/**
 * 作业本:检查作业拍的照片,按学科、按天攒在 vault 的 `作业本/<学科>/<YYYY-MM-DD>/` 下(路径角色 homework),一天一章,跨话题。
 * 照片还是先落 workspace 的 captures/<日期>/<HHMM>-<n>.jpg(认字、上下文包、孩子端取图都认那里),检查作业的话题收到就照原名另抄一份进来;
 * vault 是家长的:家长在这里看、删、导出 PDF,作业本有哪几天、一天有哪几张就照这里列(删了的不再出)。
 * 这里只管 vault 这一侧:列哪几天、一天几张、抄进来、取一张的路径;铺成页、以前的记号在 src/runtime/homework.ts。
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DATE_RE } from '../schema/index.ts';

/** 作业本里收哪几种图(captures 里孩子端缩好的 jpeg;工作台传的可能是 png) */
const PHOTO_RE = /^[^/\\.][^/\\]{0,80}\.(jpe?g|png)$/i;
/** 学科(文件夹名):不带路径分隔、不以点开头 */
const SUBJECT_RE = /^[^/\\.][^/\\]{0,40}$/;

/** 一天里的照片照拍的先后:文件名是 <HHMM>-<n>,按数排 */
const byName = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/** 一天有哪几张(文件名,照先后);没有这一天 = [] */
export async function homeworkPhotos(dir: string, subject: string, day: string): Promise<string[]> {
  if (!SUBJECT_RE.test(subject) || !DATE_RE.test(day)) return [];
  const names = await readdir(join(dir, subject, day)).catch(() => [] as string[]);
  return names.filter((n) => PHOTO_RE.test(n)).sort(byName);
}

/** 这一科的作业本有哪几天(有照片的,从早到晚)和每天几张 */
export async function homeworkDays(dir: string, subject: string): Promise<{ day: string; n: number }[]> {
  if (!SUBJECT_RE.test(subject)) return [];
  const days = (await readdir(join(dir, subject)).catch(() => [] as string[])).filter((d) => DATE_RE.test(d)).sort();
  const out: { day: string; n: number }[] = [];
  for (const day of days) {
    const n = (await homeworkPhotos(dir, subject, day)).length;
    if (n) out.push({ day, n });
  }
  return out;
}

/** 一张的路径;名字不对、不在 = null */
export async function homeworkFile(dir: string, subject: string, day: string, name: string): Promise<string | null> {
  if (!SUBJECT_RE.test(subject) || !DATE_RE.test(day) || !PHOTO_RE.test(name)) return null;
  const file = join(dir, subject, day, name);
  return (await stat(file).catch(() => null))?.isFile() ? file : null;
}

/** 抄一张进来(那一天、照原名);已经在的不动。回抄没抄成(名字不对、写不进去都是 false,不抛) */
export async function keepHomework(dir: string, subject: string, day: string, name: string, from: string): Promise<boolean> {
  if (!SUBJECT_RE.test(subject) || !DATE_RE.test(day) || !PHOTO_RE.test(name)) return false;
  const to = join(dir, subject, day);
  if (await homeworkFile(dir, subject, day, name)) return true;
  try {
    await mkdir(to, { recursive: true });
    await copyFile(from, join(to, name));
    return true;
  } catch {
    return false;
  }
}
