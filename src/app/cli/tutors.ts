/**
 * 老师的家(agents/<name>/,activity 在里面)的安装。
 * 老师文件(agents/<name>.md)不出厂、不读:一科通用的做法并进了每个 activity(「<科>这一科」那一节)。
 * 已有 workspace 里的那份不删(家长可能改过),cotutor refresh 提醒一句(retiredTutorFiles)。
 */
import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_VERSION, shippedAgents } from './skeleton.ts';
import { AGENT_NAME_RE } from '../../schema/index.ts';
import { UsageError } from '../workspace.ts';
import { SHIPPED_FILE, readManifest, writeManifest } from './shipped.ts';
import { workspaceGradePack } from './grades.ts';

export { SHIPPED_FILE, sha256, readManifest, writeManifest, type ShippedManifest } from './shipped.ts';

/** 出厂件在 workspace 里的状态(activity、技能、主题共用这套说法) */
export type TutorState = 'latest' | 'upgradable' | 'custom' | 'untracked' | 'missing' | 'broken';

export interface InstallStep {
  item: string;
  action: 'created' | 'exists' | 'kept' | 'replaced' | 'removed';
  note?: string;
}

/** init 用:出厂老师与 cotutor.json 里的每一位,补老师的家 agents/<name>/(activity 由 activities.ts 装) */
export async function installTutors(root: string, configured: string[] = []): Promise<InstallStep[]> {
  const steps: InstallStep[] = [];
  const manifest = await readManifest(root);
  const touched = !manifest.teachingPack;
  manifest.teachingPack ??= { grade: (await workspaceGradePack(root)).grade };
  const shipped = await shippedAgents((await workspaceGradePack(root)).agentsDir);
  for (const name of [...new Set([...shipped.map((a) => a.name), ...configured])]) {
    const home = join(root, 'agents', name);
    if (await lstat(home).catch(() => null)) {
      steps.push({ item: `agents/${name}/`, action: 'exists' });
      continue;
    }
    await mkdir(home, { recursive: true });
    await writeFile(join(home, '.gitkeep'), '');
    steps.push({ item: `agents/${name}/`, action: 'created' });
  }
  if (touched || !(await lstat(join(root, SHIPPED_FILE)).catch(() => null))) await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  return steps;
}

export interface AddResult {
  name: string;
  home: string;
}

/** cotutor add <name>:建老师的家(activity 往里放)。不动 cotutor.json——那是调用方(main / 页面)用 patchConfig 加的 */
export async function addTutorHome(root: string, name: string): Promise<AddResult> {
  if (!AGENT_NAME_RE.test(name)) throw new UsageError(`老师名 "${name}" 不合规:小写字母数字连字符,如 science-tutor`);
  const home = join(root, 'agents', name);
  await mkdir(home, { recursive: true });
  await writeFile(join(home, '.gitkeep'), '').catch(() => {});
  return { name, home };
}

/** 已有 workspace 里不再读的老师文件(agents/<name>.md):refresh、doctor 提醒一句,不删 */
export async function retiredTutorFiles(root: string): Promise<string[]> {
  const names = await readdir(join(root, 'agents')).catch(() => [] as string[]);
  return names.filter((n) => n.endsWith('.md')).sort().map((n) => `agents/${n}`);
}

/** 最小行 diff(LCS),只为让家长看清改了哪几行;不追求 git 那么好 */
export function lineDiff(a: string, b: string): string[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(`- ${A[i++]}`);
    else out.push(`+ ${B[j++]}`);
  }
  while (i < n) out.push(`- ${A[i++]}`);
  while (j < m) out.push(`+ ${B[j++]}`);
  return out;
}

