/**
 * dub:课包配音 —— drawtell 侧的粘合。语音 CLI(voxtell)是通用机制、不认识"课包",
 * 这里只做:读 manifest 各步 line → 写 jobs.json → voxtell batch → 音频落进 bundles/<id>/audio/ →
 * 写 audio/index.json(步 ↔ 文件 ↔ 讲稿 hash)→ 回填 manifest 的 audioSrc。
 * 课包自包含不变(audio/ 是缓存回填的拷贝,iPad 整目录下载离线播);缓存归 voxtell 用户级目录,
 * 改一句讲稿只重合成那一句(voxtell 的 key 按条算)。
 * 音色/语气是应用政策:--voice 必填,或写在工作区根 drawtell.json 的 dub 段;本命令不带默认音色。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChalkScene } from '../player/types.ts';
import type { LessonManifest } from '../schema/lesson-manifest.ts';
import { stretchToAudio, type StretchInfo } from '../player/timeline.ts';

/** 讲稿 hash:build 用它判断 audio/ 里的音频是否仍对应当前讲稿(讲稿改了 = 音频失效,不回填) */
export function lineHash(line: string): string {
  return createHash('sha1').update(line).digest('hex').slice(0, 16);
}

export interface AudioIndex {
  schema: 'drawtell-audio';
  version: 1;
  voice: string;
  model: string | null;
  instruction: string | null;
  steps: Array<{ step: number; file: string; textHash: string; characters: number; durationMs: number | null }>;
}

export interface DubOptions {
  scene: ChalkScene;
  bundleDir: string;
  voice: string;
  instruction?: string;
  model?: string;
  dryRun?: boolean;
  force?: boolean;
  /** voxtell 可执行(路径以 .js 结尾时用当前 node 跑);缺省按 DRAWTELL_VOXTELL → PATH → 同级检出 解析 */
  voxtellBin?: string;
}

export interface DubResult {
  ok: boolean;
  dryRun: boolean;
  jobsFile: string;
  audioDir: string;
  summary: { jobs: number; characters: number; hits: number; misses: number; billedCharacters: number; failed: number; estimatedCost: number | null };
  steps: Array<{ step: number; file: string | null; cached: boolean; characters: number; durationMs: number | null; error?: string }>;
  /** 每步 画多久 / 音多久 / 播放器会拉伸几倍(只拉不缩,封顶 5) */
  pacing: StretchInfo[];
  manifestUpdated: boolean;
}

interface VoxtellResults {
  ok?: boolean;
  jobs: Array<{ id: string; text: string; file: string | null; characters: number; cached: boolean; durationMs?: number | null; error?: string }>;
  summary: DubResult['summary'];
}

const DRAWTELL_ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** 解析 voxtell:显式路径 → env → PATH 里的 voxtell → 与 drawtell 同级检出的 ../voxtell/bin/voxtell.js */
export async function resolveVoxtell(explicit?: string): Promise<{ cmd: string; args: string[]; how: string }> {
  const candidate = explicit ?? process.env.DRAWTELL_VOXTELL;
  if (candidate) {
    const p = resolve(candidate);
    if (!(await exists(p))) throw new Error(`voxtell 路径不存在:${p}(--voxtell / DRAWTELL_VOXTELL)`);
    return p.endsWith('.js') ? { cmd: process.execPath, args: [p], how: p } : { cmd: p, args: [], how: p };
  }
  const sibling = resolve(DRAWTELL_ROOT, '..', 'voxtell', 'bin', 'voxtell.js');
  if (await exists(sibling)) return { cmd: process.execPath, args: [sibling], how: sibling };
  return { cmd: 'voxtell', args: [], how: 'PATH' };
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', rej);
    child.on('close', (code) => res({ code: code ?? 4, stdout, stderr }));
  });
}

