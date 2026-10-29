/**
 * 听写的录像:一次听写的记录 → 一条按时间排好的轨道,任一刻孩子的屏幕是什么样子。
 * 纯函数,不碰 DOM、不读盘;听写页(/dictation?reel=<id>)把它内联进去,用写字屏自己的画法照它画(录结果、照结果画)。
 * 时刻都是「离这次听写开始(startedAt)多少毫秒」,和笔迹的点同一把尺子;老事件没有 t 的按服务端时刻折算。
 * 页面是 ES5 写的,内联进去的名字都带 dr 前缀,别撞上页面里的。
 */
import type { DictationEvent, InkGone, Session } from '../../scenes/dictation/store.ts';
import type { CharJudge, InkPoint } from '../../scenes/dictation/match.ts';

/** 停多久算空白(压成 1.5 秒,「跳过空白」关掉就照真实时间) */
export const DR_GAP_MS = 4000;
export const DR_SQUEEZE_MS = 1500;
/** 「再念」那一遍之后、第二遍之前孩子端停 1.8 秒(page.ts 的 sayWord) */
const DR_SAY_PAUSE_MS = 1800;

export interface DrStroke { word: number; char: number; pts: InkPoint[]; gone?: number }
export interface DrGap { from: number; to: number; kind: 'gap' | 'away'; view: DrView }
export interface DrMark { t: number; kind: 'rv' | 'erase' | 'away'; label: string }
export interface DrNote { t: number; kind: '' | 'said' | 'err' | 'miss' | 'tail' | 'card'; chip: string; text: string }
export interface DrChapter { t: number; title: string }
export type DrView = 'listen' | 'check' | 'order' | 'rewrite';

export interface DrReel {
  /** 开始的墙钟(毫秒) */
  startAt: number;
  end: number;
  lang: 'zh' | 'en';
  /** 每个词的字(英文一个单词一格) */
  chars: string[][];
  says: string[];
  first: DrStroke[];
  rewrites: { word: number; from: number; to: number; strokes: DrStroke[] }[];
  /** 时间排好的状态变化 */
  steps: DrStep[];
  says_: { word: number; t: number; d: number; n: number }[];
  gaps: DrGap[];
  marks: DrMark[];
  notes: DrNote[];
  chapters: DrChapter[];
  views: { t: number; w: number; h: number; pad: 'l' | 'm' | 's' }[];
  checkedAt: number | null;
  doneAt: number | null;
}

type DrStep =
  | { t: number; k: 'show'; word: number }
  | { t: number; k: 'char'; word: number; char: number }
  | { t: number; k: 'done'; word: number; char: number }
  | { t: number; k: 'reveal' | 'order' | 'trace'; word: number; char: number }
  | { t: number; k: 'check' }
  | { t: number; k: 'strokeOrder'; word: number; char: number }
  | { t: number; k: 'rewrite'; word: number }
  | { t: number; k: 'close' };

const drSecs = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 60) return Math.max(1, s) + ' 秒';
  if (s < 3600) return Math.floor(s / 60) + ' 分' + (s % 60 ? ' ' + (s % 60) + ' 秒' : '');
  return Math.floor(s / 3600) + ' 小时 ' + Math.floor((s % 3600) / 60) + ' 分';
};
const drTenth = (ms: number): string => (ms < 10000 ? Math.round(ms / 100) / 10 : Math.round(ms / 1000)) + ' 秒';

