/**
 * 小老师的纯函数(《wip/小老师设想.md》):笔迹(按时刻可见、数笔、形状校验)、出帧 PNG、转写(浏览器段 → 行、paraformer 句 → 行、
 * 够不够叫 paraformer、家长改字、重转留下改过的行)、notes.md(分节、时刻、追问的勾)、timeline.md。
 */
import { inflateSync } from 'node:zlib';
import { check, done } from './_check.ts';
import { parseStrokes, strokesIn, visibleAt, type Strokes } from '../src/xlaoshi/lib/strokes.ts';
import { framePng } from '../src/xlaoshi/lib/png.ts';
import { applyEdits, clock, fromBrowser, fromParaformer, mergeRetranscribe, needParaformer, parseClock, speechRuns, type TalkMeta } from '../src/xlaoshi/lib/transcript.ts';
import { parseNotes, questions, setCheck } from '../src/xlaoshi/lib/notes.ts';
import { frameName, timelineMd, timelineRows } from '../src/xlaoshi/lib/timeline.ts';

const S: Strokes = {
  size: { w: 200, h: 100 },
  strokes: [
    { c: '#2b2b2b', w: 4, pts: [[10, 10, 1000], [50, 10, 1500], [90, 10, 2000]] },
    { c: '#d23f1f', w: 4, pts: [[10, 50, 5000], [90, 50, 6000]], gone: 8000 },
    { c: 'erase', w: 28, pts: [[50, 10, 9000]] },
  ],
};

// ---- 笔迹 ----
check('visibleAt:还没落笔的不在', visibleAt(S, 500).length === 0);
check('visibleAt:正在画的那一笔只到 t', visibleAt(S, 1600)[0]?.pts.length === 2, JSON.stringify(visibleAt(S, 1600)));
check('visibleAt:撤销之后不在', visibleAt(S, 7000).length === 2 && visibleAt(S, 8000).length === 1);
check('strokesIn:按落笔时刻数,橡皮另算', JSON.stringify(strokesIn(S, 0, 10_000)) === '{"ink":2,"erase":1}' && strokesIn(S, 4000, 7000).ink === 1);
check('parseStrokes:好的收下、点取一位小数', parseStrokes({ size: { w: 200, h: 100 }, strokes: [{ c: '#2b2b2b', w: 4, pts: [[1.234, 2, 3.6]] }] })?.strokes[0].pts[0].join() === '1.2,2,4');
check('parseStrokes:颜色不认、没有点、时刻是负的 → null', parseStrokes({ size: { w: 200, h: 100 }, strokes: [{ c: 'red', w: 4, pts: [[1, 2, 3]] }] }) === null
  && parseStrokes({ size: { w: 200, h: 100 }, strokes: [{ c: '#000000', w: 4, pts: [] }] }) === null
  && parseStrokes({ size: { w: 200, h: 100 }, strokes: [{ c: '#000000', w: 4, pts: [[1, 2, -1]] }] }) === null);

