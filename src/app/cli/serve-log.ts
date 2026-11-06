/**
 * 后台服务的日志(cotutor serve --log-dir <目录>,cotutor service 装的就带它):stdout / stderr 改写进 <目录>/<日期>.log,一天一个,每行带时分秒;
 * 留 LOG_KEEP_DAYS 天,起来时、换天时删更早的。一跑几个星期,不按天切就一个文件越长越大(launchd、systemd 都不替你切)。
 * 起来之前的输出(node 自己报的、模块没加载上)还是走原来的 stdout / stderr:macOS 是 launchd 接着的 <目录>/launchd.log,Linux 是 journal。
 */
import { closeSync, mkdirSync, openSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { localDate } from '../../shared/time.ts';

export const LOG_KEEP_DAYS = 14;
const LOG_RE = /^(\d{4}-\d{2}-\d{2})\.log$/;

/** 删 keepDays 天以前的(按文件名的日期,不看修改时间);返回删了哪些 */
export function pruneLogs(dir: string, now: Date, keepDays = LOG_KEEP_DAYS): string[] {
  const oldest = localDate(new Date(now.getTime() - (keepDays - 1) * 86_400_000));
  const gone: string[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return gone; }
  for (const f of names) {
    const m = LOG_RE.exec(f);
    if (m && m[1] < oldest) { rmSync(join(dir, f), { force: true }); gone.push(f); }
  }
  return gone;
}

/** 今天写的是哪个文件 */
export const logFileFor = (dir: string, now: Date): string => join(dir, `${localDate(now)}.log`);

/**
 * 把 process.stdout / stderr 改写进按天的文件(不再写到原来的地方,免得 launchd.log 里再有一份);返回撤掉的函数(测试用)。
 * 一行开头加「时:分:秒 」;一次写进来的不一定是整行,接着上一次的不再加
 */
export function teeLogs(dir: string, opts: { now?: () => Date; keepDays?: number } = {}): () => void {
  const now = opts.now ?? (() => new Date());
  mkdirSync(dir, { recursive: true });
  let day = '';
  let fd: number | null = null;
  let atLineStart = true;
  const open = (d: Date): number => {
    const today = localDate(d);
    if (fd !== null && today === day) return fd;
    if (fd !== null) closeSync(fd);
    day = today;
    fd = openSync(logFileFor(dir, d), 'a');
    pruneLogs(dir, d, opts.keepDays);
    return fd;
  };
  const write = (chunk: unknown, encoding?: unknown): void => {
    const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) || chunk instanceof Uint8Array ? Buffer.from(chunk).toString(typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8') : String(chunk);
    if (!text) return;
    const d = now();
    const stamp = `${[d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')} `;
    let out = '';
    for (const part of text.split(/(?<=\n)/)) {
      out += (atLineStart ? stamp : '') + part;
      atLineStart = part.endsWith('\n');
    }
    try { writeSync(open(d), out); } catch { /* 写不了日志不能把服务带倒 */ }
  };
  const wrap = (stream: NodeJS.WriteStream): (() => void) => {
    const original = stream.write;
    stream.write = ((chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
      write(chunk, encoding);
      const done = typeof encoding === 'function' ? encoding : cb;
      if (typeof done === 'function') queueMicrotask(() => (done as () => void)());
      return true;
    }) as typeof stream.write;
    return () => { stream.write = original; };
  };
  const undo = [wrap(process.stdout), wrap(process.stderr)];
  open(now());
  return () => {
    for (const u of undo) u();
    if (fd !== null) closeSync(fd);
    fd = null;
  };
}