/** 比对一个字的几句话(同家长页 parent-page.ts 的 charNotes,擦过几次另有「擦掉」那几条):只进录像栏的「经过」,孩子的屏幕上没有 */
export function drCharNotes(ch: string, j: CharJudge): string[] {
  const nums = (xs: number[]): string => xs.map((x) => x + 1).join('、');
  const out: string[] = [];
  if (!j.judged) return out;
  if (j.empty) return ['「' + ch + '」空着'];
  if (j.missing.length >= Math.ceil(j.std / 2)) out.push('「' + ch + '」和书上的字大半对不上(写了 ' + j.wrote + ' 笔,书上 ' + j.std + ' 笔),可能写成了别的字');
  else if (j.missing.length) out.push('「' + ch + '」少了第 ' + nums(j.missing) + ' 笔' + (j.extra.length ? ',有 ' + j.extra.length + ' 笔对不上' : ''));
  else if (j.extra.length) out.push('「' + ch + '」多了 ' + j.extra.length + ' 笔对不上的');
  if (!j.order) out.push('「' + ch + '」笔顺:写的先后是 ' + j.matched.filter((m): m is number => m !== null).map((m) => m + 1).join(' ') + '(书上是 1 到 ' + j.std + ' 依次)');
  if (j.backwards.length) out.push('「' + ch + '」第 ' + nums(j.backwards) + ' 笔写反了方向');
  const p = j.place;
  if (p) {
    const bits: string[] = [];
    if (p.size < 0.7) bits.push('偏小'); else if (p.size > 1.3) bits.push('偏大');
    const v = p.dy > 140 ? '上' : p.dy < -140 ? '下' : '', h = p.dx < -140 ? '左' : p.dx > 140 ? '右' : '';
    if (v || h) bits.push('偏' + h + v);
    if (bits.length) out.push('「' + ch + '」写得' + bits.join('、'));
  }
  return out;
}

