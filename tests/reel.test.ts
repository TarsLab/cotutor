/** 录像:轨道、某一刻的样子、空白压缩与播放时钟。纯函数,手搭的节,时刻都算得准。
 *  实时的轮照通话放;不是实时的轮写完那一刻整节铺上、不念(2026-10-22 起)。课里的卡 2026-11-17 删了(卡的改动、弹窗、翻板书的记录一起删了)。 */
import { buildReel, playRecordOk, reelChapterEnds, reelClock, reelDuration, reelFrameAt, reelSaid, REEL_GAP_PLAY_MS, type PlayRecord, type ReelInput } from '../src/ui/kid/reel.ts';
import type { BoardSection } from '../src/board/presentation.ts';
import type { RunEvent } from '../src/schema/index.ts';
import type { ConversationMessage } from '../src/schema/conversation.ts';
import { check, done } from './_check.ts';

const line = (text: string, ask = false) => ({ text, ask });
const T = Date.parse('2026-09-28T12:00:00.000Z');
const iso = (t: number) => new Date(t).toISOString();
const msg = (job: string, o: Partial<ConversationMessage>): ConversationMessage => ({ job, thread: 'th', at: '2026-09-28T20:00', from: 'kid', text: '', result: 'ok', artifacts: [], ...o }) as ConversationMessage;
const ev = (list: RunEvent[]): RunEvent[] => list;
const input = (messages: ConversationMessage[], o: Partial<ReelInput> = {}): ReelInput => ({ messages, events: {}, now: T + 3_600_000, ...o });

// S1:三句,末句问句;9.5 秒写完(ready all)
const S1: BoardSection = { lines: [line('开头'), line('讲 A'), line('B 呢?', true)] };
const E1 = ev([
  { t: 0, lane: 'main', kind: 'start', cli: 'claude', runtime: 'claude', resume: true },
  { t: 9500, lane: 'ready', kind: 'all', lines: 3 },
  { t: 9600, lane: 'index', kind: 'written', warnings: 0 },
]);
// S2:一句
const S2: BoardSection = { lines: [line('讲 C')] };

check('一轮都没有 → 没有录像', buildReel(input([])) === null);
{
  // 孩子一句都没说(系统起的轮):只有老师那一轨,从这轮自己的时刻起
  const r0 = buildReel(input([msg('p1', { from: 'system', section: S2 })]));
  const last = r0 ? reelFrameAt(r0, r0.endAt) : null;
  check('孩子一句都没说:照样有录像,只有老师那一轨;最后一帧整节都在', !!r0 && r0.tracks.length === 1 && r0.says.length === 0 && r0.marks.length >= 1 && !!last && last.sections.length === 1, JSON.stringify(r0?.marks));
}

