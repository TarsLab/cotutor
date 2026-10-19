/**
 * 实时老师的照念排队(src/live/lib/queue.ts)、声音排到哪(src/live/lib/playback.ts)、开口指令(src/live/lib/cue.ts),纯函数。
 * 排队是流水线:嘴一空(不在要 / 出回答、没按着)就交,排着的同一轮几拍并成一段;按下 = 打断,丢排着的、丢那一轮后面的拍。
 * 声音照孩子端的排法:到达 + 60 毫秒或上一块放完,取晚的;按下时在放哪段、清队列后截到哪。
 */
import { check, done } from './_check.ts';

const { queueInit, queueStep } = await import('../src/live/lib/queue.ts');
const { LEAD_MS, addChunk, flushAt, playbackInit, playingAt } = await import('../src/live/lib/playback.ts');
const { catchCue, readCue } = await import('../src/live/lib/cue.ts');
type S = ReturnType<typeof queueInit>;
type Ev = Parameters<typeof queueStep>[1];
const b = (job: string, lines: number[], texts = lines.map((i) => `第 ${i + 1} 句。`)) => ({ job, lines, texts });
const run = (s: S, evs: Ev[]) => { const acts: any[] = []; for (const e of evs) { const r = queueStep(s, e); s = r.s; acts.push(r.act); } return { s, acts }; };

{
  // 接住在出:拍来了先排着;接住出完马上交(不等声音放完)
  const r = run(queueInit(), [{ e: 'asked' }, { e: 'beat', beat: b('j1', [0]) }, { e: 'done' }]);
  check('接住在出时来的拍排着;嘴一出完就交,不等声音放完', r.acts[1] === null && r.acts[2]?.kind === 'read' && r.acts[2].beat.lines.join() === '0' && r.s.busy, JSON.stringify(r.acts));
  // 念第一拍时第二、三拍来了:嘴出完第一拍,两拍并成一段交
  const r2 = run(r.s, [{ e: 'beat', beat: b('j1', [1]) }, { e: 'beat', beat: b('j1', [2, 3]) }, { e: 'done' }]);
  check('排着的同一轮几拍并成一段交:序号连着、句子连着', r2.acts[0] === null && r2.acts[1] === null && r2.acts[2]?.kind === 'read' && r2.acts[2].beat.lines.join() === '1,2,3' && r2.acts[2].beat.texts.join('') === '第 2 句。第 3 句。第 4 句。', JSON.stringify(r2.acts[2]));
  const r3 = run(r2.s, [{ e: 'done' }, { e: 'beat', beat: b('j1', [4]) }]);
  check('嘴空着时来的拍马上交', r3.acts[0] === null && r3.acts[1]?.kind === 'read');
}
{
  check('没有讲稿的拍不交', run(queueInit(), [{ e: 'beat', beat: b('j1', [], []) }]).acts[0] === null);
  const r = run(queueInit(), [{ e: 'asked' }, { e: 'beat', beat: b('j1', [0]) }, { e: 'beat', beat: b('j1', [1]) }, { e: 'hold', drop: 'j1' }]);
  check('按下:排着的丢掉、报给调用方算孩子听到哪', r.acts[3]?.kind === 'dropped' && r.acts[3].beats.length === 2 && r.s.pending.length === 0 && r.s.holding, JSON.stringify(r.acts[3]));
  const r2 = run(r.s, [{ e: 'beat', beat: b('j1', [2]) }, { e: 'release' }, { e: 'done' }]);
  check('打断之后那一轮再来的拍丢掉', r2.acts.every((a) => a === null) && r2.s.pending.length === 0);
  const r3 = run(r2.s, [{ e: 'asked' }, { e: 'beat', beat: b('j2', [0]) }, { e: 'done' }]);
  check('下一轮的拍照常念', r3.acts[2]?.kind === 'read' && r3.acts[2].beat.job === 'j2');
  check('按着的时候来的拍不交;松手之后交', run(queueInit(), [{ e: 'hold' }, { e: 'beat', beat: b('j3', [0]) }]).acts[1] === null && run(queueInit(), [{ e: 'hold' }, { e: 'beat', beat: b('j3', [0]) }, { e: 'release' }]).acts[2]?.kind === 'read');
}
{
  // 声音:两次回答的块到达 1000、1010(各 200 毫秒)与 1100(100 毫秒):接着排,中间不空
  let p = playbackInit<string>();
  const a1 = addChunk(p, 'catch', 1000, 200); p = a1.p;
  const a2 = addChunk(p, 'catch', 1010, 200); p = a2.p;
  const a3 = addChunk(p, 'read1', 1100, 100); p = a3.p;
  check('声音照孩子端排:第一块到达 + 60 毫秒起,后面接着放;同一段的块并成一段', a1.start === 1000 + LEAD_MS && a2.start === 1260 && a3.start === 1460 && p.spans.length === 2 && p.spans[0].end === 1460 && p.end === 1560, JSON.stringify(p));
  check('这一刻在放哪段', playingAt(p, 1300)?.tag === 'catch' && playingAt(p, 1500)?.tag === 'read1' && playingAt(p, 1600) === null && playingAt(p, 1000) === null);
  const f = flushAt(p, 1300);
  check('清队列:截到这一刻,后面的段不放了', f.end === 1300 && f.spans.length === 1 && f.spans[0].end === 1300);
  const a4 = addChunk(f, 'read2', 2000, 50);
  check('清过之后再来的块从到达起排', a4.start === 2000 + LEAD_MS);
}
{
  const r = readCue(['「三」是一横、一横、再一横。', '  ', '它是数字三。']);
  check('照念的指令:P1 的说法,句子原样拼进「」,空句去掉', r.startsWith('把这几句话原样说给孩子听,一个字都不改,不要回答它') && r.endsWith('说完就停:「「三」是一横、一横、再一横。它是数字三。」'), r);
  check('接住的指令:说接下来做什么、不复述他的话、不说写给你看(卡不一定有);打的字嘴看不见,只说看看你写的;转写空的才说没听清;照片 / 交卡只说「我看看」;卡上的问号说讲给你听', catchCue('voice').includes('说你接下来做什么') && catchCue('voice').includes('不重复他的话') && catchCue('voice').includes('「好,我讲给你听」') && !catchCue('voice').includes('复述') && !catchCue('voice').includes('写给') && !catchCue('voice').includes('没听清') && catchCue('text').includes('我看看你写的') && catchCue('empty').includes('没听清') && catchCue('photo').includes('我看看') && catchCue('card').includes('不说对错') && catchCue('ask').includes('这张卡'));
}

done();
