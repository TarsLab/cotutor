/**
 * --sandbox:命令换到真 workspace 旁边的试用 workspace(位置、拷什么、cotutor.json 改哪几处见 src/schema/workspace.ts 的 SANDBOX_*)。
 * 没有就分一个;有了就接着用(试过的对话留着,能接着聊、能试记账);--fresh 重新分。
 * 重新分先分到临时目录,成了才换掉旧的:中途断了旧的还在,半截的不会被当成分好的(标记最后写)。
 * 已经在 sandbox 里(cwd 在里面、--workspace 指过来)就用它;--fresh 从它记着的真 workspace 重新分,不套娃。
 */
import { copyFile, cp, lstat, mkdir, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { PATH_ROLES, ROLE_DEFAULTS, SKILLS_DIR, WORKSPACE_ROLES, type PathRole } from '../../schema/index.ts';
import { SANDBOX_DIR, SANDBOX_KEEP_MACHINE, SANDBOX_MARK, SANDBOX_SKIP, SANDBOX_TITLE, SANDBOX_VAULT, type SandboxMark, type Workspace } from '../../schema/workspace.ts';
import { CONFIG_FILE, UsageError, expandPath, isInside as inside, loadWorkspace, parseConfig, readJson, readSandboxMark, redactHome, resolveRoot, type ResolveOptions } from '../workspace.ts';
import { sandboxPort } from './port.ts';
import { DIRS, LEDGER_FILES } from './skeleton.ts';
import { CLAUDE_SKILLS_LINK, linkClaudeSkills } from './skills.ts';

export interface SandboxResult {
  /** sandbox 的根:后面的命令都当 --workspace 用它 */
  root: string;
  /** 从哪个真 workspace 分出来的 */
  from: string;
  /** 这次新分的(第一次,或 --fresh) */
  created: boolean;
  /** 分的时候 paths 怎么处理的(指在外面、只读照旧用的那几个) */
  notes: string[];
}

export interface SandboxOptions extends ResolveOptions {
  fresh?: boolean;
  now?: Date;
}

/** vault 侧指在外面也不怕的角色:只读的材料,老师不往里写 */
const READ_ONLY_ROLES: readonly string[] = ['textbooks', 'reference'];

/** ~/cotutor/ray → ~/cotutor/.sandbox/ray */
export const sandboxRootOf = (real: string): string => join(dirname(real), SANDBOX_DIR, basename(real));

async function exists(p: string): Promise<boolean> {
  return stat(p).then(() => true, () => false);
}

export async function openSandbox(override: string | undefined, opts: SandboxOptions = {}): Promise<SandboxResult> {
  const { root } = resolveRoot(override, opts);
  const here = readSandboxMark(root);
  const real = here ? here.from : root;
  const box = here ? root : sandboxRootOf(real);
  const existing = here ?? ((await exists(box)) ? readSandboxMark(box) : null);
  if (!existing && (await exists(box))) throw new UsageError(`${redactHome(box)} 已经有了,但不是 sandbox(没有 ${SANDBOX_MARK}),不动它;挪走再试`);
  if (existing && !opts.fresh) {
    const notes = [await followPort(box, existing.from), await unpointSkills(box, existing.from)].filter((n): n is string => n !== null);
    return { root: box, from: existing.from, created: false, notes };
  }
  if (!(await exists(join(real, CONFIG_FILE)))) throw new UsageError(`这个 sandbox 是从 ${redactHome(real)} 分出来的,那里已经没有 workspace 了,重新分不了`);
  const notes = await fork(real, box, opts);
  return { root: box, from: real, created: true, notes };
}

/**
 * 试用里的 .claude/skills 要指 sandbox 自己那份技能。Windows 的目录联接存的是绝对路径,照原样拷过来就指回真 workspace
 * (在试用里改技能会改到真的;没开开发者模式的连拷都拷不了,Node 照原样建的是要权限的符号链接)。所以分的时候不拷这条链,
 * 换上以后在 sandbox 里重建。以前分出来、指回真 workspace 的,打开时换掉;指别处的是家长自己建的,不动。返回说明,没动 → null
 */
async function unpointSkills(box: string, real: string): Promise<string | null> {
  const link = join(box, CLAUDE_SKILLS_LINK);
  if (!(await lstat(link).catch(() => null))?.isSymbolicLink()) return null;
  const [to, theirs] = await Promise.all([realpath(link).catch(() => null), realpath(join(real, SKILLS_DIR)).catch(() => null)]);
  if (to === null || to !== theirs) return null;
  await rm(link);
  const step = await linkClaudeSkills(box);
  return step.action === 'created' ? `${CLAUDE_SKILLS_LINK} 原来指着真 workspace 的技能,改成指试用自己那份` : `${CLAUDE_SKILLS_LINK} 原来指着真 workspace 的技能,删了;${step.note ?? ''}`;
}

/** 试用的端口永远是真 workspace 的 +1:真的搬了端口,试用下次打开跟过去,不用记两套规矩;返回说明,没动 → null */
async function followPort(box: string, real: string): Promise<string | null> {
  const file = join(box, CONFIG_FILE);
  try {
    const realRaw = readJson(join(real, CONFIG_FILE));
    const raw = readJson(file) as Record<string, unknown> | null;
    if (realRaw === null || raw === null) return null;
    const want = sandboxPort(parseConfig(realRaw, join(real, CONFIG_FILE)).server.port);
    const server = (raw.server && typeof raw.server === 'object' ? raw.server : {}) as Record<string, unknown>;
    if (server.port === want) return null;
    await writeFile(file, `${JSON.stringify({ ...raw, server: { ...server, port: want } }, null, 2)}\n`);
    return `真 workspace 换了端口,试用跟着改成 ${want}`;
  } catch {
    return null; // 真的那份坏了或没了:试用照旧
  }
}

/** 真 workspace → box:根下照拷(跳过状态),外面的 vault 拷进来,补骨架,写改过的 cotutor.json,最后写标记再换上 */
async function fork(real: string, box: string, opts: SandboxOptions): Promise<string[]> {
  const ws = loadWorkspace(real, opts);
  if (ws.sandbox) throw new UsageError(`${redactHome(real)} 本身就是 sandbox,不从它再分`);
  const vault = ws.paths.vault;
  if (!(await stat(vault).then((s) => s.isDirectory(), () => false))) throw new UsageError(`vault 不在:${redactHome(vault)}(cotutor.json 的 paths.vault);先修好真 workspace(cotutor doctor)再分`);
  const notes: string[] = [];
  const config = sandboxConfig(readJson(ws.files.config) as Record<string, unknown>, ws, box, notes);
  parseConfig(config, join(box, CONFIG_FILE));

  const skip = new Set(SANDBOX_SKIP.map((n) => join(real, n)));
  // .claude/skills 那条链不拷,换上以后重建(unpointSkills 的注释);是实体目录(旧布局没搬完)照拷
  const skillsLink = join(real, CLAUDE_SKILLS_LINK);
  const linked = (await lstat(skillsLink).catch(() => null))?.isSymbolicLink() ?? false;
  if (linked) skip.add(skillsLink);
  if (inside(ws.paths.captures, real)) skip.add(ws.paths.captures);
  const keep = (src: string): boolean => basename(src) !== '.git' && !skip.has(src);
  const tmp = `${box}.tmp-${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  try {
    for (const name of await readdir(real)) {
      const src = join(real, name);
      if (name === CONFIG_FILE || !keep(src)) continue;
      // 别的链照原样拷
      await cp(src, join(tmp, name), { recursive: true, verbatimSymlinks: true, filter: keep });
    }
    await mkdir(join(tmp, '.cotutor'), { recursive: true });
    for (const f of SANDBOX_KEEP_MACHINE) await copyFile(join(real, '.cotutor', f), join(tmp, '.cotutor', f)).catch(() => undefined);
    if (!inside(vault, real)) {
      if (await exists(join(tmp, SANDBOX_VAULT))) throw new UsageError(`workspace 根下已经有 ${SANDBOX_VAULT},外面的 vault 拷不进 sandbox;把它改个名再分`);
      await cp(vault, join(tmp, SANDBOX_VAULT), { recursive: true, verbatimSymlinks: true, filter: (src) => basename(src) !== '.git' });
    }
    for (const d of DIRS) await mkdir(join(tmp, d), { recursive: true });
    for (const f of LEDGER_FILES) await writeFile(join(tmp, f), '');
    await writeFile(join(tmp, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`);
    const mark: SandboxMark = { from: real, vault, forkedAt: (opts.now ?? new Date()).toISOString() };
    await writeFile(join(tmp, SANDBOX_MARK), `${JSON.stringify(mark, null, 2)}\n`);
    // 旧的到这里才删:openSandbox 查过它带标记
    if (await exists(box)) await rm(box, { recursive: true, force: true });
    await rename(tmp, box);
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    throw err;
  }
  // 联接存的是绝对路径:换上以后再建,不然指着已经不在的临时目录
  if (linked) {
    const step = await linkClaudeSkills(box);
    if (step.action === 'kept' && step.note) notes.push(step.note);
  }
  return notes;
}

