/**
 * 实时老师的照念排队(src/live/lib/queue.ts)与开口指令(src/live/lib/cue.ts),纯函数,假钟。
 * 排队:嘴有空(没按着、没在出、放完再静 GAP_MS)才交下一拍;按下 = 打断,丢没念的、丢那一轮后面的拍,报孩子听到第几句。
 */
import { check, done } from './_check.ts';

const { GAP_MS, queueInit, queueStep } = await import('../src/live/lib/queue.ts');
const { catchCue, readCue } = await import('../src/live/lib/cue.ts');
type S = ReturnType<typeof queueInit>;
type Ev = Parameters<typeof queueStep>[1];
const b = (job: string, lines: number[], texts = lines.map((i) => `第 ${i + 1} 句。`)) => ({ job, lines, texts });
const run = (s: S, evs: Ev[]) => { const acts: unknown[] = []; for (const e of evs) { const r = queueStep(s, e); s = r.s; acts.push(r.act); } return { s, acts }; };

{
  // 接住孩子的那句在出:拍来了先排着;那句出完、放完再静 GAP_MS 才交
  const r = run(queueInit(), [{ e: 'created', t: 0 }, { e: 'beat', t: 100, beat: b('j1', [0, 1]) }, { e: 'tick', t: 200 }, { e: 'done', t: 300, playedAt: 1500 }, { e: 'tick', t: 1500 + GAP_MS - 10 }, { e: 'tick', t: 1500 + GAP_MS }]);
  check('嘴在出、声音没放完都不交;放完再静一会儿交第一拍', r.acts.slice(0, 5).every((a) => a === null) && (r.acts[5] as { kind: string; beat: { job: string } })?.kind === 'read' && r.s.reading?.job === 'j1' && r.s.pending.length === 0, JSON.stringify(r.acts));
  // 念这一拍的时候第二拍来了:等这拍念完放完
  const r2 = run(r.s, [{ e: 'created', t: 1810 }, { e: 'beat', t: 1900, beat: b('j1', [2]) }, { e: 'done', t: 2500, playedAt: 4000 }, { e: 'tick', t: 4100 }, { e: 'tick', t: 4000 + GAP_MS }]);
  check('一拍一拍顺着念,不叠在一起', r2.acts.slice(0, 4).every((a) => a === null) && (r2.acts[4] as { beat: { lines: number[] } })?.beat.lines[0] === 2, JSON.stringify(r2.acts));
}
{
  // 空的拍(只有卡没有讲稿)不排
  const r = run(queueInit(), [{ e: 'beat', t: 0, beat: b('j1', [], []) }, { e: 'tick', t: 1000 }]);
  check('没有讲稿的拍不交给嘴', r.acts.every((a) => a === null) && r.s.pending.length === 0);
}
{
  // 念第二拍时孩子按下:报听到第 3 句(第二拍的第一句),掐掉;排着的丢;这一轮后面的拍也丢
  let r = run(queueInit(), [{ e: 'beat', t: 0, beat: b('j1', [0, 1]) }, { e: 'tick', t: GAP_MS }, { e: 'created', t: GAP_MS }, { e: 'done', t: 900, playedAt: 2000 }, { e: 'beat', t: 1000, beat: b('j1', [2, 3]) }, { e: 'tick', t: 2000 + GAP_MS }, { e: 'created', t: 2400 }, { e: 'beat', t: 2500, beat: b('j1', [4]) }]);
  const before = r.s;
  r = run(before, [{ e: 'hold', t: 2600, drop: 'j1' }]);
  const cut = r.acts[0] as { kind: string; line: number | null; speaking: boolean };
  check('打断:报孩子听到第几句(正在念的那拍的第一句,1 起)、嘴在出', cut?.kind === 'cut' && cut.line === 3 && cut.speaking === true && r.s.pending.length === 0 && r.s.reading === null && r.s.holding, JSON.stringify(cut));
  // 调用方掐了嘴,百炼回 done(cancelled):声音已经清掉,放到的时刻就是现在
  const r2 = run(r.s, [{ e: 'done', t: 2650, playedAt: 2650 }, { e: 'beat', t: 2700, beat: b('j1', [5]) }, { e: 'release', t: 3000 }, { e: 'tick', t: 9000 }]);
  check('打断之后那一轮再来的拍丢掉;松手后也不念', r2.acts.every((a) => a === null) && r2.s.pending.length === 0, JSON.stringify(r2.acts));
  const r3 = run(r2.s, [{ e: 'beat', t: 9100, beat: b('j2', [0]) }]);
  check('下一轮的拍照常念', (r3.acts[0] as { kind: string })?.kind === 'read', JSON.stringify(r3.acts));
}
{
  // 嘴出完了声音还在放(reading 清了):按下照样报那拍;放完了、什么都没排:按下不算打断
  let r = run(queueInit(), [{ e: 'beat', t: 0, beat: b('j1', [0]) }, { e: 'tick', t: GAP_MS }, { e: 'created', t: GAP_MS }, { e: 'done', t: 600, playedAt: 3000 }]);
  const r1 = run(r.s, [{ e: 'hold', t: 1500 }]);
  check('声音还在放时按下:报正在放的那拍的第一句', (r1.acts[0] as { line: number })?.line === 1 && (r1.acts[0] as { speaking: boolean }).speaking === true, JSON.stringify(r1.acts));
  const r2 = run(r.s, [{ e: 'hold', t: 3500 }]);
  check('放完了、没排着的:按下不算打断', r2.acts[0] === null && r2.s.holding);
  r = run(queueInit(), [{ e: 'created', t: 0 }]);
  const r3 = run(r.s, [{ e: 'hold', t: 200, drop: 'j7' }]);
  check('接住孩子的那句在出时按下:掐掉,但不算讲稿(line null);那一轮的拍以后来了也丢', (r3.acts[0] as { line: unknown; speaking: boolean })?.line === null && (r3.acts[0] as { speaking: boolean }).speaking && run(r3.s, [{ e: 'release', t: 300 }, { e: 'beat', t: 400, beat: b('j7', [0]) }]).s.pending.length === 0);
  const r4 = run(queueInit(), [{ e: 'beat', t: 0, beat: b('j1', [0]) }, { e: 'beat', t: 0, beat: b('j1', [1]) }, { e: 'hold', t: 0 }]);
  check('有排着还没念的时按下:报排着的第一句(一句没听到),不算嘴在出', (r4.acts[2] as { line: number; speaking: boolean })?.line === 1 && !(r4.acts[2] as { speaking: boolean }).speaking, JSON.stringify(r4.acts));
}
{
  check('按着的时候来的拍不交;松手之后照常', run(queueInit(), [{ e: 'hold', t: 0 }, { e: 'beat', t: 10, beat: b('j1', [0]) }, { e: 'tick', t: 2000 }]).acts.every((a) => a === null) && (run(queueInit(), [{ e: 'hold', t: 0 }, { e: 'beat', t: 10, beat: b('j1', [0]) }, { e: 'release', t: 20 }, { e: 'tick', t: 2000 }]).acts[3] as { kind: string })?.kind === 'read');
}
{
  const r = readCue(['「三」是一横、一横、再一横。', '  ', '它是数字三。']);
  check('照念的指令:P1 的说法,句子原样拼进「」,空句去掉', r.startsWith('把这几句话原样说给孩子听,一个字都不改,不要回答它') && r.endsWith('说完就停:「「三」是一横、一横、再一横。它是数字三。」'), r);
  check('接住的指令:按住说的复述不答(听不清不交给嘴判);转写空的才说没听清;照片 / 交卡只说「我看看」', catchCue('voice').includes('复述他问的') && catchCue('voice').includes('不回答内容') && !catchCue('voice').includes('没听清') && catchCue('empty').includes('没听清') && catchCue('photo').includes('我看看') && catchCue('card').includes('不说对错') && !catchCue('text').includes('没听清'));
}

done();
