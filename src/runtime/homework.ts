/**
 * 作业本(activity 头上 base: homework,出厂的「检查作业」):检查作业拍的照片按学科、按天攒成一本,跨话题;孩子端是一整本连着往下滚(老的在上,新拍的接在后面,最后一张白纸)。
 * vault 那一侧(列哪几天、抄进去)在 src/memory/homework.ts;这里把它和一节课接上:
 *  - 收到照片:照原名抄进 vault 的 作业本/<学科>/<日期>/(keepHomework)。
 *  - 铺作业本(homeworkBookPage):最近 HOMEWORK_BOOK_DAYS 个拍过的天(和今天)铺成一张照片页(id「作业」,title「作业本」,day = 今天),每张记着哪天拍的;
 *    照片在页上照旧用 captures/ 的路径(认字、取图、附给老师都认那里),captures 里没有的(sandbox、家长自己放进 vault 的)先抄回去。
 *  - 以前的记号(homeworkPast):一张照片上,别的话题(在这个话题之前的)画的圈、划、加点和孩子的笔,照那个话题最后的样子,
 *    换成这张照片自己的坐标(一张宽 1000,左上角起)。只看不改:舞台垫在这一节自己的那层下面画,擦不掉、不变旧、不收。
 *    遮、盖和白纸条不带:它们盖着页上的字,只看不改的页上孩子揭不开、收不起来。一次给一整本的(读一遍以前的话题)。
 *  - 导出(homeworkPdf):家长端选几天,一张照片一页(src/shared/pdf.ts)。
 * 规矩与样子在 docs/dev/照片页.md 的「作业本」。
 */
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { dayTitle, markFresh, photoSheetBox } from '../board/lesson.ts';
import { homeworkDays, homeworkFile, homeworkPhotos, keepHomework } from '../memory/homework.ts';
import { DATE_RE, HOMEWORK_TITLE, LINE_MARKS, LessonSchema, PHOTO_PAGE, canonicalSubject, type Box, type Lesson, type PagePhoto, type PageSource, type Workspace } from '../schema/index.ts';
import { imageSize, jpegInfo } from '../shared/jpeg.ts';
import { jpegPdf } from '../shared/pdf.ts';

/** 作业本按学科分:这位老师的学科(三门主科归一);没写学科的用老师的名字 */
export function homeworkSubject(ws: Workspace, tutor: string): string {
  return canonicalSubject(ws.config.tutors[tutor]?.subject) ?? tutor;
}

/** 作业本铺最近多少个拍过的天(一天一两张,够一个多学期;再早的家长端还能导出) */
export const HOMEWORK_BOOK_DAYS = 60;

/** captures 里的一张(相对 workspace 根)是哪天、叫什么;不在 captures/<日期>/ 下 = null */
function captureDay(ws: Workspace, rel: string): { day: string; name: string } | null {
  const parts = relative(ws.paths.captures, join(ws.root, rel)).split(sep);
  return parts.length === 2 && DATE_RE.test(parts[0]) ? { day: parts[0], name: parts[1] } : null;
}

/** 作业本有哪几天(从早到晚)、每天几张、章名 */
export async function homeworkDaysOf(ws: Workspace, tutor: string): Promise<{ day: string; n: number; title: string }[]> {
  return (await homeworkDays(ws.paths.homework, homeworkSubject(ws, tutor))).map((d) => ({ ...d, title: dayTitle(d.day) }));
}

/** 检查作业的话题收到的照片:照原名抄进作业本那一天(照片落在 captures 的哪一天就是哪一天);抄不进去的不管(照片还在 captures) */
export async function keepPhotos(ws: Workspace, tutor: string, photos: readonly string[]): Promise<void> {
  const subject = homeworkSubject(ws, tutor);
  for (const rel of photos) {
    const at = captureDay(ws, rel);
    if (at) await keepHomework(ws.paths.homework, subject, at.day, at.name, join(ws.root, rel));
  }
}

/** 作业本里一天的照片(照 vault 里的先后,day 记着那一天);captures 里没有的先从 vault 抄回去,抄不回来、读不出宽高的跳过 */
async function dayPhotos(ws: Workspace, subject: string, day: string): Promise<PagePhoto[]> {
  const photos: PagePhoto[] = [];
  for (const name of await homeworkPhotos(ws.paths.homework, subject, day)) {
    const file = join(ws.paths.captures, day, name);
    if (!(await stat(file).catch(() => null))?.isFile()) {
      const from = await homeworkFile(ws.paths.homework, subject, day, name);
      if (!from) continue;
      await mkdir(dirname(file), { recursive: true }).catch(() => undefined);
      if (!(await copyFile(from, file).then(() => true, () => false))) continue;
    }
    const size = imageSize(await readFile(file).catch(() => Buffer.alloc(0)));
    if (size) photos.push({ src: relative(ws.root, file).split(sep).join('/'), ...size, day });
  }
  return photos;
}

/**
 * 作业本铺成一页:最近 HOMEWORK_BOOK_DAYS 个拍过的天,从早到晚,一张照片一个 day;今天(today)拍过的也在里面(这一条带的照片抄进去之前的)。
 * 一张都没拍过也铺(photos 空,舞台只画最后那张白纸)
 */
export async function homeworkBookPage(ws: Workspace, tutor: string, today: string, pick: boolean): Promise<Extract<PageSource, { kind: 'photo' }>> {
  const subject = homeworkSubject(ws, tutor);
  const days = (await homeworkDays(ws.paths.homework, subject)).filter((d) => d.day <= today).slice(-HOMEWORK_BOOK_DAYS);
  const photos: PagePhoto[] = [];
  for (const d of days) photos.push(...(await dayPhotos(ws, subject, d.day)));
  return { id: PHOTO_PAGE, kind: 'photo', title: HOMEWORK_TITLE, photos, pick, day: today };
}

