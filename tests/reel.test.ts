/** 录像(《家长录像设计.md》):推算轨道、某一刻的样子、空白压缩与播放时钟。纯函数,手搭的节,时刻都算得准。 */
import { buildReel, playRecordOk, reelCardTook, reelClock, reelDuration, reelFrameAt, reelSaid, REEL_GAP_PLAY_MS, type PlayRecord, type ReelDiag, type ReelInput } from '../src/lib/reel.ts';
import type { BoardSection } from '../src/lib/kid-board.ts';
import type { RunEvent } from '../src/lib/events.ts';
import type { ConversationMessage } from '../src/schema/conversation.ts';
import { check, done } from './_check.ts';

const line = (text: string, anchor: number | null, audio: string | null, ask = false) => ({ text, audio, marks: [], ask, anchor, cues: [] });
const card = (title: string, kind = 'text') => ({ kind, props: kind === 'text' ? { title, text: title } : { text: title } });
const T = Date.parse('2026-09-28T12:00:00.000Z');
const iso = (t: number) => new Date(t).toISOString();
const msg = (job: string, o: Partial<ConversationMessage>): ConversationMessage => ({ job, thread: 'th', at: '2026-09-28T20:00', from: 'kid', text: '', result: 'ok', artifacts: [], ...o }) as ConversationMessage;
const ev = (list: RunEvent[]): RunEvent[] => list;
const durations = { 'a.mp3': 1000, 'b.mp3': 2000, 'c.mp3': 1500, 'd.mp3': 1000, 'e.mp3': 1000, 'f.mp3': 1000, 'g.mp3': 2000 };
const input = (messages: ConversationMessage[], o: Partial<ReelInput> = {}): ReelInput => ({ messages, events: {}, cards: {}, durations, tutor: 'math-tutor', now: T + 3_600_000, ...o });

// S1:没卡的开头一句(第 0 拍)、卡 A 一句、卡 B 一句末句问句;流式,三拍分别在 3 / 4 / 9 秒就绪
const S1: BoardSection = { cards: [card('A'), card('B')], lines: [line('开头', null, 'a.mp3'), line('讲 A', 0, 'b.mp3'), line('B 呢?', 1, 'c.mp3', true)] };
const E1 = ev([
  { t: 0, lane: 'main', kind: 'start', cli: 'claude', runtime: 'claude', resume: true },
  { t: 3000, lane: 'ready', kind: 'beat', beat: 0, card: null, first: true },
  { t: 4000, lane: 'ready', kind: 'beat', beat: 1, card: 0, first: false },
  { t: 9000, lane: 'ready', kind: 'beat', beat: 2, card: 1, first: false },
  { t: 9500, lane: 'ready', kind: 'all', cards: 2, lines: 3 },
  { t: 9600, lane: 'index', kind: 'written', warnings: 0 },
]);
// S2:一张卡一句,整块来的(没有事件),配音 20 秒才齐
const S2: BoardSection = { cards: [card('C')], lines: [line('讲 C', 0, 'd.mp3')] };

check('话题里孩子一句都没说(只有系统起的轮)→ 没有录像', buildReel(input([msg('p1', { from: 'system', section: S2 })])) === null);

