/**
 * cotutor init <slug>:建 ~/cotutor/<slug>/ 骨架,vault 建在旁边的 ~/cotutor/<slug>-vault/(--vault 另指;2026-11-09 起两边分开)。语义是**幂等补缺**——已有的文件与目录一律不动,缺什么补什么。
 * 三条边界(沿 drawtell init):政策文件只在缺失时写模板;用户配置只在还没指定 workspace 时补;不动 git。
 * 老师文件**拷贝**进 agents/<name>.md:拷进来就是家长的,想改就改;出厂 hash 记 .cotutor/shipped.json,
 * cotutor refresh 据此换新或报 diff。老布局(.claude/agents、.claude/skills)先原样挪到新位置(migrate.ts 的 migrateLayout)。
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { DIRS, GITIGNORE, LEDGER_FILES, REFERENCE_README, configTemplate, profileTemplate, shippedAgents, writeSchemaFile } from './skeleton.ts';
import { installTutors, readManifest, writeManifest } from './tutors.ts';
import { DEFAULT_GRADE, LEGACY_GRADE, requireGradePack } from './grades.ts';
import { schoolStartFor } from '../../memory/vault-notes.ts';
import { installActivities } from './activities.ts';
import { installSkills, linkClaudeSkills } from './skills.ts';
import { migrateLayout } from './migrate.ts';
import { choiceNote, choosePort, knownPorts } from './port.ts';
import { installThemes } from './themes.ts';
import { scanVault } from '../../memory/vault.ts';
import { CONFIG_FILE, ConfigError, UsageError, HOME_ROOT, USER_CONFIG, defaultVaultOf, expandPath, homePath, isInside, knownWorkspaces, loadWorkspace, parseConfig, readJson, redactHome, vaultSeparate } from '../workspace.ts';

export interface InitStep {
  item: string;
  action: 'created' | 'exists' | 'kept' | 'replaced' | 'removed' | 'moved';
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
  /** vault 放哪(家长已有的 Obsidian 库);缺省 workspace 旁边的 <目录名>-vault。只在新建 cotutor.json 时用 */
  vault?: string;
  name?: string;
  port?: number;
  /** 出厂教学包年级,不是孩子档案的覆盖值。 */
  grade?: number;
  /** 测试:算学期用的今天 */
  now?: Date;
}

async function exists(p: string): Promise<boolean> {
  return (await stat(p).catch(() => null)) !== null;
}

/** 新建时 vault 能不能放那:和 workspace 谁也不在谁里面,不是别的孩子的 workspace,不和别的孩子共用(一孩一 vault)。报错里 workspace 说「cotutor 文件夹」、vault 说「笔记文件夹」(docs/词表.md) */
async function checkVaultPlace(root: string, vault: string): Promise<void> {
  if (isInside(vault, root)) throw new UsageError(`笔记文件夹(vault)不能放在孩子的 cotutor 文件夹里(${redactHome(vault)}):笔记是家长的,cotutor 文件夹是程序的运行记录,两边分开放。换个 --vault,缺省是旁边的 ${basename(defaultVaultOf(root))}`);
  if (isInside(root, vault)) throw new UsageError(`孩子的 cotutor 文件夹不能放在笔记文件夹(vault)里面(${redactHome(root)} 在 ${redactHome(vault)} 里):两边分开放,换个 --dir 或 --vault`);
  const st = await stat(vault).catch(() => null);
  if (st && !st.isDirectory()) throw new UsageError(`笔记文件夹(vault)要是一个目录,${redactHome(vault)} 是文件;换个 --vault`);
  if (await exists(join(vault, CONFIG_FILE))) throw new UsageError(`${redactHome(vault)} 是一个孩子的 cotutor 文件夹(有 ${CONFIG_FILE}),不能当笔记文件夹;换个 --vault`);
  for (const other of knownWorkspaces()) {
    if (other === root) continue;
    if (isInside(vault, other) || isInside(other, vault)) throw new UsageError(`${redactHome(vault)} 和 ${redactHome(other)}(别的孩子的 cotutor 文件夹)叠在一起了,不能当笔记文件夹;换个 --vault`);
    let theirs: string;
    try {
      theirs = loadWorkspace(other).paths.vault;
    } catch {
      continue; // 那边配置坏了,doctor 去报
    }
    if (isInside(root, theirs)) throw new UsageError(`${redactHome(root)} 在 ${redactHome(other)} 的笔记文件夹里,不能在这里建 cotutor 文件夹;换个短名或 --dir`);
    if (isInside(vault, theirs) || isInside(theirs, vault)) throw new UsageError(`${redactHome(vault)} 和 ${redactHome(other)} 的笔记文件夹(${redactHome(theirs)})重了:一个孩子一个笔记文件夹,换个 --vault`);
  }
}

