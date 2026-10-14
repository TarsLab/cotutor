/**
 * 单词卡(cards/word)的画法:四线三格、按笔顺写、舞台里分段两色与合拢。孩子端老师页(kid-page.ts)与口语课(talk/page.ts)共用一份,插进各页的内联脚本。
 * 插进去的地方要已经有 h(tag, attrs, ...kids)与 sv(tag, attrs)(建 SVG 元素);样式在 cards/word/card.css(页面装 /kid/theme.css 就有)。
 * 念这个词各页自己做(老师页走配音与播放仲裁,口语课用浏览器的声)。脚本里不写反斜杠、反引号、美元加花括号(模板字符串)。
 */
import { inlineScript } from './inline-lib.ts';
import { letterAdvances } from './letters.ts';

const WORD_DRAW = `
  // ---- 单词卡:四线三格(x 高为 1:升部 / 大写顶 -2、x 高顶 -1、基线 0、降部 +1),笔顺 /api/kid/letters/<词>(drawtell/glyphs 采好的中线点);
  // 写 = 每一笔一条粗线,stroke-dashoffset 从头长到尾,和田字格一个手法;数据没有(写不出的词)退成字体的字、不动 ----
  const WL = new Map();
  const lettersFor = (w) => { if (!WL.has(w)) WL.set(w, fetch('/api/kid/letters/' + encodeURIComponent(w)).then((r) => (r.ok ? r.json() : null)).catch(() => null)); return WL.get(w); };
  /** 一个 x 高 = 100 个 viewBox 单位;紧凑态一个 x 高 22px、舞台 50px */
  const WU = 100;
  /** 正常:讲到时、紧凑态;慢:舞台里(写字每 x 高毫秒数、笔间停顿、段间停顿、念的倍速) */
  const WORD_SPEED = { ms: 120, pause: 50, chunk: 0 };
  const WORD_SLOW = { ms: 190, pause: 110, chunk: 320, rate: 0.7 };
  /** 一个词的四线三格:chunks 给了(舞台)就按段上两色、先分开摆,wordMerge 合拢;fresh = 先淡着等写 */
  /** 每个字母的宽、字间距、空格宽(服务端从 drawtell/glyphs 拼进来):格子同步就排好、画出准确大小,排版量的是终态;笔画晚到只往里填 */
  const WORD_ADV = __WORD_ADV__;
  const WORD_G = Object.fromEntries(Object.entries(WORD_ADV.adv).map(([ch, a]) => [ch, { advance: a }]));
  const wordGrid = (w, chunks, opts = {}) => {
    const xh = opts.stage ? 50 : 22;
    const base = { gap: WORD_ADV.gap, space: WORD_ADV.space, chunks: chunks || undefined };
    const merged = wordLayout(w, WORD_G, base);
    const split = chunks ? wordLayout(w, WORD_G, { ...base, split: true }) : merged;
    const pad = 0.5, W = split.width + pad * 2, off = (split.width - merged.width) / 2;
    const svg = sv('svg', { viewBox: [-pad * WU, -2.5 * WU, W * WU, 4 * WU].join(' '), width: Math.round(W * xh) });
    svg.style.aspectRatio = W + ' / 4';
    const grid = sv('g', { class: 'grid' });
    for (const [k, y] of [['top', -2], ['mid', -1], ['base', 0], ['bot', 1]]) grid.append(sv('line', { class: k, x1: -pad * WU, x2: (split.width + pad) * WU, y1: y * WU, y2: y * WU }));
    svg.append(grid);
    const lts = merged.slots.map((slot, i) => {
      const lt = sv('g', { class: 'lt k' + (chunks ? slot.chunk % 2 : 0) + (opts.fresh ? '' : ' done'), 'data-k': slot.chunk });
      lt._x = [(slot.x + off) * WU, split.slots[i].x * WU];
      lt.style.transform = 'translate(' + lt._x[chunks ? 1 : 0] + 'px, 0px)';
      lt.append(sv('rect', { class: 'hit', x: -0.1 * WU, y: -2.3 * WU, width: ((WORD_G[slot.ch] ? WORD_G[slot.ch].advance : 0.8) + 0.2) * WU, height: 3.6 * WU }));
      svg.append(lt);
      return lt;
    });
    const el = h('div', { class: 'wg' }, svg);
    el._split = Boolean(chunks);
    // 笔画到了:每个字母填进淡淡的字形;数据里没有的字母(或整个没拿到)退成字体的字,不动
    lettersFor(w).then((d) => {
      merged.slots.forEach((slot, i) => {
        const g = d && d.glyphs[slot.ch], lt = lts[i];
        if (g) for (const st of g.strokes) lt.append(sv('path', { class: 'gh', d: 'M' + st.map((q) => q[0] * WU + ' ' + q[1] * WU).join(' L') }));
        else { const t = sv('text', { class: 'ft', x: 0, y: 0, 'font-size': 190 }); t.textContent = slot.ch; lt.append(t); lt.classList.add('done'); }
      });
      el._ready = true;
      const want = el._want; el._want = null;
      if (want) wordWrite(el, want.slow, want.only, want.then);
    });
    return el;
  };
  /** 回到写完的样子(打断正在写的) */
  const wordReset = (grid) => {
    if (grid._run) grid._run.stop();
    grid._run = null;
    for (const x of grid.querySelectorAll('.ink')) x.remove();
    for (const l of grid.querySelectorAll('.lt')) l.classList.add('done');
  };
  /** 写这个词(only = 只写第几段):一笔接一笔,段与段之间多停一会儿;写完调 then。数据还没到就记着,到了再写 */
  const wordWrite = (grid, slow, only, then) => {
    if (!grid) return;
    if (!grid._ready) { grid._want = { slow, only, then }; return; }
    wordReset(grid);
    const sp = slow ? WORD_SLOW : WORD_SPEED;
    const lts = [...grid.querySelectorAll('.lt')].filter((l) => only == null || Number(l.dataset.k) === only);
    const jobs = [];
    let prevK = null;
    for (const l of lts) {
      const k = Number(l.dataset.k);
      const gs = [...l.querySelectorAll('.gh')];
      if (gs.length) l.classList.remove('done');
      gs.forEach((g, n) => { jobs.push({ g, wait: n === 0 && prevK !== null && k !== prevK ? sp.chunk : 0 }); });
      if (gs.length) prevK = k;
    }
    let i = 0, timer = null, alive = true;
    grid._run = { stop: () => { alive = false; clearTimeout(timer); } };
    const step = () => {
      if (!alive) return;
      if (i >= jobs.length) { grid._run = null; for (const x of grid.querySelectorAll('.ink')) x.remove(); for (const l of lts) l.classList.add('done'); if (then) then(); return; }
      const g = jobs[i++].g;
      const len = Math.max(1, g.getTotalLength());
      const ink = sv('path', { class: 'ink', d: g.getAttribute('d') });
      ink.style.strokeDasharray = String(len + 40); ink.style.strokeDashoffset = String(len + 40);
      g.parentNode.append(ink);
      const ms = Math.max(90, Math.round(len / WU * sp.ms));
      void ink.getBoundingClientRect();
      ink.style.transition = 'stroke-dashoffset ' + ms + 'ms linear';
      ink.style.strokeDashoffset = '0';
      timer = setTimeout(step, ms + sp.pause + (i < jobs.length ? jobs[i].wait : 0));
    };
    step();
  };
  /** 舞台里分开写的段合拢成整词(merged = true)或再分开;合拢时分段的两色一起退掉(颜色只为分开时看出哪里是一段,不表示什么) */
  const wordMerge = (grid, merged) => {
    if (!grid._split) return;
    grid.classList.toggle('merged', merged);
    for (const l of grid.querySelectorAll('.lt')) l.style.transform = 'translate(' + l._x[merged ? 0 : 1] + 'px, 0px)';
  };
`;

/** 单词卡的整段脚本:排版(src/lib/word-layout.ts 内联)+ 画法;字母的宽现拼进来 */
export function wordDrawJs(): string {
  return inlineScript(new URL('../lib/word-layout.ts', import.meta.url)) + WORD_DRAW.replace('__WORD_ADV__', () => JSON.stringify(letterAdvances()));
}
