/**
 * 素材(《备课设计.md》§十一)的纯函数:解析 materials/<id>/material.md、查问题(两级,同课文件)、拼上下文包 materials: 的一行。
 * 文件 = frontmatter(tutor 必填,media: clips | bundle)+ `# 标题` + 能讲: / 不能讲: 两个列表 + `## 一段一段`(编号一段一条,
 * 下面几行画面,「停在:」写末帧)。「## 画面里的东西」「## 什么时候用」是写给老师读的,不解析。格式定本:tests/fixtures/materials/pingjunfen/material.md。
 * 永不抛错;问题都带行号(1 起)。要读盘的(老师在不在、目录里几个 mp4)由调用方查好传进来。
 */
import type { HomeTutorInfo } from './home.ts';
import { readFrontmatter, type LessonIssue } from './lesson.ts';

/** 素材的目录名(卡种那边定义:卡 → 这里 → board → 卡注册表会成环) */
export { MATERIAL_ID_RE } from '../cards/material.ts';
/** 素材放 workspace 的这个目录(不进骨架) */
export const MATERIALS_DIR = 'materials';
export const MATERIAL_FILE = 'material.md';
const MEDIA = ['clips', 'bundle'] as const;
export type MaterialMedia = (typeof MEDIA)[number];

export interface MaterialSegment {
  /** 编号那一行的字(「分给 2 个人,7 秒。」) */
  title: string;
  /** 编号那一行里写的几秒;没写 null */
  seconds: number | null;
  /** 「停在:」后面的末帧;没写 null */
  stop: string | null;
  line: number;
}

export interface MaterialDoc {
  tutor: string | null;
  media: MaterialMedia;
  /** media: bundle 时指的课包 id */
  bundle: string | null;
  title: string;
  can: string[];
  cannot: string[];
  segments: MaterialSegment[];
  issues: LessonIssue[];
}

const LIST_ITEM = /^\s*[-*]\s+(.+)$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SEGMENTS_H2 = '一段一段';

/** HTML 注释(给人看的那段)换成同样多的空行,行号不变 */
function blankComments(md: string): string[] {
  return md.replace(/<!--[\s\S]*?-->/g, (c) => '\n'.repeat(c.split('\n').length - 1)).split(/\r?\n/);
}

/** 「能讲:」这种行起的列表:冒号后面写了字算一条,接着的 `- ` 行各一条(中间可以空行),遇到别的行就停 */
function listAfter(lines: readonly string[], label: string): { items: string[]; line: number } | null {
  const re = new RegExp(`^${label}\\s*[:：]\\s*(.*)$`);
  const at = lines.findIndex((l) => re.test(l.trim()));
  if (at < 0) return null;
  const items: string[] = [];
  const inline = re.exec(lines[at].trim())![1].trim();
  if (inline) items.push(inline);
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const m = LIST_ITEM.exec(l);
    if (!m) break;
    items.push(m[1].trim());
  }
  return { items, line: at + 1 };
}

