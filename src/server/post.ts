/**
 * 板书后期的进程侧(2026-09-13 起按拍,《工作流程.md》§三):一拍关了就按 policy.post.runtime 起一次快模型
 * (claude -p --model haiku --output-format json …),等到 timeoutMs,解析 + 校验(src/lib/postprocess.ts,纯函数)→ 套到这节;
 * 每拍的输入、原始输出、丢掉的、耗时、费用攒成一份 <日期>.<job>.post.json(version 2:beats[] + 汇总;家长端「看原文」第七站)。
 * 坏了 = 没有:哪一拍失败哪一拍素版(另起一行、机械规则选笔),不重来,孩子端不知道这道工序存在。
 * runPost:整节一次(整块出的运行时、repost):各拍并行起(前文只有老师的东西,没有已定的样子),回来按顺序套。
 * repost:拿老师原文重解出这节(不动老师原文与配音),再跑一遍后期,改写索引——调提示词 / 骨架时旧板书全部能「再做一次」。
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { conversationFiles } from '../lib/conversation.ts';
import { beatsOf, type Beat, type BoardSection, type Device } from '../lib/kid-board.ts';
import { deriveKidView } from '../lib/kid-view.ts';
import { beatPrompt, parseBeatPost, validateBeatPost, type BeatKept, type BeatPostOutput } from '../lib/postprocess.ts';
import { fillRuntime, resolvePolicy, type ConversationMessage, type Policy, type ThemeManifest } from '../schema/index.ts';
import type { Workspace } from '../cli/workspace.ts';
import { readIndex, readTranscript, writeIndex } from './store.ts';
import { themeFiles } from './theme.ts';

/** 没带端就当平板横屏(iPad 是主要的端;手机打开时 rowsFor 会折) */
export const DEFAULT_DEVICE: Device = 'tablet-landscape';

/** 一拍的后期:输入、原样输出、校验 */
export interface PostBeatFile {
  beat: number;
  card: number;
  at: string;
  argv: string[];
  prompt: string;
  /** 进程 stdout 原样(截到 64K) */
  raw: string;
  /** 解析出的提案(解析不了就没有) */
  output?: BeatPostOutput;
  ok: boolean;
  error?: string;
  dropped: string[];
  kept?: BeatKept;
  ms: number;
  costUsd?: number;
}

export interface PostFile {
  version: 2;
  at: string;
  runtime: string;
  device: Device;
  theme: string;
  /** 提示词骨架用的是主题的还是出厂的 */
  template: 'theme' | 'fallback';
  beats: PostBeatFile[];
  /** 至少一拍收到了 */
  ok: boolean;
  error?: string;
  dropped: string[];
  kept: { marks: number; anchors: number; layout: boolean; looks: number };
  /** 从第一拍起到最后一拍回,毫秒 */
  ms: number;
  costUsd?: number;
}

export interface PostResult {
  section: BoardSection;
  file: PostFile;
  /** 索引消息上的摘要 */
  summary: NonNullable<ConversationMessage['post']>;
}

export interface PostOpts {
  device?: Device;
  policy?: Policy;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  cwd?: string;
}

/** claude --output-format json 的 stdout:一个对象,正文在 result,费用在 total_cost_usd;别的运行时直接把 stdout 当正文 */
export function unwrapJsonOutput(stdout: string): { text: string; costUsd?: number } {
  const t = stdout.trim();
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t) as { result?: unknown; total_cost_usd?: unknown; is_error?: unknown };
      if (typeof o.result === 'string') return { text: o.result, ...(typeof o.total_cost_usd === 'number' ? { costUsd: o.total_cost_usd } : {}) };
    } catch {
      /* 不是那种壳:整段当正文 */
    }
  }
  return { text: stdout };
}

async function spawnPost(argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ out: string; code: number | null; error?: string }> {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (r: { out: string; code: number | null; error?: string }): void => {
      if (done) return;
      done = true;
      resolve(r);
    };
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill();
      finish({ out, code: null, error: `超时(${timeoutMs}ms),这拍素版` });
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { if (out.length < 200_000) out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { if (err.length < 8000) err += d.toString(); });
    child.once('error', (e) => { clearTimeout(timer); finish({ out, code: null, error: `起不来 ${argv[0]}:${e.message}` }); });
    child.once('close', (code) => { clearTimeout(timer); finish({ out, code, ...(code ? { error: `退出码 ${code}${err.trim() ? `:${err.trim().slice(-300)}` : ''}` } : {}) }); });
  });
}

