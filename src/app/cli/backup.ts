/**
 * 备份:孩子的记录删了找不回来。升级前留一份,每天留一份,放在 workspace 旁边的 .backups/<目录名>/<名字>/,一份就是一个普通目录,打开就能看。
 * 防的是升级弄坏、手滑改坏、误删文件夹;硬盘坏了防不住,要防就把 .backups 再拷到别处。
 *
 * 不备份录音(wav):2026-11-07 量真的 workspace,1.28 GB 里 1.21 GB 是录音,其余约 70 MB;这台电脑磁盘还只剩 4%。
 * 也不备份能重新生成的(视频课 mp4、评测 evals、配音缓存)。保住的是文字记录、账本、照片、老师文件、配置。
 *
 * 没变的文件和上一份硬链接,不占第二份地方:每天一份也几乎不涨。一份里的文件不再改,所以硬链接是安全的;恢复时一律拷出去,不链回 workspace。
 * vault 在 workspace 外面(Obsidian)的,只拷 md 到 _vault/,恢复时不动它:那是家长的,要不要拿回来家长定。macOS 上后台进程读不了「文稿」时记一笔,不算失败。
 */
import { copyFile, link, lstat, mkdir, readFile, readdir, rename, rm, stat, statfs, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { Stats } from 'node:fs';
import { UsageError } from '../workspace.ts';

export const BACKUP_DIR = '.backups';
const META = 'backup.json';
const VAULT_DIR = '_vault';
const TOP_SKIP = new Set(['.git', '.claude', '.sandbox', 'evals', 'node_modules']);
/** .cotutor 里能重新生成的缓存;别的(设备表、孩子端流水、出厂 hash)留着 */
const COTUTOR_SKIP = new Set(['qwen', 'live-preview', 'qr', 'board']);
const SKIP_EXT = /\.(wav|mp4|tmp)$/i;
const AUDIO = /\.wav$/i;
const VAULT_MAX_FILES = 5000;
const KEEP: Record<BackupWhy, number> = { daily: 14, upgrade: 5, manual: 5, restore: 5 };
/** 磁盘快满了不备份:备份不能把孩子正在用的电脑撑爆 */
export const MIN_FREE_BYTES = 1024 ** 3;
const DAILY_EVERY_MS = 20 * 3600_000;

export type BackupWhy = 'daily' | 'upgrade' | 'manual' | 'restore';

export interface BackupMeta {
  name: string;
  at: string;
  why: BackupWhy;
  version: string | null;
  files: number;
  /** 这一份看上去多大 */
  bytes: number;
  /** 真正新占的地方(其余和上一份硬链接) */
  newBytes: number;
  /** 没备份的录音有几个 */
  audioSkipped: number;
  vault: 'inside' | 'copied' | 'unreadable' | 'none';
}

export interface BackupTarget {
  root: string;
  vault?: string;
}

export const backupsOf = (root: string): string => join(dirname(resolve(root)), BACKUP_DIR, basename(resolve(root)));

const pad = (n: number): string => String(n).padStart(2, '0');
const stamp = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

/** 要不要进备份:rel 是相对 workspace 根的路径,统一成 / */
export function wanted(rel: string): boolean {
  const parts = rel.split('/');
  if (TOP_SKIP.has(parts[0])) return false;
  if (parts[0] === '.cotutor' && parts.length > 1 && COTUTOR_SKIP.has(parts[1])) return false;
  return !SKIP_EXT.test(rel);
}

async function* walk(dir: string, base: string): AsyncGenerator<{ path: string; rel: string; st: Stats }> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    const rel = relative(base, path).split(sep).join('/');
    // 只认普通文件和目录:链接(.claude/skills)不跟进去,不然会拷到 workspace 外面
    if (e.isDirectory()) {
      if (rel.split('/')[0] === BACKUP_DIR) continue;
      if (TOP_SKIP.has(rel) || (rel.startsWith('.cotutor/') && COTUTOR_SKIP.has(rel.slice('.cotutor/'.length)))) continue;
      yield* walk(path, base);
    } else if (e.isFile()) {
      const st = await lstat(path).catch(() => null);
      if (st) yield { path, rel, st };
    }
  }
}

