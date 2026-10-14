/**
 * 家长端「首页」表单改首页(《首页设计.md》拍板 20):不另存一份结构,直接改已发布那份的原文(home/history/<id>.md),
 * 改完照常检查、留历史、发布。这里是纯函数:把 md 切成围栏块,按老师改按钮、改听写的词、调老师的先后,再拼回去。
 * 没动到的块(别的老师、家长自己写的卡、家长段)原样留着,一个字不改。
 */
import type { TutorButton } from '../cards/index.ts';

/** 一个围栏块(卡)或一段围栏外的字 */
export type HomeSeg = { kind: 'fence'; fence: string; card: string; mods: string[]; info: string; body: string[] } | { kind: 'text'; lines: string[] };

export interface HomeParts {
  /** frontmatter(含上下两行 ---);没有 = [] */
  front: string[];
  segs: HomeSeg[];
  /** 家长段:第一个围栏外的 H2 起到末尾 */
  note: string[];
}

const OPEN = /^(`{3,})\s*(\S.*)?$/;

export function splitHomeMd(md: string): HomeParts {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  const front: string[] = [];
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === '---');
    if (end > 0) { front.push(...lines.slice(0, end + 1)); i = end + 1; }
  }
  const segs: HomeSeg[] = [];
  const text = (l: string): void => { const last = segs[segs.length - 1]; if (last?.kind === 'text') last.lines.push(l); else segs.push({ kind: 'text', lines: [l] }); };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l)) return { front, segs, note: lines.slice(i) };
    const m = OPEN.exec(l);
    if (!m || !m[2]) { text(l); continue; }
    const close = new RegExp(`^${m[1]}\`*\\s*$`);
    const end = lines.findIndex((x, k) => k > i && close.test(x));
    if (end < 0) { text(l); continue; } // 没收口的围栏照字留着,检查会说
    const info = m[2].trim();
    const [card, ...rest] = info.split(/\s+/);
    segs.push({ kind: 'fence', fence: m[1], card, mods: rest.filter((x) => !x.includes('=')), info, body: lines.slice(i + 1, end) });
    i = end;
  }
  return { front, segs, note: [] };
}

export function joinHomeMd(p: HomeParts): string {
  const out: string[] = [...p.front];
  for (const s of p.segs) {
    if (s.kind === 'text') out.push(...s.lines);
    else out.push(`${s.fence}${s.info}`, ...s.body, s.fence);
  }
  // 卡与卡之间空一行,家长段前也空一行
  const body = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  const note = p.note.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return `${body}${note ? `\n\n${note}` : ''}\n`;
}

const isTutor = (s: HomeSeg, name?: string): s is Extract<HomeSeg, { kind: 'fence' }> => s.kind === 'fence' && s.card === 'tutor' && (name === undefined || s.mods[0] === name);
const fence = (card: string, mods: string[], body: string[]): HomeSeg => ({ kind: 'fence', fence: '```', card, mods, info: [card, ...mods].join(' '), body });
const blank = (): HomeSeg => ({ kind: 'text', lines: [''] });

/** 老师卡的正文:一行一个按钮,讲法与留到挂在下面 */
export function tutorBody(buttons: readonly TutorButton[]): string[] {
  const out: string[] = [];
  for (const b of buttons) {
    out.push(b.kind === 'continue' ? `接着 ${b.date} ${b.thread} ${b.label}` : b.kind === 'lecture' ? `小课堂 ${b.bundle} ${b.label}` : b.kind === 'activity' ? `activity ${b.activity}${b.label === b.activity ? '' : ` ${b.label}`}` : b.label);
    if (b.kind === 'activity') for (const [k, v] of Object.entries(b.params)) out.push(`${k}: ${v}`);
    if (b.kind === 'lecture' && b.activity) out.push(`activity: ${b.activity}`);
    if (b.brief) for (const l of b.brief.split('\n')) out.push(`讲法: ${l}`);
    if (b.until) out.push(`留到: ${b.until}`);
  }
  return out;
}

/** 分组:第一张老师卡前面的(公共)+ 每张老师卡连同跟在后面、到下一张老师卡之前的块 */
function groups(p: HomeParts): { head: HomeSeg[]; groups: { name: string; segs: HomeSeg[] }[] } {
  const head: HomeSeg[] = [];
  const out: { name: string; segs: HomeSeg[] }[] = [];
  for (const s of p.segs) {
    if (isTutor(s)) out.push({ name: s.mods[0] ?? '', segs: [s] });
    else if (out.length) out[out.length - 1].segs.push(s);
    else head.push(s);
  }
  return { head, groups: out };
}

/** 这位老师的老师卡;没有就在最后一位老师的那组后面加一张空的 */
function ensureTutor(p: HomeParts, name: string): Extract<HomeSeg, { kind: 'fence' }> {
  const found = p.segs.find((s) => isTutor(s, name));
  if (found && isTutor(found)) return found;
  const card = fence('tutor', [name], []) as Extract<HomeSeg, { kind: 'fence' }>;
  p.segs.push(blank(), card);
  return card;
}

/** 换掉这位老师的按钮(整张卡的正文);没有老师卡就加一张 */
export function setTutorButtons(md: string, name: string, buttons: readonly TutorButton[]): string {
  const p = splitHomeMd(md);
  ensureTutor(p, name).body = tutorBody(buttons);
  return joinHomeMd(p);
}

/** 这位老师的听写卡(`dictation <老师>`):words 空 = 删掉;没有就紧跟在他的老师卡后面加一张 */
export function setTutorDictation(md: string, name: string, words: readonly { chars: string; say?: string; emoji?: string }[]): string {
  const p = splitHomeMd(md);
  // 英文单词配的 emoji 写在最前面(同单词卡的「🍎 apple」,cards/dictation)
  const body = words.map((w) => [w.emoji, w.chars, w.say].filter(Boolean).join(' '));
  const at = p.segs.findIndex((s) => s.kind === 'fence' && s.card === 'dictation' && s.mods[0] === name);
  if (at >= 0) {
    if (body.length) (p.segs[at] as Extract<HomeSeg, { kind: 'fence' }>).body = body;
    else p.segs.splice(at, 1);
    return joinHomeMd(p);
  }
  if (!body.length) return md;
  const card = ensureTutor(p, name);
  p.segs.splice(p.segs.indexOf(card) + 1, 0, blank(), fence('dictation', [name], body));
  return joinHomeMd(p);
}

/** 调老师的先后:names 里的按这个顺序排(没有老师卡的补一张空的),别的老师照原来的相对顺序排在后面;每位老师带着跟在他后面的卡一起挪 */
export function orderTutors(md: string, names: readonly string[]): string {
  const p = splitHomeMd(md);
  for (const n of names) ensureTutor(p, n);
  const g = groups(p);
  const rank = (n: string): number => { const k = names.indexOf(n); return k < 0 ? names.length + g.groups.findIndex((x) => x.name === n) : k; };
  const sorted = [...g.groups].sort((a, b) => rank(a.name) - rank(b.name));
  p.segs = [...g.head, ...sorted.flatMap((x) => (x.segs[x.segs.length - 1]?.kind === 'text' ? x.segs : [...x.segs, blank()]))];
  return joinHomeMd(p);
}