export function parseMaterial(md: string): MaterialDoc {
  const all = blankComments(md);
  const fm = readFrontmatter(all);
  const issues: LessonIssue[] = [...fm.issues];
  for (const [k, v] of Object.entries(fm.keys)) if (!['tutor', 'media', 'bundle'].includes(k)) issues.push({ level: 'note', line: v.line, text: `frontmatter 的 ${k}: 不认识(只认 tutor / media / bundle)` });
  const tutor = fm.keys.tutor?.value || null;
  if (!tutor) issues.push({ level: 'fix', line: 1, text: 'frontmatter 要写 tutor:(哪位老师的素材,如 math-tutor)' });
  const rawMedia = fm.keys.media?.value || 'clips';
  const media: MaterialMedia = (MEDIA as readonly string[]).includes(rawMedia) ? (rawMedia as MaterialMedia) : 'clips';
  if (rawMedia !== media) issues.push({ level: 'fix', line: fm.keys.media?.line, text: `media: ${rawMedia} 不认识(只认 clips:本目录的 1.mp4 2.mp4 …;bundle:一份课包)` });
  const bundle = fm.keys.bundle?.value || null;
  if (media === 'bundle' && !bundle) issues.push({ level: 'fix', line: fm.keys.media?.line, text: 'media: bundle 要再写一行 bundle: <课包 id>' });

  const body = all.map((l, i) => (i < fm.start ? '' : l));
  // 标题:第一个 H1;段:「## 一段一段」到下一个 H2 之间
  let title = '';
  let segFrom = -1;
  let segTo = body.length;
  body.forEach((l, i) => {
    const h = HEADING.exec(l);
    if (!h) return;
    if (h[1] === '#' && !title) title = h[2].trim();
    if (h[1] === '##') {
      if (segFrom >= 0 && segTo === body.length && i > segFrom) segTo = i;
      if (h[2].trim() === SEGMENTS_H2 && segFrom < 0) segFrom = i;
    }
  });
  if (!title) issues.push({ level: 'fix', text: '没有标题:正文第一行写「# 演的是哪个道理」' });
  const head = body.slice(0, segFrom >= 0 ? segFrom : body.length);
  const can = listAfter(head, '能讲');
  const cannot = listAfter(head, '不能讲');
  if (!can?.items.length) issues.push({ level: 'fix', line: can?.line, text: '没有「能讲:」:列出这段片子能讲哪些道理,第一条会进老师的上下文包' });
  if (!cannot?.items.length) issues.push({ level: 'note', line: cannot?.line, text: '没有「不能讲:」:写清片子的边界(总数、有没有剩的),老师才不会拿它讲不对的题' });

  const segments: MaterialSegment[] = [];
  if (segFrom < 0) issues.push({ level: 'fix', text: `没有「## ${SEGMENTS_H2}」:一段一条编号,写讲什么、几秒,最后一行「停在:」` });
  else {
    let cur: MaterialSegment | null = null;
    for (let i = segFrom + 1; i < segTo; i++) {
      const l = body[i];
      const num = /^(\d+)[.、]\s*(.+)$/.exec(l.trim());
      if (num && !/^\s/.test(l)) {
        const n = Number(num[1]);
        if (n !== segments.length + 1) issues.push({ level: 'fix', line: i + 1, text: `段号接不上:这里是 ${n},应该是 ${segments.length + 1}(一段一个 mp4,1.mp4 起)` });
        const t = num[2].trim();
        const sec = /(\d+(?:\.\d+)?)\s*秒/.exec(t);
        cur = { title: t, seconds: sec ? Number(sec[1]) : null, stop: null, line: i + 1 };
        segments.push(cur);
        continue;
      }
      const item = LIST_ITEM.exec(l);
      const stop = item && /^停在\s*[:：]\s*(.+)$/.exec(item[1].trim());
      if (cur && stop) cur.stop = stop[1].trim();
    }
    if (!segments.length) issues.push({ level: 'fix', line: segFrom + 1, text: `「## ${SEGMENTS_H2}」下面没有编号的段(1. 2. 3. …)` });
    for (const s of segments) if (!s.stop) issues.push({ level: 'note', line: s.line, text: `第 ${segments.indexOf(s) + 1} 段没写「停在:」:片子停在末帧,老师是对着那一帧往下说的` });
  }
  return { tutor, media, bundle, title, can: can?.items ?? [], cannot: cannot?.items ?? [], segments, issues };
}

export interface MaterialCheckContext {
  tutors: Record<string, HomeTutorInfo>;
  /** 目录里的 <n>.mp4 的 n(media: clips 时用) */
  clips: readonly number[];
}

/** 解析的问题 + 老师在不在 + 段数与 mp4 对不对得上;按行号排 */
export function materialIssues(doc: MaterialDoc, ctx: MaterialCheckContext): LessonIssue[] {
  const out = [...doc.issues];
  if (doc.tutor) {
    const t = ctx.tutors[doc.tutor];
    const names = Object.keys(ctx.tutors).filter((n) => n.endsWith('-tutor'));
    if (!t) out.push({ level: 'fix', line: 1, text: `tutor: ${doc.tutor}——cotutor.json 里没有这位老师(有:${names.join('、')})` });
    else if (!doc.tutor.endsWith('-tutor')) out.push({ level: 'fix', line: 1, text: `tutor: ${doc.tutor} 是工具人(键不以 -tutor 结尾),它不讲课` });
    else if (!t.enabled) out.push({ level: 'note', line: 1, text: `${t.display}关着(cotutor.json enabled = false),打开之前用不上` });
  }
  if (doc.media === 'clips') {
    const n = doc.segments.length;
    const have = new Set(ctx.clips);
    const missing = Array.from({ length: n }, (_, k) => k + 1).filter((k) => !have.has(k));
    const extra = [...have].filter((k) => k > n).sort((a, b) => a - b);
    if (missing.length) out.push({ level: 'fix', text: `「一段一段」写了 ${n} 段,目录里缺 ${missing.map((k) => `${k}.mp4`).join('、')}` });
    if (extra.length && n) out.push({ level: 'fix', text: `目录里多了 ${extra.map((k) => `${k}.mp4`).join('、')}:「一段一段」只写了 ${n} 段,补上那几段或删掉文件` });
  } else out.push({ level: 'note', text: 'media: bundle(drawtell 课包当素材)还放不出来,三期才做' });
  return out.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
}

/** 上下文包 materials: 的一行:`<id> · <标题> · 能讲:<第一条>`(老师要细节自己 Read material.md) */
export function materialLine(id: string, doc: Pick<MaterialDoc, 'title' | 'can'>): string {
  return `${id} · ${doc.title} · 能讲:${doc.can[0] ?? ''}`;
}