/** 一次听写 → 轨道 */
export function drBuild(s: Session): DrReel {
  const startAt = Date.parse(s.startedAt);
  const lang: 'zh' | 'en' = s.lang === 'en' ? 'en' : 'zh';
  const chars = s.words.map((w) => (lang === 'en' ? [w.chars] : Array.from(w.chars)));
  const says = s.words.map((w) => w.say ?? w.chars);
  const tOf = (e: DictationEvent): number => (typeof e.t === 'number' ? e.t : Math.max(0, Date.parse(e.at) - startAt));
  const wallT = (iso: string | null | undefined): number | null => (iso ? Math.max(0, Date.parse(iso) - startAt) : null);
  const evs = s.events.map((e) => ({ e, t: tOf(e) })).sort((a, b) => a.t - b.t);

  // 笔:第一遍写的(留下的 + 擦掉的),再写的
  const strokesOf = (word: number, cs: { strokes: InkPoint[][]; gone?: InkGone[] }[]): DrStroke[] => {
    const out: DrStroke[] = [];
    cs.forEach((c, char) => {
      for (const pts of c.strokes) if (pts.length) out.push({ word, char, pts });
      for (const g of c.gone ?? []) if (g.pts.length) out.push({ word, char, pts: g.pts, gone: g.t });
    });
    return out;
  };
  const first: DrStroke[] = [];
  s.first.forEach((a, word) => { if (a) first.push(...strokesOf(word, a.chars)); });
  first.sort((a, b) => a.pts[0][2] - b.pts[0][2]);
  const checkedAt = wallT(s.checkedAt);
  const doneAt = wallT(s.doneAt);

  // 念:两遍之间隔「念的长度 + 1.8 秒」,倒推念多长;推不出的按字数估
  const says_: DrReel['says_'] = [];
  const sayEvs = evs.filter((x) => x.e.kind === 'say');
  sayEvs.forEach((x, k) => {
    const next = sayEvs[k + 1];
    const guess = 600 + Array.from(says[x.e.word] ?? '').length * 260;
    const d = next && next.e.word === x.e.word && next.t - x.t < guess + DR_SAY_PAUSE_MS + 4000 ? Math.max(500, Math.min(8000, next.t - x.t - DR_SAY_PAUSE_MS)) : guess;
    says_.push({ word: x.e.word, t: x.t, d, n: x.e.n ?? 1 });
  });

  // 状态的变化:事件 + 「这一笔写在哪一格」(老数据没有 open 事件,看笔落在哪一格)
  const steps: DrStep[] = [];
  for (const { e, t } of evs) {
    const c = e.char ?? 0;
    if (e.kind === 'show') steps.push({ t, k: 'show', word: e.word });
    else if (e.kind === 'done') steps.push({ t, k: 'done', word: e.word, char: c });
    else if (e.kind === 'reveal' || e.kind === 'order' || e.kind === 'trace') steps.push({ t, k: e.kind, word: e.word, char: c });
    else if (e.kind === 'open') steps.push({ t, k: 'char', word: e.word, char: c });
    else if (e.kind === 'strokeOrder') steps.push({ t, k: 'strokeOrder', word: e.word, char: c });
    else if (e.kind === 'rewrite' || e.kind === 'self') steps.push({ t, k: 'rewrite', word: e.word });
    else if (e.kind === 'close') steps.push({ t, k: 'close' });
  }
  for (const st of first) if (checkedAt === null || st.pts[0][2] < checkedAt) steps.push({ t: st.pts[0][2] - 1, k: 'char', word: st.word, char: st.char });
  if (checkedAt !== null) steps.push({ t: checkedAt, k: 'check' });

  const rewrites = s.rewrites.map((r) => {
    const strokes = strokesOf(r.word, r.attempt.chars);
    const ts = strokes.map((x) => x.pts[0][2]);
    const to = wallT(r.attempt.at) ?? (ts.length ? Math.max(...ts) : 0);
    const opened = steps.filter((x) => x.k === 'rewrite' && x.word === r.word && x.t <= (ts.length ? Math.min(...ts) : to)).pop();
    const from = opened ? opened.t : ts.length ? Math.min(...ts) - 1000 : to - 1000;
    return { word: r.word, from, to, strokes };
  });
  // 交了再写的那一遍:交上去那一刻回到对一对
  for (const r of rewrites) { if (!steps.some((x) => x.k === 'rewrite' && x.t === r.from)) steps.push({ t: r.from, k: 'rewrite', word: r.word }); steps.push({ t: r.to, k: 'close' }); }
  steps.sort((a, b) => a.t - b.t);

  // 切到别处
  const aways: { from: number; to: number }[] = [];
  let awayAt: number | null = null;
  for (const { e, t } of evs) {
    if (e.kind === 'away' && awayAt === null) awayAt = t;
    else if (e.kind === 'back' && awayAt !== null) { aways.push({ from: awayAt, to: t }); awayAt = null; }
  }

  // 有动静的时刻:笔的起止、擦掉、事件、念完;两件事之间空了 4 秒以上就是空白
  const busy: number[] = [0];
  for (const st of first) busy.push(st.pts[0][2], st.pts[st.pts.length - 1][2], ...(st.gone !== undefined ? [st.gone] : []));
  for (const r of rewrites) { busy.push(r.from, r.to); for (const st of r.strokes) busy.push(st.pts[0][2], st.pts[st.pts.length - 1][2]); }
  for (const { e, t } of evs) if (e.kind !== 'view') busy.push(t);
  for (const x of says_) busy.push(x.t + x.d);
  // 看笔顺的动画一笔约 0.9 秒(英文给答案直接描红,没有动画)
  if (lang === 'zh') for (const x of steps) if (x.k === 'reveal' || x.k === 'order') busy.push(x.t + 8000);
  if (checkedAt !== null) busy.push(checkedAt);
  if (doneAt !== null) busy.push(doneAt);
  busy.sort((a, b) => a - b);
  const end = busy[busy.length - 1] + 1200;

  const viewAt = (t: number): DrView => drView(steps, t, chars.map((c) => c.length)).view;
  const gaps: DrGap[] = [];
  for (let k = 1; k < busy.length; k++) {
    const a = busy[k - 1], b = busy[k];
    if (b - a <= DR_GAP_MS) continue;
    const away = aways.some((w) => w.from <= a + 1 && w.to >= b - 1);
    gaps.push({ from: a, to: b, kind: away ? 'away' : 'gap', view: viewAt(a + 1) });
  }

  // 章:一个词一章(走开又回来的那个词再开一章「接着写」),交卷后「对一对」
  const chapters: DrChapter[] = [];
  const shown = new Set<number>();
  for (const x of steps) {
    if (x.k === 'show') { chapters.push({ t: x.t, title: '第 ' + (x.word + 1) + ' 个词 · ' + s.words[x.word].chars + (shown.has(x.word) ? ' · 接着写' : '') }); shown.add(x.word); }
    if (x.k === 'check') chapters.push({ t: x.t, title: '对一对' });
  }
  // 第一章从头算起(出第一个词之前是开始屏)
  if (chapters.length) chapters[0] = { t: 0, title: chapters[0].title };
  else chapters.push({ t: 0, title: '开始' });

  // 点与经过
  const marks: DrMark[] = [];
  const notes: DrNote[] = [];
  const ch = (w: number, c: number): string => (chars[w] && chars[w][c]) || '';
  for (const x of steps) {
    if (x.k === 'show') notes.push({ t: x.t, kind: '', chip: '出词', text: '第 ' + (x.word + 1) + ' 个词「' + s.words[x.word].chars + '」' });
    if (x.k === 'reveal') {
      const cleared = first.filter((st) => st.word === x.word && st.char === x.char && st.gone !== undefined && Math.abs(st.gone - x.t) < 3000).length;
      marks.push({ t: x.t, kind: 'rv', label: '给答案:' + ch(x.word, x.char) });
      notes.push({ t: x.t, kind: 'err', chip: '给答案', text: '点了「不会写,给答案」:' + ch(x.word, x.char) + (cleared ? '(写了的 ' + cleared + ' 笔清掉了)' : '') });
    }
    if (x.k === 'order') notes.push({ t: x.t, kind: '', chip: '看笔顺', text: '「' + ch(x.word, x.char) + '」一笔一笔写' });
    if (x.k === 'trace') notes.push({ t: x.t, kind: '', chip: '照着写', text: '照着灰色的「' + ch(x.word, x.char) + '」写' });
    if (x.k === 'check') notes.push({ t: x.t, kind: 'tail', chip: '交卷', text: '写完了,自己对一对' });
    if (x.k === 'strokeOrder') notes.push({ t: x.t, kind: 'card', chip: '看笔顺', text: '点开「' + ch(x.word, x.char) + '」一笔一笔看' });
    if (x.k === 'rewrite') notes.push({ t: x.t, kind: 'card', chip: '再写', text: '再写一遍「' + s.words[x.word].chars + '」' });
  }
  for (const x of says_) notes.push({ t: x.t, kind: '', chip: '老师念', text: x.n > 1 ? '第 ' + x.n + ' 遍' : '「' + says[x.word] + '」' });
  for (const { e, t } of evs) if (e.kind === 'again') notes.push({ t, kind: 'said', chip: '再念', text: '点了「再念」' });
  // 一个格里写的:从第一笔到最后一笔;给答案之后的是照着写的
  const cells = new Map<string, DrStroke[]>();
  for (const st of first) { const key = st.word + ':' + st.char; if (!cells.has(key)) cells.set(key, []); cells.get(key)!.push(st); }
  for (const [key, list] of cells) {
    const [w, c] = key.split(':').map(Number);
    const kept = list.filter((st) => st.gone === undefined);
    const rv = steps.find((x) => x.k === 'reveal' && x.word === w && x.char === c);
    const after = rv ? kept.filter((st) => st.pts[0][2] > rv.t) : kept;
    if (after.length) {
      const a = after[0].pts[0][2], b = Math.max(...after.map((st) => st.pts[st.pts.length - 1][2]));
      notes.push({ t: a, kind: 'said', chip: rv ? '照着写' : '写', text: '「' + ch(w, c) + '」· ' + after.length + ' 笔 · 用了 ' + drTenth(b - a) });
    }
    // 擦掉的(给答案时清掉的另算)
    const byT = new Map<number, number>();
    for (const st of list) if (st.gone !== undefined && !(rv && Math.abs(st.gone - rv.t) < 3000)) byT.set(st.gone, (byT.get(st.gone) ?? 0) + 1);
    for (const [t, n] of byT) {
      marks.push({ t, kind: 'erase', label: '「' + ch(w, c) + '」擦掉 ' + n + ' 笔' });
      notes.push({ t, kind: 'miss', chip: '擦掉', text: '「' + ch(w, c) + '」' + (n === 1 ? '撤销了一笔' : '擦掉 ' + n + ' 笔重写') });
    }
    if (!kept.length && checkedAt !== null) notes.push({ t: checkedAt - 1, kind: '', chip: '空着', text: '「' + ch(w, c) + '」一笔没写' });
  }
  for (const r of rewrites) notes.push({ t: r.to, kind: 'tail', chip: '写好了', text: '再写的「' + s.words[r.word].chars + '」交了' });
  // 比对:第一遍在这个词写好(交上去)的那一刻,再写的在交上去那一刻;家长页的逐字那几句,孩子的屏幕上没有
  s.first.forEach((a, w) => {
    if (!a) return;
    const lastDone = steps.filter((x) => x.k === 'done' && x.word === w).pop();
    const t = lastDone ? lastDone.t : wallT(a.at) ?? 0;
    a.judges.forEach((j, c) => { const xs = drCharNotes(ch(w, c), j); if (xs.length) notes.push({ t: t + 1, kind: j.ask ? 'err' : '', chip: '比对', text: xs.join(';') }); });
  });
  s.rewrites.forEach((rw, k) => {
    const t = rewrites[k] ? rewrites[k].to : 0;
    rw.attempt.judges.forEach((j, c) => { const xs = drCharNotes(ch(rw.word, c), j); if (xs.length) notes.push({ t: t + 1, kind: j.ask ? 'err' : '', chip: '重写比对', text: xs.join(';') }); });
  });
  for (const g of gaps) {
    if (g.kind === 'away') { marks.push({ t: g.from, kind: 'away', label: '切到别处 ' + drSecs(g.to - g.from) }); notes.push({ t: g.from, kind: 'miss', chip: '切到别处', text: drSecs(g.to - g.from) }); }
    else notes.push({ t: g.from, kind: '', chip: '停', text: '停了 ' + drSecs(g.to - g.from) + (g.view === 'listen' ? ',一笔没写' : '') });
  }
  if (doneAt !== null) notes.push({ t: doneAt, kind: 'tail', chip: '对好了', text: '点了「对好了」' });
  notes.sort((a, b) => a.t - b.t);
  marks.sort((a, b) => a.t - b.t);

  const views = evs.filter((x) => x.e.kind === 'view' && x.e.w && x.e.h).map((x) => ({ t: x.t, w: x.e.w!, h: x.e.h!, pad: x.e.pad ?? ('l' as const) }));
  return { startAt, end, lang, chars, says, first, rewrites, steps, says_, gaps, marks, notes, chapters, views, checkedAt, doneAt };
}

