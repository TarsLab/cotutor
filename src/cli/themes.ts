/**
 * 主题(themes/<name>/theme.json + kid.css):孩子端板书的样子。样子的真相在主题里,不在卡的协议里(《卡片重设计评估.md》§七)。
 * 出厂主题 default 在包根 themes/default/;init **拷贝**进 workspace 的 themes/default/(拷进来就是家长的,改了刷新就有),
 * 目录 hash 记 .cotutor/shipped.json 的 themes,与老师文件 / skill 同一套:没改过的随 cotutor upgrade 换新,改过的报 diff 保留。
 * 自家的主题(cotutor add-theme <name> 拷一份 default 来改,或直接建目录)永远 untracked,upgrade 不碰。
 */
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_CSS_FILE, THEME_MANIFEST_FILE, THEME_NAME_RE, THEMES_DIR, ThemeManifestSchema, explainIssues, type ThemeManifest } from '../schema/index.ts';
import { PACKAGE_VERSION } from './skeleton.ts';
import { dirHash } from './skills.ts';
import { readManifest, writeManifest, type ShippedManifest } from './tutors.ts';
import { UsageError } from './workspace.ts';

/** 本包自带的主题目录(仓库检出与 npm 安装都在包根 themes/) */
export const PACKAGE_THEMES_DIR = fileURLToPath(new URL('../../themes/', import.meta.url));
export const SHIPPED_THEMES = ['default'] as const;

export function themeDir(root: string, name: string): string {
  return join(root, THEMES_DIR, name);
}

export class ThemeError extends UsageError {
  readonly dir: string;
  constructor(dir: string, message: string) {
    super(message);
    this.name = 'ThemeError';
    this.dir = dir;
  }
}

export interface LoadedTheme {
  name: string;
  dir: string;
  manifest: ThemeManifest;
  css: string;
}

/** 读一个主题目录:清单过契约、css 在;坏了抛 ThemeError(消息就是修复指南) */
export async function readTheme(dir: string): Promise<LoadedTheme> {
  const mf = join(dir, THEME_MANIFEST_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(mf, 'utf8'));
  } catch (err) {
    throw new ThemeError(dir, `${mf} 读不到或不是 JSON:${err instanceof Error ? err.message : String(err)}`);
  }
  const r = ThemeManifestSchema.safeParse(raw);
  if (!r.success) throw new ThemeError(dir, `${mf} 不合契约:\n${explainIssues(r.error.issues)}`);
  let css: string;
  try {
    css = await readFile(join(dir, THEME_CSS_FILE), 'utf8');
  } catch {
    throw new ThemeError(dir, `${join(dir, THEME_CSS_FILE)} 不在(主题的样式文件)`);
  }
  return { name: r.data.name, dir, manifest: r.data, css };
}

/** 出厂主题(包里那份);包坏了是开发错误,直接抛 */
export function packageTheme(name = 'default'): Promise<LoadedTheme> {
  return readTheme(join(PACKAGE_THEMES_DIR, name));
}

export type ThemeState = 'latest' | 'upgradable' | 'custom' | 'untracked' | 'missing';

export interface ThemeStatus {
  name: string;
  state: ThemeState;
  dir: string;
  basedOn?: string;
  /** 出厂件与否(自家加的主题 upgrade 不碰) */
  shipped: boolean;
}

async function readState(root: string, name: string, manifest: ShippedManifest): Promise<ThemeStatus> {
  const dir = themeDir(root, name);
  const shipped = (SHIPPED_THEMES as readonly string[]).includes(name);
  const st = await lstat(dir).catch(() => null);
  if (!st?.isDirectory()) return { name, state: 'missing', dir, shipped };
  if (!shipped) return { name, state: 'untracked', dir, shipped };
  const rec = manifest.themes?.[name];
  const mine = await dirHash(dir);
  const factory = await dirHash(join(PACKAGE_THEMES_DIR, name)).catch(() => null);
  if (factory && mine === factory) return { name, state: 'latest', dir, basedOn: rec?.version, shipped };
  if (rec && rec.hash === mine) return { name, state: 'upgradable', dir, basedOn: rec.version, shipped };
  return { name, state: rec ? 'custom' : 'untracked', dir, basedOn: rec?.version, shipped };
}

