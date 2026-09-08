/**
 * 工作区解析:一孩一 workspace(`~/cotutor/<slug>/`,2026-09-08 拍板)。
 * 解析链(定根):`--workspace <dir>` → 环境变量 COTUTOR_WORKSPACE → cwd 或其祖先有 cotutor.json
 * (老师的 cwd 是 <ws>/agents/<name>/,从那里跑 doctor 也要找得到根)→ 用户配置
 * ~/.config/cotutor/config.json 的 workspace → ~/cotutor/ 下**唯一**的一个孩子目录 → 都没有就报错附修复指南。
 * 没有"cwd 兜底":cotutor.json 是必需的政策文件(老师表在里面),没有它什么都跑不了。
 * 配置"在但解析不了"响亮报错,不静默走缺省(沿 drawtell 的教训)。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  CotutorConfigSchema,
  PATH_ROLES,
  ROLE_DEFAULTS,
  explainIssues,
  type CotutorConfig,
  type PathRole,
} from '../schema/index.ts';

/** 用法错误:main 捕获后 exit 2,错误信息即修复指南。 */
export class UsageError extends Error {}

/** 配置文件损坏或形状不对:文件在,但用不了。 */
export class ConfigError extends UsageError {
  readonly file: string;
  constructor(file: string, cause: string) {
    super(`配置文件用不了:${redactHome(file)}\n${cause}\n修好它;文件在 git 里就 git diff 看改动、git checkout 回退。cotutor doctor 可逐项体检。`);
    this.file = file;
  }
}

export const CONFIG_FILE = 'cotutor.json';
export const USER_CONFIG = join(homedir(), '.config', 'cotutor', 'config.json');
export const HOME_ROOT = join(homedir(), 'cotutor');

export type RootSource = 'flag' | 'env' | 'cwd' | 'user-config' | 'home-single';

export interface ResolvedRoot {
  root: string;
  source: RootSource;
}

export function expandPath(p: string, base: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(base, p);
}

export function redactHome(value: string): string {
  const home = homedir();
  return home && value.startsWith(home) ? '$HOME' + value.slice(home.length) : value;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactHome(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
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

export interface Workspace {
  root: string;
  source: RootSource;
  config: CotutorConfig;
  /** 角色 → 绝对路径;vault 侧角色相对 vault 解析,没配 vault 就相对 workspace 根 */
  paths: Record<PathRole, string> & Record<string, string>;
  dirs: {
    agents: string;
    ledger: string;
    conversations: string;
    claudeAgents: string;
    qwenAgents: string;
  };
  files: {
    config: string;
    observations: string;
    artifacts: string;
    rulesClaude: string;
    rulesQwen: string;
  };
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
    out[role] = expandPath(paths[role] ?? ROLE_DEFAULTS[role], vault);
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
      claudeAgents: join(root, '.claude', 'agents'),
      qwenAgents: join(root, '.qwen', 'agents'),
    },
    files: {
      config: join(root, CONFIG_FILE),
      observations: join(root, 'ledger', 'observations.jsonl'),
      artifacts: join(root, 'ledger', 'artifacts.jsonl'),
      rulesClaude: join(root, 'CLAUDE.md'),
      rulesQwen: join(root, 'QWEN.md'),
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

/** --json / 启动日志里回报工作区(脱敏) */
export function workspaceReport(ws: Workspace): Record<string, unknown> {
  return redactDeep({
    workspace: ws.root,
    workspaceSource: ws.source,
    kid: ws.config.kid.slug,
    title: ws.config.title,
    port: ws.config.server.port,
    vault: ws.paths.vault,
    teachers: Object.keys(ws.config.teachers),
    agent: ws.config.agents.default,
  });
}