/** 这个 workspace 的后期环境:主题清单 + 骨架 + 运行时;运行时不在 → null(每拍直接算失败) */
export async function postEnv(ws: Workspace, tutor: string, opts: PostOpts): Promise<{ policy: Policy; device: Device; theme: ThemeManifest; themeName: string; template: string | null; templateSource: 'theme' | 'fallback'; run: string[] | null }> {
  const policy = opts.policy ?? resolvePolicy(ws.config, tutor);
  const device = opts.device ?? DEFAULT_DEVICE;
  const t = await themeFiles(ws.root, ws.config.kid.theme);
  const rt = ws.config.runtimes[policy.post.runtime];
  return { policy, device, theme: t.manifest, themeName: ws.config.kid.theme, template: t.post, templateSource: t.post && t.source === 'workspace' ? 'theme' : 'fallback', run: rt && typeof rt !== 'string' ? rt.run : null };
}
export type PostEnv = Awaited<ReturnType<typeof postEnv>>;

/**
 * 跑一拍:section 是拍关的那一刻的节(前面的拍已套上,作前文)。回来的提案经校验套在 section 上;失败(超时 / 起不来 / 不是 JSON)→ section 原样、file.ok false。
 * 没有卡的拍不会被叫到(没有可标的东西)。
 */
export async function runBeatPost(ws: Workspace, tutor: string, section: BoardSection, beat: Beat, env: PostEnv, opts: PostOpts): Promise<{ section: BoardSection; file: PostBeatFile }> {
  const card = beat.card ?? -1;
  const beatNo = beatsOf(section).findIndex((b) => b.card === beat.card);
  const prompt = beatPrompt(section, beat, env.device, env.theme, env.template);
  const at = (opts.now ?? new Date()).toISOString();
  const base = { beat: beatNo, card, at, prompt, dropped: [] as string[] };
  if (!env.run) return { section, file: { ...base, argv: [], raw: '', ok: false, error: `运行时 ${env.policy.post.runtime} 不在 cotutor.json 的 runtimes 里(cotutor upgrade --config 可补)`, ms: 0 } };
  const t0 = Date.now();
  const argv = fillRuntime(env.run, { agent: tutor, prompt });
  const r = await spawnPost(argv, opts.cwd ?? ws.root, { ...(opts.env ?? process.env), COTUTOR_WORKSPACE: ws.root }, env.policy.post.timeoutMs);
  const ms = Date.now() - t0;
  const raw = r.out.slice(0, 65536);
  if (r.error) return { section, file: { ...base, argv, raw, ok: false, error: r.error, ms } };
  const { text, costUsd } = unwrapJsonOutput(r.out);
  const parsed = parseBeatPost(text);
  if (!parsed.ok) return { section, file: { ...base, argv, raw, ok: false, error: `输出不合形状:${parsed.why}`, ms, ...(costUsd !== undefined ? { costUsd } : {}) } };
  const v = validateBeatPost(section, beat, env.theme, env.device, parsed.out);
  return { section: v.section, file: { ...base, argv, raw, output: parsed.out, ok: true, dropped: v.dropped, kept: v.kept, ms, ...(costUsd !== undefined ? { costUsd } : {}) } };
}

/** 各拍的文件 → 整份 .post.json + 索引摘要 */
export function assemblePost(beats: PostBeatFile[], env: PostEnv, at: string, ms: number): { file: PostFile; summary: PostResult['summary'] } {
  const okBeats = beats.filter((b) => b.ok);
  const dropped = beats.flatMap((b) => b.dropped);
  const kept = { marks: 0, anchors: 0, layout: false, looks: 0 };
  for (const b of okBeats) { kept.marks += b.kept?.marks ?? 0; kept.anchors += b.kept?.anchors ?? 0; if (b.kept?.look) kept.looks++; if (b.kept?.row === 'same') kept.layout = true; }
  const costs = beats.map((b) => b.costUsd).filter((c): c is number => typeof c === 'number');
  const costUsd = costs.length ? costs.reduce((a, b) => a + b, 0) : undefined;
  const failed = beats.filter((b) => !b.ok);
  const ok = beats.length > 0 && okBeats.length > 0;
  const error = !beats.length ? '这轮没有带卡的拍' : failed.length ? `${failed.length} 拍没成:${failed[0].error ?? '?'}` : undefined;
  const file: PostFile = { version: 2, at, runtime: env.policy.post.runtime, device: env.device, theme: env.themeName, template: env.templateSource, beats, ok, ...(error ? { error } : {}), dropped, kept, ms, ...(costUsd !== undefined ? { costUsd } : {}) };
  return { file, summary: { ok, ms, dropped: dropped.length, beats: beats.length, failed: failed.length, ...(error ? { error } : {}), ...(costUsd !== undefined ? { costUsd } : {}) } };
}

