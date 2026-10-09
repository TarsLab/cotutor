/**
 * 老 workspace 的配置迁移。
 *
 * cotutor.json 是**政策文件**:init 只在缺失时写模板,已有的那份机器永不改(家长的决定不由机器替她拍板)。
 * 代价是包更新带来的新出厂件不会自己出现在老 workspace 里,而且「没有」的表现是**静默**的——
 * 2026-09-10 板书那一期加了 scene-maker(画图老师)、claude-scene / qwen-scene 运行时、
 * claude 模板的 `--disallowedTools Agent` 与 `--include-partial-messages`;老 workspace 缺了它们的表现是
 * 「画图老师不存在」「场景作业起不来」「老师自己派子代理烧预算」「回复整块出不流式」,没有一条会报错。
 *
 * 所以有这一层:把「出厂模板有、你这份没有」算出来(doctor 的 `config.migrate` 点名、家长端设置页顶部提示),
 * `cotutor upgrade --config` 只**补缺**——加缺的键、往命令模板里插缺的旗标;家长写过的值一个都不动
 * (改小的预算、加过的 `--model sonnet`、换掉的 default 运行时全都原样留着)。
 *
 * 差异是**现算的**:拿家长自己的 slug / name / port 生成一份出厂模板,和她这份逐项比,
 * 所以以后模板再加东西,这里不用跟着改。
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CotutorConfigSchema, explainIssues } from '../schema/index.ts';
import { CLAUDE_TUTOR_TOOLS } from '../clis/claude.ts';
import { isRetiredRuntime } from '../clis/index.ts';
import { configTemplate, shippedAgents } from './skeleton.ts';
import { installTutors, type InstallStep } from './tutors.ts';
import { RENAMED_TUTORS, renameTutorData, renamedEntry, type RenameOp } from './rename.ts';
import { CONFIG_FILE, ConfigError, readJson, resolvePaths } from './workspace.ts';

/** rename:出厂老师改了键名(rename.ts),值原样搬到新键下,连带文件与目录 */
export type GapKind = 'tutor' | 'rename' | 'runtime' | 'flag' | 'policy' | 'cards';

