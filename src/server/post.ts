/**
 * 板书后期的进程侧:按 policy.post.runtime 起快模型(claude -p --model haiku --output-format json …),等到 timeoutMs,
 * 解析 + 校验(src/lib/postprocess.ts,纯函数)→ 套用到这节;输入、原始输出、丢掉的、耗时、费用落 <日期>.<job>.post.json
 * (家长端「看原文」第七站)。坏了 = 没有:任何失败都回素版,孩子端不知道这道工序存在。
 * repost:拿老师原文重解出这节(不动老师原文与配音),再跑一遍后期,改写索引——调提示词时旧板书全部能「再做一次」。
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { conversationFiles } from '../lib/conversation.ts';
import type { BoardSection, Device } from '../lib/kid-board.ts';
import { deriveKidView } from '../lib/kid-view.ts';
import { parsePost, postPrompt, validatePost, type PostOutput } from '../lib/postprocess.ts';
import { fillRuntime, resolvePolicy, type ConversationMessage, type Policy, type ThemeManifest } from '../schema/index.ts';
import type { Workspace } from '../cli/workspace.ts';
import { readIndex, readTranscript, writeIndex } from './store.ts';
import { themeFiles } from './theme.ts';

/** 没带端就当平板横屏(iPad 是主要的端;手机打开时 rowsFor 会折) */
export const DEFAULT_DEVICE: Device = 'tablet-landscape';

export interface PostFile {
  at: string;
  runtime: string;
  argv: string[];
  device: Device;
  theme: string;
  prompt: string;
  /** 进程 stdout 原样(截到 64K) */
  raw: string;
  /** 解析出的提案(解析不了就没有) */
  output?: PostOutput;
  ok: boolean;
  error?: string;
  dropped: string[];
  kept?: { marks: number; anchors: number; layout: boolean; looks: number };
  ms: number;
  costUsd?: number;
}

export interface PostResult {
  section: BoardSection;
  file: PostFile;
  /** 索引消息上的摘要 */
  summary: NonNullable<ConversationMessage['post']>;
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
      finish({ out, code: null, error: `超时(${timeoutMs}ms),先出素版` });
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { if (out.length < 200_000) out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { if (err.length < 8000) err += d.toString(); });
    child.once('error', (e) => { clearTimeout(timer); finish({ out, code: null, error: `起不来 ${argv[0]}:${e.message}` }); });
    child.once('close', (code) => { clearTimeout(timer); finish({ out, code, ...(code ? { error: `退出码 ${code}${err.trim() ? `:${err.trim().slice(-300)}` : ''}` } : {}) }); });
  });
}

/**
 * 跑一次后期。runtime 不存在 → 直接算失败(素版);超时 / 起不来 / 输出不是 JSON / 校验全丢 → ok=false 但校验收下的部分照用。
 */
export async function runPost(ws: Workspace, tutor: string, section: BoardSection, opts: { device?: Device; policy?: Policy; env?: NodeJS.ProcessEnv; now?: Date; cwd?: string }): Promise<PostResult> {
  const policy = opts.policy ?? resolvePolicy(ws.config, tutor);
  const device = opts.device ?? DEFAULT_DEVICE;
  const theme = await themeFiles(ws.root, ws.config.kid.theme);
  const manifest: ThemeManifest = theme.manifest;
  const prompt = postPrompt(section, device, manifest);
  const t0 = Date.now();
  const at = (opts.now ?? new Date()).toISOString();
  const rt = ws.config.runtimes[policy.post.runtime];
  const base = { at, device, theme: ws.config.kid.theme, prompt, dropped: [] as string[] };
  if (!rt || typeof rt === 'string') {
    const file: PostFile = { ...base, runtime: policy.post.runtime, argv: [], raw: '', ok: false, error: `运行时 ${policy.post.runtime} 不在 cotutor.json 的 runtimes 里(cotutor upgrade --config 可补)`, ms: 0 };
    return { section, file, summary: { ok: false, ms: 0, dropped: 0, error: file.error } };
  }
  const argv = fillRuntime(rt.run, { agent: tutor, prompt });
  const r = await spawnPost(argv, opts.cwd ?? ws.root, { ...(opts.env ?? process.env), COTUTOR_WORKSPACE: ws.root }, policy.post.timeoutMs);
  const ms = Date.now() - t0;
  const raw = r.out.slice(0, 65536);
  if (r.error) {
    const file: PostFile = { ...base, runtime: policy.post.runtime, argv, raw, ok: false, error: r.error, ms };
    return { section, file, summary: { ok: false, ms, dropped: 0, error: r.error } };
  }
  const { text, costUsd } = unwrapJsonOutput(r.out);
  const parsed = parsePost(text);
  if (!parsed.ok) {
    const file: PostFile = { ...base, runtime: policy.post.runtime, argv, raw, ok: false, error: `输出不合形状:${parsed.why}`, ms, ...(costUsd !== undefined ? { costUsd } : {}) };
    return { section, file, summary: { ok: false, ms, dropped: 0, error: file.error, ...(costUsd !== undefined ? { costUsd } : {}) } };
  }
  const v = validatePost(section, manifest, device, parsed.out);
  const file: PostFile = { ...base, runtime: policy.post.runtime, argv, raw, output: parsed.out, ok: true, dropped: v.dropped, kept: v.kept, ms, ...(costUsd !== undefined ? { costUsd } : {}) };
  return { section: v.section, file, summary: { ok: true, ms, dropped: v.dropped.length, ...(costUsd !== undefined ? { costUsd } : {}) } };
}

export async function writePostFile(ws: Workspace, tutor: string, date: string, job: string, file: PostFile): Promise<void> {
  const target = conversationFiles(ws.dirs.conversations, tutor, date).post(job);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(file, null, 2)}\n`);
}

export async function readPostFile(ws: Workspace, tutor: string, date: string, job: string): Promise<PostFile | null> {
  try {
    const v = JSON.parse(await readFile(conversationFiles(ws.dirs.conversations, tutor, date).post(job), 'utf8')) as PostFile;
    return typeof v?.prompt === 'string' ? v : null;
  } catch {
    return null;
  }
}

/**
 * 再做一次后期:老师原文(.log)重解出这节 → 跑后期 → 改写索引里这条的 section 与 post。老师原文、配音、卡的状态都不动。
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