/** 放一个文件:和上一份一样就硬链接,不一样(或链不了:跨盘、文件系统不支持)就拷。回新占了多少字节 */
async function place(src: string, st: Stats, dest: string, prev: string | null): Promise<number> {
  await mkdir(dirname(dest), { recursive: true });
  if (prev) {
    const p = await stat(prev).catch(() => null);
    if (p && p.size === st.size && Math.abs(p.mtimeMs - st.mtimeMs) < 2) {
      try {
        await link(prev, dest);
        return 0;
      } catch { /* 链不了就拷 */ }
    }
  }
  await copyFile(src, dest);
  await utimes(dest, st.atime, st.mtime).catch(() => undefined);
  return st.size;
}

export async function listBackups(root: string): Promise<BackupMeta[]> {
  const dir = backupsOf(root);
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: BackupMeta[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try { out.push({ ...(JSON.parse(await readFile(join(dir, name, META), 'utf8')) as BackupMeta), name }); } catch { /* 不是一份完整的备份 */ }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || b.name.localeCompare(a.name));
}

export interface BackupOptions {
  why: BackupWhy;
  version?: string | null;
  now?: Date;
  /** 测试:这块盘还剩多少字节 */
  freeBytes?: () => Promise<number>;
}

const freeOf = async (dir: string): Promise<number> => {
  const s = await statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
};

