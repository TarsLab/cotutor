/**
 * 出厂 skill(scene-maker 用的四个领域 skill,来自 drawtell-skills 包):与老师文件同一套「拷不链」机制——
 * init 拷进 workspace 的 .claude/skills/<name>/(拷进来就是家长的),hash 记 .cotutor/shipped.json 的 skills,
 * upgrade 没改过的换新、改过的报 diff 保留;.qwen/skills/<name> 是相对链。工作流 skill(math-explainer 等)不拷,
 * scene-maker 的工作流写在它的老师文件正文里(《drawtell接入与场景卡.md》§3)。
 * 顺带一个机器文件 .cotutor/drawtell:指向本包 node_modules 里 drawtell CLI 的壳脚本,老师用相对路径就能跑它。
 */
import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { PACKAGE_VERSION } from './skeleton.ts';
import { readManifest, writeManifest, type ShippedManifest } from './tutors.ts';

export const SHIPPED_SKILLS = ['drawtell-scene', 'drawtell-teaching', 'drawtell-cli', 'drawtell-verify'] as const;
export type ShippedSkillName = (typeof SHIPPED_SKILLS)[number];

/** drawtell-skills 包的 skills/ 目录;包没装 → null(doctor 点名,init 跳过) */
export function packageSkillsDir(): string | null {
  try {
    return join(dirname(createRequire(import.meta.url).resolve('drawtell-skills/package.json')), 'skills');
  } catch {
    return null;
  }
}

/** drawtell CLI 的入口(本包 node_modules 里);没装 → null */
export function drawtellBin(): string | null {
  try {
    return join(dirname(createRequire(import.meta.url).resolve('drawtell/package.json')), 'bin', 'drawtell.js');
  } catch {
    return null;
  }
}

export const TOOL_SHIM = '.cotutor/drawtell';

/** 一个目录的内容 hash:相对路径 + 内容,按路径排序 */
export async function dirHash(dir: string): Promise<string> {
  const files: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) files.push(p);
    }
  };
  await walk(dir);
  const h = createHash('sha256');
  for (const f of files.sort()) {
    h.update(relative(dir, f));
    h.update('\0');
    h.update(await readFile(f));
    h.update('\0');
  }
  return `sha256:${h.digest('hex')}`;
}

export type SkillState = 'latest' | 'upgradable' | 'custom' | 'untracked' | 'missing' | 'unavailable';

export interface SkillStatus {
  name: ShippedSkillName;
  state: SkillState;
  dir: string;
  basedOn?: string;
}

export function skillDirs(root: string, name: string): { claude: string; qwen: string } {
  return { claude: join(root, '.claude', 'skills', name), qwen: join(root, '.qwen', 'skills', name) };
}

async function readState(root: string, name: ShippedSkillName, manifest: ShippedManifest, src: string | null): Promise<SkillStatus> {
  const { claude } = skillDirs(root, name);
  const st = await lstat(claude).catch(() => null);
  if (!st?.isDirectory()) return { name, state: src ? 'missing' : 'unavailable', dir: claude };
  const rec = manifest.skills?.[name];
  const mine = await dirHash(claude);
  if (src) {
    const shipped = await dirHash(join(src, name)).catch(() => null);
    if (shipped && mine === shipped) return { name, state: 'latest', dir: claude, basedOn: rec?.version };
  }
  if (rec && rec.hash === mine) return { name, state: src ? 'upgradable' : 'latest', dir: claude, basedOn: rec.version };
  return { name, state: rec ? 'custom' : 'untracked', dir: claude, basedOn: rec?.version };
}

export async function skillStatuses(root: string): Promise<SkillStatus[]> {
  const manifest = await readManifest(root);
  const src = packageSkillsDir();
  const out: SkillStatus[] = [];
  for (const name of SHIPPED_SKILLS) out.push(await readState(root, name, manifest, src));
  return out;
}

async function installOne(root: string, name: ShippedSkillName, src: string, manifest: ShippedManifest): Promise<void> {
  const { claude } = skillDirs(root, name);
  await rm(claude, { recursive: true, force: true });
  await mkdir(dirname(claude), { recursive: true });
  await cp(join(src, name), claude, { recursive: true });
  manifest.skills ??= {};
  manifest.skills[name] = { hash: await dirHash(claude), version: PACKAGE_VERSION };
}

