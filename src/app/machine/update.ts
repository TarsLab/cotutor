/**
 * 有没有新版本:服务每天问一次 npm 的 latest,结果存机器级 ~/.config/cotutor/update.json(几个孩子的服务共用,一天只问一次,重起不重问)。
 * /api/health 带上 latest(比在跑的新才有),托盘、家长端、service status 都从它拿;doctor 只读这份文件,不上网。
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
  off?: boolean;
}

/** 读不到、写坏了 → 空的,当作没问过 */
export async function readUpdateRecord(file: string = updateFile()): Promise<UpdateRecord> {
  try {
    const j = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    return {
      ...(typeof j.checkedAt === 'string' ? { checkedAt: j.checkedAt } : {}),
      ...(isPlainVersion(j.latest) ? { latest: j.latest } : {}),
      ...(j.off === true ? { off: true } : {}),
    };
  } catch {
    return {};
  }
}

/** 依次问,谁先答谁算;都问不到 → null */
export async function fetchLatest(fetchFn: typeof fetch = fetch, urls: string[] = UPDATE_URLS): Promise<string | null> {
  for (const url of urls) {
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
      if (!r.ok) continue;
      const v = ((await r.json()) as { version?: unknown }).version;
      if (isPlainVersion(v)) return v;
    } catch {
      /* 这家不通,问下一家 */
    }
  }
  return null;
}

let known: string | null = null;

/** 这个进程现在知道的最新版本;还不知道、关掉了 → null */
export const knownLatest = (): string | null => known;

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
  if (rec.off) return (known = null);
  const at = rec.checkedAt ? Date.parse(rec.checkedAt) : Number.NaN;
  // 时间在将来(改过系统时间)算不新鲜
  if (rec.latest && now >= at && now - at < DAY_MS) return (known = rec.latest);
  const latest = await fetchLatest(o.fetch);
  if (!latest) return (known = rec.latest ?? null);
  known = latest;
  try {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ checkedAt: new Date(now).toISOString(), latest }, null, 2)}\n`);
    await rename(tmp, file);
  } catch {
    /* 写不了:下个小时再问一次,不影响别的 */
  }
  return latest;
}

/** serve 起来时调:先用存着的那份,一分钟后问(刚开机网可能还没好),之后每小时看一眼,过了一天才真的问。定时器不拦进程退出 */
export function startUpdateChecks(o: UpdateOptions & { firstMs?: number; everyMs?: number } = {}): () => void {
  void readUpdateRecord(o.file).then((rec) => { known = rec.off ? null : rec.latest ?? null; });
  const run = (): void => { void refreshLatest(o).catch(() => {}); };
  const first = setTimeout(run, o.firstMs ?? FIRST_MS);
  first.unref();
  const every = setInterval(run, o.everyMs ?? HOUR_MS);
  every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}