/** 备份一份。写到临时目录再改名,中途断了不会留下半份 */
export async function makeBackup(t: BackupTarget, o: BackupOptions): Promise<BackupMeta> {
  const root = resolve(t.root);
  const dir = backupsOf(root);
  await mkdir(dir, { recursive: true });
  const free = await (o.freeBytes ?? (() => freeOf(dir)))().catch(() => Number.POSITIVE_INFINITY);
  if (free < MIN_FREE_BYTES) throw new UsageError(`磁盘只剩 ${(free / 1024 ** 3).toFixed(1)} GB,这次没备份:先腾点地方,备份不能把这台电脑撑爆`);
  const now = o.now ?? new Date();
  const list = await listBackups(root);
  const prevDir = list[0] ? join(dir, list[0].name) : null;
  let name = `${stamp(now)}-${o.why}`;
  for (let i = 2; list.some((b) => b.name === name); i++) name = `${stamp(now)}-${o.why}-${i}`;
  const tmp = join(dir, `.tmp-${process.pid}-${now.getTime()}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const meta: BackupMeta = { name, at: now.toISOString(), why: o.why, version: o.version ?? null, files: 0, bytes: 0, newBytes: 0, audioSkipped: 0, vault: 'none' };
  try {
    for await (const f of walk(root, root)) {
      if (!wanted(f.rel)) {
        if (AUDIO.test(f.rel)) meta.audioSkipped++;
        continue;
      }
      meta.newBytes += await place(f.path, f.st, join(tmp, ...f.rel.split('/')), prevDir && join(prevDir, ...f.rel.split('/')));
      meta.files++;
      meta.bytes += f.st.size;
    }
    const vault = t.vault ? resolve(t.vault) : null;
    if (vault && (vault === root || vault.startsWith(root + sep))) meta.vault = 'inside';
    else if (vault) {
      try {
        let n = 0;
        for await (const f of walk(vault, vault)) {
          if (!f.rel.endsWith('.md') || f.rel.split('/').some((p) => p.startsWith('.'))) continue;
          if (++n > VAULT_MAX_FILES) break;
          meta.newBytes += await place(f.path, f.st, join(tmp, VAULT_DIR, ...f.rel.split('/')), prevDir && join(prevDir, VAULT_DIR, ...f.rel.split('/')));
          meta.files++;
          meta.bytes += f.st.size;
        }
        meta.vault = 'copied';
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // macOS 不让后台进程读「文稿」、iCloud 云盘;vault 不在了:都不拦这一份
        if (code === 'EPERM' || code === 'EACCES' || code === 'ENOENT') meta.vault = 'unreadable';
        else throw err;
      }
    }
    await writeFile(join(tmp, META), `${JSON.stringify(meta, null, 2)}\n`);
    await rename(tmp, join(dir, name));
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  await pruneBackups(root, name);
  return meta;
}

/** 每种留最近几份;刚做的那份不删。硬链接删了不影响别的份 */
export async function pruneBackups(root: string, keepName?: string): Promise<string[]> {
  const dir = backupsOf(root);
  const list = await listBackups(root);
  const gone: string[] = [];
  const seen: Partial<Record<BackupWhy, number>> = {};
  for (const b of list) {
    seen[b.why] = (seen[b.why] ?? 0) + 1;
    if ((seen[b.why] as number) > (KEEP[b.why] ?? 5) && b.name !== keepName) {
      await rm(join(dir, b.name), { recursive: true, force: true });
      gone.push(b.name);
    }
  }
  // 上次断在半路留下的临时目录
  for (const n of await readdir(dir).catch(() => [] as string[])) {
    if (!n.startsWith('.tmp-')) continue;
    const st = await stat(join(dir, n)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 24 * 3600_000) await rm(join(dir, n), { recursive: true, force: true });
  }
  return gone;
}

/** 该不该做今天这份 */
export function dailyDue(list: readonly BackupMeta[], now: number): boolean {
  const last = list.find((b) => b.why === 'daily');
  return !last || now - Date.parse(last.at) >= DAILY_EVERY_MS;
}

/**
 * 恢复:先把现在的样子也备份一份(恢复错了还能回来),再把那一份拷回去。只覆盖备份里有的文件,之后新多出来的不删。
 * 服务要先停(main.ts 管)。外面的 vault 不动,回 vaultCopy 告诉家长在哪。
 */
export async function restoreBackup(t: BackupTarget, name: string, o: { version?: string | null; now?: Date; freeBytes?: () => Promise<number> } = {}): Promise<{ files: number; safety: string; vaultCopy: string | null }> {
  const root = resolve(t.root);
  const target = (await listBackups(root)).find((b) => b.name === name);
  if (!target) throw new UsageError(`没有这份备份:${name}(cotutor backup list 看有哪些)`);
  const from = join(backupsOf(root), name);
  const safety = await makeBackup(t, { why: 'restore', version: o.version, now: o.now, freeBytes: o.freeBytes });
  let files = 0;
  for await (const f of walk(from, from)) {
    if (f.rel === META || f.rel.split('/')[0] === VAULT_DIR) continue;
    const dest = join(root, ...f.rel.split('/'));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(f.path, dest);
    await utimes(dest, f.st.atime, f.st.mtime).catch(() => undefined);
    files++;
  }
  return { files, safety: safety.name, vaultCopy: target.vault === 'copied' ? join(from, VAULT_DIR) : null };
}

/** 一份给人看的样子 */
export function describeBackup(b: BackupMeta): string {
  const mb = (n: number): string => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
  const why = { daily: '每天', upgrade: '升级前', manual: '手动', restore: '恢复前' }[b.why] ?? b.why;
  return `${b.name}  ${why} · ${b.files} 个文件 · ${mb(b.bytes)}(新占 ${mb(b.newBytes)})${b.version ? ` · ${b.version}` : ''}`;
}

/**
 * serve 起来时调:隔一阵看一眼,该备份了就备一份。孩子在通话时往后推(拷文件占磁盘,不和通话抢)。
 * 备份失败不影响服务,只进日志,doctor 看「最近一份是多久以前」就知道了。定时器不拦进程退出。
 */
export function startDailyBackups(o: { target: () => BackupTarget | null; busy: () => boolean; version: string | null; now?: () => number; firstMs?: number; everyMs?: number; note?: (text: string) => void; freeBytes?: () => Promise<number> }): () => void {
  let running = false;
  const now = o.now ?? Date.now;
  const check = async (): Promise<void> => {
    const t = o.target();
    if (running || !t || o.busy()) return;
    running = true;
    try {
      if (dailyDue(await listBackups(t.root), now())) await makeBackup(t, { why: 'daily', version: o.version, now: new Date(now()), freeBytes: o.freeBytes });
    } catch (err) {
      (o.note ?? ((s: string) => console.error(s)))(`备份没成:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => { void check(); }, o.firstMs ?? 5 * 60_000);
  first.unref();
  const every = setInterval(() => { void check(); }, o.everyMs ?? 3600_000);
  every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}
