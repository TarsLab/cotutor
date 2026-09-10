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

export function synthesize(tts: Tts, vars: { text: string; voice: string; out: string }, opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<TtsResult> {
  const argv = fillTts(tts.say, vars);
  return new Promise((resolveResult) => {
    execFile(argv[0], argv.slice(1), { env: opts.env ?? process.env, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 1 << 20 }, async (err, _stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const why = code === 'ENOENT' ? `PATH 里没有 ${argv[0]}` : `${err.message}${stderr ? `\n${String(stderr).trim().slice(-500)}` : ''}`;
        return resolveResult({ file: null, error: why });
      }
      const st = await stat(vars.out).catch(() => null);
      if (!st?.isFile() || st.size === 0) return resolveResult({ file: null, error: `命令跑完了但 ${vars.out} 没有内容` });
      resolveResult({ file: vars.out, error: null });
    });
  });
}

/** 合成一条并把失败原因追加到 err.log;返回文件名(相对 conversations/<老师>/)或 null */
export async function dubReply(tts: Tts, text: string, voice: string, files: { audio: string; err: string }, env?: NodeJS.ProcessEnv): Promise<string | null> {
  const r = await synthesize(tts, { text, voice, out: files.audio }, { env });
  if (r.error) await appendFile(files.err, `cotutor tts: 没合成(${r.error});孩子端用浏览器的声\n`).catch(() => {});
  return r.file ? files.audio.slice(files.audio.lastIndexOf('/') + 1) : null;
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
  constructor(tts: Tts, voice: string, err: string, env?: NodeJS.ProcessEnv) {
    this.tts = tts;
    this.voice = voice;
    this.err = err;
    this.env = env;
  }

  /** 合成 text 到 out;resolve 成文件名(最后一段)或 null;label 是 err.log 里的称呼 */
  add(out: string, text: string, label: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.queue.push(async () => {
        const r = await synthesize(this.tts, { text, voice: this.voice, out }, { env: this.env });
        if (r.error) await appendFile(this.err, `cotutor tts: ${label}没合成(${r.error});用浏览器的声\n`).catch(() => {});
        resolve(r.error ? null : out.slice(out.lastIndexOf('/') + 1));
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
  add(i: number, text: string): void {
    const t = text.trim();
    const had = this.jobs.get(i);
    if (!t || (had && had.text === t)) return;
    const after = had ? had.done.catch(() => null) : Promise.resolve(null);
    const done = after.then(() => this.q.add(this.lineAudio(i + 1), t, `第 ${i + 1} 句`));
    this.jobs.set(i, { text: t, done });
  }

  /** 最终讲稿:每句拿文件名(已配的直接用,没配的现配) */
  async finish(lines: readonly { text: string }[]): Promise<(string | null)[]> {
    lines.forEach((l, i) => this.add(i, l.text));
    return Promise.all(lines.map((l, i) => (l.text.trim() ? this.jobs.get(i)!.done : Promise.resolve(null))));
  }
}