export interface ConfigGap {
  kind: GapKind;
  /** 点位:tutors.koubo-tutor / runtimes.qwen / runtimes.claude.run */
  path: string;
  /** 人话:缺的是什么、补上有什么用 */
  detail: string;
  /** 补上之后这个点位的值(--dry-run 打印、页面提示用) */
  value: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** 命令模板里一个旗标带几个词:`--disallowedTools Agent` 是两个,`--verbose` 是一个(值不以 - 打头) */
function flagSpan(argv: readonly string[], i: number): string[] {
  const span = [argv[i] as string];
  for (let j = i + 1; j < argv.length && !(argv[j] as string).startsWith('-'); j++) span.push(argv[j] as string);
  return span;
}

/**
 * 把出厂模板里有、这份没有的旗标插进来,**位置照出厂模板**:
 * 插到「出厂模板里排在它前面、这份也有」的那个旗标之后;一个都找不到就放末尾。
 * 已经有的旗标一律不碰——值被家长改过(预算 2 → 5)是她的决定。
 */
export function insertMissingFlags(mine: readonly string[], factory: readonly string[]): { argv: string[]; added: string[] } {
  const argv = [...mine];
  const added: string[] = [];
  for (let i = 0; i < factory.length; i++) {
    const tok = factory[i] as string;
    if (!tok.startsWith('-') || argv.includes(tok)) continue;
    const span = flagSpan(factory, i);
    let at = argv.length;
    for (let j = i - 1; j >= 0; j--) {
      const prev = factory[j] as string;
      if (!prev.startsWith('-')) continue;
      const k = argv.indexOf(prev);
      if (k === -1) continue;
      at = k + flagSpan(argv, k).length;
      break;
    }
    argv.splice(at, 0, ...span);
    added.push(...span);
  }
  return { argv, added };
}

/** 出厂模板:拿这份配置自己的 slug / name / port 生成,免得差异里混进「孩子叫什么」这种无关项 */
async function factoryConfig(raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  const kid = isObj(raw.kid) ? raw.kid : {};
  const server = isObj(raw.server) ? raw.server : {};
  return JSON.parse(
    configTemplate({
      slug: typeof kid.slug === 'string' ? kid.slug : 'kid',
      name: typeof kid.name === 'string' ? kid.name : undefined,
      port: typeof server.port === 'number' ? server.port : undefined,
      tutors: await shippedAgents(),
    }),
  ) as Record<string, unknown>;
}

/**
 * 这份 cotutor.json 比出厂模板少了什么。只看「有没有」,不看值——值是家长的。
 * 注意:出厂老师是家长手动从 tutors 里删掉的(页面删不了出厂老师),这里也会当成缺,
 * 所以 `--dry-run` 先列、doctor 那条不是必需项。
 */
export async function configGaps(raw: unknown): Promise<ConfigGap[]> {
  if (!isObj(raw)) return [];
  const factory = await factoryConfig(raw);
  const gaps: ConfigGap[] = [];

  const mineTutors = isObj(raw.tutors) ? raw.tutors : {};
  const factoryTutors = isObj(factory.tutors) ? factory.tutors : {};
  const renamedTo = new Set<string>();
  for (const r of RENAMED_TUTORS) {
    const mine = mineTutors[r.from];
    if (!isObj(mine) || r.to in mineTutors || !isObj(factoryTutors[r.to])) continue;
    renamedTo.add(r.to);
    gaps.push({ kind: 'rename', path: `tutors.${r.from}`, detail: `出厂老师改名 ${r.from} → ${r.to}:设置、老师文件、对话、记忆笔记、首页一起挪(要先停服务,终端里跑 cotutor upgrade --config)`, value: renamedEntry(mine, r, factoryTutors[r.to] as Record<string, unknown>) });
  }
  for (const [name, entry] of Object.entries(factoryTutors)) {
    if (name in mineTutors || renamedTo.has(name)) continue;
    const display = isObj(entry) && typeof entry.display === 'string' ? entry.display : name;
    gaps.push({ kind: 'tutor', path: `tutors.${name}`, detail: `出厂老师 ${display}(${name})不在 tutors 里`, value: entry });
  }
  // 卡的清单(2026-10-07,《卡片协议.md》「谁拿到哪些卡」):出厂老师有、你这份没写 → 补出厂的;不想裁就写全部种类,这条就不再提
  for (const [name, entry] of Object.entries(factoryTutors)) {
    const mine = mineTutors[name];
    if (!isObj(mine) || 'cards' in mine || !isObj(entry) || !Array.isArray(entry.cards)) continue;
    gaps.push({ kind: 'cards', path: `tutors.${name}.cards`, detail: `${name} 没写卡的清单,板书写法里讲全部卡;出厂清单 ${(entry.cards as string[]).join(' ')}`, value: entry.cards });
  }

  const mineRuntimes = isObj(raw.runtimes) ? raw.runtimes : {};
  const factoryRuntimes = isObj(factory.runtimes) ? factory.runtimes : {};
  for (const [name, rt] of Object.entries(factoryRuntimes)) {
    if (name === 'default' || name in mineRuntimes) continue;
    gaps.push({ kind: 'runtime', path: `runtimes.${name}`, detail: `出厂运行时 ${name} 不在 runtimes 里`, value: rt });
  }
  for (const [name, rt] of Object.entries(factoryRuntimes)) {
    if (name === 'default' || !isObj(rt)) continue;
    const mine = mineRuntimes[name];
    if (!isObj(mine)) continue; // 整个运行时都缺,上面那轮已经报了
    // 没人改过的旧出厂模板(和某一版出厂的一字不差):整份换新——换模型、换说话方式都靠这一条
    if (Array.isArray(mine.run) && Array.isArray(mine.resume) && isRetiredRuntime(name, { run: mine.run as string[], resume: mine.resume as string[] })) {
      gaps.push({ kind: 'runtime', path: `runtimes.${name}`, detail: `${name} 还是旧的出厂模板,没改过:整份换成新的(src/clis/${name}.ts 的出厂模板)`, value: rt });
      continue;
    }
    // 出厂模板换了说话方式(消息改走 stdin)而你的改过:逐个补旗标会拼出过不了契约的模板,不动(家长的决定)
    if (rt.stdin && !mine.stdin) continue;
    for (const key of ['run', 'resume'] as const) {
      const f = rt[key];
      const u = mine[key];
      if (!Array.isArray(f) || !Array.isArray(u)) continue;
      const { argv, added } = insertMissingFlags(u as string[], f as string[]);
      // --tools 的值还是旧出厂的白名单(没人改过)、出厂模板已经换成 {tools}:一起换,孩子的话才不带工具(policy.tools)。改过的白名单是家长的决定,不动
      const at = argv.indexOf('--tools');
      const swap = at >= 0 && argv[at + 1] === CLAUDE_TUTOR_TOOLS && (f as string[])[(f as string[]).indexOf('--tools') + 1] === '{tools}';
      if (swap) argv[at + 1] = '{tools}';
      if (!added.length && !swap) continue;
      const what = [added.length ? `缺出厂旗标 ${added.join(' ')}` : '', swap ? `--tools 还是写死的白名单,换成 {tools}(孩子的话不带工具,开口快)` : ''].filter(Boolean).join(';');
      gaps.push({ kind: 'flag', path: `runtimes.${name}.${key}`, detail: `${name} 的 ${key} 命令模板${what}`, value: argv });
    }
  }
  // 模板换成 {tools} 之后,出厂就要带工具的老师(口播老师要跑 koubo 命令)得在政策里写明,不然它孩子那轮没工具
  if (gaps.some((g) => g.kind === 'flag' && (g.value as string[]).includes('{tools}') && !(getAt(raw, g.path) as string[]).includes('{tools}'))) {
    for (const [name, entry] of Object.entries(factoryTutors)) {
      const want = isObj(entry) && isObj(entry.policy) ? entry.policy.tools : undefined;
      const mine = mineTutors[name];
      if (want === undefined || !isObj(mine) || (isObj(mine.policy) && mine.policy.tools !== undefined)) continue;
      gaps.push({ kind: 'policy', path: `tutors.${name}.policy.tools`, detail: `${name} 要带工具才干得了活(出厂政策 tools: ${String(want)})`, value: want });
    }
  }
  return gaps;
}

function getAt(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, k) => (isObj(cur) ? cur[k] : undefined), obj);
}