{
  // 不是实时的轮(家长端试发、cotutor send):写完那一刻整节铺上、不念
  const m1 = msg('1', { text: '7 减 9', timing: { startedAt: iso(T) }, section: S1 });
  const m2 = msg('2', { action: 'submit', text: '', timing: { startedAt: iso(T + 60000), doneMs: 20000 }, section: S2 });
  const bk = msg('3', { from: 'system', text: '记账', bookkeep: { thread: 'th' }, timing: { startedAt: iso(T + 7_200_000) }, section: S2 });
  const r = buildReel(input([m1, m2, bk], { events: { 1: E1 } }))!;
  check('不念:没有一句念的', r.says.length === 0);
  const t1 = r.tracks[0];
  check('写完(ready all)那一刻整节铺上;末句问句 → 停下等孩子;没事件的轮按 doneMs', t1.at === T + 9500 && t1.ask && t1.doneAt === T + 9500 && r.tracks[1].at === T + 80000, JSON.stringify(r.tracks));
  check('记账的轮不进录像(晚上的系统轮)', r.tracks.length === 2 && !r.marks.some((m) => m.job === '3') && r.endAt === T + 80000 + 1500);
  check('进度条上的点:两次开口(给老师看写「给老师看」)、停下等孩子', r.marks.map((m) => `${m.kind}@${m.at - T}:${m.label}`).join(' ') === 'said@0:7 减 9 ask@9500:B 呢? said@60000:给老师看', r.marks.map((m) => `${m.kind}@${m.at - T}:${m.label}`).join(' '));
  check('空白:写完到下一次开口的 50.5 秒;等老师 20 秒,前 10 秒照放、其余压', r.gaps.map((g) => `${g.kind}:${g.from - T}-${g.to - T}:${g.ms}${g.cont ? ':cont' : ''}`).join(' ') === 'think:9500-60000:50500 wait:70000-80000:20000', JSON.stringify(r.gaps));
  check('等老师:两轮各从开口到写完', r.waits.map((w) => `${w.job}:${w.to - w.from}`).join() === '1:9500,2:20000');

  // 某一刻
  const f0 = reelFrameAt(r, T + 1000);
  check('开口后老师还没写完:板上空的、等了 1 秒', f0.sections.length === 0 && f0.wait?.ms === 1000 && f0.saying === null && f0.notes.length === 1 && !f0.notes[0].post);
  const f1 = reelFrameAt(r, T + 9600);
  check('写完了:整节都在、停下等孩子、节尾的旁注出来了', f1.sections.length === 1 && f1.asking && f1.notes[0].post && f1.saying === null, JSON.stringify(f1));
  const f5 = reelFrameAt(r, T + 75000);
  check('第二次开口后老师 15 秒还没写完:在 wait 空白里,等了 15 秒;前一节还在', f5.gap?.kind === 'wait' && f5.wait?.ms === 15000 && f5.sections.length === 1 && f5.notes.length === 2);
  check('第二节写完就在', reelFrameAt(r, T + 80500).sections.length === 2);

  // 播放时钟:压过的空白各放 1.5 秒
  const c = reelClock(r, false);
  check('压缩:81.5 秒的话题,两段空白(50.5 秒、多等的 10 秒)各压成 1.5 秒', c.total === 81500 - 50500 - 10000 + 2 * REEL_GAP_PLAY_MS, String(c.total));
  check('播放 ↔ 墙钟:空白前照常、空白里线性、空白后平移', c.toWall(9500) === T + 9500 && c.toWall(9500 + 750) === T + 9500 + 50500 / 2 && c.toWall(11000) === T + 60000 && c.toPlay(T + 65000) === 16000 && c.toPlay(c.toWall(5000)) === 5000 && c.toWall(c.total + 999) === r.endAt);
  const real = reelClock(r, true);
  check('关掉「跳过空白」(按真实时间):不压', real.total === r.endAt - r.startAt && real.toWall(40000) === T + 40000);
}

{
  // 孩子在老师写完之前又开口了:这节在开口那一刻整节铺上
  const m1 = msg('1', { timing: { startedAt: iso(T) }, section: S1 });
  const m2 = msg('2', { text: '等等', timing: { startedAt: iso(T + 5000), doneMs: 3000 }, section: S2 });
  const r = buildReel(input([m1, m2], { events: { 1: E1 } }))!;
  check('下一次开口比写完早:这节在开口那一刻铺上', r.tracks[0].at === T + 5000 && reelFrameAt(r, T + 5500).sections.length === 1, JSON.stringify(r.tracks[0]));
}

{
  // 孩子第一次开口之前的系统轮:各从自己的时刻起,没有「开口」的点;末句问句有「停下等孩子」
  const S3: BoardSection = { lines: [line('第一节'), line('懂了吗?', true)] };
  const p0 = msg('p0', { from: 'system', text: '系统起的', timing: { startedAt: iso(T - 20000) }, section: S3 });
  const k = msg('k', { text: '懂了', timing: { startedAt: iso(T), doneMs: 2000 }, section: S2 });
  const r = buildReel(input([p0, k]))!;
  check('系统轮从自己的时刻起;孩子那轮写完时铺上', r.tracks.map((t) => `${t.job}:${t.at - T}`).join() === 'p0:-20000,k:2000', JSON.stringify(r.tracks));
  check('系统轮没有「开口」的点,末句问句有「停下等孩子」', !r.marks.some((m) => m.kind === 'said' && m.job === 'p0') && r.marks.some((m) => m.kind === 'ask' && m.job === 'p0'));
}

