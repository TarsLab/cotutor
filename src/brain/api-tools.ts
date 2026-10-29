/**
 * API 脑的只读工具:read_file、glob、grep_search,名字与参数同 qwen 那三样(家长端的工具清单、工具分类照旧认)。
 * 只读 roots 里的(workspace 根与 vault,runner 的 readDirsOf):真实路径出了 roots 不读(符号链接越界也算),隐藏目录(.cotutor、.git、.obsidian)不读;
 * 单文件、每次返回的字数、查找的文件数都有上限;只读文本(教材、日记、档案),图片读不了——本轮的照片已经附在消息里。
 * 从 cotutor-api-prototype 的 materials.ts 来,那边验过越界与大文件。
 */
import { constants } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';

const TEXT = new Set(['.md', '.txt', '.json', '.csv', '.tsv', '.yaml', '.yml']);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic']);
/** 单个文件最大多少字节;一次 read_file 回多少字(长的分页,offset 接着读) */
const FILE_MAX = 512 * 1024;
const PAGE = 12_000;
/** 一次查找最多看多少个条目、多深;最多回几条 */
const WALK_MAX = 3000;
const DEPTH_MAX = 8;
const GLOB_MAX = 50;
const GREP_FILES = 200;
const GREP_MAX = 30;

async function boundedRead(path: string, limit: number, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('只读普通文件');
    if (stat.size > limit) throw new Error(`文件太大(${stat.size} 字节,上限 ${limit})`);
    const buf = Buffer.alloc(limit + 1);
    let n = 0;
    while (n < buf.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(buf, n, buf.length - n, null);
      if (!bytesRead) break;
      n += bytesRead;
    }
    if (n > limit) throw new Error('文件太大');
    return buf.subarray(0, n);
  } finally {
    await file.close();
  }
}

/** 通配:* 任意字符(含 /),? 一个字符;不跑模型给的正则 */
function wildcard(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let retry = 0;
  while (t < text.length) {
    if (pattern[p] === '?' || pattern[p] === text[t]) { p++; t++; }
    else if (pattern[p] === '*') { star = p++; retry = t; }
    else if (star >= 0) { p = star + 1; t = ++retry; }
    else return false;
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}

const hidden = (rel: string): boolean => rel.split(sep).some((s) => s.startsWith('.'));
/** relative(root, p) 出了 root */
const outside = (rel: string): boolean => rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);

/**
 * 这轮的只读工具。roots[0] 是相对路径的起点(workspace 根);images = 本轮已经附在消息里的照片(绝对路径),老师去读它们时告诉它已经看得到了。
 */
export function readOnlyTools(roots: readonly string[], opts: { images?: readonly string[] } = {}) {
  let real: Promise<string[]> | null = null;
  const realRoots = (): Promise<string[]> => (real ??= Promise.all(roots.map((r) => realpath(r).catch(() => null))).then((rs) => [...new Set(rs.filter((r): r is string => r !== null))]));
  const attached = new Set(opts.images ?? []);

  /** 路径 → roots 里的真实路径;出界、隐藏的抛 */
  async function inside(path: string): Promise<string> {
    const abs = isAbsolute(path) ? path : resolve(roots[0] ?? '.', path);
    const file = await realpath(abs).catch(() => {
      throw new Error(`没有这个文件:${path}`);
    });
    for (const root of await realRoots()) {
      const rel = relative(root, file);
      if (!outside(rel)) {
        if (hidden(rel)) throw new Error('隐藏目录里的文件不读');
        return file;
      }
    }
    throw new Error('只能读 workspace 与 vault 里的文件');
  }

  async function textOf(path: string, signal?: AbortSignal): Promise<string> {
    const file = await inside(path);
    const ext = extname(file).toLowerCase();
    if (IMAGE.has(ext)) throw new Error(attached.has(path) || attached.has(file) ? '这张图已经附在这条消息里了,直接看图' : '图片读不了;要看的图请孩子拍了交上来');
    if (!TEXT.has(ext)) throw new Error('只读 md / txt / json / csv / tsv / yaml');
    return (await boundedRead(file, FILE_MAX, signal)).toString('utf8');
  }

  /** roots 里的文本文件(绝对路径);under 给了就只看那个目录 */
  async function files(signal?: AbortSignal, under?: string): Promise<{ paths: string[]; truncated: boolean }> {
    const found: string[] = [];
    let seen = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > DEPTH_MAX || seen > WALK_MAX) return;
      signal?.throwIfAborted();
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (++seen > WALK_MAX) return;
        if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p, depth + 1);
        else if (e.isFile() && TEXT.has(extname(e.name).toLowerCase())) found.push(p);
      }
    };
    const starts = under ? [await inside(under)] : await realRoots();
    for (const s of starts) await walk(s, 0);
    return { paths: [...new Set(found)].sort(), truncated: seen > WALK_MAX };
  }

  const relOf = async (p: string): Promise<string> => {
    for (const root of await realRoots()) {
      const rel = relative(root, p);
      if (!outside(rel)) return rel;
    }
    return p;
  };

  return {
    read_file: tool({
      description: '读 workspace 或 vault 里的一个文本文件(教材、日记、档案)。file_path 给绝对路径(上下文包里给的就是);长文件分页,offset 是从第几个字接着读。图片读不了,本轮的照片已经附在消息里。',
      inputSchema: z.object({ file_path: z.string().min(1).max(1000), offset: z.number().int().min(0).max(FILE_MAX).optional() }),
      execute: async ({ file_path, offset = 0 }, { abortSignal }) => {
        const text = await textOf(file_path, abortSignal);
        return { file_path, text: text.slice(offset, offset + PAGE), ...(text.length > offset + PAGE ? { more: true, next: offset + PAGE } : {}) };
      },
    }),
    glob: tool({
      description: '按文件名找 workspace 与 vault 里的文本文件。pattern 里 * 是任意字符(含 /),? 是一个字符,如 *期中*.md;回绝对路径。',
      inputSchema: z.object({ pattern: z.string().min(1).max(200) }),
      execute: async ({ pattern }, { abortSignal }) => {
        const all = await files(abortSignal);
        const hits: string[] = [];
        for (const p of all.paths) if (wildcard(pattern, await relOf(p)) || wildcard(pattern, p)) hits.push(p);
        return { paths: hits.slice(0, GLOB_MAX), ...(all.truncated || hits.length > GLOB_MAX ? { truncated: true } : {}) };
      },
    }),
    grep_search: tool({
      description: '在 workspace 与 vault 的文本文件里找一个词(照字面找,不是正则);path 给了就只找那个目录。回文件、行号与那一行。',
      inputSchema: z.object({ pattern: z.string().min(1).max(200), path: z.string().min(1).max(1000).optional() }),
      execute: async ({ pattern, path }, { abortSignal }) => {
        const all = await files(abortSignal, path);
        const matches: { file_path: string; line: number; text: string }[] = [];
        for (const p of all.paths.slice(0, GREP_FILES)) {
          abortSignal?.throwIfAborted();
          const text = await boundedRead(p, FILE_MAX, abortSignal).then((b) => b.toString('utf8'), () => null);
          if (text === null) continue;
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (!lines[i].includes(pattern)) continue;
            matches.push({ file_path: p, line: i + 1, text: lines[i].slice(0, 200) });
            if (matches.length >= GREP_MAX) return { matches, truncated: true };
          }
        }
        return { matches, ...(all.truncated || all.paths.length > GREP_FILES ? { truncated: true } : {}) };
      },
    }),
  };
}
