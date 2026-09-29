/**
 * 预热(《工作流程.md》§四「预热」,2026-09-29):消息走 stdin 的运行时,下一轮的老师进程提前起好、在 stdin 上等着;
 * 孩子开口时对得上就接过来写消息,省掉起进程与读会话(真跑冷起中位 1.8 秒,预热约 0.07 秒)。
 * 一位老师最多一个备用进程。对得上 = argv、cwd、日期、当天索引末条 job 都和它起来时一样:
 * argv 管换话题 / 会话 / 老师正文 / effort / cotutor.json,末条 job 管「会话被别的进程写过」(它起来时读的会话就旧了,拿它写会分叉)。
 * 对不上、闲置超时、自己退了,都杀掉,调用方走冷起。开口前吐的字节(claude 实测一个都没有)先攒着,接过来时交出去。
 */
import { spawn, type ChildProcess } from 'node:child_process';

/** 备用进程闲置多久杀掉 */
export const WARM_IDLE_MS = 60 * 60_000;

/** 对得上才用:argv、cwd、日期、当天索引末条 job */
export interface SpareKey {
  argv: readonly string[];
  cwd: string;
  date: string;
  lastJob: string | null;
}

export interface Spare {
  child: ChildProcess;
  /** 起来的时刻(Date.now()) */
  bornAt: number;
  /** 接过来之前 stdout / stderr 吐的(claude 开口前不吐;假 CLI 也不吐) */
  stdout: Buffer[];
  stderr: Buffer[];
  /** 进程已经 close(或起不来)了:接手之前就发生的 close 接手的等不到,看这个 */
  closed: () => boolean;
}

interface Held extends Omit<Spare, 'closed'> {
  key: string;
  exited: boolean;
  idle: NodeJS.Timeout;
}

const keyOf = (k: SpareKey): string => JSON.stringify([k.argv, k.cwd, k.date, k.lastJob]);

export class WarmPool {
  private readonly held = new Map<string, Held>();
  private readonly idleMs: number;
  constructor(opts: { idleMs?: number } = {}) {
    this.idleMs = opts.idleMs ?? WARM_IDLE_MS;
  }

  /** 这位老师有没有活着的备用进程 */
  has(tutor: string): boolean {
    const h = this.held.get(tutor);
    return Boolean(h && !h.exited);
  }

  /** 起一个备用进程;已有一个对得上的就不动,对不上的先杀 */
  warm(tutor: string, key: SpareKey, env: NodeJS.ProcessEnv): void {
    const k = keyOf(key);
    const cur = this.held.get(tutor);
    if (cur && !cur.exited && cur.key === k) return;
    this.drop(tutor);
    const child = spawn(key.argv[0], key.argv.slice(1), { cwd: key.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const h: Held = { child, bornAt: Date.now(), stdout: [], stderr: [], key: k, exited: false, idle: setTimeout(() => this.drop(tutor), this.idleMs) };
    h.idle.unref();
    child.stdout?.on('data', (c: Buffer) => h.stdout.push(c));
    child.stderr?.on('data', (c: Buffer) => h.stderr.push(c));
    // 写 stdin 时进程已经退了(EPIPE)不该把服务带倒
    child.stdin?.on('error', () => {});
    const gone = (): void => {
      h.exited = true;
      clearTimeout(h.idle);
      if (this.held.get(tutor) === h) this.held.delete(tutor);
    };
    child.once('error', gone);
    child.once('close', gone);
    this.held.set(tutor, h);
  }

  /**
   * 接过备用进程:对得上就交出去(不再归池子管);对不上 / 已经退了就杀掉,返回 null。没有备用进程也返回 null。
   * 交出去时 stdout / stderr 摘掉池子的监听并**暂停**:接手的挂好监听、先喂攒下的,再 resume(中间一个字节不丢)。
   * 池子挂的 error / close 监听留着(接手之前进程出错不至于成了没人接的 error 事件);进程可能在接手之前就退了,接手的要看 exitCode。
   */
  claim(tutor: string, key: SpareKey): Spare | null {
    const h = this.held.get(tutor);
    if (!h) return null;
    this.held.delete(tutor);
    clearTimeout(h.idle);
    if (h.exited || h.key !== keyOf(key)) {
      kill(h.child);
      return null;
    }
    for (const s of [h.child.stdout, h.child.stderr]) {
      s?.removeAllListeners('data');
      s?.pause();
    }
    return { child: h.child, bornAt: h.bornAt, stdout: h.stdout, stderr: h.stderr, closed: () => h.exited };
  }

  drop(tutor: string): void {
    const h = this.held.get(tutor);
    if (!h) return;
    this.held.delete(tutor);
    clearTimeout(h.idle);
    kill(h.child);
  }

  dropAll(): void {
    for (const t of [...this.held.keys()]) this.drop(t);
  }
}

/** 关 stdin 让它自己退;2 秒还在就 SIGKILL */
function kill(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin?.end();
  child.kill('SIGTERM');
  setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000).unref();
}
