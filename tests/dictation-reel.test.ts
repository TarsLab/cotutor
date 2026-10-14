/**
 * 听写的录像(《家长录像设计.md》拍板 13,src/dictation/lib/reel.ts):一次听写的记录 → 章、点、经过、空白,任一刻屏幕上是什么。
 * 记录是手搭的:冬天写得顺;雪白——想了 10 秒、雪写两笔不会了点「给答案」(两笔清掉)、看笔顺、照着写,白写歪了擦掉重写;
 * 鼻子——念完切到别处 38 分钟,回来接着写;交卷后自己说要再写冬天,写好交了;对好了。
 */
import { check, done } from './_check.ts';
import type { Session } from '../src/dictation/store.ts';
import { drBuild, drCaption, drClock, drFrameAt } from '../src/dictation/lib/reel.ts';

type P = [number, number, number];
/** 一笔:从 t 起 n 个点,每点 40 毫秒 */
const stroke = (t: number, n = 8): P[] => Array.from({ length: n }, (_x, k) => [100 + k * 40, 500, t + k * 40] as P);
const iso = (ms: number): string => new Date(START + ms).toISOString();
const START = Date.parse('2026-10-13T10:32:00.000Z');
const ev = (t: number, kind: string, word: number, more: Record<string, unknown> = {}) => ({ at: iso(t), t, kind, word, ...more });

const MIN = 60_000;
const away = 40000, back = away + 38 * MIN;
const s = {
  id: '2026-10-13-1832', home: null, n: -1, tutor: 'chinese-tutor',
  words: [{ chars: '冬天', say: '冬天,寒冷的冬天' }, { chars: '雪白' }, { chars: '鼻子' }],
  startedAt: iso(0),
  first: [
    { at: iso(9000), judges: [], chars: [{ strokes: [stroke(5000), stroke(5500)], undos: 0 }, { strokes: [stroke(6500)], undos: 0 }] },
    { at: iso(36000), judges: [], chars: [
      { strokes: [stroke(27000), stroke(27500)], undos: 0, revealed: true, gone: [{ t: 24000, pts: stroke(22000) }, { t: 24000, pts: stroke(22500) }] },
      { strokes: [stroke(32000)], undos: 1, gone: [{ t: 31000, pts: stroke(30000) }] },
    ] },
    { at: iso(back + 9000), judges: [], chars: [{ strokes: [stroke(back + 5000)], undos: 0 }, { strokes: [stroke(back + 6000)], undos: 0 }] },
  ],
  checkedAt: iso(back + 10000),
  asked: [],
  rewrites: [{ word: 0, self: true, attempt: { at: iso(back + 20000), judges: [], chars: [{ strokes: [stroke(back + 14000)], undos: 0 }, { strokes: [stroke(back + 16000)], undos: 0 }] } }],
  events: [
    ev(0, 'show', 0), ev(300, 'say', 0, { n: 1 }), ev(4300, 'say', 0, { n: 2 }), ev(10, 'view', 0, { w: 1180, h: 820 }),
    ev(5800, 'done', 0, { char: 0 }), ev(7000, 'done', 0, { char: 1 }),
    ev(7600, 'show', 1), ev(7700, 'say', 1, { n: 1 }), ev(9300, 'say', 1, { n: 2 }),
    // 9300 + 念 → 想了 10 秒才动笔(22000);两笔之后停住,24000 点给答案
    { at: iso(24000), t: 24000, kind: 'reveal', word: 1, char: 0 }, ev(24300, 'order', 1, { char: 0 }), ev(26500, 'trace', 1, { char: 0 }),
    ev(28000, 'done', 1, { char: 0 }), ev(33000, 'done', 1, { char: 1 }),
    ev(34000, 'show', 2), ev(34300, 'say', 2, { n: 1 }), ev(36800, 'say', 2, { n: 2 }),
    ev(away, 'away', 2), ev(back, 'back', 2), ev(back + 200, 'show', 2), ev(back + 500, 'say', 2, { n: 1 }), ev(back + 3000, 'say', 2, { n: 2 }),
    ev(back + 5800, 'done', 2, { char: 0 }), ev(back + 7000, 'done', 2, { char: 1 }),
    ev(back + 12000, 'self', 0),
  ],
  doneAt: iso(back + 22000),
} as unknown as Session;

const r = drBuild(s);
const titles = r.chapters.map((c) => c.title);
check('章:一个词一章,走开回来的那个词再开一章「接着写」,交卷后「对一对」', titles.join('|') === '第 1 个词 · 冬天|第 2 个词 · 雪白|第 3 个词 · 鼻子|第 3 个词 · 鼻子 · 接着写|对一对', titles.join('|'));
const away0 = r.gaps.find((g) => g.kind === 'away');
check('切到别处:一段 away 的空白,从切走到回来', !!away0 && away0.from === away && away0.to === back, JSON.stringify(r.gaps));
check('想了 10 秒:念完到动笔是一段空白,是写字屏上的', r.gaps.some((g) => g.kind === 'gap' && g.view === 'listen' && g.to === 22000), JSON.stringify(r.gaps.map((g) => [g.from, g.to, g.kind])));
check('念多长:两遍之间隔「念的长度 + 1.8 秒」倒推(4300 − 300 − 1800 = 2200)', r.says_[0].d === 2200, JSON.stringify(r.says_[0]));

