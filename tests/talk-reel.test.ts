/**
 * 口语课录像的轨道(src/talk/lib/reel.ts,《wip/口语课设想.md》§8.3):章、点、经过、空白、钟、这一刻那一行。纯函数。
 */
import { check, done } from './_check.ts';

const { TK_SQUEEZE_MS, tkBuild, tkCaption, tkClock, tkIn, tkUpto } = await import('../src/talk/lib/reel.ts');

const st = (phase: string, i: number, en: string | null, rd: Record<string, unknown> | null = null): Record<string, unknown> => ({ t: 'state', phase, i, n: 3, item: en ? { en, zh: '' } : null, speaking: false, deadline: null, interrupt: false, rd });
const msgs: [number, 'o' | 'i', Record<string, unknown>][] = [
  [0, 'o', st('read', 0, 'red', { mode: 'tutor', left: null, wait: 5000, again: 0 })],
  [800, 'o', { t: 'tutor', done: 'red, 红色。' }],
  [1200, 'o', st('read', 0, 'red', { mode: 'listen', left: 5000, wait: 5000, again: 0 })],
  [6200, 'o', st('read', 0, 'red', { mode: 'tutor', left: null, wait: 5000, again: 1 })],
  [7500, 'o', st('read', 0, 'red', { mode: 'listen', left: 5000, wait: 5000, again: 1 })],
  [8000, 'o', st('read', 0, 'red', { mode: 'speech', left: null, wait: 5000, again: 1 })],
  [9000, 'o', st('read', 0, 'red', { mode: 'heard', left: null, wait: 5000, again: 1 })],
  [9200, 'o', { t: 'kid', text: 'hello' }],
  [9200, 'o', st('read', 0, 'red', { mode: 'tutor', left: null, wait: 5000, again: 2 })],
  [9300, 'i', { t: 'next' }],
  [9300, 'o', st('read', 1, 'bus', { mode: 'tutor', left: null, wait: 5000, again: 0 })],
  [9900, 'o', st('read', 2, null, { mode: 'tutor', left: null, wait: 5000, again: 0 })],
  [10000, 'i', { t: 'chat' }],
  [10100, 'o', st('chat', 2, null)],
  [11000, 'o', { t: 'tutor', delta: "It's a " }],
  [11100, 'o', { t: 'card', i: 0 }],
  [11300, 'o', { t: 'tutor', done: "It's a red car." }],
  [30000, 'o', { t: 'kid', text: 'Red!' }],
  [30050, 'i', { t: 'say', w: 'red' }],
  [31000, 'i', { t: 'bye' }],
  [31000, 'o', { t: 'end', why: 'bye' }],
];
const r = tkBuild({ v: 1, startedAt: '2026-10-14T10:00:00.000Z', ms: 31000, view: [820, 1180], msgs, playing: [[60, 800], [6260, 7400], [9400, 10000], [11060, 13000]], kidVoice: [[7900, 8900], [29000, 29900]] }, [{ en: 'red' }, { en: 'bus' }]);

check('章:跟我读一句一章、打电话一章', JSON.stringify(r.chapters.map((c) => [c.t, c.title])) === JSON.stringify([[0, '跟我读 1 · red'], [9300, '跟我读 2 · bus'], [10100, '打电话']]), JSON.stringify(r.chapters));
check('点:老师再读(没出声 / 读的不沾)、孩子开口、讲到一张卡', JSON.stringify(r.marks.map((m) => [m.t, m.kind, m.label])) === JSON.stringify([[6200, 'miss', '没出声,老师再读一遍'], [9200, 'said', 'hello'], [9200, 'miss', '读的跟这句不沾,老师再读一遍'], [11100, 'card', '讲到 red'], [30000, 'said', 'Red!']]), JSON.stringify(r.marks));
const chips = r.notes.map((n) => n.chip + ':' + n.text);
check('经过:老师说的、孩子读的 / 说的、点的(下一句、直接打电话、听、挂断)、换到打电话、挂断的原因', chips.includes('老师:red, 红色。') && chips.includes('读:hello') && chips.includes('说:Red!') && chips.includes('点:点了「下一句」') && chips.includes('点:点了「直接打电话」') && chips.includes('点:点了「听」:red') && chips.includes('打电话:跟我读完了,开始打电话') && chips.includes('挂断:孩子挂的') && chips.includes('再读:没出声,老师再读一遍(第 1 遍)') && !chips.includes("老师:It's a "), JSON.stringify(chips));
check('屏幕多大照 view;起点是通话开始的墙钟', JSON.stringify(r.size) === '[820,1180]' && r.startAt === Date.parse('2026-10-14T10:00:00.000Z') && r.end === 31000);
check('空白:没消息、老师孩子都没出声 5 秒以上才压(前留 1 秒、后留 0.5 秒);孩子想词那段也算(13000 → 29000)', JSON.stringify(r.gaps) === JSON.stringify([{ from: 14000, to: 28500 }]), JSON.stringify(r.gaps));
const c = tkClock(r, false), full = tkClock(r, true);
check('钟:跳过空白时空白压成 1.5 秒,来回换得回来;关了就是原长', full.total === 31000 && c.total === 31000 - (28500 - 14000) + TK_SQUEEZE_MS && Math.abs(c.toWall(c.toPlay(20000)) - 20000) < 1 && c.toPlay(30000) === 30000 - (28500 - 14000) + TK_SQUEEZE_MS, JSON.stringify({ total: c.total, p: c.toPlay(30000) }));
check('tkUpto:≤ t 的消息几条;tkIn', tkUpto(r, -1) === 0 && tkUpto(r, 9200) === 9 && tkUpto(r, 99999) === msgs.length && tkIn(r.playing, 700) && !tkIn(r.playing, 900));
check('这一刻那一行:老师在说(带这句)、孩子在说、孩子想了几秒、都没有', tkCaption(r, 12000).text === "老师在说:It's a red car." && tkCaption(r, 8500).cls === 'kid' && tkCaption(r, 20000).text === '孩子想了 16 秒' && tkCaption(r, 5000).text === '', JSON.stringify([tkCaption(r, 12000), tkCaption(r, 20000)]));

done();
