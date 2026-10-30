/**
 * 出厂 skill:与老师文件同一套「拷不链」机制——init 拷进 workspace 的 .agents/skills/<name>/,hash 记 .cotutor/shipped.json 的 skills,
 * (2026-10-30 从 .claude/skills/ 挪来:Codex、Qwen Code 认 .agents/skills;Claude Code 只认 .claude/skills,那里是一条指过来的链,见 linkClaudeSkills。)
 * 出厂表 SHIPPED_SKILLS 每项带来源与 machine 标记(2026-09-15,照 hyperframes 的 skills/ 目录):
 * - 来源 cotutor = 本包根 skills/<name>/(进 npm files;cotutor-board 整个、其余几个的 references/ 是 scripts/gen-skills.ts 生成后入库的,
 *   tests/skills.test.ts 断言一致),来源 drawtell = drawtell 包根 skills/<name>/(四个领域 skill,2026-09-15 从退役的 drawtell-skills 仓搬过去的;
 *   没装 → unavailable,doctor 点名,init 跳过)
 * - machine: true 的是机器件(cotutor-tutor / cotutor-board / cotutor-analyze / cotutor-tune / cotutor-home:它们和解析器、契约、CLI 要一起变),init / upgrade 每次按包里的覆盖、家长改了也刷,状态只有 latest / upgradable;
 *   其余拷进来就是家长的:upgrade 没改过的换新、改过的报 diff 保留(custom / untracked)
 * 顺带一个机器文件 .cotutor/drawtell:指向本包 node_modules 里 drawtell CLI 的壳脚本,家长做课包时用相对路径就能跑它。
 */
import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARD_SKILL } from '../../board/cards/docs.ts';
import { ANALYZE_SKILL } from '../skills/analyze-doc.ts';
import { TUNE_SKILL } from '../skills/tune-doc.ts';
import { HOME_SKILL } from '../skills/home-doc.ts';
import { TUTOR_SKILL } from '../../runtime/context/tutor-rules.ts';
import { SKILLS_DIR } from '../../schema/index.ts';
export { ANALYZE_SKILL, BOARD_SKILL, HOME_SKILL, TUNE_SKILL, TUTOR_SKILL };
import { PACKAGE_VERSION } from './skeleton.ts';
import { readManifest, writeManifest, type ShippedManifest } from './tutors.ts';

export interface ShippedSkill {
  name: string;
  source: 'cotutor' | 'drawtell';
  /** 机器件:每次 init / upgrade 都按包里的覆盖,不认家长的改动 */
  machine?: boolean;
}

export const SHIPPED_SKILLS: readonly ShippedSkill[] = [
  { name: TUTOR_SKILL, source: 'cotutor', machine: true },
  { name: BOARD_SKILL, source: 'cotutor', machine: true },
  { name: ANALYZE_SKILL, source: 'cotutor', machine: true },
  { name: TUNE_SKILL, source: 'cotutor', machine: true },
  { name: HOME_SKILL, source: 'cotutor', machine: true },
  { name: 'drawtell-scene', source: 'drawtell' },
  { name: 'drawtell-teaching', source: 'drawtell' },
  { name: 'drawtell-cli', source: 'drawtell' },
  { name: 'drawtell-verify', source: 'drawtell' },
];

/**
 * 不再出厂的机器件:upgrade 时 workspace 里还有(出厂记录里有它)就删掉,免得编程助手照旧技能干活。
 * cotutor-vault(2026-10-30):老师从没读过它(孩子的话不带工具,记账那条消息自带写法),要紧的几句并进了守则 cotutor-tutor
 */
export const RETIRED_SKILLS: readonly string[] = ['cotutor-vault'];

export type ShippedSkillName = string;

/** 本包自带的技能目录(仓库检出与 npm 安装都在包根 skills/) */
export const PACKAGE_SKILLS_DIR = fileURLToPath(new URL('../../../skills/', import.meta.url));