export async function dubBundle(o: DubOptions): Promise<DubResult> {
  const audioDir = join(o.bundleDir, 'audio');
  await mkdir(audioDir, { recursive: true });
  const jobsFile = join(audioDir, 'jobs.json');
  const jobs = {
    schema: 'voxtell-jobs',
    version: 1,
    defaults: {
      voice: o.voice,
      ...(o.model ? { model: o.model } : {}),
      ...(o.instruction ? { instruction: o.instruction } : {}),
      format: 'mp3',
      languageHints: ['zh'],
    },
    jobs: o.scene.steps.map((s) => ({ id: `step-${s.step}`, text: s.line })),
  };
  await writeFile(jobsFile, `${JSON.stringify(jobs, null, 2)}\n`);

  const vx = await resolveVoxtell(o.voxtellBin);
  const args = [...vx.args, 'batch', jobsFile, '--out-dir', audioDir, '--json', ...(o.dryRun ? ['--dry-run'] : []), ...(o.force ? ['--force'] : [])];
  let r: { code: number; stdout: string; stderr: string };
  try {
    r = await run(vx.cmd, args);
  } catch (err) {
    throw new Error(`起不来 voxtell(${vx.how}):${err instanceof Error ? err.message : String(err)}。装 voxtell 或用 --voxtell <path> / DRAWTELL_VOXTELL 指定`);
  }
  let parsed: VoxtellResults | null = null;
  try {
    parsed = JSON.parse(r.stdout) as VoxtellResults;
  } catch {
    /* 非 JSON:下面按 stderr 报 */
  }
  if (!parsed) {
    let msg = r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`;
    try {
      const e = JSON.parse(r.stderr) as { message?: string };
      if (e.message) msg = e.message;
    } catch {
      /* 保留原文 */
    }
    throw new Error(`voxtell batch 失败(exit ${r.code}):${msg}`);
  }

  const steps = o.scene.steps.map((s) => {
    const j = parsed!.jobs.find((x) => x.id === `step-${s.step}`);
    return { step: s.step, file: j?.file ? `step-${s.step}.mp3` : null, cached: !!j?.cached, characters: j?.characters ?? 0, durationMs: j?.durationMs ?? null, error: j?.error };
  });
  const pacing = stretchToAudio(o.scene.skeletons, o.scene.steps, { durations: steps.map((x) => x.durationMs) }).info;
  const result: DubResult = {
    ok: parsed.summary.failed === 0,
    dryRun: !!o.dryRun,
    jobsFile,
    audioDir,
    summary: parsed.summary,
    steps,
    pacing,
    manifestUpdated: false,
  };
  if (o.dryRun || !result.ok) return result;

  const index: AudioIndex = {
    schema: 'drawtell-audio',
    version: 1,
    voice: o.voice,
    model: o.model ?? null,
    instruction: o.instruction ?? null,
    steps: o.scene.steps.map((s, i) => ({ step: s.step, file: `step-${s.step}.mp3`, textHash: lineHash(s.line), characters: steps[i].characters, durationMs: steps[i].durationMs })),
  };
  await writeFile(join(audioDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  // 回填 manifest.audioSrc(build 也会按 audio/index.json 回填,这里让当前课包立刻可播)
  const manifestPath = join(o.bundleDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as LessonManifest;
  manifest.steps = manifest.steps.map((s) => {
    const d = steps.find((x) => x.step === s.step)?.durationMs;
    return { ...s, audioSrc: `audio/step-${s.step}.mp3`, ...(d ? { audioDurationMs: d } : {}) };
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  result.manifestUpdated = true;
  return result;
}

/** build 用:audio/index.json 里讲稿 hash 仍匹配的步,回填 audioSrc;讲稿改了的步不回填(等重新 dub) */
export async function attachAudio(bundleDir: string, manifest: LessonManifest): Promise<number> {
  let index: AudioIndex;
  try {
    index = JSON.parse(await readFile(join(bundleDir, 'audio', 'index.json'), 'utf8')) as AudioIndex;
  } catch {
    return 0;
  }
  if (index?.schema !== 'drawtell-audio' || !Array.isArray(index.steps)) return 0;
  let n = 0;
  for (const s of manifest.steps) {
    if (s.audioSrc) continue; // 场景作者显式给的优先
    const e = index.steps.find((x) => x.step === s.step);
    if (!e || e.textHash !== lineHash(s.line)) continue;
    if (!(await exists(join(bundleDir, 'audio', e.file)))) continue;
    s.audioSrc = `audio/${e.file}`;
    if (e.durationMs) s.audioDurationMs = e.durationMs;
    n++;
  }
  return n;
}