async function ensureQwenLink(root: string, name: string): Promise<'created' | 'exists' | 'replaced'> {
  const { claude, qwen } = skillDirs(root, name);
  await mkdir(dirname(qwen), { recursive: true });
  const want = relative(dirname(qwen), claude);
  const st = await lstat(qwen).catch(() => null);
  if (st?.isSymbolicLink() && (await readlink(qwen).catch(() => '')) === want) return 'exists';
  if (st) {
    if (!st.isSymbolicLink()) return 'exists';
    await unlink(qwen);
    await symlink(want, qwen);
    return 'replaced';
  }
  await symlink(want, qwen);
  return 'created';
}

export interface SkillStep {
  item: string;
  action: 'created' | 'exists' | 'kept' | 'replaced';
  note?: string;
}

/** init 用:缺的拷,有的不动;drawtell-skills 没装就只报一行 */
export async function installSkills(root: string): Promise<SkillStep[]> {
  const steps: SkillStep[] = [];
  const src = packageSkillsDir();
  if (!src) return [{ item: '.claude/skills/', action: 'kept', note: 'drawtell-skills 没装,四个领域 skill 没拷(scene-maker 作业要它们);仓库根 pnpm install' }];
  const manifest = await readManifest(root);
  let touched = false;
  for (const name of SHIPPED_SKILLS) {
    const s = await readState(root, name, manifest, src);
    const item = `.claude/skills/${name}/`;
    if (s.state === 'missing') {
      await installOne(root, name, src, manifest);
      touched = true;
      steps.push({ item, action: 'created', note: `拷自 drawtell-skills` });
    } else steps.push({ item, action: 'exists', note: s.state === 'custom' ? `自定义(基于 ${s.basedOn})` : s.state === 'upgradable' ? '可升级(cotutor upgrade)' : s.state === 'untracked' ? '已有(没有出厂记录);升级时当自定义对待' : undefined });
    const q = await ensureQwenLink(root, name);
    steps.push({ item: `.qwen/skills/${name}`, action: q, note: q === 'exists' ? undefined : '→ ../../.claude/skills/' });
  }
  if (touched) await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  return steps;
}

export interface SkillUpgradeStep {
  name: string;
  action: 'upgraded' | 'latest' | 'kept-custom' | 'installed' | 'unavailable';
  basedOn?: string;
}

/** upgrade 用:latest 跳过;upgradable 换新;custom / untracked 保留只报;缺的补 */
export async function upgradeSkills(root: string): Promise<SkillUpgradeStep[]> {
  const src = packageSkillsDir();
  const steps: SkillUpgradeStep[] = [];
  if (!src) return SHIPPED_SKILLS.map((name) => ({ name, action: 'unavailable' as const }));
  const manifest = await readManifest(root);
  for (const name of SHIPPED_SKILLS) {
    const s = await readState(root, name, manifest, src);
    if (s.state === 'latest') steps.push({ name, action: 'latest', basedOn: s.basedOn });
    else if (s.state === 'missing') {
      await installOne(root, name, src, manifest);
      steps.push({ name, action: 'installed' });
    } else if (s.state === 'upgradable') {
      await installOne(root, name, src, manifest);
      steps.push({ name, action: 'upgraded', basedOn: s.basedOn });
    } else steps.push({ name, action: 'kept-custom', basedOn: s.basedOn });
    await ensureQwenLink(root, name);
  }
  await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  return steps;
}

/** .cotutor/drawtell:壳脚本,老师在 agents/<name>/ 里用 ../../.cotutor/drawtell 跑 drawtell CLI;机器文件,init / upgrade 每次刷新 */
export async function writeToolShim(root: string): Promise<{ file: string; available: boolean }> {
  const file = join(root, TOOL_SHIM);
  const bin = drawtellBin();
  await mkdir(dirname(file), { recursive: true });
  const body = bin
    ? `#!/bin/sh\n# cotutor 生成的机器文件:drawtell CLI 的壳,指向本包 node_modules 里的 drawtell;init / upgrade 会刷新\nexec node "${bin}" "$@"\n`
    : `#!/bin/sh\necho "cotutor: node_modules 里没有 drawtell(仓库根 pnpm install),场景作业跑不了" >&2\nexit 1\n`;
  await writeFile(file, body);
  await chmod(file, 0o755);
  return { file, available: bin !== null };
}