// ---- PNG ----
{
  const png = framePng(S, 2000, 200);
  const sig = png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  // 取 IDAT 解开,看 (50, 10) 那里是黑的、(50, 50) 还是白的(第二笔 5 秒才落)
  const idat = png.subarray(png.indexOf('IDAT') + 4, png.length - 12 - 4);
  const raw = inflateSync(idat);
  const at = (x: number, y: number): number[] => { const i = y * (w * 3 + 1) + 1 + x * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
  check('framePng:PNG 头、宽按参数、高按比例', sig && w === 200 && h === 100, `${w}x${h}`);
  check('framePng:画了的地方是笔的颜色,没画的白', at(50, 10).join() === '43,43,43' && at(50, 50).join() === '255,255,255', `${at(50, 10)} ${at(50, 50)}`);
}

// ---- 转写 ----
check('clock / parseClock', clock(0) === '0:00' && clock(71_500) === '1:11' && clock(3_725_000) === '1:02:05' && parseClock('1:12') === 72_000 && parseClock('1:02:05') === 3_725_000 && parseClock('1:75') === null && parseClock('x') === null);
check('fromBrowser:空段去掉、按时刻排、去首尾空白', JSON.stringify(fromBrowser([{ at: 9000, end: 12000, text: ' 我先画十八个圈 ' }, { at: 0, end: 3000, text: '我要讲' }, { at: 5000, end: 5000, text: '  ' }])) === '[{"at":0,"text":"我要讲"},{"at":9000,"text":"我先画十八个圈"}]');
{
  const long = { begin: 0, end: 9000, text: '我要讲18张贴纸分给三个人，我先画三个人，再画18个圈，然后一个一个地分给他们。', words: [
    { begin: 0, end: 900, text: '我要讲18张贴纸', punctuation: '' }, { begin: 900, end: 1800, text: '分给三个人', punctuation: '，' },
    { begin: 2000, end: 2800, text: '我先画三个人', punctuation: '，' }, { begin: 3000, end: 3800, text: '再画18个圈', punctuation: '，' },
    { begin: 5000, end: 7000, text: '然后一个一个地分给他们', punctuation: '。' }] };
  const L = fromParaformer([long, { begin: 9500, end: 10000, text: '完了。' }]);
  check('fromParaformer:长句按句读切,每段从它第一个词起;短句整句一行', L.length === 4 && L[0].text === '我要讲18张贴纸分给三个人，' && L[1].at === 2000 && L[1].text === '我先画三个人，再画18个圈，' && L[2].at === 5000 && L[3].text === '完了。', JSON.stringify(L));
}
{
  const lv = (spec: [number, number][]): number[] => spec.flatMap(([n, v]) => new Array(n).fill(v));
  check('speechRuns:停半秒以内算同一段,太短的不算', JSON.stringify(speechRuns(lv([[10, 0], [20, 40], [3, 0], [20, 40], [20, 0], [2, 50], [10, 0]]))) === '[[1000,5300]]', JSON.stringify(speechRuns(lv([[10, 0], [20, 40], [3, 0], [20, 40], [20, 0], [2, 50], [10, 0]]))));
  const base: TalkMeta = { ms: 20_000, sr: true, levels: lv([[10, 0], [80, 40], [110, 0]]), segs: [{ at: 1000, end: 8800, text: '我要讲十八张贴纸分给三个人然后我先画十八个圈' }] };
  check('needParaformer:说的都有字 → 不叫', !needParaformer(base).need, JSON.stringify(needParaformer(base)));
  check('needParaformer:这台没有识别 → 叫', needParaformer({ ...base, sr: false }).need && needParaformer({ ...base, sr: false }).why === '这台没有浏览器识别');
  const gap = needParaformer({ ...base, segs: [{ at: 1000, end: 3000, text: '我要讲十八张贴纸分给' }] });
  check('needParaformer:有声没字超过 3 秒 → 叫,说出是哪一段', gap.need && gap.why === '有声没字 0:03–0:09', JSON.stringify(gap));
  const few = needParaformer({ ...base, segs: [{ at: 1000, end: 8800, text: '嗯' }] });
  check('needParaformer:字太少 → 叫', few.need && few.why.startsWith('字太少'), JSON.stringify(few));
  check('needParaformer:一直没出声 → 不叫', !needParaformer({ ...base, levels: lv([[200, 2]]), segs: [] }).need);
}
{
  const old = [{ at: 0, text: '我要讲' }, { at: 9000, text: '十八除以三等于留' }];
  const ed = applyEdits(old, ['我要讲', '十八除以三等于六']);
  check('applyEdits:改了的那行标 edited,没改的不动;行数不对 → null', ed !== null && !ed[0].edited && ed[1].edited === true && ed[1].text === '十八除以三等于六' && applyEdits(old, ['x']) === null);
  const merged = mergeRetranscribe(ed!, [{ at: 100, text: '我要讲的是' }, { at: 9500, text: '十八除以三等于留' }, { at: 12_000, text: '因为要一样多' }]);
  check('mergeRetranscribe:家长改过的行留着,新行里离它 1.5 秒以内的不要', JSON.stringify(merged.map((l) => l.text)) === '["我要讲的是","十八除以三等于六","因为要一样多"]', JSON.stringify(merged));
}

// ---- notes.md ----
const NOTES = `# 初步理解

## 讲到了
- 三个人、十八个 @0:09
- 每人六个 @0:52

## 说的和画的对不上
- 0:31 说「一个一个地分」,可是画圈时已经一行六个 @0:09–0:52

## 还没讲到
- 为什么要一样多 @1:12

## 追问
- [x] 你说一个一个地分,再分一次给我看好吗? @0:09-0:52
  放他讲的那段,让他重画
- [ ] 18 ÷ 3 里的 3,在你的画里是哪个?
- 要是有一个人分到 7 张,还叫平均分吗? @1:12
`;
{
  const n = parseNotes(NOTES);
  check('parseNotes:标题、四节、追问那节认出来', n.title === '初步理解' && n.sections.length === 4 && n.sections[3].ask && !n.sections[0].ask, JSON.stringify(n.sections.map((s) => s.title)));
  const mis = n.sections[1].items[0];
  check('parseNotes:时刻段(破折号也认)从字里拿掉', mis.from === 9000 && mis.to === 52_000 && !mis.text.includes('@'), JSON.stringify(mis));
  const qs = n.sections[3].items;
  check('parseNotes:追问的勾、缩进的说明;没写勾的算要问', qs[0].checked === true && qs[0].detail === '放他讲的那段,让他重画' && qs[1].checked === false && qs[2].checked === true && qs[2].from === 72_000, JSON.stringify(qs));
  check('questions:勾着的两条(没写勾的也算)', questions(n).filter((q) => q.checked).length === 2);
  const off = setCheck(NOTES, qs[0].line, false);
  const on2 = off && setCheck(off, qs[2].line, false);
  check('setCheck:改勾;没有勾的补一个;标题行 → null', off !== null && parseNotes(off).sections[3].items[0].checked === false && on2 !== null && on2.includes('- [ ] 要是有一个人') && setCheck(NOTES, 0, true) === null);
  check('parseNotes:乱写的不抛', parseNotes('随便写的\n## \n- \n  多出来的').sections.length >= 0);
}

// ---- timeline.md ----
{
  const tr = { source: 'browser' as const, lines: [{ at: 1500, text: '我先画一条线' }, { at: 4000, text: '再画红的', edited: true as const }] };
  const rows = timelineRows(tr, S, 10_000);
  check('timelineRows:第一句前画了东西补一行「没说话」,一句一行,帧在这段结束时', rows.length === 3 && rows[0].text === null && rows[0].to === 1500 && rows[0].ink === 1 && rows[2].frame === frameName(10_000) && frameName(71_000) === 'frames/0111.png', JSON.stringify(rows));
  const md = timelineMd({ topic: '画线', tr, strokes: S, totalMs: 10_000, asks: [{ q: '为什么是红的?', at: '', ms: 3000, heard: '因为好看', note: '他笑了', strokes: S }] });
  check('timelineMd:题目、总况(家长改了几处)、表格、追问的回答', md.startsWith('# 画线\n') && md.includes('讲了 0:10 · 画了 2 笔(擦了 1 下) · 转写:浏览器,家长改了 1 处') && md.includes('| 0:04–0:10 | 再画红的 | 1 笔,擦 1 下 | frames/0010.png |') && md.includes('1. 问:为什么是红的?') && md.includes('家长记:他笑了') && md.includes('frames/ask-1.png'), md);
  check('timelineRows:没有转写就十五秒一行', timelineRows(null, S, 31_000).length === 3);
}

done();
