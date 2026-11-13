/**
 * 作业照片上认出的字词,存在照片旁边:`captures/<日期>/<HHMM>-<n>.jpg.words.json`(认的进度与结果,一张照片只认一次)。
 * 谁用:照片板(src/chalk/kit/photo.ts 的操作「点字」)——孩子在板上点一个字词、圈一个字词,舞台照这里的框在本地算出是哪一项,不等老师。
 * 什么时候认:孩子在写了「认字收到什么」的 activity 里发照片,runner 那一轮一开始就在后台认(和老师写板书同时),流式,一行一项地落盘;
 * 板开着时页面轮询这份文件,框一个一个出来。听写页自己的照片(dictation/photos/)不走这里。
 * 认的规则(提示词怎么拼、一行一段怎么解析)在 ./recognize.ts;看图的请求由调用的那层交进来(场景不引 media)。
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { VISION_TIMEOUT_MS, type PhotoItem, type PhotoLine, type PhotoProgress, type Recognize } from './recognize.ts';

export interface WordsRecord {
  /** 开始认的时刻 */
  at: string;
  /** running 正在认(items 是已经认出的)/ done 认完 / failed 没认成(items 是失败前认出的) */
  state: 'running' | 'done' | 'failed';
  items: PhotoItem[];
  lesson: string | null;
  /** 正文全文:一行一个字符串,词之间空一格 */
  full: string[];
  /** 正文一行一行的框(点正文里任意一个字用);认的时候要了行框才有 */
  lines?: PhotoLine[];
  error?: string;
  model?: string;
  ms?: number;
}

/** 给孩子端的样子:认到哪了、带框的字词(没框的点不了,不发) */
export interface KidWords {
  state: WordsRecord['state'] | 'none';
  items: { text: string; box: [number, number, number, number]; pick: boolean }[];
  /** 正文的行:字与框 */
  lines: PhotoLine[];
}

export const wordsFile = (photoFile: string): string => `${photoFile}.words.json`;

export async function readWords(photoFile: string): Promise<WordsRecord | null> {
  try {
    return JSON.parse(await readFile(wordsFile(photoFile), 'utf8')) as WordsRecord;
  } catch {
    return null;
  }
}

let tmpSeq = 0;
async function writeWords(photoFile: string, r: WordsRecord): Promise<void> {
  const file = wordsFile(photoFile);
  // 先写临时文件再换名:页面轮询读不到半截
  const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
  await writeFile(tmp, `${JSON.stringify(r)}\n`);
  await rename(tmp, file);
}

/** 正在认的那份多久没认完算丢了(服务中途重起):比看图的超时长一点,过了就重认 */
const STALE_MS = VISION_TIMEOUT_MS + 15_000;

/**
 * 认这张照片(后台,流式落盘);认过、正在认的不再认。回那个后台的活(done;没起就是 null);出错、超时都不抛,记成 failed。
 * 没认成的不自动重认:孩子再发同一张不会,发新拍的那张是新文件。
 */
export async function startWords(photoFile: string, recognize: Recognize, opts: { now?: () => Date } = {}): Promise<{ done: Promise<void> } | null> {
  const now = opts.now ?? (() => new Date());
  const had = await readWords(photoFile);
  if (had && (had.state !== 'running' || now().getTime() - Date.parse(had.at) < STALE_MS)) return null;
  const data = await readFile(photoFile).catch(() => null);
  if (!data) return null;
  const at = now().toISOString();
  let last: PhotoProgress = { items: [], lesson: null, full: [] };
  await writeWords(photoFile, { at, state: 'running', ...last });
  // 落盘排着队:流式回调一行一次,前一次没写完后一次接着写,文件里总是最新的那份
  let queue: Promise<void> = Promise.resolve();
  const put = (r: WordsRecord): void => { queue = queue.then(() => writeWords(photoFile, r)).catch(() => undefined); };
  const mime = /\.png$/i.test(photoFile) ? 'image/png' : 'image/jpeg';
  const done = (async (): Promise<void> => {
    const r = await recognize({ data, mime }, (p) => { last = p; put({ at, state: 'running', ...p }); }).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err), ...last, ms: 0 }));
    put({ at, state: r.ok ? 'done' : 'failed', items: r.items, lesson: r.lesson, full: r.full, ...(r.lines?.length ? { lines: r.lines } : {}), ms: r.ms, ...(r.ok ? { model: r.model } : { error: r.error }) });
    await queue;
  })();
  return { done };
}

/** 孩子端要的那一份:只有带框的项,念法、哪一栏不发 */
export function kidWords(r: WordsRecord | null): KidWords {
  if (!r) return { state: 'none', items: [], lines: [] };
  return { state: r.state, items: r.items.flatMap((it) => (it.box ? [{ text: it.text, box: it.box, pick: it.pick }] : [])), lines: r.lines ?? [] };
}
