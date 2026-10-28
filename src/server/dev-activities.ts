/**
 * 工作台改 activity(2026-10-17,《工作台设计.md》拍板 7–10;设计稿 https://claude.ai/artifact/Srg1Pe4z51iUbei1TxNtLp):
 * 列 workspace 里每位老师的 activity、读一份原文、边改边查(不落盘:检查、首页按钮解析不解析得出、老师实际收到什么、和出厂比)、
 * 存(带读进来时的 hash,磁盘上的变了就不存,免得盖掉编程助手那边的改动)、恢复出厂(原文留 .bak)。
 * 只认 listActivities 列得出的名字,不拼路径;新建、改名、删不在这里(在 workspace 里和编程助手说)。
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { EXAMPLES_SUFFIX, activityFile, activityStatusOf, listActivities, restoreActivity, shippedActivityText, type ActivityStatus } from '../cli/activities.ts';
import { sha256 } from '../cli/tutors.ts';
import type { Workspace } from '../cli/workspace.ts';
import { lintActivity, renderTutorSection, resolveParams, type ActivityIssue } from '../lib/activity.ts';
import type { TutorButton } from '../cards/index.ts';
import { ACTIVITY_PAGES, ACTIVITY_SECTIONS, ACTIVITY_TOOLS, ACTIVITY_TOOL_SECTION_RE, BOARD_CARD_KINDS, LECTURE_ACTIVITY, type Activity } from '../schema/index.ts';
import { readPublished } from './home.ts';

export interface DevActivityRow {
  tutor: string;
  name: string;
  description: string;
  /** 不起老师、进一页的(听写):那一页 */
  page: string | null;
  state: ActivityStatus['state'];
  basedOn?: string;
  fixes: number;
  notes: number;
  /** 已发布的首页上用到它的按钮几个(小课堂按钮挂的也算) */
  buttons: number;
  /** <名>.例子.md 里几个例子 */
  examples: number;
}

/** 首页上用到它的一个按钮,按正在改的这份解析 */
export interface DevActivityButton {
  label: string;
  kind: 'activity' | 'lecture';
  /** 按钮下面写的参数原文 */
  params: Record<string, string>;
  ok: boolean;
  /** 解析出的值(补了缺省)或解析不出的原因 */
  detail: string;
}

/** 和出厂比的一块:at = 在现在这份里的行号(1 起);old / now 是出厂那份 / 现在这份的行 */
export interface DiffHunk {
  at: number;
  oldAt: number;
  old: string[];
  now: string[];
}