{
  // 没成的轮
  const err = msg('e', { text: '再来', result: 'error', error: 'timeout', timing: { startedAt: iso(T) } });
  const r = buildReel(input([err], { events: { e: ev([{ t: 4000, lane: 'main', kind: 'exit', ok: false, reason: 'timeout' }]) } }))!;
  check('没成的轮:没有节;「没成」的点在老师退出那一刻,节尾旁注那时出来,之前算等老师', r.tracks.length === 0 && r.marks.map((m) => m.kind).join() === 'said,error' && r.marks[1].at === T + 4000 && r.notes[0].postAt === T + 4000 && reelFrameAt(r, T + 3000).wait?.ms === 3000);
}

{
  // 实录:切到后台 3 秒
  const m1 = msg('1', { text: '三角形', timing: { startedAt: iso(T), doneMs: 2000 }, section: S2 });
  const plays: PlayRecord[] = [{ at: T + 13000, k: 'visible', on: false }, { at: T + 16000, k: 'visible', on: true }];
  const r = buildReel(input([m1], { plays }))!;
  check('切到后台的一段;那几秒 away', r.aways.length === 1 && r.aways[0].to - r.aways[0].from === 3000 && reelFrameAt(r, T + 14000).away && !reelFrameAt(r, T + 17000).away);
}
{
  // 看小课堂(第 5 步):开口前 60 秒开始看;放 10 秒停下、5 秒后画一处、再过 7 秒接着放;放 8 秒后拖到 0:30;放到 0:46 看完;14 秒后开口
  const L = { bundle: '2026-09-18-po13-jian-8', title: '13 − 8 破十法', watchedMs: 46000, finished: true, pauses: 1,
    log: [{ t: -60000, pos: 0, play: true }, { t: -50000, pos: 10000, play: false }, { t: -38000, pos: 10000, play: true }, { t: -30000, pos: 30000, play: true }, { t: -14000, pos: 46000, play: false }],
    marks: [{ atMs: 10000, svgMs: 9000, strokes: [[[1, 1], [9, 1], [5, 9]], [[2, 2], [3, 3]]] as [number, number][][], t: -45000 }] };
  const r = buildReel(input([msg('1', { text: '为什么要拆', timing: { startedAt: iso(T) }, section: S2, lecture: L })]))!;
  check('看小课堂的一段:从第一条看的记录起、到看完那条止;录像从看课开始', r.lectures.length === 1 && r.lectures[0].from === T - 60000 && r.lectures[0].to === T - 14000 && r.startAt === T - 60000, JSON.stringify(r.lectures[0]).slice(0, 300));
  check('进度条上的点:开始看小课堂、画了一处(课里的时刻)、开口', r.marks.slice(0, 3).map((m) => `${m.kind}@${m.at - T}:${m.label}`).join(' ') === 'lecture@-60000:看小课堂 · 13 − 8 破十法 ink@-45000:画了一处(课里 0:10) said@0:为什么要拆', r.marks.map((m) => `${m.kind}@${m.at - T}:${m.label}`).join(' '));
  const at = (dt: number) => reelFrameAt(r, T + dt).lecture;
  check('某一刻:放着按真实时间往前推;停着停在那儿;画过的到画下去那一刻才出来(几笔都在)', at(-55000)?.pos === 5000 && at(-55000)?.playing === true && at(-48000)?.pos === 10000 && at(-48000)?.playing === false && at(-48000)?.marks.length === 0 && at(-44000)?.marks.length === 1 && at(-44000)?.marks[0].strokes.length === 2 && at(-31000)?.pos === 17000 && at(-29000)?.pos === 31000 && at(-15000)?.pos === 45000, JSON.stringify([at(-31000), at(-29000)]));
  check('看完到开口之间不在看(板书那边);开口之后也不在', at(-10000) === null && at(1000) === null);
  check('空白:停着的 12 秒被那一处画切开(画前后各 1 秒照放),后一段 6 秒压;在放的不压;看完到开口的 14 秒压', r.gaps.map((g) => `${g.kind}:${g.from - T}-${g.to - T}${g.cont ? ':cont' : ''}`).join(' ') === 'think:-44000--38000:cont think:-14000-0', JSON.stringify(r.gaps.map((g) => [g.from - T, g.to - T])));
  check('没带看的过程(以前的话题):没有这一段', buildReel(input([msg('1', { text: 'x', timing: { startedAt: iso(T) }, section: S2, lecture: { ...L, log: undefined } })]))!.lectures.length === 0);
}
{
  // 改版补记:按住说话、打字、发照片屏、屏幕尺寸;连着没发出去
  // 老师那轮 0 秒开口、写完就铺上;孩子 30 秒按住、话筒 31 秒开、34 秒松手、35 秒没听清;
  // 40 秒、50 秒又两次没听清(一共三次连着);60 秒打字、删改、66 秒发出去;70 秒开发照片屏、圈画、发;80 秒那条带照片
  const at = (dt: number) => T + dt;
  const plays: PlayRecord[] = [
    { at: at(500), k: 'view', w: 1180, h: 820, kb: 0, v: 'abcd1234' },
    { at: at(30000), k: 'hold', e: 'down' }, { at: at(31000), k: 'hold', e: 'audio' },
    { at: at(33000), k: 'hold', e: 'slide', on: true }, { at: at(33400), k: 'hold', e: 'slide', on: false }, { at: at(34000), k: 'hold', e: 'up' }, { at: at(35000), k: 'hold', e: 'end', r: 'unclear', lv: '0001234567899876543210000000000000000000000000000000' },
    { at: at(40000), k: 'hold', e: 'down' }, { at: at(42000), k: 'hold', e: 'end', r: 'unclear', lv: '0000000000000000000' },
    { at: at(50000), k: 'hold', e: 'down' }, { at: at(52000), k: 'hold', e: 'end', r: 'cancel' },
    { at: at(60000), k: 'view', w: 1180, h: 820, kb: 360, v: 'abcd1234' },
    { at: at(60000), k: 'type', e: 'focus' }, { at: at(61000), k: 'type', e: 'v', v: '他们' }, { at: at(62000), k: 'type', e: 'v', v: '他们在看大象' }, { at: at(63000), k: 'type', e: 'v', v: '他们在看' }, { at: at(65000), k: 'type', e: 'v', v: '他们在看大熊猫' }, { at: at(66000), k: 'type', e: 'send' }, { at: at(66100), k: 'type', e: 'blur' },
    { at: at(66200), k: 'view', w: 1180, h: 820, kb: 0, v: 'abcd1234' },
    { at: at(70000), k: 'ps', e: 'open' }, { at: at(72000), k: 'ps', e: 'tool', tool: 'pen' }, { at: at(79000), k: 'ps', e: 'send' },
  ];
  const m1 = msg('1', { text: '看图说话', timing: { startedAt: iso(T) }, section: S2 });
  const m2 = msg('2', { text: '他们在看大熊猫', timing: { startedAt: iso(T + 66000) } });
  const m3 = msg('3', { text: '', photos: ['captures/2026-09-28/1201-1.jpg'], timing: { startedAt: iso(T + 80000) } });
  const r = buildReel(input([m1, m2, m3], { plays }))!;
  check('按住说话:三次各成一段(话筒开、松手、上滑、音量、结果);打字一段(四次值、发了);发照片屏一段(圈画、发、照片是之后那条的)', r.holds.length === 3 && r.holds[0].audioAt === at(31000) && r.holds[0].upAt === at(34000) && r.holds[0].slides.length === 2 && r.holds[0].result === 'unclear' && r.holds[2].result === 'cancel' && r.types.length === 1 && r.types[0].vals.length === 4 && r.types[0].sent && r.types[0].to === at(66000) && r.photoScreens.length === 1 && r.photoScreens[0].photo === 'captures/2026-09-28/1201-1.jpg' && r.views.length === 3, JSON.stringify({ holds: r.holds, types: r.types, ps: r.photoScreens }).slice(0, 400));
  check('连着三次没发出去(中间一句也没发成):三个淡点 + 一串;按住、打字、发照片屏照真实时间放(不压)', r.marks.filter((m) => m.kind === 'miss').length === 3 && r.misses.length === 1 && r.misses[0].n === 3 && r.misses[0].from === at(30000) && r.misses[0].to === at(52000) && r.marks.some((m) => m.kind === 'misses' && m.label === '按住说话连着 3 次没发出去' && m.to === at(52000)) && !r.gaps.some((g) => (g.from < at(35000) && g.to > at(30000)) || (g.from < at(66000) && g.to > at(60000)) || (g.from < at(79000) && g.to > at(70000))), JSON.stringify(r.gaps.map((g) => [g.from - T, g.to - T])));
  const f = (dt: number) => reelFrameAt(r, at(dt));
  check('按住:话筒没开「等一下」→ 在听(上滑那会儿算取消区)→ 松手收尾;音量取到这一刻的最近 25 格', f(30500).hold?.phase === 'wait' && f(31900).hold?.phase === 'live' && f(33200).hold?.slide === true && f(33600).hold?.slide === false && f(34500).hold?.phase === 'tail' && f(31000).hold?.lv === '0000000000000000012345678' && f(30500).miss?.k === 1 && f(41000).miss?.k === 2 && f(51000).miss?.n === 3, JSON.stringify([f(31000).hold, f(41000).miss]));
  check('没听清:收尾后 2.5 秒输入条写「没听清」;再过就没了', f(35500).unclear && !f(38000).unclear && f(35500).hold === null);
  check('打字:输入框里这一刻的字(删掉的大象也看得到);键盘高跟着屏幕尺寸的记录', f(62500).typing?.v === '他们在看大象' && f(64000).typing?.v === '他们在看' && f(65500).typing?.v === '他们在看大熊猫' && f(66500).typing === null && f(61000).view?.kb === 360 && f(67000).view?.kb === 0 && f(100).view?.w === 1180);
  check('发照片屏:开着时有最近的工具与那张照片', f(73000).photoScreen?.tool === 'pen' && f(73000).photoScreen?.photo === 'captures/2026-09-28/1201-1.jpg' && f(80000).photoScreen === null);
  // 中间发成了一句:不算连着
  const ok2 = buildReel(input([m1, msg('2', { text: '好', timing: { startedAt: iso(T + 45000) } })], { plays: plays.filter((p) => p.at < at(60000)) }))!;
  check('两次没发出去之间孩子发成了一句:不算一串', ok2.misses.length === 0 && ok2.marks.filter((m) => m.kind === 'miss').length === 3);
  check('补记的形状:好的收、坏的丢', playRecordOk({ at: 1, k: 'view', w: 1180, h: 820, kb: 0, v: 'abc' }) && playRecordOk({ at: 1, k: 'hold', e: 'end', r: 'unclear', lv: '0123' }) && playRecordOk({ at: 1, k: 'hold', e: 'up', cancel: true }) && !playRecordOk({ at: 1, k: 'hold', e: 'up', cancel: false }) && playRecordOk({ at: 1, k: 'type', e: 'v', v: '他们' }) && playRecordOk({ at: 1, k: 'ps', e: 'tool', tool: 'pen' }) && !playRecordOk({ at: 1, k: 'hold', e: 'end', r: 'oops' }) && !playRecordOk({ at: 1, k: 'hold', e: 'end', r: 'dead' }) && !playRecordOk({ at: 1, k: 'hold', e: 'text', text: 'x' }) && !playRecordOk({ at: 1, k: 'hold', e: 'end', lv: 'abc' }) && !playRecordOk({ at: 1, k: 'view', w: 1, h: 820, kb: 0, v: '' }) && !playRecordOk({ at: 1, k: 'type', e: 'v', v: 'x'.repeat(500) }));
}
check('实录的形状:好的收、坏的丢;播放位置、喇叭、弹窗、卡、翻板书的记录不再收', playRecordOk({ at: 1, k: 'visible', on: true }) && !playRecordOk({ at: 1, k: 'stage', job: '1620-1', card: 2, open: true }) && !playRecordOk({ at: 1, k: 'scroll', job: '1620-1', card: 0, dy: 3 }) && !playRecordOk({ at: 1, k: 'play', job: '1620-1', line: 0, status: 'playing' }) && !playRecordOk({ at: 1, k: 'autoplay', on: true }) && !playRecordOk({ at: 1, k: 'stage', job: '../x', card: 2, open: true }) && !playRecordOk({ at: 'x', k: 'visible', on: true }) && !playRecordOk({ at: 1, k: 'eval', on: true }) && !playRecordOk(null));
check('进度条上怎么写孩子这句', reelSaid({ text: '', action: 'submit', via: { home: 'h', button: 'new', label: '6 的口诀' } }) === '给老师看' && reelSaid({ text: 'x', via: { home: 'h', button: 0, label: '开场' } }) === '开场' && reelSaid({ text: '原话' }) === '原话');
check('时长的写法', reelDuration(23400) === '23 秒' && reelDuration(130000) === '2 分 10 秒' && reelDuration(120000) === '2 分' && reelDuration(3_900_000) === '1 小时 5 分');