/** 到 t 为止:哪一屏、第几个词第几格、在写 / 看笔顺 / 描红 */
function drView(steps: DrStep[], t: number, sizes: number[]): { view: DrView; word: number; char: number; mode: 'write' | 'order' | 'trace'; orderAt: number; revealed: Set<string>; done: Set<string>; open: { word: number; char: number } | null } {
  let view: DrView = 'listen', word = 0, char = 0, mode: 'write' | 'order' | 'trace' = 'write', orderAt = 0;
  let open: { word: number; char: number } | null = null;
  const revealed = new Set<string>(), done = new Set<string>();
  for (const x of steps) {
    if (x.t > t) break;
    if (x.k === 'show') { view = 'listen'; word = x.word; char = 0; mode = revealed.has(word + ':0') ? 'trace' : 'write'; }
    else if (x.k === 'char') { if (view !== 'listen') continue; if (x.word !== word) word = x.word; if (x.char !== char || mode === 'order') { char = x.char; mode = revealed.has(word + ':' + char) ? 'trace' : 'write'; } }
    else if (x.k === 'reveal' || x.k === 'order') { word = x.word; char = x.char; mode = 'order'; orderAt = x.t; revealed.add(x.word + ':' + x.char); }
    else if (x.k === 'trace') { mode = 'trace'; }
    else if (x.k === 'done') {
      // 写好了:换到这个词下一个还没写好的格(page.ts 的「写好了」);都写好了就停在这儿,等下一个词
      done.add(x.word + ':' + x.char);
      const n = sizes[x.word] ?? 1;
      for (let k = 1; k <= n; k++) { const c = (x.char + k) % n; if (!done.has(x.word + ':' + c)) { word = x.word; char = c; mode = revealed.has(word + ':' + c) ? 'trace' : 'write'; break; } }
    }
    else if (x.k === 'check') { view = 'check'; open = null; }
    else if (x.k === 'strokeOrder') { view = 'order'; open = { word: x.word, char: x.char }; orderAt = x.t; }
    else if (x.k === 'rewrite') { view = 'rewrite'; open = { word: x.word, char: 0 }; }
    else if (x.k === 'close') { view = 'check'; open = null; }
  }
  return { view, word, char, mode, orderAt, revealed, done, open };
}