/** 本包 node_modules 里某个依赖的包根;没装 → null */
function depDir(name: 'drawtell'): string | null {
  try {
    return dirname(createRequire(import.meta.url).resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

/** drawtell 包的 skills/ 目录(四个领域 skill 随它发,0.7.0 起);包没装 → null(doctor 点名,init 跳过) */
export function drawtellSkillsDir(): string | null {
  const d = depDir('drawtell');
  return d ? join(d, 'skills') : null;
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

export function skillDir(root: string, name: string): string {
  return join(root, SKILLS_DIR, name);
}

async function readState(root: string, skill: ShippedSkill, manifest: ShippedManifest): Promise<SkillStatus> {
  const { name } = skill;
  const base = { name, source: skill.source, machine: Boolean(skill.machine) };
  const dir = skillDir(root, name);
  const src = skillSourceDir(skill);
  const st = await lstat(dir).catch(() => null);
  if (!st?.isDirectory()) return { ...base, state: src ? 'missing' : 'unavailable', dir };
  const rec = manifest.skills?.[name];
  const mine = await dirHash(dir);
  const shipped = src ? await dirHash(src).catch(() => null) : null;
  if (shipped && mine === shipped) return { ...base, state: 'latest', dir, basedOn: rec?.version };
  // 机器件不认家长的改动:和包里不一样就是该换
  if (skill.machine) return { ...base, state: src ? 'upgradable' : 'latest', dir, basedOn: rec?.version };
  if (rec && rec.hash === mine) return { ...base, state: src ? 'upgradable' : 'latest', dir, basedOn: rec.version };
  return { ...base, state: rec ? 'custom' : 'untracked', dir, basedOn: rec?.version };
}

export async function skillStatuses(root: string): Promise<SkillStatus[]> {
  const manifest = await readManifest(root);
  const out: SkillStatus[] = [];
  for (const skill of SHIPPED_SKILLS) out.push(await readState(root, skill, manifest));
  return out;
}

/** 整个目录换成包里的(先删再拷),hash 记进清单;顺手清旧位置 */
async function installOne(root: string, skill: ShippedSkill, src: string, manifest: ShippedManifest): Promise<void> {
  const dir = skillDir(root, skill.name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dirname(dir), { recursive: true });
  await cp(src, dir, { recursive: true });
  manifest.skills ??= {};
  manifest.skills[skill.name] = { hash: await dirHash(dir), version: PACKAGE_VERSION };
}

export interface SkillStep {
  item: string;
  action: 'created' | 'exists' | 'kept' | 'replaced' | 'removed';
  note?: string;
}

/** init 用:缺的拷,有的不动;机器件每次按包里的刷;drawtell 包没装就那几项各报一行 */
export async function installSkills(root: string): Promise<SkillStep[]> {
  const steps: SkillStep[] = [];
  const manifest = await readManifest(root);
  let touched = false;
  for (const skill of SHIPPED_SKILLS) {
    const { name } = skill;
    const s = await readState(root, skill, manifest);
    const src = skillSourceDir(skill);
    const item = `${SKILLS_DIR}/${name}/`;
    if (s.state === 'unavailable' || !src) {
      steps.push({ item, action: 'kept', note: `${skill.source} 没装,没拷(家长做课包要它);仓库根 pnpm install` });
      continue;
    }
    if (s.state === 'missing') {
      await installOne(root, skill, src, manifest);
      touched = true;
      steps.push({ item, action: 'created', note: skill.machine ? '机器件,从包里生成的技能,别改' : `拷自 ${skill.source}` });
    } else if (skill.machine) {
      await installOne(root, skill, src, manifest);
      touched = true;
      steps.push({ item, action: 'exists', note: s.state === 'latest' ? '已按本包刷新(机器件)' : '已按本包换新(机器件,不认改动)' });
    } else steps.push({ item, action: 'exists', note: s.state === 'custom' ? `自定义(基于 ${s.basedOn})` : s.state === 'upgradable' ? '可升级(cotutor upgrade)' : s.state === 'untracked' ? '已有(没有出厂记录);升级时当自定义对待' : undefined });
  }
  if (touched) await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  return steps;
}

export interface SkillUpgradeStep {
  name: string;
  action: 'upgraded' | 'latest' | 'kept-custom' | 'installed' | 'unavailable' | 'retired';
  basedOn?: string;
  machine?: boolean;
  /** 顺手清掉的旧位置 */
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
    else if (s.state === 'missing') { await installOne(root, skill, src, manifest); steps.push({ name, action: 'installed', machine }); }
    else if (s.state === 'upgradable') { await installOne(root, skill, src, manifest); steps.push({ name, action: 'upgraded', basedOn: s.basedOn, machine }); }
    else steps.push({ name, action: 'kept-custom', basedOn: s.basedOn, machine });
  }
  for (const name of RETIRED_SKILLS) {
    if (!manifest.skills?.[name]) continue;
    const dir = skillDir(root, name);
    await rm(dir, { recursive: true, force: true });
    delete manifest.skills[name];
    steps.push({ name, action: 'retired', machine: true });
  }
  await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  return steps;
}

/** Claude Code 只认 .claude/skills(Codex、Qwen Code 认 .agents/skills):在那里放一条相对链,两边看到的是同一份 */
export const CLAUDE_SKILLS_LINK = '.claude/skills';

/** init / upgrade 用:没有就建链;已经是链不动;是实体目录(老 workspace 没搬完)不碰,报一声 */
export async function linkClaudeSkills(root: string): Promise<SkillStep> {
  const link = join(root, CLAUDE_SKILLS_LINK);
  const target = join('..', SKILLS_DIR);
  const item = `${CLAUDE_SKILLS_LINK} → ${SKILLS_DIR}`;
  const st = await lstat(link).catch(() => null);
  if (st?.isSymbolicLink()) {
    const to = await readlink(link);
    return to === target ? { item, action: 'exists' } : { item, action: 'kept', note: `已经是指向 ${to} 的链,没动` };
  }
  if (st) return { item, action: 'kept', note: `${CLAUDE_SKILLS_LINK} 是实体目录,没建链:把里面的技能挪进 ${SKILLS_DIR}/、删掉它,再跑 cotutor upgrade` };
  await mkdir(dirname(link), { recursive: true });
  await symlink(target, link);
  return { item, action: 'created', note: 'Claude Code 只认 .claude/skills,链到同一份' };
}

/** .cotutor/drawtell:壳脚本,家长在 workspace 里做课包时用 .cotutor/drawtell 跑 drawtell CLI(和服务端烤画面同一版);机器文件,init / upgrade 每次刷新 */
export async function writeToolShim(root: string): Promise<{ file: string; available: boolean }> {
  const file = join(root, TOOL_SHIM);
  const bin = drawtellBin();
  await mkdir(dirname(file), { recursive: true });
  const body = bin
    ? `#!/bin/sh\n# cotutor 生成的机器文件:drawtell CLI 的壳,指向本包 node_modules 里的 drawtell;init / upgrade 会刷新\nexec node "${bin}" "$@"\n`
    : `#!/bin/sh\necho "cotutor: node_modules 里没有 drawtell(仓库根 pnpm install),做不了课包" >&2\nexit 1\n`;
  await writeFile(file, body);
  await chmod(file, 0o755);
  return { file, available: bin !== null };
}