{
  const m1 = msg('1', { text: '7 减 9', timing: { startedAt: iso(T) }, section: S1 });
  const m2 = msg('2', { action: 'submit', text: '', timing: { startedAt: iso(T + 60000), dubbedMs: 20000 }, section: S2 });
  const bk = msg('3', { from: 'system', text: '记账', bookkeep: { thread: 'th' }, timing: { startedAt: iso(T + 7_200_000) }, section: S2 });
  const r = buildReel(input([m1, m2, bk], { events: { 1: E1 }, cards: { 1: { 0: { at: iso(T + 30000), turn: '1', state: { picked: [1] } } } } }))!;
  const says = r.says.map((x) => [x.job, x.line, x.from - T, x.to - T].join(':')).join(' ');
  check('流式的轮:每句不早于它那拍就绪、按 mp3 时长念、句间 200 毫秒;整块来的轮在配音齐时出来', says === '1:0:3000:4000 1:1:4200:6200 1:2:9000:10500 2:0:80000:81000', says);
  const t1 = r.tracks[0];
  check('流式的轮一拍铺一拍的卡,写完整节都在;末句问句 → 停下等孩子', t1.at === T + 3000 && t1.cards.map((c) => `${c.at - T}=${c.n}`).join() === '3000=0,4000=1,9000=2,9500=2' && t1.ask && t1.doneAt === T + 10500, JSON.stringify(t1));
  check('记账的轮不进录像(晚上的系统轮)', r.tracks.length === 2 && !r.marks.some((m) => m.job === '3') && r.endAt === T + 81000 + 1500);
  check('进度条上的点:两次开口(交卡写「交给老师」)、改卡、停下等孩子', r.marks.map((m) => `${m.kind}@${m.at - T}:${m.label}`).join(' ') === 'said@0:7 减 9 ask@10500:B 呢? card@30000:A said@60000:交给老师', r.marks.map((m) => `${m.kind}@${m.at - T}:${m.label}`).join(' '));
  check('空白:老师说完到下一次开口的 49.5 秒被 30 秒那次改卡切开(改卡前后各 1 秒照放),后一段是「又过了」;等老师 20 秒,前 10 秒照放、其余压', r.gaps.map((g) => `${g.kind}:${g.from - T}-${g.to - T}:${g.ms}${g.cont ? ':cont' : ''}`).join(' ') === 'think:10500-29000:18500 think:31000-60000:29000:cont wait:70000-80000:20000', JSON.stringify(r.gaps));
  check('等老师:两轮各从开口到第一声', r.waits.map((w) => `${w.job}:${w.to - w.from}`).join() === '1:3000,2:20000');

  // 某一刻
  const f0 = reelFrameAt(r, T + 1000);
  check('开口后老师还没出声:板上空的、等了 1 秒', f0.sections.length === 0 && f0.wait?.ms === 1000 && f0.saying === null && f0.notes.length === 1 && !f0.notes[0].post);
  const f1 = reelFrameAt(r, T + 5000);
  check('念第二句:两节里第一节出来了、露 1 张卡、开始念过 2 句;在念的句从开头过了 800 毫秒', f1.sections.length === 1 && f1.sections[0].cards === 1 && f1.sections[0].spoken === 2 && f1.saying?.line === 1 && f1.saying.offset === 800 && f1.saying.audio === 'b.mp3', JSON.stringify(f1));
  const f2 = reelFrameAt(r, T + 7000);
  check('两拍之间(第三拍还没就绪):不在念,字幕留着上一句,不算停下等孩子', f2.saying === null && f2.last?.line === 1 && !f2.asking && f2.sections[0].cards === 1);
  const f3 = reelFrameAt(r, T + 20000);
  check('念完末句问句:停下等孩子,节尾的旁注出来了;在 think 空白里', f3.asking && f3.notes[0].post && f3.gap?.kind === 'think' && f3.sections[0].cards === 2 && !('1/0' in f3.cards));
  const f4 = reelFrameAt(r, T + 31000);
  check('卡的状态从状态文件的 at 起才有', JSON.stringify(f4.cards['1/0']) === '{"picked":[1]}');
  const f5 = reelFrameAt(r, T + 75000);
  check('第二次开口后老师 15 秒还没出声:在 wait 空白里,等了 15 秒;前一节还在', f5.gap?.kind === 'wait' && f5.wait?.ms === 15000 && f5.sections.length === 1 && f5.notes.length === 2);
  const f6 = reelFrameAt(r, T + 80500);
  check('整块来的节:念到第一句就露它锚到的卡', f6.sections.length === 2 && f6.sections[1].cards === 1 && f6.saying?.job === '2');

  // 播放时钟:压过的空白各放 1.5 秒
  const c = reelClock(r, false);
  check('压缩:82.5 秒的话题,三段空白(18.5 秒、29 秒、多等的 10 秒)各压成 1.5 秒', c.total === 82500 - 18500 - 29000 - 10000 + 3 * REEL_GAP_PLAY_MS, String(c.total));
  check('播放 ↔ 墙钟:空白前照常、空白里线性、改卡那 2 秒照常、空白后平移', c.toWall(10500) === T + 10500 && c.toWall(10500 + 750) === T + 10500 + 18500 / 2 && c.toWall(12000) === T + 29000 && c.toWall(13000) === T + 30000 && c.toWall(15500) === T + 60000 && c.toPlay(T + 65000) === 20500 && c.toPlay(c.toWall(5000)) === 5000 && c.toWall(c.total + 999) === r.endAt);
  const real = reelClock(r, true);
  check('关掉「跳过空白」(按真实时间):不压', real.total === r.endAt - r.startAt && real.toWall(40000) === T + 40000);
}