export interface DrFrame {
  view: DrView;
  word: number;
  char: number;
  mode: 'write' | 'order' | 'trace';
  /** 看笔顺的动画从哪一刻起(页面按笔画的长短排每一笔) */
  orderAt: number;
  /** 再写一遍 / 逐笔看的是哪个词哪个字 */
  open: { word: number; char: number } | null;
  /** 每个词都写好了(英文页这时是「交上去」那一屏) */
  allDone: boolean;
  /** 第一遍:每个词每个格这一刻看得到的笔(写到一半的截到 t) */
  ink: InkPoint[][][][];
  /** 再写一遍那一屏的笔 */
  rewrite: InkPoint[][][] | null;
  /** 对一对那一屏每个词的笔(交了再写的换成再写的) */
  latest: InkPoint[][][][];
  say: { n: number; word: number; t: number } | null;
  /** 念过了这个词的第几遍(状态那行:再听一遍 / 听完了就写) */
  said: number;
  writing: { word: number; char: number } | null;
  gap: DrGap | null;
  size: [number, number] | null;
  /** 写字格的档:照这一刻之前最后一条 view,没有就 l */
  pad: 'l' | 'm' | 's';
}

const drCut = (pts: InkPoint[], t: number): InkPoint[] => { let k = 0; while (k < pts.length && pts[k][2] <= t) k++; return k === pts.length ? pts : pts.slice(0, k); };

