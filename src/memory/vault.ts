/**
 * 家长的 vault(从 server/store.ts 搬来,2026-10-29,行为不变):《obsidian仓库设计.md》§6 的封闭清单——日记只追加,教材只读,
 * 记忆文件按「## 记忆」段增、改、删,删话题时撤回这个话题写进去的。扫 vault 按 `cotutor:` 属性找档案、入口、记忆。
 * 只要 vault 那几个路径(paths),不认整个 workspace;先 .tmp 再 rename。
 */
import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { removeDiaryBlock } from '../lib/diary.ts';
import { applyMemoryOps, frontmatter, memoryPath, memoryTemplate, parseMemoryOp, undoMemoryLines, type MemoryLine, type VaultNote } from '../lib/vault-notes.ts';
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

/**
 * 把「## 记忆」段落进这位 agent 的记忆文件(按 `cotutor: memory` + `agent:` 找;没有就建 记忆/<显示名>.md):
 * 新增追加到末尾,「改:」「删:」按原话找行改、删(任何一行都能动,2026-09-18);缺省位置已有一篇没属性的同名文件就不碰,进提醒。先 .tmp 再 rename。
 */
export async function updateVaultMemory(v: Vault, agent: string, display: string, items: readonly string[], date: string): Promise<{ file: string | null; changes: string[]; lines: MemoryLine[]; warnings: string[] }> {
  const found = (await scanVault(v)).notes.find((n) => n.props.cotutor === 'memory' && n.props.agent?.trim() === agent);
  let file: string;
  let existing: string;
  if (found) {
    file = join(v.paths.vault, found.path);
    existing = found.text;
  } else {
    file = join(v.paths.vault, memoryPath(display));
    if ((await stat(file).catch(() => null)) !== null) return { file: null, changes: [], lines: [], warnings: [`记忆没写:${memoryPath(display)} 已经有了但没有 cotutor: memory / agent: ${agent} 属性;加上属性,或挪开它`] };
    existing = memoryTemplate(agent, display);
  }
  const r = applyMemoryOps(existing, items.map(parseMemoryOp), date);
  const warnings = r.misses.length ? [`记忆:找不到原话,没改:${r.misses.join(';')}`] : [];
  if (!r.changes.length) return { file: null, changes: [], lines: [], warnings };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, r.text);
  await rename(`${file}.tmp`, file);
  return { file, changes: r.changes, lines: r.lines, warnings };
}
