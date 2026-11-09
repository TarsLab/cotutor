/**
 * activity 文件的安装、升级与检查。和老师文件同一套:**拷贝,不链**。
 * 包里的 grades/grade-<n>/agents/<老师>/activities/<名>.md 是出厂件;init 拷进 workspace 同一个位置(老师的家里,会话 cwd 下),这份是家长的;
 * 出厂 hash 记 .cotutor/shipped.json 的 activities(键「老师/名」),据此分 latest / upgradable / custom / untracked / missing,意思同 tutors.ts。
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, writeFile, lstat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { lintActivity, type ActivityIssue } from '../../runtime/activity.ts';
import type { Activity } from '../../schema/index.ts';
import { PACKAGE_AGENTS_DIR, PACKAGE_VERSION } from './skeleton.ts';
import { lineDiff, readManifest, sha256, writeManifest, type ShippedManifest, type TutorState } from './tutors.ts';
import { UsageError } from '../workspace.ts';
import { workspaceGradePack } from './grades.ts';
import { ACTIVITIES_DIR, ACTIVITY_RENAMES, EXAMPLES_SUFFIX, activityFile, activityRunFor, listActivities, type ActivityRef } from '../../runtime/activities.ts';

// 读的那一半在 src/runtime/activities.ts;照旧从这里转出
export { ACTIVITIES_DIR, EXAMPLES_SUFFIX, activityFile, activityRunFor, listActivities, type ActivityRef };

/** 出厂的 activity 与它们的例子文件 */
export const shippedActivities = async (root?: string): Promise<ActivityRef[]> => listActivities(root ? (await workspaceGradePack(root)).agentsDir : PACKAGE_AGENTS_DIR, undefined, { examples: true });

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

/** 头上的 name(activity 文件)/ activity(例子文件)从旧名改成新名;别处不动 */
function renameHead(text: string, from: string, to: string): string {
  return text.replace(/^---\n[\s\S]*?\n---/, (fm) => fm.replace(new RegExp(`^(name|activity):[ \t]*${from}[ \t]*$`, 'm'), `$1: ${to}`));
}

export interface ActivityRename {
  /** 新的键「老师/新名」 */
  key: string;
  from: string;
}

/**
 * 改过名的出厂 activity(ACTIVITY_RENAMES):workspace 里旧名的文件与例子挪成新名,头上的名字跟着改;出厂记录跟着挪——
 * 没改过的照旧算没改过(下面比新旧时换成新版),家长改过的照旧算自定义(内容不动,只改头上的名字)。新名已经有了就不动旧的
 */
async function migrateRenames(root: string, manifest: ShippedManifest): Promise<ActivityRename[]> {
  const out: ActivityRename[] = [];
  const tutors = (await readdir(join(root, 'agents'), { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const t of tutors) {
    for (const [from, to] of Object.entries(ACTIVITY_RENAMES)) {
      for (const [a, b] of [[from, to], [from + EXAMPLES_SUFFIX, to + EXAMPLES_SUFFIX]]) {
        const src = activityFile(root, t, a);
        const dst = activityFile(root, t, b);
        const text = await readFile(src, 'utf8').catch(() => null);
        if (text === null || existsSync(dst)) continue;
        const next = renameHead(text, from, to);
        await writeFile(dst, next);
        await unlink(src);
        const rec = manifest.activities?.[`${t}/${a}`];
        if (rec && manifest.activities) {
          delete manifest.activities[`${t}/${a}`];
          manifest.activities[`${t}/${b}`] = { ...rec, hash: rec.hash === sha256(text) ? sha256(next) : rec.hash };
        }
        out.push({ key: `${t}/${b}`, from: a });
      }
    }
  }
  return out;
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
  // 改过名的先挪:不然 init 会在旧名旁边再拷一份新名的
  const renamed = await migrateRenames(root, manifest);
  let touched = !manifest.teachingPack || renamed.length > 0;
  manifest.teachingPack ??= { grade: (await workspaceGradePack(root)).grade };
  for (const r of renamed) steps.push({ item: `agents/${r.key.replace('/', `/${ACTIVITIES_DIR}/`)}.md`, action: 'replaced', note: `改了名(原来叫「${r.from}」)` });
  for (const a of await shippedActivities(root)) {
    const s = await readState(root, a, manifest);
    const item = `agents/${a.tutor}/${ACTIVITIES_DIR}/${a.name}.md`;
    if (s.state === 'missing' || s.state === 'broken') {
      await installOne(root, a, manifest);
      touched = true;
      steps.push({ item, action: s.state === 'missing' ? 'created' : 'replaced', note: s.state === 'broken' ? '读不到,重新拷贝' : `拷自本包 ${PACKAGE_VERSION}` });
    } else steps.push({ item, action: s.state === 'untracked' ? 'kept' : 'exists', note: s.state === 'custom' ? `自定义(基于 ${s.basedOn})` : s.state === 'upgradable' ? '可升级(cotutor refresh)' : s.state === 'untracked' ? '已有(没有出厂记录);升级时当自定义对待' : undefined });
  }
  if (touched) await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  return steps;
}

export interface ActivityUpgradeStep {
  key: string;
  action: 'upgraded' | 'latest' | 'kept-custom' | 'forced' | 'installed' | 'renamed';
  basedOn?: string;
  diff?: string[];
  /** renamed:原来的名字 */
  from?: string;
}

/** upgrade 用:同 upgradeTutors;force 里写「老师/名」才覆盖(原文留 .bak) */
export async function upgradeActivities(root: string, opts: { force?: string[] } = {}): Promise<ActivityUpgradeStep[]> {
  const manifest = await readManifest(root);
  manifest.teachingPack ??= { grade: (await workspaceGradePack(root)).grade };
  const steps: ActivityUpgradeStep[] = (await migrateRenames(root, manifest)).map((r) => ({ key: r.key, action: 'renamed', from: r.from }));
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
 * 只把一个出厂 activity 换回出厂那份(工作台「恢复出厂」,与 cotutor reset 老师/名 同一条路,但不碰别的):
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
