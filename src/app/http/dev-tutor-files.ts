/**
 * 工作台改老师文件:「新话题」照的提示词。和 activity 同一个编辑器、同一套规矩——
 * 读、边改边查(不落盘:检查、老师收到什么、和出厂比)、存(带读进来时的 hash,磁盘上的变了就不存)、恢复出厂(原文留 .bak)。
 * 老师文件是 agents/<老师>.md:frontmatter 给 CLI,正文就是不走 activity 的话题里老师的系统提示(新话题、开场按钮、隔天接着一个不是 activity 的话题)。
 * 只认 cotutor.json 里有的老师;和老师团页的 /api/tutors/<老师>/file 是同一份文件,那条路不带 hash,这里带。
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { restoreTutor, sha256, shippedTutorText, tutorFile, tutorStatuses, type TutorState } from '../cli/tutors.ts';
import { UsageError } from '../../shared/errors.ts';
import type { Workspace } from '../../schema/index.ts';
import { lintAgentFile, parseAgentFile, type AgentFileIssue } from '../../runtime/agent-file.ts';
import { TUTOR_RULES_PATH, takesTutorRules, tutorRulesBody } from '../../runtime/context/tutor-rules.ts';
import { tutorCardKinds, type TutorButton } from '../../board/cards/index.ts';
import { resolvePolicy } from '../../schema/index.ts';
import { readPublished } from '../../runtime/home/store.ts';
import { boardGuideOf } from '../../runtime/runner.ts';
import { ActivityConflict, diffHunks, type DiffHunk } from './dev-activities.ts';

/** 列表上这一行叫什么:有脸的老师是「新话题」(孩子点的那颗),工具人没有新话题按钮,叫「老师文件」 */
export const tutorFileLabel = (tutor: string): string => (takesTutorRules(tutor) ? '新话题' : '老师文件');

export type TutorFileState = TutorState | 'own';

export interface DevTutorFileRow {
  kind: 'tutor';
  tutor: string;
  name: string;
  description: string;
  state: TutorFileState;
  basedOn?: string;
  fixes: number;
  notes: number;
  /** 孩子端首页上照它带的按钮几个(新话题 + 开场按钮) */
  buttons: number;
}

const fileOf = (ws: Workspace, tutor: string): string => tutorFile(ws.root, tutor);

async function stateOf(ws: Workspace, tutor: string): Promise<{ state: TutorFileState; basedOn?: string }> {
  const st = (await tutorStatuses(ws.root)).find((s) => s.name === tutor);
  if (!st) return { state: 'own' };
  return { state: st.state, ...(st.basedOn ? { basedOn: st.basedOn } : {}) };
}

/** 孩子端首页上照老师文件带的按钮:新话题(永远第一个)+ 开场按钮;没发布过首页就是缺省首页(孩子端露的老师一张只有新话题的卡) */
async function homeButtons(ws: Workspace, tutor: string): Promise<{ label: string; kind: 'new' | 'start' }[]> {
  if (!takesTutorRules(tutor)) return [];
  const { home } = await readPublished(ws);
  const t = ws.config.tutors[tutor];
  if (!home) return t?.enabled && !t.hidden ? [{ label: '新话题', kind: 'new' }] : [];
  const card = home.cards.find((c) => c.kind === 'tutor' && c.props.tutor === tutor);
  if (!card) return [];
  return [{ label: '新话题', kind: 'new' as const }, ...((card.props.buttons ?? []) as TutorButton[]).filter((b) => b.kind === 'start').map((b) => ({ label: b.label, kind: 'start' as const }))];
}

export async function listDevTutorFiles(ws: Workspace): Promise<DevTutorFileRow[]> {
  const rows: DevTutorFileRow[] = [];
  for (const tutor of Object.keys(ws.config.tutors)) {
    const text = await readFile(fileOf(ws, tutor), 'utf8').catch(() => null);
    if (text === null) continue;
    const issues = lintAgentFile(text, tutor);
    rows.push({
      kind: 'tutor',
      tutor,
      name: tutorFileLabel(tutor),
      description: parseAgentFile(text).frontmatter.description ?? '',
      ...(await stateOf(ws, tutor)),
      fixes: issues.filter((i) => i.level === 'fix').length,
      notes: issues.filter((i) => i.level === 'note').length,
      buttons: (await homeButtons(ws, tutor)).length,
    });
  }
  return rows;
}

/** 这位老师在 cotutor.json 里、文件读得到 */
export async function hasDevTutorFile(ws: Workspace, tutor: string): Promise<boolean> {
  return Boolean(ws.config.tutors[tutor]) && (await readFile(fileOf(ws, tutor), 'utf8').then(() => true, () => false));
}

