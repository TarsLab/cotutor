/**
 * 老师文件的安装与升级(2026-09-09 拍板:**拷贝,不链**)。
 * 包里的 agents/<name>.md 是出厂件;init 把它拷进 workspace 的 .claude/agents/<name>.md(这份是家长的,想改就改),
 * .qwen/agents/<name>.md 是指向它的相对链(一份真相两处可见,链在 workspace 内,不怕包搬家或 npx 缓存回收)。
 * 出厂时的内容 hash 记在 .cotutor/shipped.json(机器文件,家长不用管),据此分三种状态:
 *   latest     与本包一致
 *   upgradable 与记录的出厂 hash 一致(没改过,只是包更新了)→ cotutor upgrade 直接换新
 *   custom     改过 → upgrade 只报 diff,不动
 *   untracked  没有记录(旧workspace、或家长手写的老师)→ 当 custom 对待
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readlink, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { PACKAGE_AGENTS_DIR, PACKAGE_VERSION, shippedAgents, tutorTemplate, writeSchemaFile, writeSyntaxFile, type ShippedAgent, type TutorTemplateInput } from './skeleton.ts';
import { AGENT_NAME_RE } from '../schema/index.ts';
import { UsageError } from './workspace.ts';

export const SHIPPED_FILE = '.cotutor/shipped.json';

export interface ShippedManifest {
  /** 出厂 skill(drawtell-skills 的四个领域 skill)的 hash,与 tutors 同一套机制(src/cli/skills.ts) */
  skills?: Record<string, { hash: string; version: string }>;
  /** 出厂主题(themes/<name>/)的目录 hash,同一套机制(src/cli/themes.ts) */
  themes?: Record<string, { hash: string; version: string }>;
  version: string;
  tutors: Record<string, { hash: string; version: string }>;
}

export const sha256 = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex')}`;

export async function readManifest(root: string): Promise<ShippedManifest> {
  try {
    const raw = JSON.parse(await readFile(join(root, SHIPPED_FILE), 'utf8')) as Partial<ShippedManifest>;
    // skills / themes 也要带回来,不然 tutors 这边一写就把它们抹了
    return { version: raw.version ?? '0', tutors: raw.tutors ?? {}, ...(raw.skills ? { skills: raw.skills } : {}), ...(raw.themes ? { themes: raw.themes } : {}) };
  } catch {
    return { version: '0', tutors: {} };
  }
}