/** 以前的记号:一张照片上别的话题留下的(这张照片自己的坐标:宽 1000,左上角起) */
export interface HomeworkPast {
  /** 老师的圈、划、加点(old = 那个话题结束时已经淡了的) */
  marks: { k: (typeof LINE_MARKS)[number]; text: string; box: Box; old?: true }[];
  /** 孩子的笔 */
  ink: [number, number][][];
}
/** 一张照片最多带多少以前的记号(多的留最近的) */
const PAST_MARKS_MAX = 60;
const PAST_INK_MAX = 400;

/** 话题的先后:日期,再是话题 id 的时刻和序号(<HHMM>-<n>) */
const threadKey = (date: string, thread: string): string => {
  const m = /^(\d{4})-(\d+)$/.exec(thread);
  return `${date} ${m ? `${m[1]} ${m[2].padStart(6, '0')}` : thread}`;
};

/**
 * 这几张照片(captures 里的,相对 workspace 根)上别的话题留下的记号,照话题的先后叠起来;键是照片的 src,没有记号的不给。
 * mine = 现在这个话题(它自己的不算,在它之后的也不算);没有(还没进门)= 别的都算。只看同一科的老师。以前的话题读一遍
 */
export async function homeworkPast(ws: Workspace, tutor: string, srcs: readonly string[], mine: { date: string; thread: string } | null): Promise<Record<string, HomeworkPast>> {
  const want = new Set(srcs.filter((src) => captureDay(ws, src)));
  if (!want.size) return {};
  const first = [...want].map((src) => captureDay(ws, src)!.day).sort()[0];
  const subject = homeworkSubject(ws, tutor);
  const upTo = mine ? threadKey(mine.date, mine.thread) : null;
  const found: { key: string; lesson: Lesson }[] = [];
  for (const name of Object.keys(ws.config.tutors).filter((n) => homeworkSubject(ws, n) === subject)) {
    const dir = join(ws.dirs.conversations, name);
    for (const f of await readdir(dir).catch(() => [] as string[])) {
      const m = /^(\d{4}-\d{2}-\d{2})\.(.+)\.lesson\.json$/.exec(f);
      if (!m || m[1] < first) continue;
      const key = threadKey(m[1], m[2]);
      if (upTo && key >= upTo) continue;
      const raw = await readFile(join(dir, f), 'utf8').catch(() => '');
      let parsed;
      try { parsed = raw ? LessonSchema.safeParse(JSON.parse(raw)) : null; } catch { parsed = null; }
      if (parsed?.success) found.push({ key, lesson: parsed.data });
    }
  }
  found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out: Record<string, HomeworkPast> = {};
  const of = (src: string): HomeworkPast => (out[src] ??= { marks: [], ink: [] });
  for (const { lesson } of found) {
    for (const p of lesson.pages) {
      if (p.kind !== 'photo') continue;
      const fresh = markFresh(lesson, p);
      p.photos.forEach((ph, i) => {
        if (!want.has(ph.src)) return;
        const [, top, , bottom] = photoSheetBox(p.photos, i, p.day);
        p.teacher.marks.forEach((mk, j) => {
          const cy = (mk.box[1] + mk.box[3]) / 2;
          if (!(LINE_MARKS as readonly string[]).includes(mk.k) || cy < top || cy > bottom) return;
          of(ph.src).marks.push({ k: mk.k as HomeworkPast['marks'][number]['k'], text: mk.text, box: [mk.box[0], mk.box[1] - top, mk.box[2], mk.box[3] - top], ...(fresh[j] ? {} : { old: true as const }) });
        });
        for (const st of p.kid.ink) {
          const y = st[0]?.[1];
          if (y === undefined || y < top || y > bottom) continue;
          of(ph.src).ink.push(st.map(([x, yy]) => [x, yy - top] as [number, number]));
        }
      });
    }
  }
  for (const [src, v] of Object.entries(out)) {
    if (!v.marks.length && !v.ink.length) delete out[src];
    else out[src] = { marks: v.marks.slice(-PAST_MARKS_MAX), ink: v.ink.slice(-PAST_INK_MAX) };
  }
  return out;
}

/** 导出:选的那几天,一张照片一页;不是 jpeg 的跳过(skipped 几张) */
export async function homeworkPdf(ws: Workspace, tutor: string, days: readonly string[]): Promise<{ pdf: Buffer; pages: number; skipped: number }> {
  const subject = homeworkSubject(ws, tutor);
  const images: Buffer[] = [];
  let skipped = 0;
  for (const day of [...new Set(days)].filter((d) => DATE_RE.test(d)).sort()) {
    for (const name of await homeworkPhotos(ws.paths.homework, subject, day)) {
      const file = await homeworkFile(ws.paths.homework, subject, day, name);
      const buf = file ? await readFile(file).catch(() => null) : null;
      if (buf && jpegInfo(buf)) images.push(buf);
      else skipped++;
    }
  }
  return { pdf: jpegPdf(images), pages: images.length, skipped };
}

/** 导出的文件名:「作业本-数学-11月20日至11月23日.pdf」 */
export function homeworkPdfName(subject: string, days: readonly string[]): string {
  const d = [...days].sort();
  const span = !d.length ? '' : d.length === 1 ? `-${dayTitle(d[0])}` : `-${dayTitle(d[0])}至${dayTitle(d[d.length - 1])}`;
  return `作业本-${basename(subject)}${span}.pdf`;
}
