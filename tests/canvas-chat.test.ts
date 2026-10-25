/**
 * 画板的笔迹怎么数、边画边聊什么时候开口(src/lib/canvas-chat.ts;规矩在《画板设计.md》§四)。
 * 时间线照 10-21 晚 Ray 那张(《边画边聊评估》§一):第一版红楼、楼顶一道蓝线,清空,最后一版蓝色的大浪。
 */
import { CANVAS_CHAT, canvasChatAnswered, canvasChatCleared, canvasChatDue, canvasChatInit, canvasChatSaid, canvasColorsText, canvasMinutesText, canvasStrokes, canvasSummary, type CanvasStroke } from '../src/lib/canvas-chat.ts';
import { check, done } from './_check.ts';

const RED = '#d9482b', BLUE = '#2f6fd6', BLACK = '#2b2b2b';
const el = (color: string, at: number, x: number, y: number, pts: [number, number][] = [[0, 0], [10, 10]], extra: Record<string, unknown> = {}) => ({ type: 'freedraw', strokeColor: color, updated: at, x, y, width: 10, height: 10, points: pts, customData: { layer: 'ink' }, ...extra });

// ---- 数笔迹 ----
{
  const ink = [el(RED, 1000, 0, 0), el(RED, 2000, 10, 10), el(BLUE, 3000, 800, 0, [[0, 0], [-20, 30]]), el(BLACK, 4000, 0, 0, [[0, 0]], { isDeleted: true }), el('#123456', 5000, 900, 900)];
  const s = canvasStrokes(ink);
  check('删掉的不算;颜色按舞台的三支笔叫,别的叫「别的颜色」', s.length === 4 && s.map((x) => x.color).join() === '红,红,蓝,别的颜色');
  check('外框按点算(点可以是负的)', s[2].x0 === 780 && s[2].x1 === 800 && s[2].y0 === 0 && s[2].y1 === 30);
  check('形状不对的元素不抛', canvasStrokes([{}, { points: 'x' }, null as unknown as Record<string, unknown>]).length === 2);
  const sum = canvasSummary(s);
  check('摘要:几笔、笔多的颜色在前、第一笔到最后一笔', sum.strokes === 4 && sum.colors[0].name === '红' && sum.colors[0].strokes === 2 && sum.firstAt === 1000 && sum.lastAt === 5000);
  check('在哪:红在左上、蓝在上边偏右、别的颜色在右下', sum.colors[0].where === '上边偏左' && sum.colors[1].where === '上边偏右' && sum.colors[2].where === '下边偏右', JSON.stringify(sum.colors));
  const wide = canvasSummary(canvasStrokes([el(BLUE, 1, 0, 0, [[0, 0], [1000, 800]]), el(RED, 2, 900, 700)]));
  check('一种颜色占了整张画一半以上 = 铺满大半张', wide.colors[0].name === '蓝' && wide.colors[0].where === '铺满大半张');
  check('颜色那句', canvasColorsText(sum) === '红 2 笔、蓝 1 笔、别的颜色 1 笔' && canvasColorsText(canvasSummary([])) === '还没画' && canvasColorsText(canvasSummary(canvasStrokes([el(RED, 1, 0, 0)]))) === '1 笔(红)');
  check('画了多久', canvasMinutesText(30_000) === '不到 1 分钟' && canvasMinutesText(7 * 60_000 + 20_000) === '约 7 分钟');
}