{
  // 孩子在老师念完之前又开口了:没念的句不念,前一节整节都在
  const m1 = msg('1', { timing: { startedAt: iso(T) }, section: S1 });
  const m2 = msg('2', { text: '等等', timing: { startedAt: iso(T + 5000), dubbedMs: 3000 }, section: S2 });
  const r = buildReel(input([m1, m2], { events: { 1: E1 } }))!;
  const mine = r.says.filter((x) => x.job === '1');
  check('被下一次开口打断:念到一半的那句截在开口那一刻,后面的不念;不算停下等孩子', mine.length === 2 && mine[1].to === T + 5000 && !r.tracks[0].ask && reelFrameAt(r, T + 5500).sections[0].cards === 2, JSON.stringify(mine));
}

{
  // 按住说话(拍板 4):原声排在发出去之前 seconds 秒;孩子一按下孩子端就停声音,前一节念到那一刻为止;开口的点在按下那一刻
  const m1 = msg('1', { timing: { startedAt: iso(T) }, section: S1 });
  const m2 = msg('2', { text: 'Apple苹', voice: { audio: '2026-09-28.2.voice.webm', seconds: 3 }, timing: { startedAt: iso(T + 8000), dubbedMs: 3000 }, section: S2 });
  const r = buildReel(input([m1, m2], { events: { 1: E1 } }))!;
  const v = r.clips.find((c) => c.kind === 'voice');
  const cut = r.says.filter((x) => x.job === '1');
  check('原声:从按下(发出去前 3 秒)到发出去,带着认成的字;前一节念到按下那一刻', v?.from === T + 5000 && v.to === T + 8000 && v.text === 'Apple苹' && v.card === null && cut.length === 2 && cut[1].to === T + 5000 && r.marks.find((x) => x.job === '2')?.at === T + 5000, JSON.stringify({ v, cut }));
  const f = reelFrameAt(r, T + 6000);
  check('按着说的时候:放原声(从开头过了 1 秒),不算等老师', f.clip?.kind === 'voice' && f.clip.offset === 1000 && f.clip.text === 'Apple苹' && f.wait === null && f.saying === null);
}

{
  // 孩子第一次开口之前的节(2026-10-05 前交给孩子的课文件,旧索引读成 system):从开口往前倒推,一节接一节;有更早的卡状态就把那节往前挪
  const S3: BoardSection = { cards: [card('课 1')], lines: [line('第一节', 0, 'e.mp3'), line('懂了吗?', 0, 'f.mp3', true)] };
  const S4: BoardSection = { cards: [card('课 2')], lines: [line('第二节', 0, 'g.mp3')] };
  const p0 = msg('p0', { from: 'system', text: '课文件 6 的口诀', section: S3 });
  const p1 = msg('p1', { from: 'system', text: '课文件 6 的口诀 · 第 2 节', section: S4 });
  const k = msg('k', { text: '懂了', timing: { startedAt: iso(T), dubbedMs: 2000 }, section: S2 });
  const flat = buildReel(input([p0, p1, k]))!;
  check('课的几节一节接一节、正好在孩子开口时念完', flat.tracks.map((t) => `${t.job}:${t.at - T}`).join() === 'p0:-4600,p1:-2200,k:2000' && flat.says[0].from === T - 4600 && flat.says[2].to === T - 200, JSON.stringify(flat.tracks));
  const moved = buildReel(input([p0, p1, k], { cards: { p0: { 0: { at: iso(T - 10000), turn: 'p1', state: { x: 1 } } } } }))!;
  check('第一节的卡 10 秒前就有状态:第一节挪到那一刻前念完,中间空出来的算孩子在想', moved.tracks[0].at === T - 12400 && moved.tracks[0].doneAt === T - 10200 && moved.gaps.some((g) => g.kind === 'think' && g.from === T - 9000 && g.to === T - 2200), JSON.stringify({ t: moved.tracks[0], g: moved.gaps }));
  check('课的节没有「开口」的点,末句问句有「停下等孩子」', !moved.marks.some((m) => m.kind === 'said' && m.job.startsWith('p')) && moved.marks.some((m) => m.kind === 'ask' && m.job === 'p0'));
}

