/**
 * cotutor init <slug>:建 ~/cotutor/<slug>/ 骨架。语义是**幂等补缺**——已有的文件与目录一律不动,缺什么补什么。
 * 三条边界(沿 drawtell init):政策文件只在缺失时写模板;用户配置只在还没指定 workspace 时补;不动 git。
 * 老师定义**拷贝**进 .claude/agents/(2026-09-09 拍板,原来是链):拷进来就是家长的,想改就改;出厂 hash 记 .cotutor/shipped.json,
 * cotutor upgrade 据此换新或报 diff。旧工作区里指向包的链会被换成拷贝。.qwen/agents/ 是指向 .claude/agents/ 的相对链。
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DIRS, GITIGNORE, LEDGER_FILES, RULES, configTemplate, shippedAgents } from './skeleton.ts';
import { installTeachers } from './teachers.ts';
import { CONFIG_FILE, HOME_ROOT, USER_CONFIG, expandPath } from './workspace.ts';

export interface InitStep {
  item: string;
  action: 'created' | 'exists' | 'kept' | 'replaced';
  note?: string;
}

export interface InitResult {
  root: string;
  steps: InitStep[];
  suggestions: string[];
}

export interface InitOptions {
  slug: string;
  dir?: string;
  name?: string;
  port?: number;
}

async function exists(p: string): Promise<boolean> {
  return (await stat(p).catch(() => null)) !== null;
}

export async function initWorkspace(opts: InitOptions): Promise<InitResult> {
  const root = opts.dir ? expandPath(opts.dir, resolve(process.cwd())) : join(HOME_ROOT, opts.slug);
  const steps: InitStep[] = [];
  const agents = await shippedAgents();

  const rootExisted = await exists(root);
  if (!rootExisted) await mkdir(root, { recursive: true });
  steps.push({ item: '.', action: rootExisted ? 'exists' : 'created' });

  for (const dir of DIRS) {
    const p = join(root, dir);
    if (await exists(p)) {
      steps.push({ item: `${dir}/`, action: 'exists' });
      continue;
    }
    await mkdir(p, { recursive: true });
    steps.push({ item: `${dir}/`, action: 'created' });
  }

  for (const a of agents) {
    const home = join(root, 'agents', a.name);
    if (await exists(home)) {
      steps.push({ item: `agents/${a.name}/`, action: 'exists' });
    } else {
      await mkdir(home, { recursive: true });
      await writeFile(join(home, '.gitkeep'), '');
      steps.push({ item: `agents/${a.name}/`, action: 'created' });
    }
  }
  steps.push(...(await installTeachers(root)));

  for (const f of LEDGER_FILES) {
    const p = join(root, f);
    if (await exists(p)) steps.push({ item: f, action: 'exists' });
    else {
      await writeFile(p, '');
      steps.push({ item: f, action: 'created' });
    }
  }

  const config = join(root, CONFIG_FILE);
  if (await exists(config)) steps.push({ item: CONFIG_FILE, action: 'kept', note: '政策文件不覆盖(家长的决定)' });
  else {
    await writeFile(config, configTemplate({ slug: opts.slug, name: opts.name, port: opts.port, teachers: agents }));
    steps.push({ item: CONFIG_FILE, action: 'created' });
  }

  for (const f of ['CLAUDE.md', 'QWEN.md']) {
    const p = join(root, f);
    if (await exists(p)) steps.push({ item: f, action: 'kept', note: '家规已有,不覆盖' });
    else {
      await writeFile(p, RULES);
      steps.push({ item: f, action: 'created' });
    }
  }

  const gitignore = join(root, '.gitignore');
  if (await exists(gitignore)) steps.push({ item: '.gitignore', action: 'kept' });
  else {
    await writeFile(gitignore, GITIGNORE);
    steps.push({ item: '.gitignore', action: 'created' });
  }

  // 用户配置:补缺不改向;解析不了也不动(doctor 去体检)
  let user: Record<string, unknown> | null = null;
  let userBroken = false;
  try {
    user = JSON.parse(await readFile(USER_CONFIG, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    userBroken = (err as NodeJS.ErrnoException).code !== 'ENOENT';
  }
  const configured = user && typeof user.workspace === 'string' && user.workspace ? user.workspace : null;
  if (userBroken) steps.push({ item: 'user-config', action: 'kept', note: '解析失败,未动(cotutor doctor 可体检)' });
  else if (configured) {
    steps.push(
      expandPath(configured, root) === root
        ? { item: 'user-config', action: 'exists', note: '已指向本工作区' }
        : { item: 'user-config', action: 'kept', note: '已指向别的工作区,未改;多孩子时一 workspace 一进程,用 --workspace / COTUTOR_WORKSPACE 指定' },
    );
  } else {
    await mkdir(dirname(USER_CONFIG), { recursive: true });
    await writeFile(USER_CONFIG, `${JSON.stringify({ ...(user ?? {}), workspace: root }, null, 2)}\n`);
    steps.push({ item: 'user-config', action: 'created', note: 'workspace 指向本工作区' });
  }

  const suggestions: string[] = [];
  if (!(await exists(join(root, '.git')))) suggestions.push('git init(建议:老师记忆、账本、政策都是不可再生状态,git 是破坏后的兜底)');
  suggestions.push(`改 ${CONFIG_FILE}:paths.vault 指到孩子的 Obsidian vault,teachers.*.voice 填 voxtell 音色 id`);
  suggestions.push('cotutor doctor 逐项体检;cotutor serve 起服务');
  return { root, steps, suggestions };
}
