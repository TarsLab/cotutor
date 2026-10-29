/**
 * activity 的例子与判分:`agents/<老师>/activities/<名>.例子.md`,一个 `## ` 一个例子。
 * 例子 = 孩子心里的故事 + 人设(模拟孩子照它答)+ 开头几句写死的孩子的话 + 参数 + 几条判。判只看板书(讲稿与卡),应用就能判,不用再请模型。
 * 纯函数:解析、判分;跑在 src/app/activity-eval.ts。
 */
import type { BoardSection } from '../board/presentation.ts';
import type { ActivityValue } from '../schema/index.ts';

export interface ActivityExample {
  name: string;
  line: number;
  /** 首页按钮下面那几行的写法:名=值;名=值 */
  params: string;
  /** 孩子心里的故事(模拟孩子照它答;不写 = 只有写死的那几句) */
  story?: string;
  /** 模拟孩子是什么样的孩子 */
  persona?: string;
  /** 写死的孩子的话,按顺序先说;说完了有人设就交给模拟孩子 */
  kid: string[];
  /** 随第一句写死的孩子的话一起发的照片(相对例子文件所在的目录,或绝对路径) */
  photos: string[];
  /** 先看了一堂小课堂(小课堂 activity):课包或视频的 id、停过几次、画的几处(时刻 + 画的地方盖着什么,原样给老师);第一句写死的孩子的话带着它发 */
  lecture?: { bundle: string; pauses: number; marks: { atMs: number; text: string }[] };
  /** 最多几轮(孩子说一句、老师回一节算一轮) */
  maxTurns: number;
  /** 判,原文一行一条(见 GRADERS) */
  checks: string[];
}

export interface ExampleIssue {
  text: string;
  line?: number;
}

/** 认得的判:名字 → 一句话。带参数的写成「名字: 参数」 */
export const GRADERS: Readonly<Record<string, string>> = {
  每节有讲稿: '每一轮至少有一句非空讲稿;只有卡、空回复或没有轮次都不通过',
  出画图卡: '最后写了画图卡',
  不出画图卡: '一张画图卡都没写',
  画图卡前放过整段: '第一张画图卡之前,有一节放过三行以上的 read 卡,孩子在它后面开过口',
  放过整段: '有一节放过三行以上的 read 卡(连成的一段)',
  分幅没有看不见的词: '画图卡的分幅里没有「高兴」「羞愧」这种看不见的词',
  分幅至少: '每张画图卡至少这么多幅(「分幅至少: 3」;三四件事挤成两幅就不过)',
  画图卡带题干和词: '每张画图卡都写了「题:」和「词:」(我来出题)',
  每节末句是问句: '有卡的每一节(讲解),最后一句讲稿以问号结尾;没卡的随口问答不查(守则:问答一两句、没有卡)',
  一节一问: '有卡的每一节,讲稿里最多一个问号(看图说话:一节只问一个问题)',
  收尾不问: '最后一轮的末句不是问句(守则「答完就停」:答案出来了、孩子说懂了,一句收住,不再考他)',
  不说: '老师的讲稿里没有这几个说法(「不说: 你没说清楚、错了」)',
  说到: '老师的讲稿里出现过这几个说法(「说到: 你画的」;同「问到」,不要求是问句)',
  放课里一段: '写过 lecture 卡(放小课堂里的一段)',
  一节最多一段: '每一节最多一张 lecture 卡',
  问到: '老师的讲稿里出现过这个词(「问到: 画家」)',
  并排: '有一张 read 卡同时有这两句里的字(「并排: 睡大觉 | 浇了水」)',
  卡上有: '老师写的卡上出现过这几个说法(「卡上有: 先看清」,如顺口溜)',
  出拍给我看卡: '写过拍给我看卡(photo):要孩子拍照片发来时',
  词落到幅: '参数「词」里至少这么多个原样出现在分幅里(「词落到幅: 2」);只适合画得出来的词,「羞愧」「满满」老师会照规矩换成看得见的样子',
};