{
  // 没成的轮、录音卡
  const err = msg('e', { text: '再来', result: 'error', error: 'timeout', timing: { startedAt: iso(T) } });
  const r = buildReel(input([err], { events: { e: ev([{ t: 4000, lane: 'main', kind: 'exit', ok: false, reason: 'timeout' }]) } }))!;
  check('没成的轮:没有节;「没成」的点在老师退出那一刻,节尾旁注那时出来,之前算等老师', r.tracks.length === 0 && r.marks.map((m) => m.kind).join() === 'said,error' && r.marks[1].at === T + 4000 && r.notes[0].postAt === T + 4000 && reelFrameAt(r, T + 3000).wait?.ms === 3000);

  const RS: BoardSection = { cards: [card('山', 'record')], lines: [line('读一遍。', 0, 'a.mp3', true)] };
  const m1 = msg('1', { timing: { startedAt: iso(T), dubbedMs: 1000 }, section: RS });
  const m2 = msg('2', { action: 'submit', timing: { startedAt: iso(T + 60000), dubbedMs: 1000 }, section: S2 });
  const rec = { at: iso(T + 30000), turn: '1', state: { audio: 'conversations/math-tutor/2026-09-28.1.cards/0/rec-1.webm', seconds: 3 } };
  const rr = buildReel(input([m1, m2], { cards: { 1: { 0: rec } } }))!;
  check('录音卡:孩子的录音排在存下来之前 3 秒,路径去掉 conversations/<老师>/;这 3 秒不被压', rr.clips.length === 1 && rr.clips[0].from === T + 27000 && rr.clips[0].audio === '2026-09-28.1.cards/0/rec-1.webm' && reelFrameAt(rr, T + 28000).clip?.offset === 1000 && !rr.gaps.some((g) => g.from < T + 30000 && g.to > T + 27000), JSON.stringify(rr.gaps));
}

