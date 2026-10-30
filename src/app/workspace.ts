/**
 * workspace解析:一孩一 workspace(`~/cotutor/<slug>/`)。
 * 解析链(定根):`--workspace <dir>` → 环境变量 COTUTOR_WORKSPACE → cwd 或其祖先有 cotutor.json
 * (老师的 cwd 是 <ws>/agents/<name>/,从那里跑 doctor 也要找得到根)→ 用户配置
 * ~/.config/cotutor/config.json 的 workspace → ~/cotutor/ 下**唯一**的一个孩子目录 → 都没有就报错附修复指南。
 * 没有"cwd 兜底":cotutor.json 是必需的政策文件(老师表在里面),没有它什么都跑不了。
 * 配置"在但解析不了"响亮报错,不静默走缺省(沿 drawtell 的教训)。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { writeFile, rename, stat } from 'node:fs/promises';
import { ConfigError, UsageError } from '../shared/errors.ts';
import { redactDeep, redactHome } from '../shared/home.ts';
import { SKILLS_DIR, type RootSource, type Workspace } from '../schema/workspace.ts';

import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  CotutorConfigSchema,
  PATH_ROLES,
  ROLE_DEFAULTS,
  WORKSPACE_ROLES,
  explainIssues,
  type CotutorConfig,
} from '../schema/index.ts';

// 挪走了的几样照旧从这里转出(旧的引法不用改)
export { ConfigError, UsageError, redactDeep, redactHome };
export type { RootSource, Workspace };



export const CONFIG_FILE = 'cotutor.json';
export const USER_CONFIG = join(homedir(), '.config', 'cotutor', 'config.json');
/** 机器级自签证书目录(cotutor cert 写 cert.pem + key.pem):证书签的是本机名与局域网 IP,与孩子无关,所以不在 workspace 里 */
export const USER_CERT_DIR = join(homedir(), '.config', 'cotutor', 'certs');
export const HOME_ROOT = join(homedir(), 'cotutor');


export interface ResolvedRoot {
  root: string;
  source: RootSource;
}

export function expandPath(p: string, base: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(base, p);
}