/** 分幅里不该有的:心里的、看不见的 */
export const INVISIBLE_WORDS = ['高兴', '开心', '难过', '伤心', '生气', '害怕', '羞愧', '着急', '得意', '后悔', '觉得', '心里', '想着'];

const DEFAULT_TURNS = 12;
const KEYS = '故事: / 人设: / 孩子: / 照片: / 课: / 看: / 画: / 参数: / 最多轮: / 判:';
/** 「1:05」「0:26」→ 毫秒 */
const clockMs = (s: string): number | null => { const m = /^(\d+):([0-5]\d)$/.exec(s); return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null; };
const MAX_TURNS = 30;

/** 解析例子文件;写坏的行进 issues,不抛 */
export function parseExamples(text: string): { activity: string; examples: ActivityExample[]; issues: ExampleIssue[] } {
  const issues: ExampleIssue[] = [];
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  let activity = '';
  let i = 0;
  if (/^---\s*$/.test(rows[0] ?? '')) {
    const end = rows.findIndex((r, k) => k > 0 && /^---\s*$/.test(r));
    for (const r of rows.slice(1, end > 0 ? end : 1)) {
      const m = /^activity:\s*(.+)$/.exec(r.trim());
      if (m) activity = m[1].trim();
    }
    i = end > 0 ? end + 1 : 1;
  }
  if (!activity) issues.push({ text: '头上要写 activity: <名>', line: 1 });
  const examples: ActivityExample[] = [];
  let cur: ActivityExample | null = null;
  let inChecks = false;
  let inNote = false;
  for (; i < rows.length; i++) {
    const raw = rows[i];
    const no = i + 1;
    const line = raw.trim();
    if (inNote) { if (line.includes('-->')) inNote = false; continue; }
    if (line.startsWith('<!--')) { if (!line.includes('-->')) inNote = true; continue; }
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      cur = { name: h[1].trim(), line: no, params: '', kid: [], photos: [], maxTurns: DEFAULT_TURNS, checks: [] };
      examples.push(cur);
      inChecks = false;
      continue;
    }
    if (!cur || !line) continue;
    if (inChecks && /^[-*]\s+/.test(line)) { cur.checks.push(line.replace(/^[-*]\s+/, '')); continue; }
    inChecks = false;
    const m = /^([^:：]+)[:：]\s*(.*)$/.exec(line);
    if (!m) { issues.push({ text: `「${line}」认不出:例子里一行写「${KEYS}」`, line: no }); continue; }
    const [, key, value] = m;
    if (key === '故事') cur.story = value;
    else if (key === '人设') cur.persona = value;
    else if (key === '孩子') cur.kid.push(value);
    else if (key === '参数') cur.params = value;
    else if (key === '照片') cur.photos.push(...value.split(/[,，\s]+/).filter(Boolean));
    else if (key === '课') cur.lecture = { bundle: value.trim(), pauses: cur.lecture?.pauses ?? 0, marks: cur.lecture?.marks ?? [] };
    else if (key === '看') {
      const n = /停过\s*(\d+)\s*次/.exec(value);
      cur.lecture = { bundle: cur.lecture?.bundle ?? '', pauses: n ? Number(n[1]) : 0, marks: cur.lecture?.marks ?? [] };
    } else if (key === '画' || key === '圈') {
      // 「圈:」是 2026-10-19 改成画一画以前的写法,照认
      const m2 = /^(\d+:\d\d)\s*(.*)$/.exec(value.trim());
      const at = m2 ? clockMs(m2[1]) : null;
      if (at === null) issues.push({ text: `「${key}:」后面先写时刻,再写画的地方盖着什么:「画: 0:14 画的地方盖着:散的 3 根小棒」`, line: no });
      else cur.lecture = { bundle: cur.lecture?.bundle ?? '', pauses: cur.lecture?.pauses ?? 0, marks: [...(cur.lecture?.marks ?? []), { atMs: at, text: m2![2].trim() }] };
    }
    else if (key === '最多轮') {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 1 && n <= MAX_TURNS) cur.maxTurns = n;
      else issues.push({ text: `最多轮要是 1 到 ${MAX_TURNS} 的整数`, line: no });
    } else if (key === '判') {
      inChecks = true;
      if (value) cur.checks.push(value);
    } else issues.push({ text: `「${key}」认不出:例子里一行写「${KEYS}」`, line: no });
  }
  for (const e of examples) {
    if (!e.kid.length && !e.persona) issues.push({ text: `例子「${e.name}」:孩子一句都没有,也没有人设`, line: e.line });
    if (!e.checks.length) issues.push({ text: `例子「${e.name}」:没有判`, line: e.line });
    if (e.photos.length && !e.kid.length) issues.push({ text: `例子「${e.name}」:照片随第一句写死的孩子的话发,要写一句「孩子:」`, line: e.line });
    if (e.lecture && !e.lecture.bundle) issues.push({ text: `例子「${e.name}」:写了「看:」或「画:」,要先写「课: <课包 id>」`, line: e.line });
    if (e.lecture && !e.kid.length) issues.push({ text: `例子「${e.name}」:看完课第一句是孩子问的,要写一句「孩子:」`, line: e.line });
    for (const p of e.photos) if (!/\.(jpe?g|png)$/i.test(p)) issues.push({ text: `例子「${e.name}」:照片只认 jpg / png(${p})`, line: e.line });
    for (const c of e.checks) {
      const name = c.split(/[:：]/)[0].trim();
      if (!GRADERS[name]) issues.push({ text: `例子「${e.name}」:判「${name}」不认得(有:${Object.keys(GRADERS).join('、')})`, line: e.line });
    }
  }
  if (!examples.length) issues.push({ text: '一个例子都没有(一个 `## ` 一个例子)' });
  return { activity, examples, issues };
}

