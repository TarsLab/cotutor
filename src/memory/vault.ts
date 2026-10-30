/**
 * 家长的 vault(从 runtime/journal/store.ts 搬来,2026-10-29,行为不变):《obsidian仓库设计.md》§6 的封闭清单——日记只追加,教材只读,
 * 记忆文件按「## 记忆」段增、改、删,删话题时撤回这个话题写进去的。扫 vault 按 `cotutor:` 属性找档案、入口、记忆。
 * 只要 vault 那几个路径(paths),不认整个 workspace;先 .tmp 再 rename。
 */
import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { removeDiaryBlock } from './diary.ts';
import { applyMemoryOps, clipNote, frontmatter, memoryPath, memoryTemplate, parseMemoryOp, textHash, undoMemoryLines, type MemoryLine, type VaultNote } from './vault-notes.ts';
import type { ConversationMessage, PathRole } from '../schema/index.ts';

/** vault 在哪:workspace 的 paths(vault、diary、plans、textbooks…);传整个 workspace 也行 */
export interface Vault {
  paths: Readonly<Record<PathRole, string>>;
}

/** 删话题撤销了多少:记忆几行、日记几段;找不到原文没撤的(家长或整理那轮后来改过)一条一句 */
export interface ThreadUndo {
  memory: number;
  diary: number;
  misses: string[];
}

/**
 * 删话题时撤回它留在 vault 里的:各轮写进记忆的行(memoryLines)倒着撤、记账写进日记的那段(diaryBlock)摘掉;
 * 找不到原文的(家长或整理那轮后来改过)不撤,一条一句列进 misses
 */
export async function undoThreadVault(v: Vault, tutor: string, date: string, gone: readonly ConversationMessage[]): Promise<ThreadUndo> {
  const undo: ThreadUndo = { memory: 0, diary: 0, misses: [] };
  const edits = gone.flatMap((m) => m.memoryLines ?? []);
  if (edits.length) {
    // activity 话题写的是 activity 自己的记忆(agent: <老师>/<activity>)
    const run = gone.find((m) => m.activity)?.activity;
    const agent = run ? `${tutor}/${run.name}` : tutor;
    const found = (await scanVault(v)).notes.find((n) => n.props.cotutor === 'memory' && n.props.agent?.trim() === agent);
    if (!found) undo.misses.push('记忆文件不在了,记忆没撤');
    else {
      const r = undoMemoryLines(found.text, edits);
      undo.memory = r.undone;
      undo.misses.push(...r.misses.map((l) => `记忆:找不到这行,没撤:${l}`));
      if (r.undone) {
        const file = join(v.paths.vault, found.path);
        await writeFile(`${file}.tmp`, r.text);
        await rename(`${file}.tmp`, file);
      }
    }
  }
  for (const m of gone) {
    if (!m.diaryBlock) continue;
    const existing = await readFile(join(v.paths.diary, `${date}.md`), 'utf8').catch(() => null);
    const out = existing === null ? null : removeDiaryBlock(existing, m.diaryBlock);
    if (out === null) { undo.misses.push(`日记:${date} 里找不到这个话题记的那段,没摘`); continue; }
    await writeDiary(v, date, () => out);
    undo.diary++;
  }
  return undo;
}

/** 这几天的日记(<日记目录>/<日期>.md);没有的跳过 */
export async function readDiaries(v: Vault, dates: readonly string[]): Promise<{ date: string; text: string }[]> {
  const out: { date: string; text: string }[] = [];
  for (const date of dates) {
    try {
      out.push({ date, text: await readFile(join(v.paths.diary, `${date}.md`), 'utf8') });
    } catch {
      /* 那天没写 */
    }
  }
  return out;
}

/** 当天的日记:update 拿现有内容(没有 → null)回新内容;先 .tmp 再 rename。返回文件名(<日期>.md) */
export async function writeDiary(v: Vault, date: string, update: (existing: string | null) => string): Promise<string> {
  await mkdir(v.paths.diary, { recursive: true });
  const file = join(v.paths.diary, `${date}.md`);
  const existing = await readFile(file, 'utf8').catch(() => null);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, update(existing));
  await rename(tmp, file);
  return basename(file);
}