const at = (t: number) => drFrameAt(r, t);
const f1 = at(5200);
check('写到一半:冬的第一笔截到这一刻,在写冬', f1.view === 'listen' && f1.word === 0 && f1.char === 0 && f1.ink[0][0].length === 1 && f1.ink[0][0][0].length === 6 && f1.writing?.char === 0, JSON.stringify(f1.ink[0][0].map((x) => x.length)));
check('念着:第几遍、字幕行', at(4400).say?.n === 2 && drCaption(r, at(4400)).text.includes('第 2 遍'), drCaption(r, at(4400)).text);
check('冬写好了:换到第二格(done)', at(6000).char === 1 && at(6000).mode === 'write');
check('雪写了两笔:格里两笔', at(23000).word === 1 && at(23000).ink[1][0].length === 2);
const f2 = at(25000);
check('点了给答案:两笔清掉、看笔顺;录像栏写「给答案」', f2.mode === 'order' && f2.ink[1][0].length === 0 && f2.orderAt === 24300 && drCaption(r, f2).text.includes('给答案'), JSON.stringify({ mode: f2.mode, ink: f2.ink[1][0].length, cap: drCaption(r, f2) }));
check('我来写:描红,照着写的笔出来', at(27200).mode === 'trace' && at(27200).ink[1][0].length === 1 && drCaption(r, at(27200)).text.includes('照着灰色的写'));
check('白写歪了擦掉:擦之前有那一笔,擦了就没了,重写的出来', at(30500).ink[1][1].length === 1 && at(31500).ink[1][1].length === 0 && at(32400).ink[1][1].length === 1 && at(30500).char === 1);
check('切到别处那段:录像栏写切到别处与多久', drCaption(r, at(away + 60_000)).text === '📴 孩子切到别处了 · 38 分', drCaption(r, at(away + 60_000)).text);
check('回来接着写:鼻子那一格', at(back + 5100).word === 2 && at(back + 5100).ink[2][0].length === 1);
check('交卷后:对一对', at(back + 11000).view === 'check' && at(back + 11000).latest[0][0].length === 2);
const f3 = at(back + 14100);
check('自己要再写冬天:再写那一屏,笔一笔一笔出来', f3.view === 'rewrite' && f3.open?.word === 0 && (f3.rewrite?.[0].length ?? 0) === 1 && drCaption(r, f3).text.includes('再写一遍「冬」'), JSON.stringify({ v: f3.view, cap: drCaption(r, f3) }));
const f4 = at(back + 20500);
check('交了:回对一对,冬天换成再写的', f4.view === 'check' && f4.latest[0][0].length === 1 && f4.latest[0][0][0][0][2] === back + 14000);
check('屏幕尺寸照 view', JSON.stringify(f1.size) === '[1180,820]');

const notes = r.notes.map((n) => n.chip + ':' + n.text);
check('经过:给答案(写了的 2 笔清掉了)、照着写、擦掉、切到别处、停了、对好了', notes.some((x) => x === '给答案:点了「不会写,给答案」:雪(写了的 2 笔清掉了)') && notes.some((x) => x.startsWith('照着写:「雪」· 2 笔')) && notes.some((x) => x === '擦掉:「白」撤销了一笔') && notes.some((x) => x === '切到别处:38 分') && notes.some((x) => x.startsWith('停:停了 ')) && notes.some((x) => x.startsWith('对好了')), notes.join('\n'));
check('点:给答案、擦掉、切到别处', r.marks.map((m) => m.kind).join() === 'erase,rv,erase,away' || r.marks.map((m) => m.kind).sort().join() === 'away,erase,rv', r.marks.map((m) => m.kind + '@' + m.t).join());

const sq = drClock(r, false), real = drClock(r, true);
check('跳过空白:总长短得多(38 分钟压成 1.5 秒),来回换算对得上', sq.total < 60_000 && real.total === r.end && Math.abs(sq.toWall(sq.toPlay(back + 5100)) - (back + 5100)) < 1, `${sq.total} / ${real.total}`);
check('空白里的一刻压在 1.5 秒里', sq.toPlay(back) - sq.toPlay(away) === 1500);

// 比对(拍板 16):这个词写好那一刻进经过,孩子的屏幕上没有
{
  const J = { judged: true, empty: false, std: 5, wrote: 4, matched: [0, 1, 2, 3], missing: [4], extra: [], order: true, backwards: [], place: { size: 0.6, dx: 0, dy: 0 }, ask: true };
  const sj = { ...s, first: s.first.map((a, w) => (a && w === 0 ? { ...a, judges: [J, { ...J, missing: [], wrote: 5, matched: [0, 1, 2, 3, 4], ask: false, place: null }] } : a)) } as unknown as Session;
  const rj = drBuild(sj);
  const cmp = rj.notes.filter((n) => n.chip === '比对');
  check('比对:冬少了第 5 笔、写得偏小,在第一个词写好那一刻;天没毛病不出', cmp.length === 1 && cmp[0].text === '「冬」少了第 5 笔;「冬」写得偏小' && cmp[0].t === 7001 && cmp[0].kind === 'err', JSON.stringify(cmp));
}

// 老数据:事件没有 t、没有擦掉的笔,也排得出来
const old = { ...s, events: s.events.map(({ t: _t, ...e }) => e), first: s.first.map((a) => a && { ...a, chars: a.chars.map(({ gone: _g, ...c }) => c) }) } as unknown as Session;
const ro = drBuild(old);
check('老数据(事件没 t、没记擦掉的笔):按服务端时刻排,照样能取任一刻', ro.chapters.length >= 3 && drFrameAt(ro, 5200).ink[0][0].length === 1 && ro.marks.every((m) => m.kind !== 'erase'));
// 刚开始、一笔没写的
const fresh = drBuild({ ...s, first: [null, null, null], events: [ev(0, 'show', 0), ev(300, 'say', 0, { n: 1 })], checkedAt: null, rewrites: [], doneAt: null } as unknown as Session);
check('一笔没写的:轨道只有念,屏幕停在第一个词', fresh.first.length === 0 && drFrameAt(fresh, 100).word === 0 && fresh.end > 300);

done();