/** 一轮:孩子说的,和老师回的那一节 */
export interface EvalTurn {
  kid: string;
  section: BoardSection | null;
}

export interface GradeResult {
  check: string;
  pass: boolean;
  why?: string;
}

const paintCards = (s: BoardSection | null): BoardSection['cards'] => (s?.cards ?? []).filter((c) => c.kind === 'paint');
const panelsOf = (c: BoardSection['cards'][number]): string[] => (Array.isArray((c.props as { panels?: unknown }).panels) ? ((c.props as { panels: unknown[] }).panels as string[]) : []);
const segmentsOf = (c: BoardSection['cards'][number]): string[] => (c.kind === 'read' && Array.isArray((c.props as { segments?: unknown }).segments) ? ((c.props as { segments: unknown[] }).segments as string[]) : []);
const listArg = (arg: string): string[] => arg.split(/[、,，;；]/).map((x) => x.trim()).filter(Boolean);

/** 判一次跑下来的这些轮;params 是这个话题的参数(词落到幅用) */
export function gradeRun(checks: readonly string[], turns: readonly EvalTurn[], params: Readonly<Record<string, ActivityValue>> = {}): GradeResult[] {
  const firstPaint = turns.findIndex((t) => paintCards(t.section).length > 0);
  const allPanels = turns.flatMap((t) => paintCards(t.section).flatMap(panelsOf));
  const lines = turns.flatMap((t) => t.section?.lines.map((l) => l.text) ?? []);
  return checks.map((check): GradeResult => {
    const [name, ...rest] = check.split(/[:：]/);
    const arg = rest.join(':').trim();
    switch (name.trim()) {
      case '每节有讲稿': {
        const silent = turns.findIndex((t) => !t.section?.lines.some((l) => l.text.trim()));
        return { check, pass: turns.length > 0 && silent < 0, ...(!turns.length ? { why: '没有老师回复' } : silent >= 0 ? { why: `第 ${silent + 1} 轮没有讲稿` } : {}) };
      }
      case '出画图卡':
        return { check, pass: firstPaint >= 0, ...(firstPaint < 0 ? { why: `${turns.length} 轮都没写画图卡` } : {}) };
      case '不出画图卡':
        return { check, pass: firstPaint < 0, ...(firstPaint >= 0 ? { why: `第 ${firstPaint + 1} 轮写了画图卡` } : {}) };
      case '画图卡前放过整段': {
        if (firstPaint < 0) return { check, pass: true, why: '没写画图卡,不用判' };
        // 整段那一节之后(含画图卡那一轮孩子说的话)孩子开过口:轮 k 的孩子话在轮 k 的老师那节之前,所以整段要在画图卡那一轮之前
        const story = turns.slice(0, firstPaint).some((t) => (t.section?.cards ?? []).some((c) => segmentsOf(c).length >= 3));
        return { check, pass: story, ...(story ? {} : { why: `第 ${firstPaint + 1} 轮写画图卡之前没放过整段` }) };
      }
      case '放过整段': {
        const ok = turns.some((t) => (t.section?.cards ?? []).some((c) => segmentsOf(c).length >= 3));
        return { check, pass: ok, ...(ok ? {} : { why: `${turns.length} 轮都没放过三行以上的 read 卡` }) };
      }
      case '分幅至少': {
        const need = Number(arg) || 1;
        const bad = turns.flatMap((t, k) => paintCards(t.section).filter((c) => panelsOf(c).length < need).map((c) => `第 ${k + 1} 轮的画图卡 ${panelsOf(c).length} 幅`));
        return { check, pass: !bad.length, ...(bad.length ? { why: `${bad.join(';')},要至少 ${need} 幅` } : {}) };
      }
      case '画图卡带题干和词': {
        const bad = turns.flatMap((t, k) => paintCards(t.section).filter((c) => !(c.props as { ask?: unknown }).ask || !((c.props as { words?: unknown[] }).words ?? []).length).map(() => `第 ${k + 1} 轮的画图卡`));
        return { check, pass: !bad.length, ...(bad.length ? { why: `${bad.join(';')}没写题干或词` } : {}) };
      }
      case '分幅没有看不见的词': {
        const bad = allPanels.flatMap((p) => INVISIBLE_WORDS.filter((w) => p.includes(w)).map((w) => `「${w}」在「${p}」`));
        return { check, pass: !bad.length, ...(bad.length ? { why: bad.join(';') } : {}) };
      }
      case '每节末句是问句': {
        const bad = turns.flatMap((t, k) => {
          const last = t.section?.lines[t.section.lines.length - 1]?.text.trim() ?? '';
          return t.section?.cards.length && !/[?？]$/.test(last) ? [`第 ${k + 1} 轮末句「${last}」`] : [];
        });
        return { check, pass: !bad.length, ...(bad.length ? { why: bad.join(';') } : {}) };
      }
      case '收尾不问': {
        const k = turns.length - 1;
        const last = turns[k]?.section?.lines.at(-1)?.text.trim() ?? '';
        const asked = /[?？]$/.test(last);
        return { check, pass: !asked, ...(asked ? { why: `第 ${k + 1} 轮(最后一轮)末句「${last}」` } : {}) };
      }
      case '一节一问': {
        const bad = turns.flatMap((t, k) => {
          const n = (t.section?.lines ?? []).reduce((a, l) => a + (l.text.match(/[?？]/g)?.length ?? 0), 0);
          return t.section?.cards.length && n > 1 ? [`第 ${k + 1} 轮问了 ${n} 个`] : [];
        });
        return { check, pass: !bad.length, ...(bad.length ? { why: bad.join(';') } : {}) };
      }
      case '出拍给我看卡': {
        const ok = turns.some((t) => (t.section?.cards ?? []).some((c) => c.kind === 'photo'));
        return { check, pass: ok, ...(ok ? {} : { why: `${turns.length} 轮都没写拍给我看卡` }) };
      }
      case '卡上有': {
        const cards = turns.flatMap((t) => (t.section?.cards ?? []).map((c) => JSON.stringify(c.props)));
        const miss = listArg(arg).filter((w) => !cards.some((c) => c.includes(w)));
        return { check, pass: !miss.length, ...(miss.length ? { why: `卡上没有:${miss.join('、')}` } : {}) };
      }
      case '不说': {
        const said = listArg(arg).flatMap((w) => lines.filter((l) => l.includes(w)).map((l) => `「${l}」`));
        return { check, pass: !said.length, ...(said.length ? { why: said.join(';') } : {}) };
      }
      case '放课里一段': {
        const ok = turns.some((t) => (t.section?.cards ?? []).some((c) => c.kind === 'lecture'));
        return { check, pass: ok, ...(ok ? {} : { why: `${turns.length} 轮都没放课里的一段` }) };
      }
      case '一节最多一段': {
        const bad = turns.flatMap((t, k) => { const n = (t.section?.cards ?? []).filter((c) => c.kind === 'lecture').length; return n > 1 ? [`第 ${k + 1} 轮放了 ${n} 段`] : []; });
        return { check, pass: !bad.length, ...(bad.length ? { why: bad.join(';') } : {}) };
      }
      case '说到':
      case '问到': {
        const want = listArg(arg);
        const miss = want.filter((w) => !lines.some((l) => l.includes(w)));
        return { check, pass: !miss.length, ...(miss.length ? { why: `没说过:${miss.join('、')}` } : {}) };
      }
      case '并排': {
        const [a, b] = arg.split('|').map((x) => x.trim());
        const ok = Boolean(a && b) && turns.some((t) => (t.section?.cards ?? []).some((c) => { const seg = segmentsOf(c).join('\n'); return seg.includes(a) && seg.includes(b); }));
        return { check, pass: ok, ...(ok ? {} : { why: `没有一张 read 卡同时有「${a}」和「${b}」` }) };
      }
      case '词落到幅': {
        const words = Array.isArray(params.词) ? params.词 : [];
        const need = Number(arg) || words.length;
        const hit = words.filter((w) => allPanels.some((p) => p.includes(w)));
        return { check, pass: hit.length >= need, ...(hit.length >= need ? {} : { why: `落到幅的词 ${hit.length} 个(${hit.join('、') || '无'}),要 ${need} 个` }) };
      }
      default:
        return { check, pass: false, why: '不认得这条判' };
    }
  });
}

/** 模拟孩子的提示词:故事、人设、到现在的对话;只回孩子说的一句 */
export function kidPrompt(e: Pick<ActivityExample, 'story' | 'persona'>, turns: readonly EvalTurn[]): string {
  const said = turns.flatMap((t) => [`孩子:${t.kid}`, `老师:${(t.section?.lines.map((l) => l.text) ?? []).join('')}${(t.section?.cards ?? []).filter((c) => c.kind === 'read').map((c) => `(板上:${segmentsOf(c).join(' / ')})`).join('')}`]);
  return [
    '你在扮演一个小学二年级的孩子,在和语文老师说话。',
    e.persona ? `你是这样的孩子:${e.persona}` : '',
    e.story ? `你心里想讲的故事是:${e.story}` : '',
    '规矩:',
    '- 只回孩子说的一句话,不加引号、不加「孩子:」,不超过 30 个字。',
    '- 老师问什么答什么,照你心里的故事答;老师没问到的不主动说完。',
    '- 老师请你连起来说一遍,就把整个故事一口气说出来(这时可以长一点)。',
    '- 说孩子的话,不像大人。',
    '',
    '到现在的对话:',
    ...said,
    '',
    '孩子接下来说:',
  ].filter((x) => x !== '').join('\n');
}