{
  // 章尾:下一章的前奏开始之前;前奏一段段往前连(没认出来马上又按一次);最后一章是录像末尾
  const ends = reelChapterEnds([1000, 10_000, 20_000], [{ from: 8000, to: 9000 }, { from: 9500, to: 10_200 }, { from: 3000, to: 3500 }, { from: 19_000, to: 19_800 }], 30_000);
  check('章尾:第 1 章落在两次按住说话(连着)之前;中间那次早早没发出去的不算;第 2 章落在下一次按住之前;最后一章是末尾', JSON.stringify(ends) === '[7999,18999,30000]', JSON.stringify(ends));
  const bare = reelChapterEnds([0, 5000], [], 9000);
  check('章尾:没有前奏(听写、口语课、打字的老数据)就是下一章开头之前', JSON.stringify(bare) === '[4999,9000]', JSON.stringify(bare));
  const tight = reelChapterEnds([5000, 5200], [{ from: 4000, to: 5300 }], 6000);
  check('章尾:前奏比这一章开头还早,不早于这一章的开头', tight[0] === 5000, JSON.stringify(tight));
}

{
  // 实时的轮:照那次通话的录像放——孩子按住到松手是原声、嘴接住一段、每句从开始放(read)到下一句或这段放完,声音都在通话那一条里(seek)
  const call = {
    audio: '2026-09-28.live/120000.wav', startAt: T,
    msgs: [
      [100, 'i', { t: 'hold' }], [1500, 'i', { t: 'release', body: {} }],
      [2000, 'o', { t: 'tutor', of: 'catch', done: '你问三明治怎么写' }], [2300, 'o', { t: 'turn', job: 'L1', thread: 'th' }],
      [6000, 'o', { t: 'read', job: 'L1', line: 0, text: '一' }], [8000, 'o', { t: 'read', job: 'L1', line: 1, text: '二' }],
      [12000, 'i', { t: 'hold' }], [13000, 'i', { t: 'release', body: {} }], [13600, 'o', { t: 'tutor', of: 'catch', done: '再讲一遍' }], [13800, 'o', { t: 'turn', job: 'L2', thread: 'th' }],
      [16000, 'o', { t: 'read', job: 'L2', line: 0, text: '三' }], [18000, 'o', { t: 'read', job: 'L2', line: 1, text: '四' }],
      [19000, 'i', { t: 'send', body: { text: '懂了' } }], [19800, 'o', { t: 'turn', job: 'L3', thread: 'th' }],
    ],
    playing: [[2100, 3500], [6000, 10000], [13100, 13500], [16000, 21000], [19400, 19900]],
  } as const;
  const SL: BoardSection = { lines: [line('一'), line('二')] };
  const L1 = msg('L1', { live: true, text: '三明治怎么写', timing: { startedAt: iso(T + 2300) }, section: SL });
  const L2 = msg('L2', { live: true, text: '再讲一遍', timing: { startedAt: iso(T + 13800) }, section: { lines: [line('三'), line('四')] } });
  const L3 = msg('L3', { live: true, text: '懂了', timing: { startedAt: iso(T + 19800) }, section: { lines: [line('好')] } });
  const evL = { L1: ev([{ t: 0, lane: 'main', kind: 'start', cli: 'qwen', runtime: 'qwen', resume: false }, { t: 4000, lane: 'ready', kind: 'all', lines: 2 }]) };
  const r = buildReel(input([L1, L2, L3], { events: evL, calls: [call as unknown as NonNullable<ReelInput['calls']>[number]] }))!;
  const says = r.says.map((x) => `${x.job}:${x.line}:${x.from - T}-${x.to - T}@${x.seek}`).join(' ');
  check('实时:每句从开始放到下一句 / 这段放完;下一次按下就截断;声音在通话那一条里(seek = 在通话里的时刻)', says === 'L1:0:6000-8000@6000 L1:1:8000-10000@8000 L2:0:16000-18000@16000 L2:1:18000-19000@18000' && r.says.every((x) => x.audio === call.audio), says);
  const clips = r.clips.map((c) => `${c.kind}:${c.job}:${c.from - T}-${c.to - T}@${c.seek}${c.text ? ':' + c.text : ''}`).join(' ');
  check('实时:孩子按住到松手是原声、嘴接住一段(带它说的);打字发的没有原声', clips === 'voice:L1:100-1500@100:三明治怎么写 mouth:L1:2100-3500@2100:你问三明治怎么写 voice:L2:12000-13000@12000:再讲一遍 mouth:L2:13100-13500@13100:再讲一遍 mouth:L3:19400-19900@19400', clips);
  check('实时:开口的点在按下那一刻(打字的在发出那一刻);等老师 = 松手到嘴出声', r.marks.filter((x) => x.kind === 'said').map((x) => x.at - T).join() === '100,12000,19000' && r.waits.map((w) => `${w.job}:${w.from - T}-${w.to - T}`).join() === 'L1:1500-2100,L2:13000-13100,L3:19000-19400', JSON.stringify([r.marks, r.waits]));
  const tr = r.tracks.find((x) => x.job === 'L1')!;
  check('实时:节在脑开写时出来,念完整节写完', tr.at === T + 2300 && tr.doneAt === T + 10000, JSON.stringify(tr));
  const f1 = reelFrameAt(r, T + 7000), f2 = reelFrameAt(r, T + 2500);
  check('某一刻:在念的句带 seek(页面从通话的声音里这一处放)、嘴接住那段是 mouth 的声音', f1.saying?.line === 0 && f1.saying.offset === 1000 && f1.saying.seek === 6000 && f1.saying.audio === call.audio && f2.clip?.kind === 'mouth' && f2.clip.offset === 400 && f2.clip.seek === 2100 && f2.clip.text === '你问三明治怎么写', JSON.stringify([f1.saying, f2.clip]));
  // 脑想得久,嘴垫了一句(第一句之前的第二段嘴的声音):也是 mouth 的一段,带它说的
  const fillCall = { audio: call.audio, startAt: T, msgs: [[100, 'i', { t: 'hold' }], [1500, 'i', { t: 'release', body: {} }], [2000, 'o', { t: 'tutor', of: 'catch', done: '嗯,我听到了' }], [2300, 'o', { t: 'turn', job: 'L1', thread: 'th' }], [6600, 'o', { t: 'tutor', of: 'catch', done: '我想一想怎么讲' }], [12000, 'o', { t: 'read', job: 'L1', line: 0, text: '一' }], [14000, 'o', { t: 'read', job: 'L1', line: 1, text: '二' }]], playing: [[2100, 2700], [6500, 7600], [12000, 16000]] };
  const rf = buildReel(input([L1], { events: evL, calls: [fillCall as unknown as NonNullable<ReelInput['calls']>[number]] }))!;
  const fclips = rf.clips.map((c) => `${c.kind}:${c.from - T}-${c.to - T}${c.text ? ':' + c.text : ''}`).join(' ');
  check('实时:嘴垫的那句也是嘴的一段(带它说的),等老师只算松手到接住', fclips === 'voice:100-1500:三明治怎么写 mouth:2100-2700:嗯,我听到了 mouth:6500-7600:我想一想怎么讲' && rf.waits.map((w) => `${w.from - T}-${w.to - T}`).join() === '1500-2100', fclips);
  const noCall = buildReel(input([L1], { events: evL }))!;
  check('实时的轮没有通话的录像:当不是实时的,写完那一刻整节铺上、不念', noCall.says.length === 0 && noCall.tracks.length === 1 && noCall.tracks[0].at === T + 2300 + 4000);
}

