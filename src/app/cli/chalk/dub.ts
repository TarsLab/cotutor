/**
 * dub:课包配音。manifest 各步的讲稿 → 配音(src/media/tts.ts,和卡的配音同一条线、同一份缓存)→ bundles/<id>/audio/step-<n>.mp3 →
 * audio/index.json(步 ↔ 文件 ↔ 讲稿 hash ↔ 时长)→ 回填 manifest 的 audioSrc / audioDurationMs。
 * 课包自包含不变(audio/ 是拷贝,iPad 整目录离线播)。讲稿与音色都没变的步不重配;变了的去合成(缓存里有就不花钱)。
 * 时长从 mp3 帧头量(src/media/mp3.ts):播放器按它把这一步的笔画拉伸到讲稿那么长。
 * 2026-10-31 以前是起 voxtell batch;audio/index.json 的格式与 schema 名(drawtell-audio)照旧,已经配好的课包不用重配。
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChalkScene } from '../../../chalk/types.ts';
import type { LessonManifest } from '../../../chalk/manifest.ts';
import { stretchToAudio, type StretchInfo } from '../../../chalk/timeline.ts';
import { mp3DurationMs } from '../../../media/mp3.ts';
import { synthesize, ttsModelOf } from '../../../media/tts.ts';

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
  /** 只算账:哪几步要合成、约多少计费字符,不花钱 */
  dryRun?: boolean;
  /** 配音缓存(workspace 的 dirs.tts) */
  cacheDir: string;
  env?: NodeJS.ProcessEnv;
}

export interface DubResult {
  ok: boolean;
  dryRun: boolean;
  /** 约多少计费字符(汉字算 2、别的算 1;voxtell 实测和账单差 ±5%) */
  characters: number;
  /** kept = 讲稿与音色都没变,沿用课包里那份 */
  steps: Array<{ step: number; file: string | null; kept: boolean; characters: number; durationMs: number | null; error?: string }>;
  /** 每步 画多久 / 音多久 / 播放器会拉伸几倍(只拉不缩,封顶 5) */
  pacing: StretchInfo[];
  manifestUpdated: boolean;
}

const estimate = (text: string): number => [...text].reduce((n, ch) => n + (/\p{Script=Han}/u.test(ch) ? 2 : 1), 0);

async function exists(p: string): Promise<boolean> {
  return access(p).then(() => true, () => false);
}

async function readIndex(bundleDir: string): Promise<AudioIndex | null> {
  try {
    const index = JSON.parse(await readFile(join(bundleDir, 'audio', 'index.json'), 'utf8')) as AudioIndex;
    return index?.schema === 'drawtell-audio' && Array.isArray(index.steps) ? index : null;
  } catch {
    return null;
  }
}

export async function dubBundle(o: DubOptions): Promise<DubResult> {
  const audioDir = join(o.bundleDir, 'audio');
  const old = await readIndex(o.bundleDir);
  const sameVoice = old !== null && old.voice === o.voice && (old.instruction ?? null) === (o.instruction ?? null);
  const steps: DubResult['steps'] = [];
  for (const s of o.scene.steps) {
    const file = `step-${s.step}.mp3`;
    const prev = sameVoice ? old.steps.find((x) => x.step === s.step && x.textHash === lineHash(s.line)) : undefined;
    const characters = estimate(s.line);
    if (prev && (await exists(join(audioDir, prev.file)))) {
      steps.push({ step: s.step, file: prev.file, kept: true, characters, durationMs: prev.durationMs });
      continue;
    }
    if (o.dryRun) {
      steps.push({ step: s.step, file: null, kept: false, characters, durationMs: null });
      continue;
    }
    await mkdir(audioDir, { recursive: true });
    const r = await synthesize({ text: s.line, voice: o.voice, instruction: o.instruction, out: join(audioDir, file) }, { cacheDir: o.cacheDir, env: o.env });
    if (!r.file) steps.push({ step: s.step, file: null, kept: false, characters, durationMs: null, error: r.error ?? '?' });
    else steps.push({ step: s.step, file, kept: false, characters, durationMs: mp3DurationMs(new Uint8Array(await readFile(r.file))) });
  }
  const pacing = stretchToAudio(o.scene.skeletons, o.scene.steps, { durations: steps.map((x) => x.durationMs) }).info;
  const result: DubResult = {
    ok: !steps.some((x) => x.error),
    dryRun: Boolean(o.dryRun),
    characters: steps.filter((x) => !x.kept).reduce((n, x) => n + x.characters, 0),
    steps,
    pacing,
    manifestUpdated: false,
  };
  if (o.dryRun || !result.ok) return result;

  const index: AudioIndex = {
    schema: 'drawtell-audio',
    version: 1,
    voice: o.voice,
    model: ttsModelOf(o.voice),
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
  const index = await readIndex(bundleDir);
  if (!index) return 0;
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
