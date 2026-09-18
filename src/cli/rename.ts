/**
 * 出厂老师改名(2026-09-18:reading-tutor → english-tutor)。
 *
 * 老师的键是数据的钥匙:cotutor.json 的键、老师文件、会话 cwd、对话目录、记忆笔记的 `agent:`、首页的 tutor 卡都认它。
 * 包里只换名不迁,老 workspace 会静默多出一位新老师、旧的降成「自家的」——所以改名是 `upgrade --config` 的一项(migrate.ts):
 * 旧键在、新键不在才动;要服务停着(会话 cwd 一挪,当天的旧话题续不上,内存里的任务也还认旧名)。
 * 先把要动的全列出来、冲突先查,查过了才动手;--dry-run 只列。
 */
import { lstat, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join, relative } from 'node:path';
import { readManifest, sha256, tutorFiles, writeManifest } from './tutors.ts';
import { shippedAgents } from './skeleton.ts';
import { UsageError } from './workspace.ts';

export interface TutorRename {
  from: string;
  to: string;
  /** 旧的出厂显示名与头像:家长没改过才跟着换成新的出厂值 */
  display: string;
  avatar: string;
}

export const RENAMED_TUTORS: readonly TutorRename[] = [{ from: 'reading-tutor', to: 'english-tutor', display: '朗读老师', avatar: '📖' }];

/** cotutor.json 里那一条改名后的样子:值原样,显示名 / 头像还是旧出厂值才换,头像路径指着 avatars/<旧名>.* 的跟着改 */
export function renamedEntry(entry: Record<string, unknown>, r: TutorRename, factory: Record<string, unknown>): Record<string, unknown> {
  const out = { ...entry };
  if (out.display === r.display && typeof factory.display === 'string') out.display = factory.display;
  if (out.avatar === r.avatar && typeof factory.avatar === 'string') out.avatar = factory.avatar;
  else if (typeof out.avatar === 'string' && out.avatar.startsWith(`avatars/${r.from}.`)) out.avatar = `avatars/${r.to}.${out.avatar.slice(`avatars/${r.from}.`.length)}`;
  return out;
}

export interface RenameOp {
  /** workspace 或 vault 里的相对位置 */
  item: string;
  note: string;
}

export class RenameConflict extends UsageError {}

const exists = (p: string) => lstat(p).then(() => true, () => false);

/** 目标目录在但只有 .gitkeep(init / upgrade 顺手建的)算空 */
async function emptyish(dir: string): Promise<boolean> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.every((n) => n === '.gitkeep');
}

