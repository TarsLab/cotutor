/**
 * 实时老师的照念排队(src/runtime/delivery/queue.ts)、声音排到哪(src/runtime/delivery/playback.ts)、开口指令(src/realtime/cues.ts),纯函数。
 * 排队是流水线:嘴一空(不在要 / 出回答、没按着)就交,排着的同一轮几拍并成一段;按下 = 打断,丢排着的、丢那一轮后面的拍。
 * 声音照孩子端的排法:到达 + 60 毫秒或上一块放完,取晚的;按下时在放哪段、清队列后截到哪。
 */
import { check, done } from './_check.ts';

const { queueInit, queueStep } = await import('../src/runtime/delivery/queue.ts');
const { LEAD_MS, addChunk, flushAt, playbackInit, playingAt } = await import('../src/runtime/delivery/playback.ts');
const { catchCue, readCue, spoken } = await import('../src/realtime/cues.ts');
type S = ReturnType<typeof queueInit>;
type Ev = Parameters<typeof queueStep>[1];
const b = (job: string, lines: number[], texts = lines.map((i) => `第 ${i + 1} 句。`)) => ({ job, lines, texts });
const run = (s: S, evs: Ev[]) => { const acts: any[] = []; for (const e of evs) { const r = queueStep(s, e); s = r.s; acts.push(r.act); } return { s, acts }; };

