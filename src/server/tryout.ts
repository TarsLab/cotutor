/**
 * 试用话题第二天删(《备课设计.md》§12.3):家长在孩子端扮孩子跑过的话题,找问题用的,改落在文件里(课文件、老师文件),聊天记录不留。
 * 删:索引里这个话题(消息、会话、星、记账标记、lessons 那一项)与这些轮的 <日期>.<job>.* 文件(store.deleteThread);
 * 这些消息带的照片(captures/,别的消息还引用的留着);claude 的会话文件(~/.claude/projects/<项目>/<会话 id>.jsonl,找不到就算了)。
 * 不删:这天的费用合计(钱真花了);试用里起的课包(本身就是素材)。
 * 什么时候:serve 起来时、家长端每天第一次读清单时(app.ts),删日期早于今天的。今天试的今晚都在。
 */
import { readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Workspace } from '../cli/workspace.ts';
import { isTryThread, localDate, threads } from '../lib/conversation.ts';
import { deleteThread, listDates, readIndex } from './store.ts';

export interface SweptThread {
  tutor: string;
  date: string;
  thread: string;
  jobs: number;
  photos: number;
  /** 删掉的会话文件(绝对路径);没有会话或找不到 = null */
  session: string | null;
}

export async function sweepTryouts(ws: Workspace, now: Date, opts: { claudeProjects?: string } = {}): Promise<SweptThread[]> {
  const today = localDate(now);
  const projects = opts.claudeProjects ?? join(homedir(), '.claude', 'projects');
  const out: SweptThread[] = [];
  const tutors = (await readdir(ws.dirs.conversations, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const tutor of tutors) {
    for (const date of await listDates(ws, tutor)) {
      if (date >= today) continue;
      let index = await readIndex(ws, tutor, date);
      const tries = [...new Set(threads(index.messages))].filter((th) => isTryThread(index.messages, th));
      for (const thread of tries) {
        const ths = threads(index.messages);
        const mine = index.messages.filter((_, i) => ths[i] === thread);
        const session = index.sessions[thread]?.id ?? null;
        index = await deleteThread(ws, tutor, date, thread, { keepCost: true });
        // 照片:只删这个话题自己的(剩下的消息还引用的不动),只认 workspace 根以内的
        const still = new Set(index.messages.flatMap((m) => m.photos ?? []));
        let photos = 0;
        for (const rel of new Set(mine.flatMap((m) => m.photos ?? []))) {
          const file = resolve(ws.root, rel);
          if (still.has(rel) || !file.startsWith(ws.root + sep)) continue;
          if ((await stat(file).catch(() => null))?.isFile()) { await rm(file, { force: true }); photos++; }
        }
        out.push({ tutor, date, thread, jobs: mine.length, photos, session: session ? await removeSession(projects, session) : null });
      }
    }
  }
  return out;
}

/** claude 按 cwd 分目录存会话(老师会话的 cwd 是 agents/<name>/,目录名是路径转写的);会话 id 是 uuid,挨个目录找 <id>.jsonl */
async function removeSession(projects: string, id: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]{8,}$/.test(id)) return null; // 拼进路径的,只认字母数字连字符
  for (const d of await readdir(projects, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory()) continue;
    const file = join(projects, d.name, `${id}.jsonl`);
    if ((await stat(file).catch(() => null))?.isFile()) {
      await rm(file, { force: true });
      await rm(join(projects, d.name, id), { recursive: true, force: true });
      return file;
    }
  }
  return null;
}