export function drFrameAt(r: DrReel, t: number): DrFrame {
  const v = drView(r.steps, t, r.chars.map((c) => c.length));
  const ink: InkPoint[][][][] = r.chars.map((cs) => cs.map(() => []));
  let writing: { word: number; char: number } | null = null;
  for (const st of r.first) {
    if (st.pts[0][2] > t || (st.gone !== undefined && st.gone <= t)) continue;
    ink[st.word][st.char].push(drCut(st.pts, t));
    if (t <= st.pts[st.pts.length - 1][2] + 250) writing = { word: st.word, char: st.char };
  }
  const latest = ink.map((w) => w.map((c) => c.slice()));
  let rewrite: InkPoint[][][] | null = null;
  for (const rw of r.rewrites) {
    const live = r.chars[rw.word].map(() => [] as InkPoint[][]);
    for (const st of rw.strokes) if (st.pts[0][2] <= t && !(st.gone !== undefined && st.gone <= t)) live[st.char].push(drCut(st.pts, t));
    if (rw.to <= t) latest[rw.word] = live;
    else if (rw.from <= t) { rewrite = live; for (const st of rw.strokes) if (st.pts[0][2] <= t && t <= st.pts[st.pts.length - 1][2] + 250) writing = { word: rw.word, char: st.char }; }
  }
  let say: DrFrame['say'] = null, said = 0;
  for (const x of r.says_) { if (x.t > t || x.word !== v.word) continue; if (t < x.t + x.d) say = { n: x.n, word: x.word, t: x.t }; else said = Math.max(said, x.n); }
  const gap = r.gaps.find((g) => t > g.from && t < g.to) ?? null;
  let size: [number, number] | null = null, pad: DrFrame['pad'] = 'l';
  for (const x of r.views) if (x.t <= t || !size) { size = [x.w, x.h]; pad = x.pad; }
  const allDone = r.chars.every((cs, w) => cs.every((_c, c) => v.done.has(w + ':' + c)));
  return { view: v.view, word: v.word, char: v.char, mode: v.mode, orderAt: v.orderAt, open: v.open, allDone, ink, rewrite, latest, say, said, writing, gap, size, pad };
}

