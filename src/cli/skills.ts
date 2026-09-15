/**
 * 出厂 skill:与老师文件同一套「拷不链」机制——init 拷进 workspace 的 .claude/skills/<name>/,hash 记 .cotutor/shipped.json 的 skills,
 * .qwen/skills/<name> 是相对链。出厂表 SHIPPED_SKILLS 每项带来源与 machine 标记(2026-09-15,照 hyperframes 的 skills/ 目录):
 * - 来源 cotutor = 本包根 skills/<name>/(进 npm files;cotutor-board 整个、cotutor-vault 的 references/ 是 scripts/gen-skills.ts 生成后入库的,
 *   tests/skills.test.ts 断言一致),来源 drawtell = drawtell 包根 skills/<name>/(四个领域 skill,2026-09-15 从退役的 drawtell-skills 仓搬过去的;
 *   没装 → unavailable,doctor 点名,init 跳过)
 * - machine: true 的是机器件(cotutor-board / cotutor-vault / cotutor-analyze:它们和解析器、CLI 要一起变),init / upgrade 每次按包里的覆盖、家长改了也刷,状态只有 latest / upgradable;
 *   其余拷进来就是家长的:upgrade 没改过的换新、改过的报 diff 保留(custom / untracked)
 * 工作流 skill(math-explainer 等)不拷,scene-maker 的工作流写在它的老师文件正文里(《drawtell接入与场景卡.md》§3)。
 * 顺带一个机器文件 .cotutor/drawtell:指向本包 node_modules 里 drawtell CLI 的壳脚本,老师用相对路径就能跑它。
 */
import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARD_SKILL } from '../cards/docs.ts';
import { VAULT_SKILL } from '../lib/vault-doc.ts';
import { ANALYZE_SKILL } from '../lib/analyze-doc.ts';
export { ANALYZE_SKILL, BOARD_SKILL, VAULT_SKILL };
import { PACKAGE_VERSION } from './skeleton.ts';
import { readManifest, writeManifest, type ShippedManifest } from './tutors.ts';

export interface ShippedSkill {
  name: string;
  source: 'cotutor' | 'drawtell';
  /** 机器件:每次 init / upgrade 都按包里的覆盖,不认家长的改动 */
  machine?: boolean;
  /** 装它时顺手清掉的旧位置(相对 workspace 根;机器文件,没有用户数据) */
  legacy?: readonly string[];
}

/** 2026-09-12 到 09-14 板书语法表的旧位置 .cotutor/板书语法.md + .cotutor/cards/ */
export const LEGACY_SYNTAX_PATHS = ['.cotutor/板书语法.md', '.cotutor/cards'] as const;

export const SHIPPED_SKILLS: readonly ShippedSkill[] = [
  { name: BOARD_SKILL, source: 'cotutor', machine: true, legacy: LEGACY_SYNTAX_PATHS },
  { name: VAULT_SKILL, source: 'cotutor', machine: true },
  { name: ANALYZE_SKILL, source: 'cotutor', machine: true },
  { name: 'drawtell-scene', source: 'drawtell' },
  { name: 'drawtell-teaching', source: 'drawtell' },
  { name: 'drawtell-cli', source: 'drawtell' },
  { name: 'drawtell-verify', source: 'drawtell' },
];
export type ShippedSkillName = string;

export const BOARD_SKILL_DIR = `.claude/skills/${BOARD_SKILL}`;
export const BOARD_SKILL_FILE = `${BOARD_SKILL_DIR}/SKILL.md`;

/** 本包自带的技能目录(仓库检出与 npm 安装都在包根 skills/) */
export const PACKAGE_SKILLS_DIR = fileURLToPath(new URL('../../skills/', import.meta.url));

/** drawtell 包的 skills/ 目录(四个领域 skill 随它发,0.7.0 起);包没装 → null(doctor 点名,init 跳过) */
export function drawtellSkillsDir(): string | null {
  try {
    return join(dirname(createRequire(import.meta.url).resolve('drawtell/package.json')), 'skills');
  } catch {
    return null;
  }
}

/** 这个技能在包里的目录;来源没装 → null */
export function skillSourceDir(skill: ShippedSkill): string | null {
  const base = skill.source === 'cotutor' ? PACKAGE_SKILLS_DIR : drawtellSkillsDir();
  return base ? join(base, skill.name) : null;
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
  source: ShippedSkill['source'];
  machine: boolean;
}

export function skillDirs(root: string, name: string): { claude: string; qwen: string } {
  return { claude: join(root, '.claude', 'skills', name), qwen: join(root, '.qwen', 'skills', name) };
}

