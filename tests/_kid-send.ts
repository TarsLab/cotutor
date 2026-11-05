/**
 * 孩子端发一条,照实时那条连接交给脑(src/runtime/live/turns.ts 的 Turns,实时通话用的就是它):验与拼走 runner.accept,带上 live: 交给 runner.send。
 * 少的只有嘴(不接住、不照念)。孩子端 2026-10-22 起只走这条路,HTTP 的发 2026-11-04 删了。
 * 回的形状同以前的路由,测试照旧看 status:收下 202 + {tutor, date, job, thread};拒了是 runner.accept 的码 + {error};
 * 老师正在写(别处起的、或上一条还没写完)不拒,排着等它写完再发(同实时)→ 202 + {queued: true}。
 */
import type { AppContext } from '../src/app/http/app.ts';
import type { ContextPack } from '../src/schema/index.ts';
import { Turns } from '../src/runtime/live/turns.ts';

export interface KidSent {
  status: number;
  json: Record<string, unknown>;
}

export async function kidSend(ctx: AppContext, tutor: string, body: unknown, opts: { deviceId?: string | null; live?: NonNullable<ContextPack['live']> } = {}): Promise<KidSent> {
  let out: KidSent | null = null;
  const turns = new Turns({
    runner: ctx.runner,
    now: () => ctx.now(),
    tutor,
    deviceId: opts.deviceId ?? null,
    live: () => opts.live ?? {},
    send: (o) => { if (o.t === 'err') out ??= { status: Number(o.status), json: { error: o.error } }; },
    started: (s) => { out ??= { status: 202, json: { tutor, date: s.date, job: s.job, thread: s.thread } }; },
    lines: () => {},
    settled: () => {},
    timer: (t) => t.unref(),
    ended: () => false,
  });
  // 实时连接上不是对象的那条直接不理(call.ts 的 send);这里回 400,测试好照旧断言
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, json: { error: 'bad_request' } };
  await turns.submit(body as Record<string, unknown>);
  return out ?? { status: 202, json: { queued: true } };
}