/** 这一刻录像栏上那一行字 */
export function drCaption(r: DrReel, f: DrFrame): { text: string; cls: string } {
  const ch = (w: number, c: number): string => (r.chars[w] && r.chars[w][c]) || '';
  if (f.gap) return { text: f.gap.kind === 'away' ? '📴 孩子切到别处了 · ' + drSecs(f.gap.to - f.gap.from) : '⏩ 停了 ' + drSecs(f.gap.to - f.gap.from) + (f.gap.view === 'listen' ? ',一笔没写' : ''), cls: 'gap' };
  if (f.writing) return { text: (f.view === 'rewrite' ? '✏️ 再写一遍「' : f.mode === 'trace' ? '✏️ 照着灰色的写「' : '✏️ 正在写「') + ch(f.writing.word, f.writing.char) + '」', cls: 'kid' };
  if (f.view === 'listen' && f.mode === 'order') return { text: r.lang === 'en' ? '💡 点了「不会写,给答案」· 照着灰色的单词写' : '💡 点了「不会写,给答案」· 在看「' + ch(f.word, f.char) + '」的笔顺', cls: 'miss' };
  if (f.view === 'listen' && f.say) return { text: '🔊 老师念「' + r.says[f.word] + '」' + (f.say.n > 1 ? ' · 第 ' + f.say.n + ' 遍' : ''), cls: '' };
  if (f.view === 'check') return { text: '自己对一对', cls: 'gap' };
  if (f.view === 'order' && f.open) return { text: '在看「' + ch(f.open.word, f.open.char) + '」一笔一笔写', cls: 'gap' };
  if (f.view === 'rewrite' && f.open) return { text: '再写一遍「' + r.chars[f.open.word].join('') + '」', cls: 'gap' };
  return { text: '', cls: '' };
}

/** 播放的钟:跳过空白开着时空白压成 1.5 秒;p 是录像里的位置(毫秒) */
export function drClock(r: DrReel, real: boolean): { total: number; toPlay(t: number): number; toWall(p: number): number } {
  const gs = real ? [] : r.gaps;
  const toPlay = (t: number): number => {
    let cut = 0;
    for (const g of gs) {
      if (t >= g.to) cut += g.to - g.from - DR_SQUEEZE_MS;
      else if (t > g.from) return g.from - cut + ((t - g.from) / (g.to - g.from)) * DR_SQUEEZE_MS;
      else break;
    }
    return t - cut;
  };
  const toWall = (p: number): number => {
    let cut = 0;
    for (const g of gs) {
      const pa = g.from - cut;
      if (p < pa) return p + cut;
      if (p <= pa + DR_SQUEEZE_MS) return g.from + ((p - pa) / DR_SQUEEZE_MS) * (g.to - g.from);
      cut += g.to - g.from - DR_SQUEEZE_MS;
    }
    return p + cut;
  };
  return { total: toPlay(r.end), toPlay, toWall };
}
