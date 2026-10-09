/**
 * 预热(《工作流程.md》§四「预热」,2026-09-29):消息走 stdin 的运行时,下一轮的老师进程提前起好、在 stdin 上等着;
 * 孩子开口时对得上就接过来写消息,省掉起进程与读会话(真跑冷起中位 1.8 秒,预热约 0.07 秒)。
 * 一位老师两个位置:resume(接某个话题的会话)与 fresh(新开会话:新话题、接着上次)。
 * 对得上 = argv、适配器定的环境变量、cwd、日期、**这个话题**末条 job 都和它起来时一样(fresh 没有会话,末条记 null):
 * argv 管换话题 / 会话 / 老师正文 / effort / cotutor.json,末条 job 管「会话被别的进程写过」(它起来时读的会话就旧了,拿它写会分叉)。
 * 对不上、闲置超时、自己退了,都杀掉,调用方走冷起。开口前吐的字节(claude 实测一个都没有)先攒着,接过来时交出去。
 */
import { spawn, type ChildProcess } from 'node:child_process';

/** 备用进程闲置多久杀掉(闲着不花钱,只占内存,真跑一个约 64MB) */
export const WARM_IDLE_MS = 60 * 60_000;

/** resume:接某个话题的会话;fresh:新开会话 */
export type Slot = 'resume' | 'fresh';
export const SLOTS: readonly Slot[] = ['resume', 'fresh'];

/** 对得上才用:argv、适配器定的环境变量、cwd、日期、这个话题末条 job(fresh 为 null) */
export interface SpareKey {
  argv: readonly string[];
  /** 计划里适配器定的环境变量(qwen 按 effort 选的配置之类);不给当空 */
  env?: Readonly<Record<string, string>>;
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

const keyOf = (k: SpareKey): string => JSON.stringify([k.argv, Object.entries(k.env ?? {}).sort(), k.cwd, k.date, k.lastJob]);
const at = (tutor: string, slot: Slot): string => `${tutor}\n${slot}`;

export class WarmPool {
  private readonly held = new Map<string, Held>();
  private readonly idleMs: number;
  constructor(opts: { idleMs?: number } = {}) {
    this.idleMs = opts.idleMs ?? WARM_IDLE_MS;
  }

  /** 这位老师这个位置(不给 = 任一位置)有没有活着的备用进程 */
  has(tutor: string, slot?: Slot): boolean {
    return (slot ? [slot] : SLOTS).some((s) => {
      const h = this.held.get(at(tutor, s));
      return Boolean(h && !h.exited);
    });
  }

  /** 在这个位置起一个备用进程;已有一个对得上的就不动,对不上的先杀 */
  warm(tutor: string, slot: Slot, key: SpareKey, env: NodeJS.ProcessEnv): void {
    const id = at(tutor, slot);
    const k = keyOf(key);
    const cur = this.held.get(id);
    if (cur && !cur.exited && cur.key === k) return;
    this.drop(tutor, slot);
    const child = spawn(key.argv[0], key.argv.slice(1), { cwd: key.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const h: Held = { child, bornAt: Date.now(), stdout: [], stderr: [], key: k, exited: false, idle: setTimeout(() => this.drop(tutor, slot), this.idleMs) };
    h.idle.unref();
    child.stdout?.on('data', (c: Buffer) => h.stdout.push(c));
    child.stderr?.on('data', (c: Buffer) => h.stderr.push(c));
    // 写 stdin 时进程已经退了(EPIPE)不该把服务带倒
    child.stdin?.on('error', () => {});
    const gone = (): void => {
      h.exited = true;
      clearTimeout(h.idle);
      if (this.held.get(id) === h) this.held.delete(id);
    };
    child.once('error', gone);
    child.once('close', gone);
    this.held.set(id, h);
  }

  /**
   * 接过这个位置的备用进程:对得上就交出去(不再归池子管);对不上 / 已经退了就杀掉,返回 null。没有也返回 null。另一个位置不动。
   * 交出去时 stdout / stderr 摘掉池子的监听并**暂停**:接手的挂好监听、先喂攒下的,再 resume(中间一个字节不丢)。
   * 池子挂的 error / close 监听留着(接手之前进程出错不至于成了没人接的 error 事件);进程可能在接手之前就退了,接手的看 closed()。
   */
  claim(tutor: string, slot: Slot, key: SpareKey): Spare | null {
    const id = at(tutor, slot);
    const h = this.held.get(id);
    if (!h) return null;
    this.held.delete(id);
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

  /** 杀掉这位老师这个位置(不给 = 两个位置)的备用进程 */
  drop(tutor: string, slot?: Slot): void {
    for (const s of slot ? [slot] : SLOTS) {
      const id = at(tutor, s);
      const h = this.held.get(id);
      if (!h) continue;
      this.held.delete(id);
      clearTimeout(h.idle);
      kill(h.child);
    }
  }

  dropAll(): void {
    for (const h of this.held.values()) {
      clearTimeout(h.idle);
      kill(h.child);
    }
    this.held.clear();
  }
}

/** 关 stdin 让它自己退;2 秒还在就 SIGKILL */
function kill(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin?.end();
  child.kill('SIGTERM');
  setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000).unref();
}