export async function initWorkspace(opts: InitOptions): Promise<InitResult> {
  const root = opts.dir ? expandPath(opts.dir, resolve(process.cwd())) : join(HOME_ROOT, opts.slug);
  const steps: InitStep[] = [];
  const manifest = await readManifest(root);
  const installed = manifest.teachingPack?.grade;
  const existing = await exists(join(root, CONFIG_FILE));
  const grade = opts.grade ?? installed ?? (existing ? LEGACY_GRADE : DEFAULT_GRADE);
  const pack = await requireGradePack(grade);
  if (existing && grade !== (installed ?? LEGACY_GRADE)) throw new UsageError('init 只补缺,不能切换已有 workspace 的年级包;请另建 workspace,原有自定义文件和话题保持不动。');
  if (installed !== undefined && installed !== grade) throw new UsageError(`已安装 ${installed} 年级包,init 不切换年级`);
  const agents = await shippedAgents(pack.agentsDir);
  // vault 只在新建 cotutor.json 时定(写进 paths.vault),以后 init 不改向;已有的再给 --vault,对不上就报错,不悄悄换
  const vaultArg = opts.vault ? resolve(expandPath(opts.vault, resolve(process.cwd()))) : undefined; // resolve 去掉末尾的 /,好比较
  let newVault: string | undefined;
  if (!existing) {
    newVault = vaultArg ?? defaultVaultOf(root);
    await checkVaultPlace(root, newVault);
  } else if (vaultArg) {
    const now = loadWorkspace(root).paths.vault;
    if (resolve(now) !== vaultArg) throw new UsageError(`已有 ${CONFIG_FILE},笔记文件夹(vault)在 ${redactHome(now)};init 只补缺,不换笔记文件夹。要换先把里面的笔记挪过去,再改 ${CONFIG_FILE} 的 paths.vault`);
  }

  const rootExisted = await exists(root);
  if (!rootExisted) await mkdir(root, { recursive: true });
  manifest.teachingPack = { grade };
  await writeManifest(root, manifest);
  steps.push({ item: 'teachingPack', action: installed === undefined ? 'created' : 'exists', note: `${grade} 年级教学包${existing && installed === undefined ? '(旧版来源补记,保留原 hash)' : opts.grade === undefined && installed === undefined ? '(默认)' : ''};孩子当前年级仍读档案` });
  steps.push({ item: '.', action: rootExisted ? 'exists' : 'created' });
  // 老布局先搬,再补缺:不然出厂件先占了新位置,家长改过的那份晾在老位置
  steps.push(...(await migrateLayout(root)));

  for (const dir of DIRS) {
    const p = join(root, dir);
    if (await exists(p)) {
      steps.push({ item: `${dir}/`, action: 'exists' });
      continue;
    }
    await mkdir(p, { recursive: true });
    steps.push({ item: `${dir}/`, action: 'created' });
  }

  const config = join(root, CONFIG_FILE);
  if (await exists(config)) steps.push({ item: CONFIG_FILE, action: 'kept', note: '政策文件不覆盖(家长的决定)' });
  else {
    // 端口只在这里选一次,写进文件以后不变(port.ts);--port 给了就听它的
    const chosen = opts.port === undefined ? await choosePort(knownPorts()) : null;
    await writeFile(config, configTemplate({ slug: opts.slug, name: opts.name, port: opts.port ?? chosen?.port, vault: newVault && homePath(newVault), tutors: agents }));
    steps.push({ item: CONFIG_FILE, action: 'created', ...(chosen ? { note: choiceNote(chosen) } : {}) });
  }
  // 老师按 cotutor.json 里有谁走(家长自己加的也补目录与链);配置坏了就只管出厂的,doctor 去报
  let tutorNames: string[] = [];
  try {
    const raw = readJson(config);
    if (raw !== null) tutorNames = Object.keys(parseConfig(raw, config).tutors);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
  }
  steps.push(...(await installTutors(root, tutorNames)));
  // 出厂 activity(老师的家里 agents/<老师>/activities/):缺的拷,有的不动
  steps.push(...(await installActivities(root)));
  const schemaThere = await exists(join(root, '.cotutor', 'cotutor.schema.json'));
  await writeSchemaFile(root);
  steps.push({ item: '.cotutor/cotutor.schema.json', action: schemaThere ? 'exists' : 'created', note: schemaThere ? '已按本包刷新(机器文件)' : 'cotutor.json 的 JSON Schema,编辑器补全用' });
  // 出厂 skill(机器件 cotutor-board 等 + 做课包的四个 chalk-*)
  steps.push(...(await installSkills(root)));
  steps.push(await linkClaudeSkills(root));
  // 出厂主题(孩子端板书的样子):拷进 themes/default/,是家长的
  steps.push(...(await installThemes(root)));

  for (const f of LEDGER_FILES) {
    const p = join(root, f);
    if (await exists(p)) steps.push({ item: f, action: 'exists' });
    else {
      await writeFile(p, '');
      steps.push({ item: f, action: 'created' });
    }
  }

  // vault 侧(《obsidian仓库设计.md》§2):只补档案与参考 README,缺了才写;档案按 cotutor: profile 找(2026-09-17),vault 里已有一篇就不补;
  // 入口文件(每科每学期一篇)不自动建,doctor 提醒;日记由记账现建,计划家长自己写
  let vaultAt: string | null = null;
  try {
    const ws = loadWorkspace(root);
    vaultAt = ws.paths.vault;
    if (!vaultSeparate(root, vaultAt)) steps.push({ item: 'vault', action: 'kept', note: '笔记文件夹(vault)在 cotutor 文件夹里(旧版 init 的布局),照旧能用;要分开看 cotutor doctor 的 vault.separate' });
    else {
      const there = await exists(vaultAt);
      if (!there) await mkdir(vaultAt, { recursive: true });
      steps.push({ item: redactHome(vaultAt), action: there ? 'exists' : 'created', note: '笔记文件夹:档案、日记、老师的记忆,都是普通 markdown' });
    }
    const profile = ws.paths.profile;
    const found = (await scanVault(ws)).notes.find((n) => n.props.cotutor === 'profile');
    if (found) steps.push({ item: redactHome(join(ws.paths.vault, found.path)), action: 'exists' });
    else if (await exists(profile)) steps.push({ item: redactHome(profile), action: 'kept', note: '没有 cotutor: profile 属性,老师读不到;在 frontmatter 加上(cotutor doctor 有写法)' });
    else {
      await mkdir(dirname(profile), { recursive: true });
      // 给了年级就算好读一年级的年月,老师第一天就知道是几年级哪个学期;没给就不猜(教学包的缺省年级不等于孩子的年级)
      const start = opts.grade === undefined ? undefined : schoolStartFor(opts.grade, opts.now ?? new Date());
      await writeFile(profile, profileTemplate(ws.config.kid.name ?? ws.config.kid.slug, start));
      steps.push({ item: redactHome(profile), action: 'created', note: start ? `档案:按 ${opts.grade} 年级算,读一年级是 ${start};孩子的情况写在正文,每个话题开头整篇进上下文包` : '档案:填 school_start 与孩子的情况,每个话题开头整篇进上下文包' });
    }
    const readme = join(ws.paths.reference, 'README.md');
    if (await exists(readme)) steps.push({ item: redactHome(readme), action: 'exists' });
    else {
      await mkdir(ws.paths.reference, { recursive: true });
      await writeFile(readme, REFERENCE_README);
      steps.push({ item: redactHome(readme), action: 'created' });
    }
  } catch {
    /* 配置读不了(doctor 去体检):vault 侧不动 */
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
        ? { item: 'user-config', action: 'exists', note: '已指向本workspace' }
        : { item: 'user-config', action: 'kept', note: '已指向别的workspace,未改;多孩子时一 workspace 一进程,用 --workspace / COTUTOR_WORKSPACE 指定' },
    );
  } else {
    await mkdir(dirname(USER_CONFIG), { recursive: true });
    await writeFile(USER_CONFIG, `${JSON.stringify({ ...(user ?? {}), workspace: root }, null, 2)}\n`);
    steps.push({ item: 'user-config', action: 'created', note: 'workspace 指向本workspace' });
  }

  const suggestions: string[] = [];
  if (!(await exists(join(root, '.git')))) suggestions.push('git init(建议:老师记忆、账本、政策都是不可再生状态,git 是破坏后的兜底)');
  if (opts.grade === undefined) suggestions.push('档案里填 school_start(读一年级的年月,如 2025-09),老师才知道现在是几年级哪个学期');
  if (vaultAt && vaultSeparate(root, vaultAt)) suggestions.push(`孩子的档案、日记、老师的记忆在笔记文件夹(${redactHome(vaultAt)}):普通 markdown,不用装 Obsidian;想用 Obsidian 看,就把这个目录当库打开`);
  suggestions.push('cotutor service install 装成后台服务(登录后自己起来、关了终端照样跑;在终端里调试用 cotutor serve),第一次装会打开家长端(以后 cotutor open),在「首页」填百炼的按量 API Key 与业务空间 ID(老师的嘴和脑都用它;没填孩子端只出「老师们还没到」)');
  suggestions.push('在平板、手机上用:cotutor cert 签证书(要 mkcert),根证书装到设备上并打开信任,iPad / iPhone 的步骤见 README 里的《iPad 与 iPhone》');
  suggestions.push('可选:点读、单词卡的配音用百炼(和老师的嘴同一把 key),到家长端首页点老师的「样子与声音」挑声音;cotutor pin 给家长端与工作台加锁');
  suggestions.push('cotutor doctor 逐项体检');
  return { root, steps, suggestions };
}
