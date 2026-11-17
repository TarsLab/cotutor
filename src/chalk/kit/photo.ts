/**
 * 照片页的文字层:孩子拍的作业照片上认出的字
 * (src/scenes/photo-words/:挑出的字词、正文的行、每道题的框,都是整张照片的千分比)换成课本的样子——行与字(BookPage)、题(BookBlock)。
 * 这样照片页和课本页用同一份找框(bookFind、bookTarget)、点字(bookPick)、说窗里是哪(bookView),圈、遮、盖、点字只有一份实现。
 * 一张照片当一页:宽 1000(BOOK_W),高 1000 × 高宽比,几张从上往下连着(同 src/board/lesson.ts 的 photoSheetBox)。
 * 行里一个字多宽照行框按字数等分(课文正文差不多等宽、标点占一格);挑出的字词框更紧,也各当一行放在前面(找字先找到它)。
 * 手拍的歪照片上行框是正的、字是斜的,等分出来的位置只是大概(scripts/probe-photo-boxes.mjs 的结论)。
 */
import type { BookLine, BookPage } from '../../schema/index.ts';
import type { BookBlock } from './book.ts';

type Box = [number, number, number, number];

/** 照片上认出的一项(挑出的字词):字与它的框,整张照片的千分比 [左, 上, 右, 下] */
export interface PhotoWord { text: string; box: readonly [number, number, number, number] }
/** 照片上正文的一行:字照原样带标点,框是这一行的位置(千分比) */
export interface PhotoLine { text: string; box: readonly [number, number, number, number] }
/** 照片上的一道题:题号(数字)与框住整道题的框(千分比) */
export interface PhotoQuestion { no: string; box: readonly [number, number, number, number] }
/** 一张照片认出的字(还没认完的也行:有多少给多少) */
export interface PhotoText { items: readonly PhotoWord[]; lines: readonly PhotoLine[]; questions: readonly PhotoQuestion[] }

/** 挑出的字词那几行的字体名(给老师的正文不重复它们) */
export const PHOTO_ITEM = 'item';

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** 一行字 → 课本的一行:框换成页的坐标(横 = 千分比,竖 = 千分比 × 高宽比),字照字数等分 */
function lineOf(text: string, b: PhotoLine['box'], k: number, f: string): BookLine | null {
  const cs = Array.from(text);
  if (!cs.length || !(b[2] > b[0]) || !(b[3] > b[1])) return null;
  const w = (b[2] - b[0]) / cs.length;
  return { text, x1: b[0], x2: b[2], y1: r1(b[1] * k), y2: r1(b[3] * k), z: r1((b[3] - b[1]) * k), f, chars: cs.map((c, i) => ({ c, x1: r1(b[0] + i * w), x2: r1(b[0] + (i + 1) * w) })) };
}

/**
 * 第 n 张照片(从 1 起;宽高是像素)的文字层:页(BookPage,印的页码没有)和题(problem 块,no 是题号;area 是题框,
 * refs 是框里的那几行)。还没认出来(text = null)就是一页空的
 */
export function photoBookPage(n: number, photo: { w: number; h: number }, text: PhotoText | null): { page: BookPage; blocks: BookBlock[] } {
  const k = photo.h / photo.w;
  const items = (text?.items ?? []).flatMap((x) => { const l = lineOf(x.text, x.box, k, PHOTO_ITEM); return l ? [l] : []; });
  const lines = (text?.lines ?? []).flatMap((x) => { const l = lineOf(x.text, x.box, k, ''); return l ? [l] : []; });
  const page: BookPage = { n, printed: null, w: 1000, h: r1(1000 * k), lines: [...items, ...lines] };
  const seen = new Set<string>();
  const blocks: BookBlock[] = [];
  for (const q of text?.questions ?? []) {
    const no = Number(q.no);
    if (!Number.isInteger(no) || no <= 0 || seen.has(q.no)) continue;
    seen.add(q.no);
    const box: Box = [q.box[0], r1(q.box[1] * k), q.box[2], r1(q.box[3] * k)];
    const refs = page.lines.flatMap((l, i) => { const cx = (l.x1 + l.x2) / 2, cy = (l.y1 + l.y2) / 2; return l.f !== PHOTO_ITEM && cx >= box[0] && cx <= box[2] && cy >= box[1] && cy <= box[3] ? [{ n, i }] : []; });
    blocks.push({ kind: 'problem', no, text: refs.map((r) => page.lines[r.i].text).join(' '), refs, area: { n, box } });
  }
  return { page, blocks };
}

/** 照片页的正文给老师看(一行一句,挑出的字词不重复;有题号的行前面带题号) */
export function photoText(page: BookPage, blocks: readonly BookBlock[]): string[] {
  const head = new Map<number, number>();
  for (const b of blocks) if (b.refs.length && !head.has(b.refs[0].i)) head.set(b.refs[0].i, b.no!);
  return page.lines.flatMap((l, i) => (l.f === PHOTO_ITEM ? [] : [head.has(i) ? `第${head.get(i)}题 ${l.text}` : l.text]));
}