/** workspace 里所有主题的状态:出厂的 + themes/ 下自家建的 */
export async function themeStatuses(root: string): Promise<ThemeStatus[]> {
  const manifest = await readManifest(root);
  const names = new Set<string>(SHIPPED_THEMES);
  for (const e of await readdir(join(root, THEMES_DIR), { withFileTypes: true }).catch(() => [])) if (e.isDirectory() && THEME_NAME_RE.test(e.name)) names.add(e.name);
  const out: ThemeStatus[] = [];
  for (const name of [...names].sort()) out.push(await readState(root, name, manifest));
  return out;
}

async function installOne(root: string, name: string, manifest: ShippedManifest): Promise<void> {
  const dir = themeDir(root, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await cp(join(PACKAGE_THEMES_DIR, name), dir, { recursive: true });
  manifest.themes ??= {};
  manifest.themes[name] = { hash: await dirHash(dir), version: PACKAGE_VERSION };
}

export interface ThemeStep {
  item: string;
  action: 'created' | 'exists' | 'kept';
  note?: string;
}

/** init 用:缺的拷,有的不动 */
export async function installThemes(root: string): Promise<ThemeStep[]> {
  const steps: ThemeStep[] = [];
  const manifest = await readManifest(root);
  let touched = false;
  for (const name of SHIPPED_THEMES) {
    const s = await readState(root, name, manifest);
    const item = `${THEMES_DIR}/${name}/`;
    if (s.state === 'missing') {
      await installOne(root, name, manifest);
      touched = true;
      steps.push({ item, action: 'created', note: '孩子端的主题(theme.json 槽的清单 + kid.css 样式),拷自本包,改了刷新就有' });
    } else steps.push({ item, action: 'exists', note: s.state === 'custom' ? `自定义(基于 ${s.basedOn})` : s.state === 'upgradable' ? '可升级(cotutor upgrade)' : s.state === 'untracked' ? '已有(没有出厂记录);升级时当自定义对待' : undefined });
  }
  if (touched) await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  return steps;
}

export interface ThemeUpgradeStep {
  name: string;
  action: 'upgraded' | 'latest' | 'kept-custom' | 'installed';
  basedOn?: string;
}

/** upgrade 用:latest 跳过;upgradable 换新;custom / untracked 保留只报;缺的补 */
export async function upgradeThemes(root: string): Promise<ThemeUpgradeStep[]> {
  const manifest = await readManifest(root);
  const steps: ThemeUpgradeStep[] = [];
  for (const name of SHIPPED_THEMES) {
    const s = await readState(root, name, manifest);
    if (s.state === 'latest') steps.push({ name, action: 'latest', basedOn: s.basedOn });
    else if (s.state === 'missing') {
      await installOne(root, name, manifest);
      steps.push({ name, action: 'installed' });
    } else if (s.state === 'upgradable') {
      await installOne(root, name, manifest);
      steps.push({ name, action: 'upgraded', basedOn: s.basedOn });
    } else steps.push({ name, action: 'kept-custom', basedOn: s.basedOn });
  }
  await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  return steps;
}

export interface AddThemeResult {
  name: string;
  dir: string;
  from: string;
}

/** cotutor add-theme <name> [--from <主题>]:拷一份(缺省 default)来改;清单里的 name 改成新名 */
export async function addTheme(root: string, name: string, from = 'default'): Promise<AddThemeResult> {
  if (!THEME_NAME_RE.test(name)) throw new UsageError(`主题名只能是小写字母、数字、连字符:${name}`);
  const dir = themeDir(root, name);
  if (await lstat(dir).catch(() => null)) throw new UsageError(`${dir} 已经在了`);
  const srcDir = (await lstat(themeDir(root, from)).catch(() => null))?.isDirectory() ? themeDir(root, from) : join(PACKAGE_THEMES_DIR, from);
  const src = await readTheme(srcDir);
  await mkdir(dir, { recursive: true });
  await cp(srcDir, dir, { recursive: true });
  const raw = JSON.parse(await readFile(join(dir, THEME_MANIFEST_FILE), 'utf8')) as Record<string, unknown>;
  await writeFile(join(dir, THEME_MANIFEST_FILE), `${JSON.stringify({ ...raw, name }, null, 2)}\n`);
  return { name, dir, from: src.name };
}
