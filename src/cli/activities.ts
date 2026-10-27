/**
 * activity 文件的安装、升级与检查(《activity设计.md》)。和老师文件同一套:**拷贝,不链**。
 * 包里的 grades/grade-<n>/agents/<老师>/activities/<名>.md 是出厂件;init 拷进 workspace 同一个位置(老师的家里,会话 cwd 下),这份是家长的;
 * 出厂 hash 记 .cotutor/shipped.json 的 activities(键「老师/名」),据此分 latest / upgradable / custom / untracked / missing,意思同 tutors.ts。
 */
import { readFile, readdir, mkdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { lintActivity, parseActivity, resolveParams, type ActivityIssue } from '../lib/activity.ts';
import type { Activity, ActivityRun } from '../schema/index.ts';
import { PACKAGE_AGENTS_DIR, PACKAGE_VERSION } from './skeleton.ts';
import { lineDiff, readManifest, sha256, writeManifest, type ShippedManifest, type TutorState } from './tutors.ts';
import { UsageError } from './workspace.ts';
import { workspaceGradePack } from './grades.ts';

export const ACTIVITIES_DIR = 'activities';

export interface ActivityRef {
  tutor: string;
  name: string;
  /** 文件的绝对路径 */
  file: string;
}

/** 例子文件(cotutor activity eval 用):和 activity 放在一起,`<名>.例子.md`;跟着 activity 一起出厂,检查时不当 activity */
export const EXAMPLES_SUFFIX = '.例子';

/** 某个根下(包的 agents/,或 workspace 的 agents/)每位老师的 activities/*.md;examples = 连例子文件一起(出厂、升级用) */
export async function listActivities(agentsDir: string, tutor?: string, opts: { examples?: boolean } = {}): Promise<ActivityRef[]> {
  const out: ActivityRef[] = [];
  const tutors = tutor ? [tutor] : (await readdir(agentsDir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const t of tutors) {
    const dir = join(agentsDir, t, ACTIVITIES_DIR);
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.md')).sort();
    for (const f of files) if (opts.examples || !f.slice(0, -3).endsWith(EXAMPLES_SUFFIX)) out.push({ tutor: t, name: f.slice(0, -3), file: join(dir, f) });
  }
  return out;
}

/** 出厂的 activity 与它们的例子文件 */
export const shippedActivities = async (root?: string): Promise<ActivityRef[]> => listActivities(root ? (await workspaceGradePack(root)).agentsDir : PACKAGE_AGENTS_DIR, undefined, { examples: true });

/** workspace 里那份的位置 */
export function activityFile(root: string, tutor: string, name: string): string {
  return join(root, 'agents', tutor, ACTIVITIES_DIR, `${name}.md`);
}

const keyOf = (a: { tutor: string; name: string }): string => `${a.tutor}/${a.name}`;

export interface ActivityStatus {
  key: string;
  state: TutorState;
  file: string;
  basedOn?: string;
}

async function readState(root: string, a: ActivityRef, manifest: ShippedManifest): Promise<ActivityStatus> {
  const key = keyOf(a);
  const file = activityFile(root, a.tutor, a.name);
  if (!(await lstat(file).catch(() => null))) return { key, state: 'missing', file };
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return { key, state: 'broken', file };
  }
  const h = sha256(text);
  const rec = manifest.activities?.[key];
  if (h === sha256(await readFile(a.file, 'utf8'))) return { key, state: 'latest', file, basedOn: rec?.version };
  if (rec && rec.hash === h) return { key, state: 'upgradable', file, basedOn: rec.version };
  return { key, state: rec ? 'custom' : 'untracked', file, basedOn: rec?.version };
}

export async function activityStatuses(root: string): Promise<ActivityStatus[]> {
  const manifest = await readManifest(root);
  return Promise.all((await shippedActivities(root)).map((a) => readState(root, a, manifest)));
}

async function installOne(root: string, a: ActivityRef, manifest: ShippedManifest): Promise<void> {
  const file = activityFile(root, a.tutor, a.name);
  await mkdir(dirname(file), { recursive: true });
  const text = await readFile(a.file, 'utf8');
  await writeFile(file, text);
  manifest.teachingPack ??= { grade: (await workspaceGradePack(root)).grade };
  manifest.activities ??= {};
  manifest.activities[keyOf(a)] = { hash: sha256(text), version: PACKAGE_VERSION };
}

export interface ActivityInstallStep {
  item: string;
  action: 'created' | 'exists' | 'kept' | 'replaced';
  note?: string;
}

/** init 用:缺的拷,有的不动(家长的) */
export async function installActivities(root: string): Promise<ActivityInstallStep[]> {
  const steps: ActivityInstallStep[] = [];
  const manifest = await readManifest(root);
  let touched = !manifest.teachingPack;
  manifest.teachingPack ??= { grade: (await workspaceGradePack(root)).grade };
  for (const a of await shippedActivities(root)) {
    const s = await readState(root, a, manifest);
    const item = `agents/${a.tutor}/${ACTIVITIES_DIR}/${a.name}.md`;
    if (s.state === 'missing' || s.state === 'broken') {
      await installOne(root, a, manifest);
      touched = true;
      steps.push({ item, action: s.state === 'missing' ? 'created' : 'replaced', note: s.state === 'broken' ? '读不到,重新拷贝' : `拷自本包 ${PACKAGE_VERSION}` });
    } else steps.push({ item, action: s.state === 'untracked' ? 'kept' : 'exists', note: s.state === 'custom' ? `自定义(基于 ${s.basedOn})` : s.state === 'upgradable' ? '可升级(cotutor upgrade)' : s.state === 'untracked' ? '已有(没有出厂记录);升级时当自定义对待' : undefined });
  }
  if (touched) await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  return steps;
}

export interface ActivityUpgradeStep {
  key: string;
  action: 'upgraded' | 'latest' | 'kept-custom' | 'forced' | 'installed';
  basedOn?: string;
  diff?: string[];
}

/** upgrade 用:同 upgradeTutors;force 里写「老师/名」才覆盖(原文留 .bak) */
export async function upgradeActivities(root: string, opts: { force?: string[] } = {}): Promise<ActivityUpgradeStep[]> {
  const manifest = await readManifest(root);
  manifest.teachingPack ??= { grade: (await workspaceGradePack(root)).grade };
  const steps: ActivityUpgradeStep[] = [];
  for (const a of await shippedActivities(root)) {
    const s = await readState(root, a, manifest);
    if (s.state === 'latest') steps.push({ key: s.key, action: 'latest', basedOn: s.basedOn });
    else if (s.state === 'missing' || s.state === 'broken') {
      await installOne(root, a, manifest);
      steps.push({ key: s.key, action: 'installed' });
    } else if (s.state === 'upgradable') {
      await installOne(root, a, manifest);
      steps.push({ key: s.key, action: 'upgraded', basedOn: s.basedOn });
    } else if (opts.force?.includes(s.key)) {
      await writeFile(`${s.file}.bak`, await readFile(s.file, 'utf8'));
      await installOne(root, a, manifest);
      steps.push({ key: s.key, action: 'forced', basedOn: s.basedOn });
    } else steps.push({ key: s.key, action: 'kept-custom', basedOn: s.basedOn, diff: lineDiff(await readFile(s.file, 'utf8'), await readFile(a.file, 'utf8')) });
  }
  await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  return steps;
}

/**
 * 只把一个出厂 activity 换回出厂那份(工作台「恢复出厂」,与 upgrade --force 老师/名 同一条路,但不碰别的):
 * 现在那份和出厂不一样就先存 .bak。不是出厂的 → UsageError。返回 .bak 的路径(没存就是 null)
 */
export async function restoreActivity(root: string, tutor: string, name: string): Promise<{ bak: string | null }> {
  const ref = (await shippedActivities(root)).find((a) => a.tutor === tutor && a.name === name);
  if (!ref) throw new UsageError(`${tutor}/${name} 不是出厂的 activity,没有出厂那份可换`);
  const manifest = await readManifest(root);
  const file = activityFile(root, tutor, name);
  const cur = await readFile(file, 'utf8').catch(() => null);
  let bak: string | null = null;
  if (cur !== null && cur !== (await readFile(ref.file, 'utf8'))) {
    bak = `${file}.bak`;
    await writeFile(bak, cur);
  }
  await installOne(root, ref, manifest);
  await writeManifest(root, manifest);
  return { bak };
}

/** 出厂那份的原文;不是出厂的 → null */
export async function shippedActivityText(tutor: string, name: string, root?: string): Promise<string | null> {
  const ref = (await shippedActivities(root)).find((a) => a.tutor === tutor && a.name === name);
  return ref ? readFile(ref.file, 'utf8') : null;
}

/** workspace 里一个 activity 现在的状态(出厂的看新旧;自家加的是 untracked) */
export async function activityStatusOf(root: string, tutor: string, name: string): Promise<ActivityStatus> {
  const ref = (await shippedActivities(root)).find((a) => a.tutor === tutor && a.name === name);
  if (ref) return readState(root, ref, await readManifest(root));
  const file = activityFile(root, tutor, name);
  return { key: `${tutor}/${name}`, state: (await lstat(file).catch(() => null)) ? 'untracked' : 'missing', file };
}

export interface ActivityCheck {
  tutor: string;
  name: string;
  file: string;
  activity: Activity | null;
  issues: ActivityIssue[];
}

/**
 * cotutor activity check:workspace 里每个(或某位老师的、某一个)activity 文件解析 + 检查。
 * tutors 是 cotutor.json 的老师表(键 → 这位老师的 cards;没写 cards 是 undefined = 全部);老师不在表里也报一条。
 */
export async function checkActivities(root: string, tutors: Readonly<Record<string, { cards?: readonly string[] }>>, opts: { tutor?: string; name?: string } = {}): Promise<ActivityCheck[]> {
  const refs = (await listActivities(join(root, 'agents'), opts.tutor)).filter((r) => !opts.name || r.name === opts.name);
  const out: ActivityCheck[] = [];
  for (const r of refs) {
    const text = await readFile(r.file, 'utf8').catch(() => null);
    if (text === null) {
      out.push({ ...r, activity: null, issues: [{ level: 'fix', text: '读不到' }] });
      continue;
    }
    const t = tutors[r.tutor];
    const { activity, issues } = lintActivity(text, { fileName: r.name, tutorCards: t?.cards });
    if (!t) issues.unshift({ level: 'fix', text: `cotutor.json 里没有 ${r.tutor} 这位老师,这个 activity 没人带` });
    out.push({ ...r, activity, issues });
  }
  return out;
}

/**
 * 终端里起一个 activity 话题(cotutor send / pack --activity):读 workspace 里那份,参数照首页按钮的写法给(`名=值`,几个用 ; 隔开),
 * 和孩子点按钮同一条解析(补缺省、按类型转)。不在、参数不对 → UsageError。
 */
export async function activityRunFor(root: string, tutor: string, name: string, raw = ''): Promise<ActivityRun> {
  const file = activityFile(root, tutor, name);
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) throw new UsageError(`${file} 不在;cotutor activity check ${tutor} 看这位老师有哪些`);
  const params: Record<string, string> = {};
  for (const pair of raw.split(/[;；]/).map((x) => x.trim()).filter(Boolean)) {
    // 值可以有几行(口语课的口语单)
    const m = /^([^=]+)=([\s\S]*)$/.exec(pair);
    if (!m) throw new UsageError(`--param 写成「名=值」,几个用 ; 隔开,如 --param '词=播种、羞愧;最多画=1'(「${pair}」不对)`);
    params[m[1].trim()] = m[2].trim();
  }
  const r = resolveParams(parseActivity(text).activity, params);
  if (r.issues.length) throw new UsageError(r.issues.join(';'));
  return { name, params: r.values };
}