/**
 * 整节一次:有卡的拍并行起(前文只有老师的东西),回来按拍的顺序套(行要顺着长)。给整块出的运行时、repost 用;流式那条路在 runner 里按拍起。
 */
export async function runPost(ws: Workspace, tutor: string, section: BoardSection, opts: PostOpts): Promise<PostResult> {
  const env = await postEnv(ws, tutor, opts);
  const t0 = Date.now();
  const at = (opts.now ?? new Date()).toISOString();
  const beats = beatsOf(section).filter((b) => b.card !== null);
  const results = await Promise.all(beats.map((b) => runBeatPost(ws, tutor, section, b, env, opts)));
  let cur: BoardSection = section;
  const files: PostBeatFile[] = [];
  results.forEach((r, i) => {
    if (r.file.ok && r.file.output) {
      const v = validateBeatPost(cur, beatsOf(cur).find((b) => b.card === beats[i].card)!, env.theme, env.device, r.file.output);
      cur = v.section;
      files.push({ ...r.file, dropped: v.dropped, kept: v.kept });
    } else files.push(r.file);
  });
  const a = assemblePost(files, env, at, Date.now() - t0);
  return { section: files.some((f) => f.ok) ? cur : section, file: a.file, summary: a.summary };
}

export async function writePostFile(ws: Workspace, tutor: string, date: string, job: string, file: PostFile): Promise<void> {
  const target = conversationFiles(ws.dirs.conversations, tutor, date).post(job);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(file, null, 2)}\n`);
}

/** 读 .post.json;老的(整节一次的 version 1)包成只有一拍的样子给页面看 */
export async function readPostFile(ws: Workspace, tutor: string, date: string, job: string): Promise<PostFile | null> {
  try {
    const v = JSON.parse(await readFile(conversationFiles(ws.dirs.conversations, tutor, date).post(job), 'utf8')) as PostFile & { prompt?: string; raw?: string; argv?: string[]; output?: unknown };
    if (Array.isArray(v?.beats)) return v;
    if (typeof v?.prompt !== 'string') return null;
    const one: PostBeatFile = { beat: 0, card: 0, at: v.at, argv: v.argv ?? [], prompt: v.prompt, raw: v.raw ?? '', ok: v.ok, ...(v.error ? { error: v.error } : {}), dropped: v.dropped ?? [], ms: v.ms, ...(v.costUsd !== undefined ? { costUsd: v.costUsd } : {}) };
    return { version: 2, at: v.at, runtime: v.runtime, device: v.device, theme: v.theme, template: 'fallback', beats: [one], ok: v.ok, ...(v.error ? { error: v.error } : {}), dropped: v.dropped ?? [], kept: v.kept ?? { marks: 0, anchors: 0, layout: false, looks: 0 }, ms: v.ms, ...(v.costUsd !== undefined ? { costUsd: v.costUsd } : {}) };
  } catch {
    return null;
  }
}

/**
 * 再做一次后期:老师原文(.log)重解出这节 → 跑后期(整节一次,各拍并行)→ 改写索引里这条的 section 与 post。老师原文、配音、卡的状态都不动。
 * 讲稿按 replyMaxChars 截(与当时下发一致);配音文件名沿用索引里的。
 */
export async function repost(ws: Workspace, tutor: string, date: string, job: string, opts: { device?: Device; env?: NodeJS.ProcessEnv } = {}): Promise<{ ok: boolean; message?: ConversationMessage; error?: string; file?: PostFile }> {
  const index = await readIndex(ws, tutor, date);
  const m = index.messages.find((x) => x.job === job);
  if (!m) return { ok: false, error: `没有 ${job}` };
  const transcript = await readTranscript(ws, tutor, date, job);
  if (!transcript) return { ok: false, error: '转录不在,重解不了' };
  const policy = resolvePolicy(ws.config, tutor);
  const view = deriveKidView(transcript, { replyMaxChars: policy.replyMaxChars });
  if (!view.section || !view.section.cards.length) return { ok: false, error: '这轮没有卡,不用后期' };
  const section: BoardSection = { ...view.section, lines: view.section.lines.map((l, i) => ({ ...l, audio: m.section?.lines[i]?.audio ?? null })) };
  const r = await runPost(ws, tutor, section, { device: opts.device ?? m.device ?? DEFAULT_DEVICE, policy, env: opts.env });
  await writePostFile(ws, tutor, date, job, r.file);
  const latest = await readIndex(ws, tutor, date);
  const next = { ...latest, messages: latest.messages.map((x) => (x.job === job ? { ...x, section: r.section, post: r.summary } : x)) };
  await writeIndex(ws, next);
  return { ok: r.summary.ok, message: next.messages.find((x) => x.job === job), file: r.file };
}
