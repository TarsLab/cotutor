/**
 * 这个 serve 跑的是哪份代码:版本号、git 提交(包目录自己是 git 仓才有;npm 装的没有)、有没有没提交的改动、启动时刻。
 * 仓里的提交后来变了 = 代码更新了,要重起 serve 才用上(serve 只热重载 cotutor.json;Ray 跑的是仓里检出的分支)。
 * 工作台侧栏(/api/health)与孩子端流水的打开那行(srv)用。
 */
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readVersion(): string | null {
  try {
    return (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return null;
  }
}

/** 包目录自己是 git 仓才认(装在别人的仓里的 node_modules 不算) */
function readCommit(): { commit: string | null; dirty: boolean } {
  const git = (args: string[]): string => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
  try {
    if (realpathSync(git(['rev-parse', '--show-toplevel'])) !== realpathSync(ROOT)) return { commit: null, dirty: false };
    return { commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--untracked-files=no']) !== '' };
  } catch {
    return { commit: null, dirty: false };
  }
}

/** 起来那一刻:commit 是完整哈希,显示时取前 7 位 */
export const BUILD: { version: string | null; commit: string | null; dirty: boolean; started: string } = { version: readVersion(), ...readCommit(), started: new Date().toISOString() };

export const shortCommit = (c: string | null): string | null => (c ? c.slice(0, 7) : null);

/** 仓里现在的提交(十秒内复用);不是 git 仓 → null */
let cached = { at: 0, head: null as string | null };
export async function headNow(): Promise<string | null> {
  if (!BUILD.commit) return null;
  if (Date.now() - cached.at < 10_000) return cached.head;
  const head = await new Promise<string | null>((resolve) => execFile('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { timeout: 3000 }, (err, out) => resolve(err ? null : String(out).trim() || null)));
  cached = { at: Date.now(), head };
  return head;
}

/** 代码更新了没有:起来时的提交与仓里现在的都知道、而且不一样 */
export const codeChanged = (started: string | null, head: string | null): boolean => Boolean(started && head && started !== head);