export async function writeManifest(root: string, m: ShippedManifest): Promise<void> {
  const file = join(root, SHIPPED_FILE);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ ...m, _note: '出厂时老师文件的 hash,cotutor upgrade 据此分辨「没改过」与「改过」;机器写,不用手改' }, null, 2)}\n`);
  await rename(tmp, file);
}

export type TutorState = 'latest' | 'upgradable' | 'custom' | 'untracked' | 'missing' | 'broken';

export interface TutorStatus {
  name: string;
  state: TutorState;
  /** workspace 里那份 */
  file: string;
  /** 记录的出厂版本(custom / upgradable 时有) */
  basedOn?: string;
  /** 是否还是指向包的旧链(init 会换成拷贝) */
  legacyLink?: boolean;
}

/** 老师文件在 workspace 里的位置:.claude/agents/<name>.md 是真相,.qwen/agents/<name>.md 是相对链 */
export function tutorFiles(root: string, name: string): { claude: string; qwen: string } {
  return { claude: join(root, '.claude', 'agents', `${name}.md`), qwen: join(root, '.qwen', 'agents', `${name}.md`) };
}

async function readState(root: string, a: ShippedAgent, manifest: ShippedManifest): Promise<TutorStatus> {
  const { claude } = tutorFiles(root, a.name);
  const st = await lstat(claude).catch(() => null);
  if (!st) return { name: a.name, state: 'missing', file: claude };
  let legacyLink = false;
  if (st.isSymbolicLink()) {
    const target = await readlink(claude).catch(() => '');
    legacyLink = target.startsWith(PACKAGE_AGENTS_DIR) || target === a.file;
  }
  let text: string;
  try {
    text = await readFile(claude, 'utf8');
  } catch {
    return { name: a.name, state: 'broken', file: claude, legacyLink };
  }
  const shipped = await readFile(a.file, 'utf8');
  const h = sha256(text);
  const rec = manifest.tutors[a.name];
  if (h === sha256(shipped)) return { name: a.name, state: 'latest', file: claude, basedOn: rec?.version, legacyLink };
  if (rec && rec.hash === h) return { name: a.name, state: 'upgradable', file: claude, basedOn: rec.version, legacyLink };
  return { name: a.name, state: rec ? 'custom' : 'untracked', file: claude, basedOn: rec?.version, legacyLink };
}

export async function tutorStatuses(root: string): Promise<TutorStatus[]> {
  const manifest = await readManifest(root);
  const out: TutorStatus[] = [];
  for (const a of await shippedAgents()) out.push(await readState(root, a, manifest));
  return out;
}

/** 把出厂件写进 workspace(覆盖),并记 hash */
async function installOne(root: string, a: ShippedAgent, manifest: ShippedManifest): Promise<void> {
  const { claude } = tutorFiles(root, a.name);
  await mkdir(dirname(claude), { recursive: true });
  const text = await readFile(a.file, 'utf8');
  await unlink(claude).catch(() => {});
  await writeFile(claude, text);
  manifest.tutors[a.name] = { hash: sha256(text), version: PACKAGE_VERSION };
}

/** .qwen/agents/<name>.md → ../../.claude/agents/<name>.md;已是这条链就不动;是旧的包内链或别的东西就换 */
async function ensureQwenLink(root: string, name: string): Promise<'created' | 'exists' | 'replaced'> {
  const { claude, qwen } = tutorFiles(root, name);
  await mkdir(dirname(qwen), { recursive: true });
  const want = relative(dirname(qwen), claude);
  const st = await lstat(qwen).catch(() => null);
  if (st?.isSymbolicLink() && (await readlink(qwen).catch(() => '')) === want) return 'exists';
  if (st) {
    if (!st.isSymbolicLink()) {
      // 家长手放了实体文件在 .qwen 下:留着,当作她的
      return 'exists';
    }
    await unlink(qwen);
    await symlink(want, qwen);
    return 'replaced';
  }
  await symlink(want, qwen);
  return 'created';
}

export interface InstallStep {
  item: string;
  action: 'created' | 'exists' | 'kept' | 'replaced';
  note?: string;
}

/**
 * init 用。出厂的:缺的拷,旧的包内链换成拷贝,家长的文件不动;
 * cotutor.json 里的每一位(含家长自己加的):补老师目录 agents/<name>/ 与 .qwen 链——「加老师 = 加文件 + 目录,没有注册表」,
 * 自己加的老师文件不在这里生成(cotutor add 生成模板),缺了由 doctor 点名。
 */
export async function installTutors(root: string, configured: string[] = []): Promise<InstallStep[]> {
  const steps: InstallStep[] = [];
  const manifest = await readManifest(root);
  let touched = false;
  const shipped = await shippedAgents();
  for (const a of shipped) {
    const s = await readState(root, a, manifest);
    const item = `.claude/agents/${basename(a.file)}`;
    if (s.state === 'missing' || s.legacyLink || s.state === 'broken') {
      await installOne(root, a, manifest);
      touched = true;
      steps.push({ item, action: s.state === 'missing' ? 'created' : 'replaced', note: s.legacyLink ? '旧的包内链换成拷贝(2026-09-09 起老师文件是你的)' : s.state === 'broken' ? '读不到,重新拷贝' : `拷自本包 ${PACKAGE_VERSION}` });
    } else if (s.state === 'untracked') {
      // 没记录但内容在:当家长的,记一笔当前 hash 免得以后一直是 untracked?不记——记了就等于宣称它是出厂件。留 untracked。
      steps.push({ item, action: 'kept', note: '已有(不是出厂件,或没有记录);升级时当自定义对待' });
    } else {
      steps.push({ item, action: 'exists', note: s.state === 'custom' ? `自定义(基于 ${s.basedOn})` : s.state === 'upgradable' ? `可升级(cotutor upgrade)` : undefined });
    }
    const q = await ensureQwenLink(root, a.name);
    steps.push({ item: `.qwen/agents/${basename(a.file)}`, action: q, note: q === 'exists' ? undefined : '→ ../../.claude/agents/' });
  }
  for (const name of configured.filter((n) => !shipped.some((a) => a.name === n))) {
    const { claude } = tutorFiles(root, name);
    if (await lstat(claude).catch(() => null)) {
      const q = await ensureQwenLink(root, name);
      steps.push({ item: `.qwen/agents/${name}.md`, action: q, note: q === 'exists' ? undefined : '→ ../../.claude/agents/(自家的老师)' });
    } else steps.push({ item: `.claude/agents/${name}.md`, action: 'kept', note: `缺:cotutor.json 里有 ${name},文件还没写;cotutor add ${name} 出模板,或自己写(frontmatter name: ${name})` });
  }
  for (const name of [...new Set([...shipped.map((a) => a.name), ...configured])]) {
    const home = join(root, 'agents', name);
    if (await lstat(home).catch(() => null)) {
      steps.push({ item: `agents/${name}/`, action: 'exists' });
      continue;
    }
    await mkdir(home, { recursive: true });
    await writeFile(join(home, '.gitkeep'), '');
    steps.push({ item: `agents/${name}/`, action: 'created' });
  }
  if (touched || !(await lstat(join(root, SHIPPED_FILE)).catch(() => null))) await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  return steps;
}

export interface AddResult {
  name: string;
  file: string;
  home: string;
}

/**
 * cotutor add <name>:按出厂老师的结构写一份模板(约定都带上,人设一句留给家长填)、建目录与 .qwen 链。
 * 不动 cotutor.json——那是调用方(main / 页面)用 patchConfig 加的,同一条路。已有同名文件就拒,不覆盖。
 */
export async function addTutorFile(root: string, input: TutorTemplateInput): Promise<AddResult> {
  if (!AGENT_NAME_RE.test(input.name)) throw new UsageError(`老师名 "${input.name}" 不合规:小写字母数字连字符,如 science-tutor`);
  const { claude } = tutorFiles(root, input.name);
  if (await lstat(claude).catch(() => null)) throw new UsageError(`${claude} 已经在了;要改就直接改它,要重来先把它挪开`);
  await mkdir(dirname(claude), { recursive: true });
  await writeFile(claude, tutorTemplate(input));
  await ensureQwenLink(root, input.name);
  const home = join(root, 'agents', input.name);
  await mkdir(home, { recursive: true });
  await writeFile(join(home, '.gitkeep'), '').catch(() => {});
  return { name: input.name, file: claude, home };
}

export interface UpgradeStep {
  name: string;
  action: 'upgraded' | 'latest' | 'kept-custom' | 'forced' | 'installed';
  basedOn?: string;
  /** custom 时的行级 diff(出厂新版 vs 你的) */
  diff?: string[];
}

/** 最小行 diff(LCS),只为让家长看清改了哪几行;不追求 git 那么好 */
export function lineDiff(a: string, b: string): string[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(`- ${A[i++]}`);
    else out.push(`+ ${B[j++]}`);
  }
  while (i < n) out.push(`- ${A[i++]}`);
  while (j < m) out.push(`+ ${B[j++]}`);
  return out;
}

/**
 * cotutor upgrade:latest 跳过;upgradable 换新;custom / untracked 只报 diff 并保留(--force <name> 才覆盖,原文留 .bak);缺的补。
 */
export async function upgradeTutors(root: string, opts: { force?: string[] } = {}): Promise<UpgradeStep[]> {
  const manifest = await readManifest(root);
  const steps: UpgradeStep[] = [];
  for (const a of await shippedAgents()) {
    const s = await readState(root, a, manifest);
    const force = opts.force?.includes(a.name) ?? false;
    if (s.state === 'latest' && !s.legacyLink) {
      steps.push({ name: a.name, action: 'latest', basedOn: s.basedOn });
    } else if (s.state === 'missing' || s.state === 'broken') {
      await installOne(root, a, manifest);
      steps.push({ name: a.name, action: 'installed' });
    } else if (s.state === 'upgradable' || s.legacyLink || (s.state === 'latest' && s.legacyLink)) {
      await installOne(root, a, manifest);
      steps.push({ name: a.name, action: 'upgraded', basedOn: s.basedOn });
    } else if (force) {
      const mine = await readFile(s.file, 'utf8');
      await writeFile(`${s.file}.bak`, mine);
      await installOne(root, a, manifest);
      steps.push({ name: a.name, action: 'forced', basedOn: s.basedOn });
    } else {
      const mine = await readFile(s.file, 'utf8');
      const shipped = await readFile(a.file, 'utf8');
      steps.push({ name: a.name, action: 'kept-custom', basedOn: s.basedOn, diff: lineDiff(mine, shipped) });
    }
    await ensureQwenLink(root, a.name);
  }
  await writeManifest(root, { ...manifest, version: PACKAGE_VERSION });
  await writeSchemaFile(root);
  await writeSyntaxFile(root);
  return steps;
}

export interface TutorFileView {
  name: string;
  text: string;
  /** 出厂件的状态;自家加的是 own */
  state: TutorState | 'own';
  basedOn?: string;
}

export async function readTutorFile(root: string, name: string): Promise<TutorFileView> {
  const { claude } = tutorFiles(root, name);
  const text = await readFile(claude, 'utf8').catch(() => null);
  if (text === null) throw new UsageError(`老师文件不在:${claude};cotutor add ${name} --display <显示名> 可出模板`);
  const st = (await tutorStatuses(root)).find((s) => s.name === name);
  return { name, text, state: st?.state ?? 'own', basedOn: st?.basedOn };
}

/** 页面上改老师正文:frontmatter 的 name 必须还是它;写完 doctor 会把它标成自定义 */
export async function writeTutorFile(root: string, name: string, text: string): Promise<TutorFileView> {
  const { parseAgentFile } = await import('../lib/agent-file.ts');
  const fm = parseAgentFile(text).frontmatter;
  if (fm.name !== name) throw new UsageError(`frontmatter 的 name 要是 ${name}(现在是 "${fm.name ?? ''}"),老师键靠它对上`);
  const { claude } = tutorFiles(root, name);
  await mkdir(dirname(claude), { recursive: true });
  const tmp = `${claude}.tmp`;
  await writeFile(tmp, text.endsWith('\n') ? text : `${text}\n`);
  await rename(tmp, claude);
  await ensureQwenLink(root, name);
  return readTutorFile(root, name);
}

/** 删自家加的老师文件:改名成 .removed-<时间>(不真删;记忆目录与对话不动);出厂的不让删,用开关 */
export async function removeTutorFile(root: string, name: string): Promise<{ moved: string | null }> {
  if ((await shippedAgents()).some((a) => a.name === name)) throw new UsageError(`${name} 是出厂老师,不删文件;不想用就在老师团页关掉`);
  const { claude, qwen } = tutorFiles(root, name);
  await unlink(qwen).catch(() => {});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const moved = `${claude}.removed-${stamp}`;
  try {
    await rename(claude, moved);
    return { moved };
  } catch {
    return { moved: null };
  }
}