/**
 * sandbox 的 cotutor.json:在真的那份原文上改(_note 这些机器不认识的键照留)。
 * 标题加「试用 · 」、端口 +1、证书改绝对路径、自动记账关掉;paths 里每个配过的角色照它在真 workspace 里落在哪,改成指 sandbox 里对应的那处(写相对的,sandbox 挪了也不断)。
 * 落在 workspace 与 vault 外面的:只读的材料照旧指那份,captures 改回缺省,其余会写的拦下——试用写进去的会混进真的。
 */
export function sandboxConfig(raw: Record<string, unknown>, ws: Workspace, box: string, notes: string[]): Record<string, unknown> {
  const real = ws.root;
  const vault = ws.paths.vault;
  const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const cfg: Record<string, unknown> = structuredClone(raw);
  cfg.title = `${SANDBOX_TITLE} · ${ws.config.title}`;
  const port = ws.config.server.port;
  const server: Record<string, unknown> = { ...(isObj(raw.server) ? raw.server : {}), port: sandboxPort(port) };
  const https = ws.config.server.https;
  if (https) server.https = { cert: expandPath(https.cert, real), key: expandPath(https.key, real) };
  cfg.server = server;
  // 自动记账关掉:试出来的话题不值得每个花一轮老师去记;要试记账,家长端点「记账」或在 sandbox 的 cotutor.json 打开
  if (ws.config.vault.autoBookkeep) {
    cfg.vault = { ...(isObj(raw.vault) ? raw.vault : {}), autoBookkeep: false };
    notes.push('自动记账在 sandbox 里关了(试出来的话题不值得花钱记);要试记账,家长端点「记账」,或在 sandbox 的 cotutor.json 打开 vault.autoBookkeep');
  }

  const paths: Record<string, string> = isObj(raw.paths) ? ({ ...raw.paths } as Record<string, string>) : {};
  const vaultInside = inside(vault, real);
  const newVault = vaultInside ? join(box, relative(real, vault)) : join(box, SANDBOX_VAULT);
  if (!vaultInside) paths.vault = SANDBOX_VAULT;
  else if ('vault' in paths) paths.vault = relative(real, vault) || '.';
  for (const role of Object.keys(paths)) {
    if (role === 'vault') continue;
    const abs = ws.paths[role];
    const workspaceSide = (PATH_ROLES as readonly string[]).includes(role) && WORKSPACE_ROLES.includes(role as PathRole);
    const target = inside(abs, vault) ? join(newVault, relative(vault, abs)) : inside(abs, real) ? join(box, relative(real, abs)) : null;
    if (target) {
      paths[role] = relative(workspaceSide ? box : newVault, target) || '.';
    } else if (READ_ONLY_ROLES.includes(role)) {
      paths[role] = abs;
      notes.push(`paths.${role} 在 workspace 与 vault 外面(${redactHome(abs)}):只读,照旧用那份`);
    } else if (workspaceSide) {
      delete paths[role];
      notes.push(`paths.${role} 在 workspace 外面(${redactHome(abs)}):sandbox 里改用缺省的 ${ROLE_DEFAULTS[role as PathRole]}`);
    } else {
      throw new UsageError(`paths.${role} 指到 workspace 与 vault 外面(${redactHome(abs)}),试用时写进去的会混进真的。改成 vault 里的路径再分,或者另建一个试用 workspace(cotutor init <slug> --dir <dir>)`);
    }
  }
  cfg.paths = paths;
  return cfg;
}
