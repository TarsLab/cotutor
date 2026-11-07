/**
 * 有没有新版本:服务每天问一次 npm 的 latest,结果存机器级 ~/.config/cotutor/update.json(几个孩子的服务共用,一天只问一次,重起不重问)。
 * /api/health 带上 latest(比在跑的新才有),托盘、家长端、service status 都从它拿;doctor 只读这份文件,不上网。
 * 更新说明写在 package.json 的 releaseNotes,跟着 npm 一起下来(npm、npmmirror 都留自定义字段,2026-11-07 查过),国内连不上 GitHub 也看得到。
 * 只发一个普通的 GET,不带孩子或使用的任何信息;问不到(断网、被墙)不报错,下个小时再问。先问 npm,不通再问 npmmirror(中国家庭常连不上 npm)。
 * latest 这个标签要等 npm 扫描通过才变(2026-07 起发布后先扫描),不会提前提醒。
 * 不自动升级:升级要重起服务,孩子可能正在上课;老师文件的更新也要家长知道。
 * 不想让它问:update.json 写 {"off": true}。从仓库跑的(BUILD.commit 有值)不问,见 main.ts。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isPlainVersion } from '../../shared/upgrade.ts';

export const UPDATE_URLS = ['https://registry.npmjs.org/cotutor/latest', 'https://registry.npmmirror.com/cotutor/latest'];
const DAY_MS = 24 * 3600_000;
const HOUR_MS = 3600_000;
const FIRST_MS = 60_000;
const TIMEOUT_MS = 8000;

export const updateFile = (): string => join(homedir(), '.config', 'cotutor', 'update.json');

export interface UpdateRecord {
  checkedAt?: string;
  latest?: string;
  notes?: string[];
  off?: boolean;
}

/** 网上来的,要显示给家长:只留几行短的纯文本 */
export function cleanNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()).filter((x) => x && x.length <= 140).slice(0, 8);
}

/** 读不到、写坏了 → 空的,当作没问过 */
export async function readUpdateRecord(file: string = updateFile()): Promise<UpdateRecord> {
  try {
    const j = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    return {
      ...(typeof j.checkedAt === 'string' ? { checkedAt: j.checkedAt } : {}),
      ...(isPlainVersion(j.latest) ? { latest: j.latest, notes: cleanNotes(j.notes) } : {}),
      ...(j.off === true ? { off: true } : {}),
    };
  } catch {
    return {};
  }
}

export interface Release {
  version: string;
  notes: string[];
  /** 新版本要的 Node 主次版本,如 [22, 18];没写 → null */
  minNode: [number, number] | null;
  /** 答的是不是 npm 本家;不是就说明 npm 不通,下载也要走镜像 */
  mirror: boolean;
}

/** engines.node 里的下限;只认 >=22.18 这种,看不懂的不拦 */
function minNodeOf(raw: unknown): [number, number] | null {
  const m = /^\s*>=\s*(\d+)(?:\.(\d+))?/.exec(typeof raw === 'string' ? raw : '');
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : null;
}

/** 依次问,谁先答谁算;都问不到 → null */
export async function fetchRelease(fetchFn: typeof fetch = fetch, urls: string[] = UPDATE_URLS): Promise<Release | null> {
  for (const [i, url] of urls.entries()) {
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
      if (!r.ok) continue;
      const j = (await r.json()) as { version?: unknown; releaseNotes?: unknown; engines?: { node?: unknown } };
      if (isPlainVersion(j.version)) return { version: j.version, notes: cleanNotes(j.releaseNotes), minNode: minNodeOf(j.engines?.node), mirror: i > 0 };
    } catch {
      /* 这家不通,问下一家 */
    }
  }
  return null;
}

let known: string | null = null;
let knownNoteLines: string[] = [];

/** 这个进程现在知道的最新版本;还不知道、关掉了 → null */
export const knownLatest = (): string | null => known;
/** 那个版本的更新说明 */
export const knownNotes = (): string[] => knownNoteLines;

const remember = (latest: string | null, notes: string[] = []): string | null => {
  known = latest;
  knownNoteLines = latest ? notes : [];
  return latest;
};

export interface UpdateOptions {
  now?: number;
  fetch?: typeof fetch;
  file?: string;
}

/** 文件里的还新鲜就用它,否则问一次并存下;问不到就继续用上次的 */
export async function refreshLatest(o: UpdateOptions = {}): Promise<string | null> {
  const file = o.file ?? updateFile();
  const now = o.now ?? Date.now();
  const rec = await readUpdateRecord(file);
  if (rec.off) return remember(null);
  const at = rec.checkedAt ? Date.parse(rec.checkedAt) : Number.NaN;
  // 时间在将来(改过系统时间)算不新鲜
  if (rec.latest && now >= at && now - at < DAY_MS) return remember(rec.latest, rec.notes);
  const release = await fetchRelease(o.fetch);
  if (!release) return remember(rec.latest ?? null, rec.notes);
  const { version: latest, notes } = release;
  remember(latest, notes);
  try {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ checkedAt: new Date(now).toISOString(), latest, notes }, null, 2)}\n`);
    await rename(tmp, file);
  } catch {
    /* 写不了:下个小时再问一次,不影响别的 */
  }
  return latest;
}

/** serve 起来时调:先用存着的那份,一分钟后问(刚开机网可能还没好),之后每小时看一眼,过了一天才真的问。定时器不拦进程退出 */
export function startUpdateChecks(o: UpdateOptions & { firstMs?: number; everyMs?: number } = {}): () => void {
  void readUpdateRecord(o.file).then((rec) => { remember(rec.off ? null : rec.latest ?? null, rec.notes); });
  const run = (): void => { void refreshLatest(o).catch(() => {}); };
  const first = setTimeout(run, o.firstMs ?? FIRST_MS);
  first.unref();
  const every = setInterval(run, o.everyMs ?? HOUR_MS);
  every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}