const exampleCount = async (file: string): Promise<number> => {
  const text = await readFile(file.replace(/\.md$/, `${EXAMPLES_SUFFIX}.md`), 'utf8').catch(() => null);
  return text === null ? 0 : (text.match(/^## /gm) ?? []).length;
};

/** 已发布首页上这位老师用到这个 activity 的按钮 */
async function homeButtons(ws: Workspace, tutor: string, name: string): Promise<{ label: string; kind: 'activity' | 'lecture'; params: Record<string, string> }[]> {
  const { home } = await readPublished(ws);
  const out: { label: string; kind: 'activity' | 'lecture'; params: Record<string, string> }[] = [];
  for (const c of home?.cards ?? []) {
    if (c.kind !== 'tutor' || c.props.tutor !== tutor) continue;
    for (const b of (c.props.buttons ?? []) as TutorButton[]) {
      if (b.kind === 'activity' && b.activity === name) out.push({ label: b.label, kind: 'activity', params: b.params });
      else if (b.kind === 'lecture' && (b.activity ?? LECTURE_ACTIVITY) === name) out.push({ label: b.label, kind: 'lecture', params: {} });
    }
  }
  return out;
}

const tutorCards = (ws: Workspace, tutor: string): readonly string[] | undefined => ws.config.tutors[tutor]?.cards;

/** 按老师(cotutor.json 的顺序)列 workspace 里的 activity */
export async function listDevActivities(ws: Workspace): Promise<DevActivityRow[]> {
  const order = Object.keys(ws.config.tutors);
  const refs = (await listActivities(join(ws.root, 'agents'))).sort((a, b) => ((order.indexOf(a.tutor) + 1 || 999) - (order.indexOf(b.tutor) + 1 || 999)) || a.name.localeCompare(b.name, 'zh'));
  const rows: DevActivityRow[] = [];
  for (const r of refs) {
    const text = await readFile(r.file, 'utf8').catch(() => '');
    const { activity, issues } = lintActivity(text, { fileName: r.name, tutorCards: tutorCards(ws, r.tutor) });
    const st = await activityStatusOf(ws.root, r.tutor, r.name);
    rows.push({
      tutor: r.tutor,
      name: r.name,
      description: activity.description,
      page: activity.page ? (ACTIVITY_PAGES[activity.page] ?? activity.page) : null,
      state: st.state,
      ...(st.basedOn ? { basedOn: st.basedOn } : {}),
      fixes: issues.filter((i) => i.level === 'fix').length,
      notes: issues.filter((i) => i.level === 'note').length,
      buttons: (await homeButtons(ws, r.tutor, r.name)).length,
      examples: await exampleCount(r.file),
    });
  }
  return rows;
}

/** 名字在不在 workspace 的这位老师名下(只认列得出的,不拼路径) */
export async function findDevActivity(ws: Workspace, tutor: string, name: string): Promise<string | null> {
  const refs = await listActivities(join(ws.root, 'agents'), tutor);
  return refs.find((r) => r.name === name)?.file ?? null;
}

export async function readDevActivity(ws: Workspace, tutor: string, name: string): Promise<{ tutor: string; name: string; path: string; text: string; hash: string; state: ActivityStatus['state']; basedOn?: string; shipped: boolean; examples: number }> {
  const file = activityFile(ws.root, tutor, name);
  const text = await readFile(file, 'utf8');
  const st = await activityStatusOf(ws.root, tutor, name);
  return {
    tutor,
    name,
    path: relative(ws.root, file).split(sep).join('/'),
    text,
    hash: sha256(text),
    state: st.state,
    ...(st.basedOn ? { basedOn: st.basedOn } : {}),
    shipped: (await shippedActivityText(tutor, name, ws.root)) !== null,
    examples: await exampleCount(file),
  };
}

/** 一节一个读者(《写提示词.md》):节标题 → 谁读、在第几行 */
export function activitySections(text: string): { title: string; reader: string; line: number }[] {
  const out: { title: string; reader: string; line: number }[] = [{ title: '头', reader: 'name · cards', line: 1 }];
  let fence = false;
  text.split('\n').forEach((l, i) => {
    if (/^`{3,}/.test(l)) fence = !fence;
    const m = !fence && /^##[ \t]+(.+?)[ \t]*$/.exec(l);
    if (!m) return;
    const title = m[1];
    const tool = ACTIVITY_TOOL_SECTION_RE.exec(title)?.[1];
    const reader = title === ACTIVITY_SECTIONS.tutor ? '老师的系统提示' : tool ? (tool in ACTIVITY_TOOLS ? (tool === '画家' ? '百炼文生图' : tool === '认字' ? '拍照认词' : tool) : tool) : '给你';
    out.push({ title, reader, line: i + 1 });
  });
  return out;
}

/** 两份原文按行比,连着改的合成一块;行号按现在这份(LCS,文件一两百行) */
export function diffHunks(before: string, now: string): DiffHunk[] {
  const A = before.split('\n');
  const B = now.split('\n');
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  const open = (i: number, j: number): DiffHunk => (cur ??= { at: j + 1, oldAt: i + 1, old: [], now: [] });
  const close = (): void => { if (cur) out.push(cur); cur = null; };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { close(); i++; j++; }
    else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) open(i, j).old.push(A[i++]);
    else open(i, j).now.push(B[j++]);
  }
  close();
  return out;
}

const showValue = (v: unknown): string => (Array.isArray(v) ? v.join('、') : String(v));

export interface DevActivityCheck {
  issues: ActivityIssue[];
  summary: {
    params: { name: string; type: string; optional: boolean; default?: string; min?: number; max?: number }[];
    state: string[];
    gates: string[];
    cards: string[];
    tools: { tool: string; slots: readonly string[] }[];
    page: string | null;
  };
  sections: { title: string; reader: string; line: number }[];
  buttons: DevActivityButton[];
  /** 老师实际收到什么:按 params(首页按钮的或自己填的)裁好的「老师怎么带」;不起老师的是 null */
  preview: { text: string | null; chars: number; cards: string[]; paramIssues: string[]; values: Record<string, string>; tools: { tool: string; prompt: string; negative?: string }[] };
  /** 和出厂那份比;不是出厂的 → null */
  diff: DiffHunk[] | null;
}

/** 边改边查(不落盘):检查、首页按钮按这份解析、预览、和出厂比 */
export async function checkDevActivity(ws: Workspace, tutor: string, name: string, text: string, params: Record<string, string> = {}): Promise<DevActivityCheck> {
  const { activity, issues } = lintActivity(text, { fileName: name, tutorCards: tutorCards(ws, tutor) });
  const resolve = (raw: Record<string, string>): { ok: boolean; detail: string; values: Record<string, unknown> } => {
    const r = resolveParams(activity, raw);
    return r.issues.length ? { ok: false, detail: r.issues.join(';'), values: {} } : { ok: true, detail: Object.entries(r.values).map(([k, v]) => `${k} ${showValue(v)}${raw[k] === undefined ? '(缺省)' : ''}`).join(' · ') || '没有参数', values: r.values };
  };
  const fixes = issues.some((i) => i.level === 'fix');
  const buttons = (await homeButtons(ws, tutor, name)).map((b) => {
    const r = resolve(b.params);
    return { ...b, ok: r.ok && !fixes, detail: fixes ? '写坏了,孩子端不出' : r.ok ? r.detail : `解析不出,孩子端不出:${r.detail}` };
  });
  const kinds = [...new Set(['text', ...activity.cards.filter((k) => (BOARD_CARD_KINDS as readonly string[]).includes(k))])];
  const p = resolveParams(activity, params);
  const body = activity.tutor ? renderTutorSection(activity, { params: p.values, cards: kinds }) : null;
  const shipped = await shippedActivityText(tutor, name, ws.root);
  return {
    issues,
    summary: summaryOf(activity),
    sections: activitySections(text),
    buttons,
    preview: {
      text: body,
      chars: body ? [...body].length : 0,
      cards: kinds,
      paramIssues: p.issues,
      values: Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, showValue(v)])),
      tools: activity.tools.map((t) => ({ tool: t.tool, prompt: t.prompt, ...(t.negative ? { negative: t.negative } : {}) })),
    },
    diff: shipped === null ? null : diffHunks(shipped, text),
  };
}

function summaryOf(a: Activity): DevActivityCheck['summary'] {
  return {
    params: a.params.map((x) => ({ name: x.name, type: x.type, optional: x.optional, ...(x.default !== undefined ? { default: x.default } : {}), ...(x.min !== undefined ? { min: x.min } : {}), ...(x.max !== undefined ? { max: x.max } : {}) })),
    state: a.state.map((x) => x.name),
    gates: a.gates.map((x) => x.rule),
    cards: a.cards,
    tools: a.tools.map((t) => ({ tool: t.tool, slots: ACTIVITY_TOOLS[t.tool]?.slots ?? [] })),
    page: a.page ? (ACTIVITY_PAGES[a.page] ?? a.page) : null,
  };
}

export class ActivityConflict extends Error {
  readonly hash: string;
  constructor(hash: string) {
    super('文件在别处改过了');
    this.hash = hash;
  }
}

/** 存:磁盘上那份的 hash 要还是 base(读进来时的),不然不存(ActivityConflict);先写 .tmp 再 rename */
export async function saveDevActivity(ws: Workspace, tutor: string, name: string, text: string, base: string): Promise<{ hash: string; state: ActivityStatus['state']; fixes: number }> {
  const file = activityFile(ws.root, tutor, name);
  const disk = await readFile(file, 'utf8');
  if (sha256(disk) !== base) throw new ActivityConflict(sha256(disk));
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
  const st = await activityStatusOf(ws.root, tutor, name);
  return { hash: sha256(text), state: st.state, fixes: lintActivity(text, { fileName: name, tutorCards: tutorCards(ws, tutor) }).issues.filter((i) => i.level === 'fix').length };
}

export async function restoreDevActivity(ws: Workspace, tutor: string, name: string): Promise<{ bak: string | null }> {
  const r = await restoreActivity(ws.root, tutor, name);
  return { bak: r.bak ? relative(ws.root, r.bak).split(sep).join('/') : null };
}