function setAt(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1] as string] = value;
}

export interface UpgradeConfigResult {
  file: string;
  gaps: ConfigGap[];
  /** 真写了没有(--dry-run 与没有差异时都是 false) */
  applied: boolean;
  /** 新老师进了表之后顺带补的文件与目录(老师文件、agents/<name>/) */
  installed: InstallStep[];
  /** 改名挪了(--dry-run:要挪)的文件与目录 */
  moved: RenameOp[];
}

const renameOf = (g: ConfigGap) => RENAMED_TUTORS.find((r) => `tutors.${r.from}` === g.path);

/** 改名:键换掉、位置不变(老师在首页的顺序就是 tutors 的顺序) */
function renameKey(tutors: Record<string, unknown>, from: string, to: string, value: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(tutors).map(([k, v]) => (k === from ? [to, value] : [k, v])));
}

/**
 * 补缺并落盘:补丁打在**原始 JSON** 上(`$schema` `_note` 这些机器不认识的键原样留着),
 * 整份过契约才写;不过就抛,原文件不动。
 */
export async function upgradeConfig(root: string, opts: { dryRun?: boolean; renames?: boolean } = {}): Promise<UpgradeConfigResult> {
  const file = join(root, CONFIG_FILE);
  const raw = readJson(file);
  if (raw === null) throw new ConfigError(file, '不存在:先 cotutor init <slug> 建 workspace');
  if (!isObj(raw)) throw new ConfigError(file, '顶层不是一个 JSON 对象');
  // 服务里点「补上」不做改名(renames: false):服务自己还认着旧名,改名要停了服务在终端里跑
  const gaps = (await configGaps(raw)).filter((g) => g.kind !== 'rename' || opts.renames !== false);
  const vault = resolvePaths(root, isObj(raw.paths) ? (raw.paths as Record<string, string>) : {}).vault;
  // 先把改名要挪的全算出来,冲突在这里就抛,还没动任何文件
  const renames = gaps.flatMap((g) => (g.kind === 'rename' && renameOf(g) ? [renameOf(g)!] : []));
  const moved: RenameOp[] = [];
  for (const rn of renames) moved.push(...(await renameTutorData(root, vault, rn, false)));
  if (opts.dryRun || !gaps.length) return { file, gaps, applied: false, installed: [], moved };

  const merged = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  for (const g of gaps) {
    const rn = g.kind === 'rename' ? renameOf(g) : undefined;
    if (rn) merged.tutors = renameKey(merged.tutors as Record<string, unknown>, rn.from, rn.to, g.value);
    else setAt(merged, g.path, g.value);
  }
  const r = CotutorConfigSchema.safeParse(merged);
  if (!r.success) {
    throw new ConfigError(file, `补完之后不合契约,没有写入:\n${explainIssues(r.error.issues).map((l) => `  - ${l}`).join('\n')}`);
  }
  for (const rn of renames) await renameTutorData(root, vault, rn, true);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`);
  await rename(tmp, file);

  // 新老师进了表,她的文件与家还得在,否则 doctor 立刻报「老师文件读不到」——
  // 补缺就补到底(installTutors 是 init 用的同一条路:缺的拷、有的不动)
  const installed = gaps.some((g) => g.kind === 'tutor' || g.kind === 'rename')
    ? (await installTutors(root, Object.keys(r.data.tutors))).filter((s) => s.action === 'created' || s.action === 'replaced')
    : [];
  return { file, gaps, applied: true, installed, moved };
}

/** doctor 与家长端都要:读文件算差异;文件读不到 / 坏了就当没有差异(那边有别的检查在报) */
export async function configGapsOf(root: string): Promise<ConfigGap[]> {
  try {
    return await configGaps(JSON.parse(await readFile(join(root, CONFIG_FILE), 'utf8')));
  } catch {
    return [];
  }
}