export async function readDevTutorFile(ws: Workspace, tutor: string): Promise<{ kind: 'tutor'; tutor: string; name: string; path: string; text: string; hash: string; state: TutorFileState; basedOn?: string; shipped: boolean; examples: number }> {
  const file = fileOf(ws, tutor);
  const text = await readFile(file, 'utf8');
  return {
    kind: 'tutor',
    tutor,
    name: tutorFileLabel(tutor),
    path: relative(ws.root, file).split(sep).join('/'),
    text,
    hash: sha256(text),
    ...(await stateOf(ws, tutor)),
    shipped: (await shippedTutorText(tutor, ws.root)) !== null,
    examples: 0,
  };
}

/** 节:frontmatter 一节给 CLI,正文开头与每个 ## 给老师(系统提示);围栏里的 ## 不算 */
export function tutorFileSections(text: string): { title: string; reader: string; line: number }[] {
  const lines = text.split('\n');
  const out: { title: string; reader: string; line: number }[] = [];
  let bodyAt = 1;
  if (/^---[^\S\n]*$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, i) => i > 0 && /^---[^\S\n]*$/.test(l));
    if (end > 0) {
      out.push({ title: '头', reader: 'CLI 认的 name · description', line: 1 });
      bodyAt = end + 2;
    }
  }
  while (bodyAt <= lines.length && !lines[bodyAt - 1].trim()) bodyAt++;
  out.push({ title: '开头', reader: '老师的系统提示', line: Math.min(bodyAt, lines.length) });
  let fence = false;
  lines.forEach((l, i) => {
    if (/^`{3,}/.test(l)) fence = !fence;
    const m = !fence && i + 1 > bodyAt && /^##[ \t]+(.+?)[ \t]*$/.exec(l);
    if (m) out.push({ title: m[1], reader: '老师的系统提示', line: i + 1 });
  });
  return out;
}

export interface DevTutorFileCheck {
  issues: AgentFileIssue[];
  sections: { title: string; reader: string; line: number }[];
  buttons: { label: string; kind: 'new' | 'start' }[];
  /** 老师在一个新话题里收到什么:系统提示 = 正文(+ 板书写法);话题第一条带守则(机器件,这里不改) */
  preview: {
    text: string;
    chars: number;
    board: { chars: number; cards: string[] } | null;
    rules: { path: string; text: string; chars: number } | null;
  };
  diff: DiffHunk[] | null;
}

const charsOf = (s: string): number => [...s].length;

export async function checkDevTutorFile(ws: Workspace, tutor: string, text: string): Promise<DevTutorFileCheck> {
  const body = parseAgentFile(text).body;
  const faced = takesTutorRules(tutor);
  const kinds = tutorCardKinds(ws.config.tutors[tutor]?.cards);
  const guide = faced && resolvePolicy(ws.config, tutor).board !== 'off' ? await boardGuideOf(ws, tutor) : null;
  let rules: DevTutorFileCheck['preview']['rules'] = null;
  if (faced) {
    const md = await readFile(join(ws.root, TUTOR_RULES_PATH), 'utf8').catch(() => null);
    if (md !== null) {
      const r = tutorRulesBody(md, kinds ?? undefined);
      rules = { path: TUTOR_RULES_PATH, text: r, chars: charsOf(r) };
    }
  }
  const shipped = await shippedTutorText(tutor, ws.root);
  return {
    issues: lintAgentFile(text, tutor),
    sections: tutorFileSections(text),
    buttons: await homeButtons(ws, tutor),
    preview: {
      text: body,
      chars: charsOf(body),
      board: guide ? { chars: charsOf(guide.body), cards: kinds ? [...kinds] : [] } : null,
      rules,
    },
    diff: shipped === null ? null : diffHunks(shipped, text),
  };
}

/**
 * 存:磁盘上那份的 hash 要还是 base(读进来时的),不然不存(ActivityConflict);检查有「要改」的不存(UsageError):
 * 老师文件写坏了这位老师整个起不来,不像 activity 有首页护栏兜着。先写 .tmp 再 rename
 */
export async function saveDevTutorFile(ws: Workspace, tutor: string, text: string, base: string): Promise<{ hash: string; state: TutorFileState; fixes: number }> {
  const fixes = lintAgentFile(text, tutor).filter((i) => i.level === 'fix');
  if (fixes.length) throw new UsageError(`老师文件还有 ${fixes.length} 处要改,改好才能存:${fixes.map((i) => i.text).join(';')}`);
  const file = fileOf(ws, tutor);
  const disk = await readFile(file, 'utf8');
  if (sha256(disk) !== base) throw new ActivityConflict(sha256(disk));
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
  return { hash: sha256(text), ...(await stateOf(ws, tutor)), fixes: 0 };
}

export async function restoreDevTutorFile(ws: Workspace, tutor: string): Promise<{ bak: string | null }> {
  const r = await restoreTutor(ws.root, tutor);
  return { bak: r.bak ? relative(ws.root, r.bak).split(sep).join('/') : null };
}
