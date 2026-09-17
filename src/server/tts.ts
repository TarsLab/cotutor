/**
 * 配音:老师说完,把 kidText 按 cotutor.json 的 tts 运行时合成到 conversations/<老师>/<日期>.<job>.mp3。
 * 失败不响、不阻塞对话:这条没有音频,孩子端退回浏览器自带的声;原因写进 err.log 供家长看。
 * 音色是人设(tutors[].voice),没配就不合成——「无缺省音色」是 voxtell 的政策,这里照办。
 */
import { execFile } from 'node:child_process';
import { appendFile, stat } from 'node:fs/promises';
import { fillTts, type Tts } from '../schema/index.ts';

export interface TtsResult {
  /** 成功 → 输出文件路径;失败 → null */
  file: string | null;
  error: string | null;
}

/** 子进程失败的原因:没装 / 退出码 + 它自己说的话(voxtell 带 --json 时错误是一份 JSON,在 stderr;只取它的 message) */
function explainExec(argv: readonly string[], err: Error, stdout: unknown, stderr: unknown): string {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') return `PATH 里没有 ${argv[0]}`;
  const said = `${String(stderr ?? '').trim()}\n${String(stdout ?? '').trim()}`.trim().slice(-500);
  let detail = said;
  for (const chunk of [stdout, stderr]) {
    try {
      const j = JSON.parse(String(chunk ?? '')) as { message?: unknown; error?: unknown };
      if (typeof j.message === 'string') detail = j.message;
      else if (typeof j.error === 'string') detail = j.error;
      else continue;
      break;
    } catch {
      /* 不是 JSON 就原样 */
    }
  }
  return `${argv[0]} ${argv[1] ?? ''} 失败${detail ? `:${detail}` : `(${err.message})`}`;
}

export function synthesize(tts: Tts, vars: { text: string; voice: string; out: string }, opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<TtsResult> {
  const argv = fillTts(tts.say, vars);
  return new Promise((resolveResult) => {
    execFile(argv[0], argv.slice(1), { env: opts.env ?? process.env, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 1 << 20 }, async (err, stdout, stderr) => {
      if (err) return resolveResult({ file: null, error: explainExec(argv, err, stdout, stderr) });
      const st = await stat(vars.out).catch(() => null);
      if (!st?.isFile() || st.size === 0) return resolveResult({ file: null, error: `命令跑完了但 ${vars.out} 没有内容` });
      resolveResult({ file: vars.out, error: null });
    });
  });
}

/** 一个音色:voice 是 id(填进 tutors.*.voice 的),其余是给家长挑的时候看的 */
export interface VoiceInfo {
  voice: string;
  name: string;
  gender?: string;
  age?: number;
  trait?: string;
  scene?: string;
  lang?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * 列音色:跑 tts.voices(缺省 voxtell voices --json),stdout 认两种形状——{voices: [...]} 或直接数组;
 * 每项至少要有 voice(id),name 缺了用 id 顶。失败不抛,error 带原因给家长端显示。
 */
export function listVoices(tts: Tts, opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<{ voices: VoiceInfo[]; error: string | null }> {
  const argv = tts.voices;
  return new Promise((resolveResult) => {
    execFile(argv[0], argv.slice(1), { env: opts.env ?? process.env, timeout: opts.timeoutMs ?? 30_000, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      if (err) return resolveResult({ voices: [], error: explainExec(argv, err, stdout, stderr) });
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(stdout));
      } catch {
        return resolveResult({ voices: [], error: `${argv.join(' ')} 的输出不是 JSON` });
      }
      const raw = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { voices?: unknown }).voices) ? ((parsed as { voices: unknown[] }).voices) : null;
      if (!raw) return resolveResult({ voices: [], error: `${argv.join(' ')} 的输出里没有 voices 数组` });
      const voices: VoiceInfo[] = [];
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const voice = str(o.voice) ?? str(o.id);
        if (!voice) continue;
        const age = typeof o.age === 'number' && Number.isFinite(o.age) ? o.age : undefined;
        voices.push({ voice, name: str(o.name) ?? voice, gender: str(o.gender), age, trait: str(o.trait), scene: str(o.scene), lang: str(o.lang) });
      }
      resolveResult({ voices, error: null });
    });
  });
}

/**
 * 一轮的配音队列:讲稿句与点读段同一条队,三个并行,先进先出(讲稿句在流式时就进了,自然排在点读段前面)。
 * 每个文件一项;失败写 err.log、结果 null。
 */
export class DubQueue {
  private readonly queue: (() => Promise<void>)[] = [];
  private running = 0;
  private readonly tts: Tts;
  private readonly voice: string;
  private readonly err: string;
  private readonly env?: NodeJS.ProcessEnv;
  /** 每条的进展(排队 / 完成 / 失败)报给谁:runner 把它变成 tts 道的事件 */
  report?: (e: { kind: 'queued' | 'done' | 'failed'; label: string; ms: number; file?: string; error?: string }) => void;
  constructor(tts: Tts, voice: string, err: string, env?: NodeJS.ProcessEnv) {
    this.tts = tts;
    this.voice = voice;
    this.err = err;
    this.env = env;
  }

  /** 合成 text 到 out;resolve 成文件名(最后一段)或 null;label 是 err.log 里的称呼 */
  add(out: string, text: string, label: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.report?.({ kind: 'queued', label, ms: 0 });
      const t0 = Date.now();
      this.queue.push(async () => {
        const r = await synthesize(this.tts, { text, voice: this.voice, out }, { env: this.env });
        if (r.error) await appendFile(this.err, `cotutor tts: ${label}没合成(${r.error});用浏览器的声\n`).catch(() => {});
        const file = out.slice(out.lastIndexOf('/') + 1);
        if (r.error) this.report?.({ kind: 'failed', label, ms: Date.now() - t0, error: r.error });
        else this.report?.({ kind: 'done', label, ms: Date.now() - t0, file });
        resolve(r.error ? null : file);
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < 3 && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void job().finally(() => {
        this.running--;
        this.pump();
      });
    }
  }
}

/**
 * 边讲边配:流式时讲稿每写完一句就交进来(add),整轮跑完 finish(最终句子)——同下标同文本的直接用,
 * 不一样的(极少:末句被截、partial 与最终切句不同)重配到同一个文件。失败句 null。
 */
export class LineDubber {
  private readonly jobs = new Map<number, { text: string; done: Promise<string | null> }>();
  private readonly q: DubQueue;
  private readonly lineAudio: (n: number) => string;
  constructor(q: DubQueue, lineAudio: (n: number) => string) {
    this.q = q;
    this.lineAudio = lineAudio;
  }

  /** 第 i 句(0 起)定稿了;同下标同文本不重配 */
  add(i: number, text: string): Promise<string | null> | null {
    const t = text.trim();
    const had = this.jobs.get(i);
    if (!t) return null;
    if (had && had.text === t) return had.done;
    const after = had ? had.done.catch(() => null) : Promise.resolve(null);
    const done = after.then(() => this.q.add(this.lineAudio(i + 1), t, `第 ${i + 1} 句`));
    this.jobs.set(i, { text: t, done });
    return done;
  }

  /** 最终讲稿:每句拿文件名(已配的直接用,没配的现配) */
  async finish(lines: readonly { text: string }[]): Promise<(string | null)[]> {
    lines.forEach((l, i) => this.add(i, l.text));
    return Promise.all(lines.map((l, i) => (l.text.trim() ? this.jobs.get(i)!.done : Promise.resolve(null))));
  }
}