{
  // 一节课(铺着页的)录像照孩子端记的样子画
  const P1 = msg('P1', { live: true, text: '看图', timing: { startedAt: iso(T) }, section: { lines: [line('我们看这张图')] } });
  const P2 = msg('P2', { live: true, text: '这是什么', timing: { startedAt: iso(T + 30000) } });
  const callP = { audio: '2026-11-14.live/183345.wav', startAt: T, playing: [], msgs: [
    [100, 'o', { t: 'turn', job: 'P1', thread: 'th' }],
    [28000, 'i', { t: 'hold' }], [29500, 'i', { t: 'release', body: {} }], [30000, 'o', { t: 'turn', job: 'P2', thread: 'th' }],
  ] };
  const plain = buildReel(input([P1, P2], { calls: [callP as unknown as NonNullable<ReelInput['calls']>[number]] }))!;
  // 课本做底:孩子端记的一节课的样子(play 的 lesson),录像照这一刻的那一份画;第一份之前也先铺它
  const L1 = { v: 1, pages: [], at: 'a.pdf#目录', look: null, view: null, strip: null, jobs: [] };
  const L2 = { ...L1, at: 'a.pdf#日月潭', look: { label: '第1段', box: [0, 0, 1000, 200], n: 1 } };
  const withLesson = buildReel(input([P1, P2], { calls: [callP as unknown as NonNullable<ReelInput['calls']>[number]], plays: [{ at: T + 1000, k: 'lesson', l: L1 }, { at: T + 31000, k: 'lesson', l: L2 }] }))!;
  check('课本做底:录像照记下的一节课的样子', JSON.stringify(reelFrameAt(withLesson, T + 500).lesson) === JSON.stringify(L1) && JSON.stringify(reelFrameAt(withLesson, T + 20000).lesson) === JSON.stringify(L1) && JSON.stringify(reelFrameAt(withLesson, T + 40000).lesson) === JSON.stringify(L2));
  check('不是课本做底:lesson 是 null', reelFrameAt(plain, T + 2000).lesson === null);
  check('记下的样子形状不对的不收', playRecordOk({ at: 1, k: 'lesson', l: L1 }) && !playRecordOk({ at: 1, k: 'lesson', l: { v: 2 } }) && !playRecordOk({ at: 1, k: 'lesson', l: null }));
}

done();
