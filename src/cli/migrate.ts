/**
 * 老 workspace 的配置迁移。
 *
 * cotutor.json 是**政策文件**:init 只在缺失时写模板,已有的那份机器永不改(家长的决定不由机器替她拍板)。
 * 代价是包更新带来的新出厂件不会自己出现在老 workspace 里,而且「没有」的表现是**静默**的——
 * 2026-09-10 板书那一期加了 scene-maker(画图老师)、claude-scene / qwen-scene 运行时、
 * claude 模板的 `--disallowedTools Agent` 与 `--include-partial-messages`;老 workspace 缺了它们的表现是
 * 「画图老师不存在」「转交起不来」「老师自己派子代理烧预算」「回复整块出不流式」,没有一条会报错。
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
import { configTemplate, shippedAgents } from './skeleton.ts';
import { installTutors, type InstallStep } from './tutors.ts';
import { CONFIG_FILE, ConfigError, readJson } from './workspace.ts';

export type GapKind = 'tutor' | 'runtime' | 'flag';

export interface ConfigGap {
  kind: GapKind;
  /** 点位:tutors.scene-maker / runtimes.claude-scene / runtimes.claude.run */
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
  for (const [name, entry] of Object.entries(isObj(factory.tutors) ? factory.tutors : {})) {
    if (name in mineTutors) continue;
    const display = isObj(entry) && typeof entry.display === 'string' ? entry.display : name;
    gaps.push({ kind: 'tutor', path: `tutors.${name}`, detail: `出厂老师 ${display}(${name})不在 tutors 里`, value: entry });
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
    for (const key of ['run', 'resume'] as const) {
      const f = rt[key];
      const u = mine[key];
      if (!Array.isArray(f) || !Array.isArray(u)) continue;
      const { argv, added } = insertMissingFlags(u as string[], f as string[]);
      if (!added.length) continue;
      gaps.push({ kind: 'flag', path: `runtimes.${name}.${key}`, detail: `${name} 的 ${key} 命令模板缺出厂旗标 ${added.join(' ')}`, value: argv });
    }
  }
  return gaps;
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
  /** 新老师进了表之后顺带补的文件与目录(老师文件、.qwen 链、agents/<name>/) */
  installed: InstallStep[];
}

/**
 * 补缺并落盘:补丁打在**原始 JSON** 上(`$schema` `_note` 这些机器不认识的键原样留着),
 * 整份过契约才写;不过就抛,原文件不动。
 */
export async function upgradeConfig(root: string, opts: { dryRun?: boolean } = {}): Promise<UpgradeConfigResult> {
  const file = join(root, CONFIG_FILE);
  const raw = readJson(file);
  if (raw === null) throw new ConfigError(file, '不存在:先 cotutor init <slug> 建 workspace');
  if (!isObj(raw)) throw new ConfigError(file, '顶层不是一个 JSON 对象');
  const gaps = await configGaps(raw);
  if (opts.dryRun || !gaps.length) return { file, gaps, applied: false, installed: [] };

  const merged = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  for (const g of gaps) setAt(merged, g.path, g.value);
  const r = CotutorConfigSchema.safeParse(merged);
  if (!r.success) {
    throw new ConfigError(file, `补完之后不合契约,没有写入:\n${explainIssues(r.error.issues).map((l) => `  - ${l}`).join('\n')}`);
  }
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`);
  await rename(tmp, file);

  // 新老师进了表,她的文件与家还得在,否则 doctor 立刻报「老师文件读不到」——
  // 补缺就补到底(installTutors 是 init 用的同一条路:缺的拷、有的不动)
  const installed = gaps.some((g) => g.kind === 'tutor')
    ? (await installTutors(root, Object.keys(r.data.tutors))).filter((s) => s.action === 'created' || s.action === 'replaced')
    : [];
  return { file, gaps, applied: true, installed };
}

/** doctor 与家长端都要:读文件算差异;文件读不到 / 坏了就当没有差异(那边有别的检查在报) */
export async function configGapsOf(root: string): Promise<ConfigGap[]> {
  try {
    return await configGaps(JSON.parse(await readFile(join(root, CONFIG_FILE), 'utf8')));
  } catch {
    return [];
  }
}
