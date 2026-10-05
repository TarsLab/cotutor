/**
 * 素材(《备课设计.md》§十一)读盘的那一半:列 materials/ 下各份、查(老师在不在、段数与 mp4 对不对得上)、拼上下文包 materials: 的几行。
 * 纯函数(解析、两级问题、一行的样子)在 src/lib/material.ts。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace } from '../cli/workspace.ts';
import type { BoardCard, BoardSection } from '../lib/kid-board.ts';
import { stripHumanNotes } from '../lib/human-notes.ts';
import type { LessonIssue } from '../lib/lesson.ts';
import { MATERIAL_FILE, MATERIAL_ID_RE, MATERIALS_DIR, materialIssues, materialLine, parseMaterial, type MaterialDoc } from '../lib/material.ts';

/** 上下文包 materials: 最多几行(《备课设计.md》§11.3) */
export const MATERIALS_IN_PACK = 20;
/** 其中前几份把 material.md 原文也带上(<material>):老师不用再读盘就知道画面里有什么、每段停在哪 */
export const MATERIAL_DOCS_IN_PACK = 5;

export interface MaterialCheck {
  id: string;
  /** 相对 workspace 根:materials/<id>/material.md */
  source: string;
  doc: MaterialDoc;
  /** 目录里的 <n>.mp4 */
  clips: number[];
  /** material.md 的改动时间;没有这个文件 null */
  mtime: string | null;
  issues: LessonIssue[];
  fixes: number;
}

const rel = (id: string): string => `${MATERIALS_DIR}/${id}/${MATERIAL_FILE}`;

/** 一份素材:读 material.md、数 mp4、查;目录不在 → null。material.md 没有也回一份(要改:写一份) */
export async function checkMaterial(ws: Workspace, id: string): Promise<MaterialCheck | null> {
  if (!MATERIAL_ID_RE.test(id)) return null;
  const dir = join(ws.dirs.materials, id);
  const names = await readdir(dir).catch(() => null);
  if (!names) return null;
  const clips = names.map((n) => /^(\d{1,3})\.mp4$/.exec(n)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1])).sort((a, b) => a - b);
  const file = join(dir, MATERIAL_FILE);
  const md = await readFile(file, 'utf8').catch(() => null);
  const mtime = md === null ? null : ((await stat(file).catch(() => null))?.mtime.toISOString() ?? null);
  const doc = parseMaterial(md ?? '');
  const tutors = Object.fromEntries(Object.entries(ws.config.tutors).map(([k, t]) => [k, { display: t.display, enabled: t.enabled, hidden: t.hidden }]));
  const issues: LessonIssue[] = md === null ? [{ level: 'fix', text: `没有 ${MATERIAL_FILE}:老师不知道片子里演的是什么,不会拿它(写一份:标题、能讲、一段一段)` }] : materialIssues(doc, { tutors, clips });
  return { id, source: rel(id), doc, clips, mtime, issues, fixes: issues.filter((i) => i.level === 'fix').length };
}

/** materials/ 下每个合规的目录一份,按 id 排 */
export async function listMaterials(ws: Workspace): Promise<MaterialCheck[]> {
  const entries = await readdir(ws.dirs.materials, { withFileTypes: true }).catch(() => []);
  const out: MaterialCheck[] = [];
  for (const e of entries.filter((x) => x.isDirectory() && MATERIAL_ID_RE.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const c = await checkMaterial(ws, e.name);
    if (c) out.push(c);
  }
  return out;
}

/**
 * 上下文包 materials: 的几行:这位老师的、没有要改的;first 里列的排前面(课文件尾巴 `## 素材` 列的,§11.4),
 * 其余按改动时间新的在前;最多 MATERIALS_IN_PACK 行
 */
export async function materialsFor(ws: Workspace, tutor: string, first: readonly string[] = []): Promise<string[]> {
  const mine = (await listMaterials(ws)).filter((c) => c.doc.tutor === tutor && !c.fixes);
  const rank = (c: MaterialCheck): number => (first.includes(c.id) ? first.indexOf(c.id) : first.length);
  mine.sort((a, b) => rank(a) - rank(b) || (b.mtime ?? '').localeCompare(a.mtime ?? ''));
  return mine.slice(0, MATERIALS_IN_PACK).map((c) => materialLine(c.id, c.doc));
}

/** materials: 那几行里前 MATERIAL_DOCS_IN_PACK 份的 material.md 原文(去掉给人看的注释);读不到的跳过 */
export async function materialDocs(ws: Workspace, lines: readonly string[]): Promise<{ id: string; text: string }[]> {
  const out: { id: string; text: string }[] = [];
  for (const line of lines.slice(0, MATERIAL_DOCS_IN_PACK)) {
    const id = line.split(' · ')[0];
    const md = await readFile(join(ws.dirs.materials, id, MATERIAL_FILE), 'utf8').catch(() => null);
    if (md !== null) out.push({ id, text: stripHumanNotes(md).trim() });
  }
  return out;
}

export function formatMaterialCheck(c: MaterialCheck): string {
  const segs = c.doc.segments.length;
  const out = [`${c.source}:${c.doc.tutor ?? '(没写 tutor)'} · ${c.doc.title || '(没有标题)'} · ${segs} 段 · ${c.clips.length} 个 mp4`];
  c.doc.segments.forEach((s, k) => out.push(`  第 ${k + 1} 段:${s.title}${s.stop ? ` 停在:${s.stop}` : ''}`));
  for (const i of c.issues) out.push(`  ${i.level === 'fix' ? '✗ 要改' : '· 提醒'}${i.line ? ` 第 ${i.line} 行` : ''}:${i.text}`);
  if (!c.issues.length) out.push(`  没有问题;上下文包里是:${materialLine(c.id, c.doc)}`);
  return out.join('\n');
}

/** 素材卡下发前的快照(src/cards/material.ts):标题、段数、能不能播;素材不在 / 有要改的 / 不是 clips → ready: false */
export async function materialSnapshot(ws: Workspace, id: string): Promise<{ title?: string; segments?: number; ready: boolean }> {
  const c = await checkMaterial(ws, id);
  if (!c) return { ready: false };
  const ok = !c.fixes && c.doc.media === 'clips' && c.doc.segments.length > 0;
  return { ...(c.doc.title ? { title: c.doc.title } : {}), ...(ok ? { segments: c.doc.segments.length } : {}), ready: ok };
}

/** 一节里的素材卡全部补上快照(别的卡原样;同一节同一份素材只读一次) */
export async function enrichMaterials(ws: Workspace, section: BoardSection): Promise<BoardSection> {
  if (!section.cards.some((c) => c.kind === 'material')) return section;
  const seen = new Map<string, Awaited<ReturnType<typeof materialSnapshot>>>();
  const cards: BoardCard[] = [];
  for (const c of section.cards) {
    if (c.kind !== 'material' || typeof c.props.id !== 'string') { cards.push(c); continue; }
    if (!seen.has(c.props.id)) seen.set(c.props.id, await materialSnapshot(ws, c.props.id));
    cards.push({ ...c, props: { ...c.props, ...seen.get(c.props.id)! } });
  }
  return { ...section, cards };
}
