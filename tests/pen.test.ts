/** 收笔(src/runtime/live/pen.ts 的 turnStep):抬笔以后停多久替孩子交给老师。做法同 live-player.test.ts 对 liveStep:先把每种事写清预期。 */
import { penInit, turnStep, type PenDo, type PenEvent, type PenState } from '../src/runtime/live/pen.ts';
import { LIVE_DEFAULT } from '../src/schema/config.ts';
import { check, done } from './_check.ts';

const T = { blankMs: 2500, stripMs: 6000, retryMs: 1000 };
const run = (evs: PenEvent[], s: PenState = penInit()): { s: PenState; dos: PenDo[][] } => {
  const dos: PenDo[][] = [];
  for (const ev of evs) { const r = turnStep(s, ev, T); s = r.s; dos.push(r.do); }
  return { s, dos };
};
const j = (x: unknown): string => JSON.stringify(x);

check('缺省的秒数:空位 2.5 秒、白纸条 6 秒(cotutor.json 的 live.pen 能改)', LIVE_DEFAULT.pen.blankMs === 2500 && LIVE_DEFAULT.pen.stripMs === 6000);
{
  const r = run([{ e: 'down', at: 0 }, { e: 'up', at: 800, strip: false }]);
  check('在空位上写完抬笔:2.5 秒后看', j(r.dos[0]) === '[]' && j(r.dos[1]) === '[{"k":"arm","at":3300}]' && r.s.due === 3300 && !r.s.down, j(r));
  const strip = run([{ e: 'down', at: 0 }, { e: 'up', at: 800, strip: true }]);
  check('在白纸条上写、画:等久一点(6 秒)', strip.s.due === 6800, j(strip));
}
{
  const r = run([{ e: 'down', at: 0 }, { e: 'up', at: 800, strip: false }, { e: 'down', at: 2000 }, { e: 'due', at: 3300, busy: false }, { e: 'up', at: 4000, strip: false }, { e: 'due', at: 6500, busy: false }]);
  check('再落笔:计时取消;笔在页上时到点不算;再抬笔重新起', j(r.dos[2]) === '[{"k":"cancel"}]' && j(r.dos[3]) === '[]' && j(r.dos[4]) === '[{"k":"arm","at":6500}]' && j(r.dos[5]) === '[{"k":"send"}]' && r.s.due === null, j(r.dos));
}
{
  const r = run([{ e: 'up', at: 0, strip: false }, { e: 'due', at: 2500, busy: true }, { e: 'due', at: 3500, busy: false }]);
  check('到点老师还在说(或脑在写、孩子在说):再等一会儿;静下来就交', j(r.dos[1]) === '[{"k":"arm","at":3500}]' && j(r.dos[2]) === '[{"k":"send"}]', j(r.dos));
  const early = run([{ e: 'up', at: 0, strip: false }, { e: 'down', at: 100 }, { e: 'up', at: 200, strip: false }, { e: 'due', at: 2500, busy: false }]);
  check('被取代的那一次计时(早到的)不交', j(early.dos[3]) === '[]' && early.s.due === 2700, j(early));
}
{
  const r = run([{ e: 'up', at: 0, strip: false }, { e: 'turn' }, { e: 'due', at: 2500, busy: false }]);
  check('孩子开口、按了给老师看、开了别的一轮:不等了,这一轮自然带着页上的样子', j(r.dos[1]) === '[{"k":"cancel"}]' && j(r.dos[2]) === '[]' && r.s.due === null);
  check('没在等的时候开了一轮:什么都不做', j(turnStep(penInit(), { e: 'turn' }, T).do) === '[]');
}
done();
