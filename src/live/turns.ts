/**
 * 实时那一轮交给脑(从 call.ts 拆出来,2026-10-29,行为不变;以后是 runtime/turn):
 * 孩子端发来的那条验过、拼好(runner.accept,和 HTTP 共用),带上这一轮实时的那些(live:)交给 runner.send;
 * 这位老师别处正在写(BusyError)就排着,它写完把排着的几句合并成一条再发;脑在写时孩子又说的(submit 时 running)也排着,这一轮写完一起发。
 * 一轮写完,收尾时把流式没发出来的讲稿从正式的一节补上(整块出的运行时、最后几句)。
 */
import { lineFlags } from '../lib/board.ts';
import { localDate } from '../lib/conversation.ts';
import type { ContextPack } from '../schema/index.ts';
import { adoptPaper } from '../server/paper.ts';
import { BusyError, type Runner, type SendStarted } from '../server/runner.ts';
import { readIndex } from '../server/store.ts';
import type { Echo } from './lib/queue.ts';

export interface TurnsDeps {
  runner: Runner;
  now(): Date;
  tutor: string;
  /** 哪一台设备(升级请求里的设备 cookie):孩子发的每一条记上 */
  deviceId?: string | null;
  /** 这一轮实时的那些(接住时说的、念到第几句被打断、摸底、打电话几分钟…);body = 孩子端发来的那条(收下了才问) */
  live(body: Record<string, unknown>): NonNullable<ContextPack['live']>;
  /** 发给孩子端 */
  send(o: Record<string, unknown>): void;
  /** 脑开始写这一轮 */
  started(s: SendStarted): void;
  /** 一轮写完了,正式的那一节的讲稿(流式时没发出来的由调用方按序号补) */
  lines(job: string, lines: { i: number; text: string; play?: boolean; echo?: Echo; call?: true }[]): void;
  /** 一轮写完了(成没成都算)、排着的也发出去了 */
  settled(): void;
  /** 定时器交给调用方收(挂电话时清) */
  timer(t: NodeJS.Timeout): void;
  ended(): boolean;
}

export class Turns {
  private running: SendStarted | null = null;
  /** 脑忙时孩子又说的:等它写完合并成一条 */
  private waiting: Record<string, unknown>[] = [];
  /** 脑最近写的那一轮的话题(应用起的那一轮接在它后面) */
  private last: string | null = null;
  private readonly deps: TurnsDeps;
  constructor(deps: TurnsDeps) {
    this.deps = deps;
  }

  /** 脑在写 */
  get busy(): boolean {
    return this.running !== null;
  }
  get thread(): string | null {
    return this.last;
  }

  /** 交给脑;脑在写就排着,它写完合并发 */
  async submit(body: Record<string, unknown>): Promise<void> {
    if (this.running) {
      this.waiting.push(body);
      return;
    }
    await this.dispatch(body);
  }

  private async dispatch(body: Record<string, unknown>): Promise<void> {
    const { runner, tutor } = this.deps;
    const { app: _app, ...rest } = body;
    const r = await runner.accept(tutor, rest, localDate(this.deps.now()), this.deps.deviceId);
    if ('reject' in r) {
      this.deps.send({ t: 'err', status: r.reject.status, error: r.reject.error });
      return;
    }
    const live = this.deps.live(body);
    let started: SendStarted;
    try {
      started = await runner.send(tutor, { ...r.input, live });
    } catch (err) {
      // 别处(页面、工作台)正在让这位老师写:排着,它写完再发
      if (err instanceof BusyError) {
        this.waiting.push(body);
        this.afterBusy();
        return;
      }
      this.deps.send({ t: 'err', status: 500, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    this.running = started;
    this.deps.started(started);
    this.last = started.thread;
    // 新话题的第一条:话题还没有时画的那张纸归它
    if (started.thread === started.job) void adoptPaper(runner.ws, tutor, started.date, started.thread);
    const job = started.job;
    void started.done
      .then(async (index) => {
        // 收尾:整块出的运行时、或流式时没发出来的最后几句,从正式的一节补上
        const m = index.messages.find((x) => x.job === job) ?? (await readIndex(runner.ws, tutor, started.date)).messages.find((x) => x.job === job);
        const sec = m?.section;
        if (sec) this.deps.lines(job, sec.lines.map((l, i) => ({ i, text: l.text, ...lineFlags(l, sec.cards) })));
      }, () => {})
      .finally(() => {
        if (this.running === started) this.running = null;
        this.flushWaiting();
        this.deps.settled();
      });
  }

  /** 别处在写:等那一轮完了再发排着的 */
  private afterBusy(): void {
    const { runner, tutor } = this.deps;
    const busy = runner.running(tutor);
    const poll = setInterval(() => {
      if (this.deps.ended() || runner.running(tutor)?.job === busy?.job) return;
      clearInterval(poll);
      this.flushWaiting();
    }, 200);
    this.deps.timer(poll);
  }

  /** 脑忙时孩子说的几句:合并成一条(话题等照最后一句的),发 */
  private flushWaiting(): void {
    if (this.deps.ended() || this.running || !this.waiting.length) return;
    const all = this.waiting.splice(0);
    const last = all[all.length - 1];
    void this.dispatch({ ...last, text: all.map((b) => String(b.text ?? '').trim()).filter(Boolean).join('\n') });
  }
}