{
  // 一直听:孩子开口先 pause(不交新的、排着的不丢),放过了 release 接着交;收下了才 hold(丢)
  const r = run(queueInit(), [{ e: 'beat', beat: b('j1', [0]) }, { e: 'pause' }, { e: 'beat', beat: b('j1', [1]) }, { e: 'done' }, { e: 'release' }]);
  check('一直听:开口 pause 时来的拍、嘴出完都不交,排着不丢;release 接着交', r.acts[0]?.kind === 'read' && r.acts[1] === null && r.acts[2] === null && r.acts[3] === null && r.acts[4]?.kind === 'read' && r.acts[4].beat.lines.join() === '1', JSON.stringify(r.acts));
  const r2 = run(queueInit(), [{ e: 'asked' }, { e: 'beat', beat: b('j1', [0]) }, { e: 'pause' }, { e: 'hold', drop: 'j1' }]);
  check('一直听:pause 后收下(hold)丢掉排着的', r2.acts[3]?.kind === 'dropped' && r2.s.pending.length === 0, JSON.stringify(r2.acts));
}
{
  // 嘴卡住(2026-10-31):交出去的那段一个字没出,放回排头不交;换好连接 done 了再交,和后来的同一轮的并成一段
  const r = run(queueInit(), [{ e: 'beat', beat: b('j1', [0]) }, { e: 'beat', beat: b('j1', [1]) }]);
  const stuck = r.acts[0].beat;
  const r2 = run(r.s, [{ e: 'retry', beat: stuck }, { e: 'beat', beat: b('j1', [2]) }]);
  check('retry:卡住的那段放回排头、不交,闸开;这时来的拍也先排着(连接还没换好)', r2.acts.every((a) => a === null) && r2.s.busy && !r2.s.gated && r2.s.pending.map((x) => x.lines.join()).join('|') === '0|1|2', JSON.stringify(r2));
  const r3 = run(r.s, [{ e: 'retry', beat: stuck }, { e: 'done' }]);
  check('retry 后 done:从卡住的那句接着交,同一轮排着的并成一段', r3.acts[1]?.kind === 'read' && r3.acts[1].beat.lines.join() === '0,1', JSON.stringify(r3.acts));
  const r4 = run(r.s, [{ e: 'hold', drop: 'j1' }, { e: 'retry', beat: stuck }, { e: 'done' }]);
  check('retry:那一轮被打断过就不放回', r4.s.pending.length === 0 && r4.acts[2] === null, JSON.stringify(r4));
}
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
  // 小课堂(讲稿的 [[play]]):并段到那句为止;交出去关闸,孩子端放完(staged)才交后面的;按下开闸
  const pb = (job: string, i: number) => ({ ...b(job, [i]), play: true });
  const r = run(queueInit(), [{ e: 'asked' }, { e: 'beat', beat: b('j1', [0]) }, { e: 'beat', beat: pb('j1', 1) }, { e: 'beat', beat: b('j1', [2]) }, { e: 'done' }]);
  check('[[play]]:排着的并段到那句为止,那段带 play、关闸;后面的留着', r.acts[4]?.kind === 'read' && r.acts[4].beat.lines.join() === '0,1' && r.acts[4].beat.play === true && r.s.gated && r.s.pending.length === 1, JSON.stringify(r.acts[4]));
  const r2 = run(r.s, [{ e: 'done' }, { e: 'beat', beat: b('j1', [3]) }]);
  check('[[play]]:嘴出完那段、又来了拍,闸关着都不交', r2.acts.every((a) => a === null) && r2.s.pending.length === 2);
  const r3 = run(r2.s, [{ e: 'staged' }]);
  check('[[play]]:孩子端放完(staged)→ 开闸,后面的并成一段交', r3.acts[0]?.kind === 'read' && r3.acts[0].beat.lines.join() === '2,3' && !r3.acts[0].beat.play && !r3.s.gated, JSON.stringify(r3.acts[0]));
  const r4 = run(r.s, [{ e: 'done' }, { e: 'hold', drop: 'j1' }]);
  check('[[play]]:闸关着时孩子按下 → 排着的丢、闸开(下一轮照常)', r4.acts[1]?.kind === 'dropped' && !r4.s.gated && r4.s.pending.length === 0);
  const r5 = run(queueInit(), [{ e: 'beat', beat: pb('j2', 0) }]);
  check('[[play]]:嘴空着时来的那拍直接交、关闸', r5.acts[0]?.kind === 'read' && r5.acts[0].beat.play === true && r5.s.gated);
}
{
  // 热身(讲稿的 [[echo 词]] / [[say 词]]):同 [[play]] 并段到那句、关闸;孩子跟完(echoed)才交后面的。各开各的闸
  const eb = (job: string, i: number, word: string, say?: true) => ({ ...b(job, [i]), echo: { word, ...(say ? { say } : {}) } });
  const r = run(queueInit(), [{ e: 'asked' }, { e: 'beat', beat: b('j1', [0]) }, { e: 'beat', beat: eb('j1', 1, 'duck') }, { e: 'beat', beat: eb('j1', 2, 'duck') }, { e: 'done' }]);
  check('[[echo]]:并段到那句为止,那段带 echo、关闸;后面的留着', r.acts[4]?.kind === 'read' && r.acts[4].beat.lines.join() === '0,1' && r.acts[4].beat.echo?.word === 'duck' && r.s.gated === 'echo' && r.s.pending.length === 1, JSON.stringify(r.acts[4]));
  const r2 = run(r.s, [{ e: 'done' }, { e: 'staged' }]);
  check('[[echo]]:嘴出完、小课堂的 staged 都开不了等孩子跟的闸', r2.acts.every((a) => a === null) && r2.s.gated === 'echo');
  const r3 = run(r2.s, [{ e: 'echoed' }]);
  check('[[echo]]:孩子跟完(echoed)→ 开闸,下一拍单独一段(它自己也带 echo)', r3.acts[0]?.kind === 'read' && r3.acts[0].beat.lines.join() === '2' && r3.acts[0].beat.echo?.word === 'duck' && r3.s.gated === 'echo', JSON.stringify(r3.acts[0]));
  const r4 = run(queueInit(), [{ e: 'beat', beat: { ...b('j2', [0]), play: true } }, { e: 'done' }, { e: 'echoed' }]);
  check('[[play]] 的闸 echoed 开不了', r4.acts[2] === null && r4.s.gated === 'play');
  const r5 = run(queueInit(), [{ e: 'beat', beat: eb('j3', 0, 'bus', true) }]);
  check('[[say]]:嘴空着时直接交、带 say、关闸', r5.acts[0]?.kind === 'read' && r5.acts[0].beat.echo?.say === true && r5.s.gated === 'echo');
  const r6 = run(r5.s, [{ e: 'done' }, { e: 'pause' }, { e: 'hold', drop: 'j3' }]);
  check('[[echo]]:关闸时收下孩子对老师说的(hold)→ 闸开、那一轮后面的丢', !r6.s.gated && r6.s.dropJob === 'j3');
}
{
  // [[call]]:并段到那句为止;那一轮排着的、后面再来的拍都不要(打电话那段是下一轮写的)
  const r = run(queueInit(), [{ e: 'asked' }, { e: 'beat', beat: b('j1', [0]) }, { e: 'beat', beat: { ...b('j1', [1]), call: true } }, { e: 'beat', beat: b('j1', [2]) }, { e: 'done' }]);
  check('[[call]]:并段到那句为止,那段带 call、关闸(孩子端响铃);后面排着的丢', r.acts[4]?.kind === 'read' && r.acts[4].beat.lines.join() === '0,1' && r.acts[4].beat.call === true && r.s.pending.length === 0 && r.s.gated === 'call', JSON.stringify(r.acts[4]));
  const r2 = run(r.s, [{ e: 'done' }, { e: 'beat', beat: b('j1', [3]) }, { e: 'beat', beat: b('j2', [0]) }, { e: 'pause' }, { e: 'release' }, { e: 'staged' }, { e: 'echoed' }]);
  check('[[call]]:那一轮再来的拍不要;打电话那一轮的先排着,孩子开口的暂停 / 放过、staged、echoed 都开不了闸', r2.acts.every((a) => a === null) && r2.s.pending.length === 1 && r2.s.gated === 'call', JSON.stringify(r2.acts));
  const r3 = run(r2.s, [{ e: 'rung' }]);
  check('[[call]]:铃响够了(rung)→ 开闸,念打电话那一轮', r3.acts[0]?.kind === 'read' && r3.acts[0].beat.job === 'j2' && !r3.s.gated);
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
  check('嘴先说的:拍照说「我看一看图片」、转写空的说没听清、热身说热热身;说话、打字、交卡、首页按钮都不出声(null,等脑的第一句)', catchCue('photo')!.includes('「我看一看图片」') && catchCue('empty')!.includes('没听清') && catchCue('warm')!.includes('热热身') && (['voice', 'answer', 'text', 'card', 'start'] as const).every((k) => catchCue(k) === null && catchCue(k, 'en') === null));
  check('念法:空括号、下划线的空念「几」,□ 念「方框」,运算符换成字(ASCII 的 - 只在两个数之间)', spoken('二四得( ),每份都是（　）个,分了(  )次') === '二四得几,每份都是几个,分了几次' && spoken('□+5=12,填在 ___ 上') === '方框加5等于12,填在 几 上' && spoken('6×4−1 = 23,12÷3,6>5,2<3,7 - 2') === '6乘4减1等于23,12除以3,6大于5,2小于3,7减2' && spoken('0:19 那里,一二-三') === '0:19 那里,一二-三' && readCue(['二四得( )。']).includes('「二四得几。」'));
}

done();