async function readState(root: string, skill: ShippedSkill, manifest: ShippedManifest): Promise<SkillStatus> {
  const { name } = skill;
  const base = { name, source: skill.source, machine: Boolean(skill.machine) };
  const { claude } = skillDirs(root, name);
  const src = skillSourceDir(skill);
  const st = await lstat(claude).catch(() => null);
  if (!st?.isDirectory()) return { ...base, state: src ? 'missing' : 'unavailable', dir: claude };
  const rec = manifest.skills?.[name];
  const mine = await dirHash(claude);
  const shipped = src ? await dirHash(src).catch(() => null) : null;
  if (shipped && mine === shipped) return { ...base, state: 'latest', dir: claude, basedOn: rec?.version };
  // 机器件不认家长的改动:和包里不一样就是该换
  if (skill.machine) return { ...base, state: src ? 'upgradable' : 'latest', dir: claude, basedOn: rec?.version };
  if (rec && rec.hash === mine) return { ...base, state: src ? 'upgradable' : 'latest', dir: claude, basedOn: rec.version };
  return { ...base, state: rec ? 'custom' : 'untracked', dir: claude, basedOn: rec?.version };
}

export async function skillStatuses(root: string): Promise<SkillStatus[]> {
  const manifest = await readManifest(root);
  const out: SkillStatus[] = [];
  for (const skill of SHIPPED_SKILLS) out.push(await readState(root, skill, manifest));
  return out;
}

/** 整个目录换成包里的(先删再拷),hash 记进清单;顺手清旧位置 */
async function installOne(root: string, skill: ShippedSkill, src: string, manifest: ShippedManifest): Promise<string[]> {
  const { claude } = skillDirs(root, skill.name);
  await rm(claude, { recursive: true, force: true });
  await mkdir(dirname(claude), { recursive: true });
  await cp(src, claude, { recursive: true });
  manifest.skills ??= {};
  manifest.skills[skill.name] = { hash: await dirHash(claude), version: PACKAGE_VERSION };
  const removed: string[] = [];
  for (const p of skill.legacy ?? []) {
    if (await lstat(join(root, p)).catch(() => null)) {
      await rm(join(root, p), { recursive: true, force: true });
      removed.push(p);
    }
  }
  return removed;
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

/** init 用:缺的拷,有的不动;机器件每次按包里的刷;drawtell-skills 没装就那几项各报一行 */
export async function installSkills(root: string): Promise<SkillStep[]> {
  const steps: SkillStep[] = [];
  const manifest = await readManifest(root);
  let touched = false;
  for (const skill of SHIPPED_SKILLS) {
    const { name } = skill;
    const s = await readState(root, skill, manifest);
    const src = skillSourceDir(skill);
    const item = `.claude/skills/${name}/`;
    if (s.state === 'unavailable' || !src) {
      steps.push({ item, action: 'kept', note: `${skill.source} 没装,没拷(scene-maker 作业要它);仓库根 pnpm install` });
      continue;
    }
    if (s.state === 'missing') {
      const removed = await installOne(root, skill, src, manifest);
      touched = true;
      steps.push({ item, action: 'created', note: skill.machine ? '机器件,从包里生成的技能,别改' : `拷自 ${skill.source}` });
      for (const p of removed) steps.push({ item: p, action: 'replaced', note: `旧位置的机器文件,已并进 ${name} 技能` });
    } else if (skill.machine) {
      const removed = await installOne(root, skill, src, manifest);
      touched = true;
      steps.push({ item, action: 'exists', note: s.state === 'latest' ? '已按本包刷新(机器件)' : '已按本包换新(机器件,不认改动)' });
      for (const p of removed) steps.push({ item: p, action: 'replaced', note: `旧位置的机器文件,已并进 ${name} 技能` });
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
  machine?: boolean;
  /** 顺手清掉的旧位置 */
  removed?: string[];
}

/** upgrade 用:latest 跳过;upgradable 换新(机器件改过也换);custom / untracked 保留只报;缺的补;来源没装的报 unavailable */
export async function upgradeSkills(root: string): Promise<SkillUpgradeStep[]> {
  const steps: SkillUpgradeStep[] = [];
  const manifest = await readManifest(root);
  for (const skill of SHIPPED_SKILLS) {
    const { name } = skill;
    const machine = Boolean(skill.machine);
    const s = await readState(root, skill, manifest);
    const src = skillSourceDir(skill);
    if (s.state === 'unavailable' || !src) {
      steps.push({ name, action: 'unavailable', machine });
      continue;
    }
    if (s.state === 'latest') steps.push({ name, action: 'latest', basedOn: s.basedOn, machine });
    else if (s.state === 'missing') steps.push({ name, action: 'installed', machine, removed: await installOne(root, skill, src, manifest) });
    else if (s.state === 'upgradable') steps.push({ name, action: 'upgraded', basedOn: s.basedOn, machine, removed: await installOne(root, skill, src, manifest) });
    else steps.push({ name, action: 'kept-custom', basedOn: s.basedOn, machine });
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
