/** 录像(《家长录像设计.md》):推算轨道、某一刻的样子、空白压缩与播放时钟。纯函数,手搭的节,时刻都算得准。 */
import { buildReel, reelClock, reelDuration, reelFrameAt, reelSaid, REEL_GAP_PLAY_MS, type ReelInput } from '../src/lib/reel.ts';
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

check('话题里孩子一句都没说(没交出去的备课)→ 没有录像', buildReel(input([msg('p1', { from: 'parent', section: S2 })])) === null);

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
  check('空白:老师说完到下一次开口 49.5 秒(think);等老师 20 秒,前 10 秒照放、其余压(wait)', r.gaps.map((g) => `${g.kind}:${g.from - T}-${g.to - T}:${g.ms}`).join(' ') === 'think:10500-60000:49500 wait:70000-80000:20000', JSON.stringify(r.gaps));
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
  check('压缩:82.5 秒的话题,49.5 秒的想与 10 秒的多等各压成 1.5 秒', c.total === 82500 - 49500 - 10000 + 2 * REEL_GAP_PLAY_MS, String(c.total));
  check('播放 ↔ 墙钟:空白前照常、空白里线性、空白后平移', c.toWall(10500) === T + 10500 && c.toWall(10500 + 750) === T + 10500 + 49500 / 2 && c.toWall(12000) === T + 60000 && c.toPlay(T + 65000) === 17000 && c.toPlay(c.toWall(5000)) === 5000 && c.toWall(c.total + 999) === r.endAt);
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
  // 孩子第一次开口之前的节(交给孩子的课):从开口往前倒推,一节接一节;有更早的卡状态就把那节往前挪
  const S3: BoardSection = { cards: [card('课 1')], lines: [line('第一节', 0, 'e.mp3'), line('懂了吗?', 0, 'f.mp3', true)] };
  const S4: BoardSection = { cards: [card('课 2')], lines: [line('第二节', 0, 'g.mp3')] };
  const p0 = msg('p0', { from: 'parent', text: '课文件 6 的口诀', lessonSection: 0, section: S3 });
  const p1 = msg('p1', { from: 'parent', text: '课文件 6 的口诀 · 第 2 节', lessonSection: 1, section: S4 });
  const k = msg('k', { text: '懂了', timing: { startedAt: iso(T), dubbedMs: 2000 }, section: S2 });
  const flat = buildReel(input([p0, p1, k]))!;
  check('课的几节一节接一节、正好在孩子开口时念完', flat.tracks.map((t) => `${t.job}:${t.at - T}`).join() === 'p0:-4600,p1:-2200,k:2000' && flat.says[0].from === T - 4600 && flat.says[2].to === T - 200, JSON.stringify(flat.tracks));
  const moved = buildReel(input([p0, p1, k], { cards: { p0: { 0: { at: iso(T - 10000), turn: 'p1', state: { x: 1 } } } } }))!;
  check('第一节的卡 10 秒前就有状态:第一节挪到那一刻前念完,中间空出来的算孩子在想', moved.tracks[0].at === T - 12400 && moved.tracks[0].doneAt === T - 10200 && moved.gaps.some((g) => g.kind === 'think' && g.from === T - 10200 && g.to === T - 2200), JSON.stringify({ t: moved.tracks[0], g: moved.gaps }));
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

check('进度条上怎么写孩子这句', reelSaid({ text: 'x', action: 'continue' }) === '继续' && reelSaid({ text: '', action: 'submit', via: { home: 'h', button: 'new', label: '6 的口诀' } }) === '交给老师' && reelSaid({ text: 'x', via: { home: 'h', button: 0, label: '开场' } }) === '开场' && reelSaid({ text: '原话' }) === '原话');
check('时长的写法', reelDuration(23400) === '23 秒' && reelDuration(130000) === '2 分 10 秒' && reelDuration(120000) === '2 分' && reelDuration(3_900_000) === '1 小时 5 分');

done();