const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** 读 JSON:不存在 → null;坏 → ConfigError */
export function readJson(file: string): unknown | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ConfigError(file, `不是合法 JSON:${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 从 dir 向上找 cotutor.json,找到返回目录 */
export function findUp(dir: string): string | null {
  let cur = resolve(dir);
  for (;;) {
    if (isFile(join(cur, CONFIG_FILE))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** ~/cotutor/ 下带 cotutor.json 的子目录 */
export function homeWorkspaces(homeRoot = HOME_ROOT): string[] {
  try {
    return readdirSync(homeRoot)
      .map((d) => join(homeRoot, d))
      .filter((p) => isDir(p) && isFile(join(p, CONFIG_FILE)))
      .sort();
  } catch {
    return [];
  }
}

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  homeRoot?: string;
}

export function resolveRoot(override?: string, opts: ResolveOptions = {}): ResolvedRoot {
  const env = opts.env ?? process.env;
  const cwd = resolve(opts.cwd ?? process.cwd());
  if (override !== undefined) {
    const root = expandPath(override, cwd);
    if (!isDir(root)) {
      throw new UsageError(
        `--workspace 指向的目录不存在:${redactHome(root)}(由 '${redactHome(override)}' 解析)。先 cotutor init <slug>(缺省建在 ~/cotutor/<slug>/),或改指向已有的 workspace 根。`,
      );
    }
    return { root, source: 'flag' };
  }
  if (env.COTUTOR_WORKSPACE) {
    const root = expandPath(env.COTUTOR_WORKSPACE, cwd);
    if (!isDir(root)) throw new UsageError(`COTUTOR_WORKSPACE 指向的目录不存在:${redactHome(root)}。改环境变量,或先 cotutor init。`);
    return { root, source: 'env' };
  }
  const up = findUp(cwd);
  if (up) return { root: up, source: 'cwd' };
  const user = readJson(USER_CONFIG) as { workspace?: unknown } | null;
  if (user && typeof user.workspace === 'string' && user.workspace) {
    return { root: expandPath(user.workspace, cwd), source: 'user-config' };
  }
  const homes = homeWorkspaces(opts.homeRoot);
  if (homes.length === 1) return { root: homes[0], source: 'home-single' };
  if (homes.length > 1) {
    throw new UsageError(
      `~/cotutor/ 下有 ${homes.length} 个 workspace(${homes.map((h) => redactHome(h)).join('、')}),不知道要哪个。` +
        '用 --workspace <dir> 或 COTUTOR_WORKSPACE 指定,或在 workspace 目录里跑;一 workspace 一进程。',
    );
  }
  throw new UsageError('找不到 workspace:没有 --workspace、COTUTOR_WORKSPACE、cwd 里的 cotutor.json、用户配置,~/cotutor/ 下也没有。先 cotutor init <slug>。');
}


/** 校验 cotutor.json 的形状;失败 → ConfigError,信息是逐条修复指南 */
export function parseConfig(raw: unknown, file: string): CotutorConfig {
  const r = CotutorConfigSchema.safeParse(raw);
  if (r.success) return r.data;
  throw new ConfigError(file, explainIssues(r.error.issues).map((l) => `  - ${l}`).join('\n'));
}

export function resolvePaths(root: string, paths: Record<string, string>): Workspace['paths'] {
  const vault = expandPath(paths.vault ?? ROLE_DEFAULTS.vault, root);
  const out: Record<string, string> = { vault };
  for (const role of PATH_ROLES) {
    if (role === 'vault') continue;
    out[role] = expandPath(paths[role] ?? ROLE_DEFAULTS[role], WORKSPACE_ROLES.includes(role) ? root : vault);
  }
  for (const [role, value] of Object.entries(paths)) if (!(role in out)) out[role] = expandPath(value, vault);
  return out as Workspace['paths'];
}

export function assembleWorkspace(root: string, source: RootSource, config: CotutorConfig): Workspace {
  return {
    root,
    source,
    config,
    paths: resolvePaths(root, config.paths),
    dirs: {
      agents: join(root, 'agents'),
      ledger: join(root, 'ledger'),
      conversations: join(root, 'conversations'),
      skills: join(root, SKILLS_DIR),
      bundles: join(root, 'bundles'),
      home: join(root, 'home'),
      lectures: join(root, 'lectures'),
    },
    files: {
      config: join(root, CONFIG_FILE),
      artifacts: join(root, 'ledger', 'artifacts.jsonl'),
    },
  };
}

/** 定根 + 读配置 + 校验 + 展开角色。cotutor.json 缺失也是错(它是必需的)。 */
export function loadWorkspace(override?: string, opts: ResolveOptions = {}): Workspace {
  const { root, source } = resolveRoot(override, opts);
  const file = join(root, CONFIG_FILE);
  const raw = readJson(file);
  if (raw === null) throw new ConfigError(file, `不存在。cotutor init <slug> --dir ${redactHome(root)} 可生成模板(已有文件不动)。`);
  return assembleWorkspace(root, source, parseConfig(raw, file));
}

/** --json / 启动日志里回报workspace(脱敏) */
export function workspaceReport(ws: Workspace): Record<string, unknown> {
  return redactDeep({
    workspace: ws.root,
    workspaceSource: ws.source,
    kid: ws.config.kid.slug,
    title: ws.config.title,
    port: ws.config.server.port,
    vault: ws.paths.vault,
    tutors: Object.keys(ws.config.tutors),
    runtime: ws.config.runtimes.default,
  });
}

// ---- cotutor.json 的补丁写回与热重载(从 runtime/journal/store.ts 搬来,2026-10-29) ----

/** PATCH 允许改的顶层键(老师团页与设置页);kid / version / 运行时模板走编辑器 */
export const CONFIG_PATCH_KEYS = ['title', 'policyDefaults', 'tutors', 'agents', 'paths', 'server', 'tts', 'vault', 'live'] as const;

const isPlainObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * 深合并:对象递归、其余覆盖、null 删键(老师条目可整体删:tutors.x = null)。
 * 底下没有这个对象时也要**先剥掉 null 再放**——页面上留空的字段发的就是 null,
 * 直接把补丁原样放进去会写出 `policy: {replyMaxChars: null, …}`,整份过不了契约、一保存就报错
 * (2026-09-11:老师条目本来没有 policy 键时必然撞上,出厂六位都是这样)。
 */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObj(patch)) return patch;
  const out: Record<string, unknown> = isPlainObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete out[k];
      continue;
    }
    const had = k in out;
    const merged = deepMerge(out[k], v);
    // 补丁里一组字段全留空(全是 null)时别凭空造个空对象出来:policy: {contextPack: {}} 这种噪音不该进政策文件
    if (!had && isPlainObj(merged) && !Object.keys(merged).length) continue;
    out[k] = merged;
  }
  return out;
}

/**
 * 补丁合到原始 JSON 上(保留 _note 等机器不认识的键),整份过契约再写;写坏了不落盘。
 * 返回新配置;agents 只允许改 default(运行时模板走编辑器,页面上改错一个引号就把老师全弄哑)。
 */
/** also:除了工作台能改的,这次还放行哪几个顶层键(家长端设置自己拼好补丁,只放 talk 的几项) */
export async function patchConfig(ws: Workspace, patch: Record<string, unknown>, opts: { also?: readonly string[] } = {}): Promise<CotutorConfig> {
  const allowed: readonly string[] = [...CONFIG_PATCH_KEYS, ...(opts.also ?? [])];
  const unknown = Object.keys(patch).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new ConfigError(ws.files.config, `页面只能改 ${CONFIG_PATCH_KEYS.join(' / ')},不认识:${unknown.join(', ')};其余字段请直接编辑文件`);
  if (isPlainObj(patch.agents) && Object.keys(patch.agents).some((k) => k !== 'default')) {
    throw new ConfigError(ws.files.config, 'agents 只能在页面上改 default;运行时模板请直接编辑文件');
  }
  const raw = readJson(ws.files.config);
  if (raw === null) throw new ConfigError(ws.files.config, '不存在');
  const merged = deepMerge(raw, patch);
  const r = CotutorConfigSchema.safeParse(merged);
  if (!r.success) throw new ConfigError(ws.files.config, `补丁应用后不合契约,未写入:\n${explainIssues(r.error.issues).map((l) => `  - ${l}`).join('\n')}`);
  const tmp = `${ws.files.config}.tmp`;
  await writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`);
  await rename(tmp, ws.files.config);
  return r.data;
}

/** 文件改了(页面写的、或家长在编辑器改的)就重读;坏了抛 ConfigError,调用方决定是留旧的还是响 */
export async function reloadIfChanged(ws: Workspace, lastMtime: number): Promise<{ ws: Workspace; mtime: number }> {
  const st = await stat(ws.files.config);
  if (st.mtimeMs === lastMtime) return { ws, mtime: lastMtime };
  const raw = readJson(ws.files.config);
  if (raw === null) throw new ConfigError(ws.files.config, '不存在了');
  return { ws: assembleWorkspace(ws.root, ws.source, parseConfig(raw, ws.files.config)), mtime: st.mtimeMs };
}
