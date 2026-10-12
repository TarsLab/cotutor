/**
 * activity 的例子与判分(《wip/activity设计.md》6.1):`agents/<老师>/activities/<名>.例子.md`,一个 `## ` 一个例子。
 * 例子 = 孩子心里的故事 + 人设(模拟孩子照它答)+ 开头几句写死的孩子的话 + 参数 + 几条判。判只看板书(讲稿与卡),应用就能判,不用再请模型。
 * 纯函数:解析、判分;跑在 src/server/activity-eval.ts。
 */
import type { BoardSection } from './kid-board.ts';
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
  出画图卡: '最后写了画图卡',
  不出画图卡: '一张画图卡都没写',
  画图卡前放过整段: '第一张画图卡之前,有一节放过三行以上的 read 卡,孩子在它后面开过口',
  放过整段: '有一节放过三行以上的 read 卡(连成的一段)',
  分幅没有看不见的词: '画图卡的分幅里没有「高兴」「羞愧」这种看不见的词',
  分幅至少: '每张画图卡至少这么多幅(「分幅至少: 3」;三四件事挤成两幅就不过)',
  每节末句是问句: '每一节最后一句讲稿以问号结尾',
  不说: '老师的讲稿里没有这几个说法(「不说: 你没说清楚、错了」)',
  问到: '老师的讲稿里出现过这个词(「问到: 画家」)',
  并排: '有一张 read 卡同时有这两句里的字(「并排: 睡大觉 | 浇了水」)',
  词落到幅: '参数「词」里至少这么多个出现在分幅里(「词落到幅: 2」)',
};

/** 分幅里不该有的:心里的、看不见的 */
export const INVISIBLE_WORDS = ['高兴', '开心', '难过', '伤心', '生气', '害怕', '羞愧', '着急', '得意', '后悔', '觉得', '心里', '想着'];

const DEFAULT_TURNS = 12;
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
    if (!m) { issues.push({ text: `「${line}」认不出:例子里一行写「故事: / 人设: / 孩子: / 照片: / 参数: / 最多轮: / 判:」`, line: no }); continue; }
    const [, key, value] = m;
    if (key === '故事') cur.story = value;
    else if (key === '人设') cur.persona = value;
    else if (key === '孩子') cur.kid.push(value);
    else if (key === '参数') cur.params = value;
    else if (key === '照片') cur.photos.push(...value.split(/[,，\s]+/).filter(Boolean));
    else if (key === '最多轮') {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 1 && n <= MAX_TURNS) cur.maxTurns = n;
      else issues.push({ text: `最多轮要是 1 到 ${MAX_TURNS} 的整数`, line: no });
    } else if (key === '判') {
      inChecks = true;
      if (value) cur.checks.push(value);
    } else issues.push({ text: `「${key}」认不出:例子里一行写「故事: / 人设: / 孩子: / 照片: / 参数: / 最多轮: / 判:」`, line: no });
  }
  for (const e of examples) {
    if (!e.kid.length && !e.persona) issues.push({ text: `例子「${e.name}」:孩子一句都没有,也没有人设`, line: e.line });
    if (!e.checks.length) issues.push({ text: `例子「${e.name}」:没有判`, line: e.line });
    if (e.photos.length && !e.kid.length) issues.push({ text: `例子「${e.name}」:照片随第一句写死的孩子的话发,要写一句「孩子:」`, line: e.line });
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
      case '分幅没有看不见的词': {
        const bad = allPanels.flatMap((p) => INVISIBLE_WORDS.filter((w) => p.includes(w)).map((w) => `「${w}」在「${p}」`));
        return { check, pass: !bad.length, ...(bad.length ? { why: bad.join(';') } : {}) };
      }
      case '每节末句是问句': {
        const bad = turns.flatMap((t, k) => {
          const last = t.section?.lines[t.section.lines.length - 1]?.text.trim() ?? '';
          return t.section && !/[?？]$/.test(last) ? [`第 ${k + 1} 轮末句「${last}」`] : [];
        });
        return { check, pass: !bad.length, ...(bad.length ? { why: bad.join(';') } : {}) };
      }
      case '不说': {
        const said = listArg(arg).flatMap((w) => lines.filter((l) => l.includes(w)).map((l) => `「${l}」`));
        return { check, pass: !said.length, ...(said.length ? { why: said.join(';') } : {}) };
      }
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