// ---- 边画边聊:什么时候说 ----
const T = CANVAS_CHAT;
const S = (color: string, at: number): CanvasStroke => ({ color, at, x0: 0, y0: 0, x1: 1, y1: 1 });
const run = (color: string, from: number, n: number, every = 1000): CanvasStroke[] => Array.from({ length: n }, (_, i) => S(color, from + i * every));
{
  const t0 = 1_000_000;
  let st = canvasChatInit(t0);
  const reds = run('红', t0 + 1000, 8);
  check('点开 20 秒内不说', canvasChatDue(st, t0 + T.openQuietMs - 1, reds, false).why === 'opened');
  const blue1 = [...reds, S('蓝', t0 + 25_000)];
  check('换了颜色、上一种画了 ≥ 5 笔,但还在画(上一笔不到 2 秒)→ 不说', canvasChatDue(st, t0 + 26_000, blue1, false).why === 'drawing');
  const d = canvasChatDue(st, t0 + 28_000, blue1, false);
  check('停了 2 秒 → 说刚画完的那种颜色,问', d.say && d.color === '红' && d.ask && d.why === 'color', JSON.stringify(d));
  check('孩子按着、嘴在说、脑在写(busy)→ 不说', canvasChatDue(st, t0 + 28_000, blue1, true).why === 'busy');
  if (d.say) st = canvasChatSaid(st, t0 + 28_000, d, blue1);
  const more = [...blue1, ...run('蓝', t0 + 30_000, 6), S('红', t0 + 50_000)];
  check('离上一句不到 45 秒 → 不说', canvasChatDue(st, t0 + 60_000, more, false).why === 'gap');
  const d2 = canvasChatDue(st, t0 + 28_000 + T.gapMs, more, false);
  check('过了 45 秒,蓝又画了 ≥ 5 笔、换回红 → 说蓝;上一问没回 → 只说不问', d2.say && d2.color === '蓝' && !d2.ask, JSON.stringify(d2));
  const answered = canvasChatAnswered(st, t0 + 60_000);
  check('孩子刚按头像说过 → 15 秒内不主动说', canvasChatDue(answered, t0 + 60_000 + T.kidQuietMs - 1, more, false).why === 'kid');
  const d3 = canvasChatDue(answered, t0 + 28_000 + T.gapMs + T.kidQuietMs, more, false);
  check('上一问回了 → 这句接着问', d3.say && d3.ask);
  if (d2.say) st = canvasChatSaid(st, t0 + 28_000 + T.gapMs, d2, more);
  const later = [...more, ...run('黑', t0 + 200_000, 6), S('红', t0 + 210_000)];
  check('连着两句没回 → 这一张不说了', canvasChatDue(st, t0 + 400_000, later, false).why === 'unanswered');
  const cleared = canvasChatCleared(st, t0 + 400_000);
  check('清空 = 新的一张:30 秒内不说,之后计数重来', canvasChatDue(cleared, t0 + 410_000, run('蓝', t0 + 401_000, 6), false).why === 'cleared' && cleared.lines.length === 0);
  const fresh = [...run('蓝', t0 + 431_000, 6), S('红', t0 + 440_000)];
  check('清空以后又能说', canvasChatDue(cleared, t0 + 445_000, fresh, false).say);
  let full = canvasChatInit(0);
  for (let i = 0; i < T.maxLines; i++) full = canvasChatSaid(canvasChatAnswered(full, 0), i * 100_000, { say: true, color: null, ask: true, why: 'pause' }, []);
  full = canvasChatAnswered(full, 0);
  check('一张最多 4 句', canvasChatDue(full, 1_000_000, run('红', 900_000, 12), false).why === 'max');
}
{
  // 一种颜色画了一整张、停笔够久:说它(久停)
  const st = canvasChatInit(0);
  const reds = run('红', 1000, 12, 2000);
  const last = 1000 + 11 * 2000;
  check('一种颜色 ≥ 10 笔、停笔不到 12 秒 → 等', canvasChatDue(st, last + T.pauseMs - 1, reds, false).why === 'wait');
  const d = canvasChatDue(st, last + T.pauseMs, reds, false);
  check('停笔 12 秒 → 说(只有一种颜色就说它)', d.say && d.color === '红' && d.why === 'pause');
  const mixed = [...run('红', 1000, 3), ...run('蓝', 4000, 3), ...run('黑', 7000, 4)];
  const dm = canvasChatDue(st, 7000 + 3000 + T.pauseMs, mixed, false);
  check('几种颜色都不到 5 笔、停够久 → 说整张(color null)', dm.say && dm.color === null && dm.why === 'pause', JSON.stringify(dm));
  const said = d.say ? canvasChatSaid(st, last + T.pauseMs, d, reds) : st;
  check('说过以后没再画 → 不再说整张', canvasChatDue(said, last + T.pauseMs + T.gapMs + 1, reds, false).why === 'wait');
}

// ---- 10-21 晚那张的时间线(秒,从点开起):第一版红楼 57 笔,楼顶一道蓝线;清空;最后一版红太阳、三个蓝浪、满屏蓝雨 ----
{
  const at = (s: number) => s * 1000;
  let st = canvasChatInit(0);
  const said: string[] = [];
  const ink: CanvasStroke[] = [];
  const add = (color: string, from: number, to: number, n: number) => { for (let i = 0; i < n; i++) ink.push(S(color, at(from + ((to - from) * i) / Math.max(1, n - 1)))); };
  add('红', 51, 150, 50); // 21:16:40 起的红楼
  add('蓝', 155, 158, 1); // 楼顶一道蓝线
  add('红', 165, 195, 6); // 右上红太阳
  for (let s = 0; s <= 196; s++) { const d = canvasChatDue(st, at(s), ink.filter((x) => x.at <= at(s)), false); if (d.say) { said.push(`${s}:${d.color ?? '整张'}`); st = canvasChatSaid(st, at(s), d, ink.filter((x) => x.at <= at(s))); } }
  check('第一版画好、还没清空的时候说到了红色(头一句落在第一版上)', said.length >= 1 && said[0].endsWith(':红'), said.join(' '));
}

done();