/** 教材目录下的每册文件(<教材目录>/<册>.md),给 textbookHeadings;没有目录 → [] */
export async function readTextbooks(v: Vault): Promise<{ name: string; text: string }[]> {
  let names: string[];
  try {
    names = (await readdir(v.paths.textbooks)).filter((f) => f.endsWith('.md') && !f.startsWith('.')).sort();
  } catch {
    return [];
  }
  const out: { name: string; text: string }[] = [];
  for (const name of names) {
    try {
      out.push({ name, text: await readFile(join(v.paths.textbooks, name), 'utf8') });
    } catch {
      /* 读不到就跳过 */
    }
  }
  return out;
}

/**
 * 扫 vault:所有文件的相对路径(解析 [[链接]] 用)+ 带 `cotutor:` 属性的 md(按属性定位,《obsidian仓库设计.md》2026-09-17)。
 * 跳过点开头的目录(.obsidian / .git)与日记、计划目录(机器写的,不带属性,越积越多)。读不到的文件跳过;vault 不在 → 全空。
 */
export async function scanVault(v: Vault): Promise<{ notes: VaultNote[]; files: string[] }> {
  const root = v.paths.vault;
  const skip = new Set([v.paths.diary, v.paths.plans]);
  const notes: VaultNote[] = [];
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(abs)) await walk(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = relative(root, abs).split(sep).join('/');
      files.push(rel);
      if (!e.name.endsWith('.md')) continue;
      try {
        const text = await readFile(abs, 'utf8');
        const props = frontmatter(text);
        if (props.cotutor) notes.push({ path: rel, props, text });
      } catch {
        /* 读不到(iCloud 占位)就跳过 */
      }
    }
  };
  await walk(root);
  return { notes, files: files.sort() };
}

/** 要写进记忆文件的一次改动(还没写):planVaultMemory 算,writeVaultMemory 写 */
export interface MemoryPlan {
  /** 相对 vault 根 */
  file: string;
  /** 算的时候文件的原文;新建 = null */
  base: string | null;
  text: string;
  changes: string[];
  lines: MemoryLine[];
}

/**
 * 「## 记忆」段 → 这位 agent 的记忆文件要怎么改(按 `cotutor: memory` + `agent:` 找;没有就建 记忆/<显示名>.md),只算不写:
 * 新增追加到末尾,「改:」「删:」按原话找行改、删(任何一行都能动,2026-09-18);缺省位置已有一篇没属性的同名文件就不碰,进提醒。
 * seen = 这一轮上下文包里老师看到的那版(截过的那段的 textHash 与截的字数):文件和它对不上 = 这轮里家长改过,
 * 改、删只认一字不差的原话,找不到的不改——按「包含」找会把家长刚补上的半句一起盖掉(2026-10-30)。
 */
export async function planVaultMemory(v: Vault, o: { agent: string; display: string; items: readonly string[]; date: string; seen?: { path: string; hash: string; clip: number } }): Promise<{ plan: MemoryPlan | null; warnings: string[] }> {
  const found = (await scanVault(v)).notes.find((n) => n.props.cotutor === 'memory' && n.props.agent?.trim() === o.agent);
  const file = found?.path ?? memoryPath(o.display);
  if (!found && (await stat(join(v.paths.vault, file)).catch(() => null)) !== null) return { plan: null, warnings: [`记忆没写:${file} 已经有了但没有 cotutor: memory / agent: ${o.agent} 属性;加上属性,或挪开它`] };
  const base = found?.text ?? null;
  const strict = base !== null && o.seen?.path === file && textHash(clipNote(base, o.seen.clip, 'tail').text) !== o.seen.hash;
  const r = applyMemoryOps(base ?? memoryTemplate(o.agent, o.display), o.items.map(parseMemoryOp), o.date, { strict });
  const warnings = !r.misses.length ? [] : strict ? [`记忆:这轮里家长改过记忆文件,找不到原话的没改(不盖掉家长改的):${r.misses.join(';')}`] : [`记忆:找不到原话,没改:${r.misses.join(';')}`];
  if (!r.changes.length) return { plan: null, warnings };
  return { plan: { file, base, text: r.text, changes: r.changes, lines: r.lines }, warnings };
}

/** 写下 planVaultMemory 算好的:先重读,和算的时候不一样(家长刚存了一版)就不写,回为什么;写成回 null。先 .tmp 再 rename */
export async function writeVaultMemory(v: Vault, plan: MemoryPlan): Promise<string | null> {
  const file = join(v.paths.vault, plan.file);
  if ((await readFile(file, 'utf8').catch(() => null)) !== plan.base) return `记忆没写:${plan.file} 刚被改过,这轮的记忆没写:${plan.changes.join(';')}`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, plan.text);
  await rename(`${file}.tmp`, file);
  return null;
}