async function walkMd(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walkMd(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
}

const FRONT_RE = /^---\n([\s\S]*?)\n---/;

/** 记忆笔记(`cotutor: memory`)里 `agent: <旧名>` 那一行;不是就 null */
function memoryAgentLine(text: string, from: string): RegExp | null {
  const fm = FRONT_RE.exec(text.replace(/\r\n/g, '\n'))?.[1];
  if (!fm || !/^cotutor:\s*memory\s*$/m.test(fm)) return null;
  const re = new RegExp(`^(agent:\\s*)${from}\\s*$`, 'm');
  return re.test(fm) ? re : null;
}

/**
 * 算一次改名要动什么、有没有冲突;`apply` 为真才真动。冲突(新名下已经有东西)在动手前就抛,一个文件都不碰。
 * `vault` 是解析好的 vault 根(不配 vault 就是 workspace 根)。
 */
export async function renameTutorData(root: string, vault: string, r: TutorRename, apply: boolean): Promise<RenameOp[]> {
  const ops: { op: RenameOp; run: () => Promise<void> }[] = [];
  const conflict = (what: string) => {
    throw new RenameConflict(`${r.from} → ${r.to} 没法自动迁:${what}。挪开它再跑 cotutor upgrade --config`);
  };

  // 老师文件:没改过的删掉,由出厂新版顶上;改过的挪成新名(frontmatter name 跟着改),记录带过去,upgrade 照旧报 diff
  const manifest = await readManifest(root);
  const oldF = tutorFiles(root, r.from);
  const newF = tutorFiles(root, r.to);
  let manifestTouched = false;
  if (await exists(oldF.claude)) {
    const text = await readFile(oldF.claude, 'utf8');
    const rec = manifest.tutors[r.from];
    const pristine = Boolean(rec && rec.hash === sha256(text));
    if (await exists(newF.claude)) {
      // upgrade / init 在包更新后可能已经把新名的出厂件拷进来了:那份没人动过才可以让位
      const shippedNew = (await shippedAgents()).find((a) => a.name === r.to);
      const cur = await readFile(newF.claude, 'utf8');
      if (!shippedNew || cur !== (await readFile(shippedNew.file, 'utf8'))) conflict(`.claude/agents/${r.to}.md 已经在,而且不是出厂原样`);
    }
    ops.push({
      op: { item: `.claude/agents/${r.from}.md`, note: pristine ? `没改过:删掉,换出厂的 ${r.to}.md` : `改过:挪成 ${r.to}.md(name 跟着改),你的改动留着` },
      run: async () => {
        if (!pristine) await writeFile(newF.claude, text.replace(new RegExp(`^name:\\s*${r.from}\\s*$`, 'm'), `name: ${r.to}`));
        await unlink(oldF.claude);
        if (rec && !pristine) manifest.tutors[r.to] = rec;
        delete manifest.tutors[r.from];
        manifestTouched = true;
      },
    });
  } else if (manifest.tutors[r.from]) {
    ops.push({ op: { item: '.cotutor/shipped.json', note: `去掉 ${r.from} 的出厂记录` }, run: async () => { delete manifest.tutors[r.from]; manifestTouched = true; } });
  }
  const qst = await lstat(oldF.qwen).catch(() => null);
  if (qst?.isSymbolicLink()) ops.push({ op: { item: `.qwen/agents/${r.from}.md`, note: '旧链删掉,新链照常补' }, run: () => unlink(oldF.qwen) });
  else if (qst) {
    if (await exists(newF.qwen)) conflict(`.qwen/agents/${r.to}.md 已经在`);
    ops.push({ op: { item: `.qwen/agents/${r.from}.md`, note: `挪成 ${r.to}.md` }, run: () => rename(oldF.qwen, newF.qwen) });
  }

  // 目录:会话 cwd、对话、回放;对话与回放里的 json 认名字的地方一起改
  const rewriteJson = async (dir: string) => {
    const pathRe = new RegExp(`conversations/${r.from}/`, 'g');
    const tutorRe = new RegExp(`("tutor":\\s*)"${r.from}"`, 'g');
    for (const n of await readdir(dir).catch(() => [] as string[])) {
      if (!n.endsWith('.json')) continue;
      const f = join(dir, n);
      const t = await readFile(f, 'utf8');
      const u = t.replace(tutorRe, `$1"${r.to}"`).replace(pathRe, `conversations/${r.to}/`);
      if (u !== t) await writeFile(f, u);
    }
  };
  for (const [base, what, rewrite] of [
    ['agents', '会话目录(老师会话的 cwd;当天没聊完的旧话题续不上,新话题照常)', false],
    ['conversations', '对话(索引里的 tutor 与画板图片路径跟着改)', true],
    ['evals', '回放', true],
  ] as const) {
    const from = join(root, base, r.from);
    const to = join(root, base, r.to);
    if (!(await exists(from))) continue;
    const toThere = await exists(to);
    if (toThere && !(await emptyish(to))) conflict(`${base}/${r.to}/ 已经在,而且不是空的`);
    ops.push({
      op: { item: `${base}/${r.from}/`, note: `挪成 ${base}/${r.to}/:${what}` },
      run: async () => {
        if (toThere) await rm(to, { recursive: true, force: true });
        await rename(from, to);
        if (rewrite) await rewriteJson(to);
      },
    });
  }

  // 头像:avatars/<旧名>.png / .fig.json
  for (const n of await readdir(join(root, 'avatars')).catch(() => [] as string[])) {
    if (!n.startsWith(`${r.from}.`)) continue;
    const to = `${r.to}.${n.slice(r.from.length + 1)}`;
    if (await exists(join(root, 'avatars', to))) conflict(`avatars/${to} 已经在`);
    ops.push({ op: { item: `avatars/${n}`, note: `挪成 avatars/${to}` }, run: () => rename(join(root, 'avatars', n), join(root, 'avatars', to)) });
  }

  // vault 的记忆笔记:按 agent: 找(文件名是显示名,是家长的,不动)
  const mds: string[] = [];
  await walkMd(vault, mds);
  for (const f of mds) {
    const text = await readFile(f, 'utf8').catch(() => '');
    const re = memoryAgentLine(text, r.from);
    if (!re) continue;
    ops.push({ op: { item: `vault/${relative(vault, f)}`, note: `记忆笔记的 agent: 改成 ${r.to}` }, run: () => writeFile(f, text.replace(re, `$1${r.to}`)) });
  }

  // 首页:草稿里的 tutor 卡、已发布的 props.tutor;history 是过去的,不动
  const draft = join(root, 'home', 'draft.md');
  const fenceRe = new RegExp(`^(\\s*(?:\`\`\`|~~~)tutor\\s+)${r.from}\\b`, 'gm');
  const draftText = await readFile(draft, 'utf8').catch(() => null);
  if (draftText !== null && fenceRe.test(draftText)) {
    ops.push({ op: { item: 'home/draft.md', note: `tutor 卡改成 ${r.to}` }, run: () => writeFile(draft, draftText.replace(fenceRe, `$1${r.to}`)) });
  }
  const pub = join(root, 'home', 'published.json');
  const pubRe = new RegExp(`("tutor":\\s*)"${r.from}"`, 'g');
  const pubText = await readFile(pub, 'utf8').catch(() => null);
  if (pubText !== null && pubRe.test(pubText)) {
    ops.push({ op: { item: 'home/published.json', note: `孩子端首页的老师卡改成 ${r.to}` }, run: () => writeFile(pub, pubText.replace(pubRe, `$1"${r.to}"`)) });
  }

  if (apply) {
    for (const o of ops) await o.run();
    if (manifestTouched) await writeManifest(root, manifest);
  }
  return ops.map((o) => o.op);
}

/** serve 在不在跑:连一下本机的端口 */
export function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ port, host: '127.0.0.1' });
    const end = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(500);
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
    s.once('timeout', () => end(false));
  });
}