{
  // 实录(第二期):S2 念一句(卡 C 是选择题);孩子暂停过、再听过一次;弹窗开着想了 9 秒(中间切到后台 3 秒)选了 A 又改 B;有记录的节用记录,不推算
  const CH: BoardSection = { cards: [card('几个角?', 'choice')], lines: [line('数一数。', 0, 'd.mp3'), line('有几个角?', 0, 'a.mp3', true)] };
  const m1 = msg('1', { text: '三角形', timing: { startedAt: iso(T), dubbedMs: 2000 }, section: CH });
  const m2 = msg('2', { action: 'submit', timing: { startedAt: iso(T + 40000), dubbedMs: 2000 }, section: S2 });
  const plays: PlayRecord[] = [
    { at: T + 2500, k: 'play', job: '1', line: 0, status: 'playing' },
    { at: T + 3000, k: 'play', job: '1', line: 0, status: 'paused' },
    { at: T + 8000, k: 'play', job: '1', line: 0, status: 'playing' },
    { at: T + 9100, k: 'play', job: '1', line: 1, status: 'playing' },
    { at: T + 10200, k: 'play', job: '1', line: 1, status: 'waiting' },
    { at: T + 10200, k: 'stage', job: '1', card: 0, open: true },
    { at: T + 13000, k: 'visible', on: false },
    { at: T + 16000, k: 'visible', on: true },
    { at: T + 19200, k: 'card', job: '1', card: 0, state: { picked: [0] } },
    { at: T + 25000, k: 'card', job: '1', card: 0, state: { picked: [1] } },
    { at: T + 26000, k: 'stage', job: '1', card: 0, open: false },
    { at: T + 30000, k: 'play', job: '1', line: 1, status: 'playing', replay: true },
    { at: T + 31000, k: 'play', job: '1', line: 1, status: 'waiting' },
  ];
  const r = buildReel(input([m1, m2], { plays, cards: { 1: { 0: { at: iso(T + 25000), turn: '1', state: { picked: [1] } } } } }))!;
  const s1 = r.says.filter((x) => x.job === '1').map((x) => `${x.line}:${x.from - T}-${x.to - T}${x.replay ? 'r' : ''}`).join(' ');
  check('实录的念句:暂停那段不出声、接着念从头念那句、到 mp3 念完为止、再听标 replay;这节不用推算的', s1 === '0:2500-3000 0:8000-9000 1:9100-10100 1:30000-31000r', s1);
  check('有记录的节:出来的时刻、念完(第一次停下等孩子)、停下等孩子的点都照记录', r.tracks[0].at === T + 2500 && r.tracks[0].doneAt === T + 10200 && r.tracks[0].ask && r.marks.some((x) => x.kind === 'ask' && x.at === T + 10200));
  check('第二节没有记录:照推算;所以不算全程实录', r.says.some((x) => x.job === '2') && !r.precise);
  check('弹窗开着的一段、切到后台的一段', r.stages.length === 1 && r.stages[0].from === T + 10200 && r.stages[0].to === T + 26000 && r.aways.length === 1 && r.aways[0].to - r.aways[0].from === 3000);
  check('选了 A 又改 B:两次改动都在(状态文件那一份不重复算)', r.cards.map((c) => JSON.stringify(c.state)).join() === '{"picked":[0]},{"picked":[1]}', JSON.stringify(r.cards));
  const f1 = reelFrameAt(r, T + 18000);
  check('弹窗开着、还没动:想了 7.8 秒 − 切到后台的 3 秒 = 4.8 秒', f1.stage?.card === 0 && f1.thinking?.ms === 4800 && !f1.away, JSON.stringify(f1.thinking));
  check('切到后台那几秒:away', reelFrameAt(r, T + 14000).away);
  const f2 = reelFrameAt(r, T + 20000);
  check('动过了就不再算「想了」;弹窗照开着,卡是选 A 的样子', f2.stage !== null && f2.thinking === null && JSON.stringify(f2.cards['1/0']) === '{"picked":[0]}');
  check('再听那句不算「念过几句」', reelFrameAt(r, T + 30500).sections[0].spoken === 2 && reelFrameAt(r, T + 30500).saying?.line === 1);
  check('弹窗关了:frame 里没有 stage', reelFrameAt(r, T + 27000).stage === null);
  check('想了多久、改过几次:打开到第一次改动减去切到后台的;改了两次', JSON.stringify(reelCardTook(plays, '1', 0, -Infinity, T + 40000)) === '{"think":6000,"changes":2}' && reelCardTook(plays, '1', 0, T + 27000, T + 40000) === null && reelCardTook(plays, '2', 0, -Infinity, Infinity) === null);
  const all = buildReel(input([m1], { plays }))!;
  check('每一轮有讲稿的节都有记录:实录', all.precise);
}
{
  // 看小课堂(《小课堂设计.md》§八第 5 步):开口前 60 秒开始看;放 10 秒停下、5 秒后圈一处、再过 7 秒接着放;放 8 秒后拖到 0:30;放到 0:46 看完;14 秒后开口
  const L = { bundle: '2026-09-18-po13-jian-8', title: '13 − 8 破十法', watchedMs: 46000, finished: true, pauses: 1,
    log: [{ t: -60000, pos: 0, play: true }, { t: -50000, pos: 10000, play: false }, { t: -38000, pos: 10000, play: true }, { t: -30000, pos: 30000, play: true }, { t: -14000, pos: 46000, play: false }],
    marks: [{ atMs: 10000, svgMs: 9000, path: [[1, 1], [9, 1], [5, 9]] as [number, number][], t: -45000 }] };
  const r = buildReel(input([msg('1', { text: '为什么要拆', timing: { startedAt: iso(T) }, section: S2, lecture: L })]))!;
  check('看小课堂的一段:从第一条看的记录起、到看完那条止;录像从看课开始', r.lectures.length === 1 && r.lectures[0].from === T - 60000 && r.lectures[0].to === T - 14000 && r.startAt === T - 60000, JSON.stringify(r.lectures[0]).slice(0, 300));
  check('进度条上的点:开始看小课堂、圈了一处(课里的时刻)、开口', r.marks.slice(0, 3).map((m) => `${m.kind}@${m.at - T}:${m.label}`).join(' ') === 'lecture@-60000:看小课堂 · 13 − 8 破十法 circle@-45000:圈了一处(课里 0:10) said@0:为什么要拆', r.marks.map((m) => `${m.kind}@${m.at - T}:${m.label}`).join(' '));
  const at = (dt: number) => reelFrameAt(r, T + dt).lecture;
  check('某一刻:放着按真实时间往前推;停着停在那儿;圈过的到圈下去那一刻才出来', at(-55000)?.pos === 5000 && at(-55000)?.playing === true && at(-48000)?.pos === 10000 && at(-48000)?.playing === false && at(-48000)?.marks.length === 0 && at(-44000)?.marks.length === 1 && at(-31000)?.pos === 17000 && at(-29000)?.pos === 31000 && at(-15000)?.pos === 45000, JSON.stringify([at(-31000), at(-29000)]));
  check('看完到开口之间不在看(板书那边);开口之后也不在', at(-10000) === null && at(1000) === null);
  check('空白:停着的 12 秒被那一圈切开(圈前后各 1 秒照放),后一段 6 秒压;在放的不压;看完到开口的 14 秒压', r.gaps.map((g) => `${g.kind}:${g.from - T}-${g.to - T}${g.cont ? ':cont' : ''}`).join(' ') === 'think:-44000--38000:cont think:-14000-0', JSON.stringify(r.gaps.map((g) => [g.from - T, g.to - T])));
  check('没带看的过程(以前的话题):没有这一段', buildReel(input([msg('1', { text: 'x', timing: { startedAt: iso(T) }, section: S2, lecture: { ...L, log: undefined } })]))!.lectures.length === 0);
}
{
  // 改版补记(拍板 6、7、10):按住说话、打字、发照片屏、屏幕尺寸、翻板书;连着没发出去
  // 老师 0 秒开口那轮念完(S2 整块,20 秒配音齐 → 念到 21 秒);孩子 30 秒按住、话筒 31 秒开、认出字两段、34 秒松手、35 秒没听清;
  // 40 秒、50 秒又两次没听清(一共三次连着);60 秒打字、删改、66 秒发出去;70 秒开发照片屏、圈画、发;80 秒那条带照片
  const at = (dt: number) => T + dt;
  const plays: PlayRecord[] = [
    { at: at(500), k: 'view', w: 1180, h: 820, kb: 0, v: 'abcd1234' },
    { at: at(25000), k: 'scroll', job: '1', card: 0, dy: -40 },
    { at: at(30000), k: 'hold', e: 'down' }, { at: at(31000), k: 'hold', e: 'audio' }, { at: at(31800), k: 'hold', e: 'text', text: '拜拜' }, { at: at(32600), k: 'hold', e: 'text', text: '拜拜和爸爸' },
    { at: at(33000), k: 'hold', e: 'slide', on: true }, { at: at(33400), k: 'hold', e: 'slide', on: false }, { at: at(34000), k: 'hold', e: 'up' }, { at: at(35000), k: 'hold', e: 'end', r: 'unclear', lv: '0001234567899876543210000000000000000000000000000000' },
    { at: at(40000), k: 'hold', e: 'down' }, { at: at(42000), k: 'hold', e: 'end', r: 'unclear', lv: '0000000000000000000' },
    { at: at(50000), k: 'hold', e: 'down' }, { at: at(52000), k: 'hold', e: 'end', r: 'dead' },
    { at: at(60000), k: 'view', w: 1180, h: 820, kb: 360, v: 'abcd1234' },
    { at: at(60000), k: 'type', e: 'focus' }, { at: at(61000), k: 'type', e: 'v', v: '他们' }, { at: at(62000), k: 'type', e: 'v', v: '他们在看大象' }, { at: at(63000), k: 'type', e: 'v', v: '他们在看' }, { at: at(65000), k: 'type', e: 'v', v: '他们在看大熊猫' }, { at: at(66000), k: 'type', e: 'send' }, { at: at(66100), k: 'type', e: 'blur' },
    { at: at(66200), k: 'view', w: 1180, h: 820, kb: 0, v: 'abcd1234' },
    { at: at(70000), k: 'ps', e: 'open' }, { at: at(72000), k: 'ps', e: 'tool', tool: 'pen' }, { at: at(79000), k: 'ps', e: 'send' },
  ];
  const m1 = msg('1', { text: '看图说话', timing: { startedAt: iso(T) }, section: S2 });
  const m2 = msg('2', { text: '他们在看大熊猫', timing: { startedAt: iso(T + 66000) } });
  const m3 = msg('3', { text: '', photos: ['captures/2026-09-28/1201-1.jpg'], timing: { startedAt: iso(T + 80000) } });
  const r = buildReel(input([m1, m2, m3], { plays }))!;
  check('按住说话:三次各成一段(话筒开、松手、字、上滑、音量、结果);打字一段(四次值、发了);发照片屏一段(圈画、发、照片是之后那条的)', r.holds.length === 3 && r.holds[0].audioAt === at(31000) && r.holds[0].upAt === at(34000) && r.holds[0].texts.length === 2 && r.holds[0].slides.length === 2 && r.holds[0].result === 'unclear' && r.holds[2].result === 'dead' && r.types.length === 1 && r.types[0].vals.length === 4 && r.types[0].sent && r.types[0].to === at(66000) && r.photoScreens.length === 1 && r.photoScreens[0].photo === 'captures/2026-09-28/1201-1.jpg' && r.views.length === 3 && r.scrolls.length === 1, JSON.stringify({ holds: r.holds, types: r.types, ps: r.photoScreens }).slice(0, 400));
  check('连着三次没发出去(中间一句也没发成):三个淡点 + 一串;按住、打字、发照片屏照真实时间放(不压)', r.marks.filter((m) => m.kind === 'miss').length === 3 && r.misses.length === 1 && r.misses[0].n === 3 && r.misses[0].from === at(30000) && r.misses[0].to === at(52000) && r.marks.some((m) => m.kind === 'misses' && m.label === '按住说话连着 3 次没发出去' && m.to === at(52000)) && !r.gaps.some((g) => (g.from < at(35000) && g.to > at(30000)) || (g.from < at(66000) && g.to > at(60000)) || (g.from < at(79000) && g.to > at(70000))), JSON.stringify(r.gaps.map((g) => [g.from - T, g.to - T])));
  const f = (dt: number) => reelFrameAt(r, at(dt));
  check('按住:话筒没开「等一下」→ 在听(字到这一刻、上滑那会儿算取消区)→ 松手收尾;音量取到这一刻的最近 25 格', f(30500).hold?.phase === 'wait' && f(31900).hold?.phase === 'live' && f(31900).hold?.text === '拜拜' && f(33200).hold?.slide === true && f(33600).hold?.slide === false && f(34500).hold?.phase === 'tail' && f(34500).hold?.text === '拜拜和爸爸' && f(31000).hold?.lv === '0000000000000000012345678' && f(30500).miss?.k === 1 && f(41000).miss?.k === 2 && f(51000).miss?.n === 3, JSON.stringify([f(31000).hold, f(41000).miss]));
  check('没听清:收尾后 2.5 秒输入条写「没听清」;再过就没了', f(35500).unclear && !f(38000).unclear && f(35500).hold === null);
  check('打字:输入框里这一刻的字(删掉的大象也看得到);键盘高跟着屏幕尺寸的记录', f(62500).typing?.v === '他们在看大象' && f(64000).typing?.v === '他们在看' && f(65500).typing?.v === '他们在看大熊猫' && f(66500).typing === null && f(61000).view?.kb === 360 && f(67000).view?.kb === 0 && f(100).view?.w === 1180);
  check('发照片屏:开着时有最近的工具与那张照片;翻板书取最近一次', f(73000).photoScreen?.tool === 'pen' && f(73000).photoScreen?.photo === 'captures/2026-09-28/1201-1.jpg' && f(80000).photoScreen === null && f(26000).scroll?.dy === -40 && f(20000).scroll === null);
  // 中间发成了一句:不算连着
  const ok2 = buildReel(input([m1, msg('2', { text: '好', timing: { startedAt: iso(T + 45000) } })], { plays: plays.filter((p) => p.at < at(60000)) }))!;
  check('两次没发出去之间孩子发成了一句:不算一串', ok2.misses.length === 0 && ok2.marks.filter((m) => m.kind === 'miss').length === 3);
  // 老话题:没有 hold 实录,从 voice-diag 推没发出去的那几次;发出去的不进(有原声那一段)
  const diag: ReelDiag[] = [{ at: at(30000), ms: 4000, audioMs: null, result: 'unclear', peak: -1 }, { at: at(36000), ms: 3000, audioMs: 100, result: 'unclear', peak: 0 }, { at: at(40000), ms: 2000, audioMs: 50, result: 'dead', peak: 0 }, { at: at(45000), ms: 2000, audioMs: 50, result: 'sent', peak: 1 }];
  const old = buildReel(input([m1], { diag }))!;
  check('老话题从 voice-diag 推:三次没发出去成一串;话筒没开的一直是「等一下」,音量 0 的波形是平的', old.holds.length === 3 && old.holds.every((x) => x.diag) && old.misses.length === 1 && reelFrameAt(old, at(28000)).hold?.phase === 'wait' && reelFrameAt(old, at(34000)).hold?.lv === '0000000000000000000000000' && reelFrameAt(old, at(28000)).hold?.lv === null, JSON.stringify(old.holds.map((x) => [x.from - T, x.to - T, x.audioAt, x.lv.length])));
  check('有 hold 实录就不用 voice-diag', buildReel(input([m1], { plays, diag }))!.holds.length === 3 && buildReel(input([m1], { plays, diag }))!.holds.every((x) => !x.diag));
  check('补记的形状:好的收、坏的丢', playRecordOk({ at: 1, k: 'view', w: 1180, h: 820, kb: 0, v: 'abc' }) && playRecordOk({ at: 1, k: 'hold', e: 'end', r: 'unclear', lv: '0123' }) && playRecordOk({ at: 1, k: 'type', e: 'v', v: '他们' }) && playRecordOk({ at: 1, k: 'ps', e: 'tool', tool: 'pen' }) && playRecordOk({ at: 1, k: 'scroll', job: '1620-1', card: 0, dy: -40 }) && !playRecordOk({ at: 1, k: 'hold', e: 'end', r: 'oops' }) && !playRecordOk({ at: 1, k: 'hold', e: 'end', lv: 'abc' }) && !playRecordOk({ at: 1, k: 'view', w: 1, h: 820, kb: 0, v: '' }) && !playRecordOk({ at: 1, k: 'type', e: 'v', v: 'x'.repeat(500) }) && !playRecordOk({ at: 1, k: 'scroll', job: 'x', card: 0, dy: 0 }));
}
check('实录的形状:好的收、坏的丢', playRecordOk({ at: 1, k: 'play', job: '1620-1', line: 0, status: 'playing' }) && playRecordOk({ at: 1, k: 'play', job: null, line: -1, status: 'idle' }) && playRecordOk({ at: 1, k: 'stage', job: '1620-1', card: 2, open: true }) && !playRecordOk({ at: 1, k: 'stage', job: '../x', card: 2, open: true }) && !playRecordOk({ at: 'x', k: 'visible', on: true }) && !playRecordOk({ at: 1, k: 'eval', on: true }) && !playRecordOk(null));
check('进度条上怎么写孩子这句', reelSaid({ text: 'x', action: 'continue' }) === '继续' && reelSaid({ text: '', action: 'submit', via: { home: 'h', button: 'new', label: '6 的口诀' } }) === '交给老师' && reelSaid({ text: 'x', via: { home: 'h', button: 0, label: '开场' } }) === '开场' && reelSaid({ text: '原话' }) === '原话');
check('时长的写法', reelDuration(23400) === '23 秒' && reelDuration(130000) === '2 分 10 秒' && reelDuration(120000) === '2 分' && reelDuration(3_900_000) === '1 小时 5 分');

done();
