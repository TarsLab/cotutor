/**
 * 一节课的舞台(课本、孩子拍的作业照片、练习册、白纸都铺在这里):
 * 照一节课的状态画(src/schema/lesson.ts,页面一句一句落好了发进来):现在这一页、老师的一层(记号、白纸条)、孩子的一层(笔、揭开)、开放的、老师让看的那一处。
 * 一页铺的四种:课本的一课(几页 PDF)、作业照片(几张)、练习册(几页图,文字层和能写的格子是排版时记下的,/api/kid/workbook/)、白纸,都从上往下连成一条(场景坐标:一页宽 1000,src/chalk/kit/book.ts 的 bookSheets),屏幕是看它的一扇窗:
 *  - 窗只有两种大小:页宽铺满、两倍,双击切换;不两指缩放、不滚轮缩放。页宽时手指只上下滚,两倍时上下左右都能挪,松手带惯性。
 *  - 老师「看」了一处(look.n 变了):窗滚到那一块(大小不变,近的滑过去,远的直接到),块里的字一行一行刷上荧光黄(读的顺序,像老师拿荧光笔划一遍)、停一会儿淡掉;
 *    字行是服务端找「看」的那一块时一起给的(look.rows,跨页的段不会把中间的脚注带进来);没给的(照片的第几张、新拍的照片)照框在文字层里挑,
 *    文字层还没拉下来就等它,白纸、照片没认出字的整块铺一层。没看就不动——他眼前的就是老师要讲的。
 *  - 只读(录像、家长看)照记录的窗摆:以前孩子缩放过的窗照样放得下(camFor)。
 *  - Apple Pencil(pointerType = pen)写画,手指永远不落笔;笔在纸上时别的手指(手掌)不算。课本页、练习册上随时能画(预习时自己圈生字、标段,练习册就是拿笔做的);
 *    照片、白纸页上老师请了写、圈…才能画。请没请只管抬笔后替不替他交(服务端照 open 判)。
 *    试用(mousePen,电脑上没有笔):能落笔时鼠标当笔(课本页上一直是,拖不动页,用滚轮),不能落笔时鼠标还是手指;滚轮照常滚。
 *  - 轻点(手指或笔;手指的等一下看是不是双击)一个字:本地照课本的行和字算出是哪个字(bookPick),告诉页面(pick,带它在屏幕上的框)弹田字格,那个字一直标着;
 *    页挪了就告诉页面它挪到哪(pickAt,卡跟着字走),字出了窗、点了页上别处(不是字)、落笔就告诉页面收卡(pickAt null);页面自己收了卡发 unpick。点在盖住的拼音上就揭开(reveal)。
 *  - 孩子挪完、切完大小停下来:把窗(场景坐标)告诉页面(view),页面报给服务端说成一句「第 55 页:第 7 段」给老师。
 *  - 课本的目录(页面给了 toc:能点的那几项):只能上下滚和点一项翻过去,不点字、不落笔、不双击放大(笔、鼠标在这里都当手指)。
 *    范围是那一行从序号到页码,上下撑到和邻行之间的中线(最多再宽两成行高);平时不画,手指按住一会儿(TOC_PRESS_MS,刚滚起来的不算)、
 *    鼠标或悬着的笔移到上面才铺一层学科色;松手在范围里就让它停 TOC_HOLD_MS 再告诉页面(open),页面自己先翻过去。
 *    窗:页面发来的状态带着 view(上次翻到的那一课那一行、在一课里按「目录」回来的那一课)就把它摆在窗中间。
 * 画面:课本 pdf.js(/stage/pdf/,不打进 stage.js)现画,每页先画一张中等清晰度的(移动、缩放时用它),停下来再把窗里那一块照屏幕的像素重画一张盖上去,放大了字也清楚;
 * 照片照原图画进一张画布(孩子端上传前已缩到长边 2000,够清楚),只画窗附近的几张(作业本攒得多,全画 iPad 的内存不够),远了放掉;白纸是一张白底。
 * 作业本(带 day 的照片页):一整本连着滚,老的在上。天与天之间一行「星期一」(今天写「今天」),周与周之间一道宽条「11月23日 – 29日」(空多少照 src/board/lesson.ts 的 photoGaps);
 * 最后一张白纸,纸上「拍照」「从相册选」(点中了告诉页面 capture);一进来窗停在白纸的顶上(上半是最近拍的,下半是白纸)。以前那天的照片上落不了笔(只看);
 * 窗停在哪一天告诉页面(day,顶栏写它);页面要去哪一天(go,目录上点的)就滚到那一天的分割线。点字照页的文字层:课本是 PDF 的行和字,照片是认字认出的(src/chalk/kit/photo.ts 换成同样的样子)。
 * 老师的记号(圈、划、加点、盖拼音的块)和孩子的笔画是一层 SVG,和页面在同一个随窗变换的容器里,所以对得齐;孩子的笔画挂在书页上(一节课的状态里),换课再回来还在。
 * 记号的样子(docs/dev/一节课.md 的四条原则):老师的线朱橙、孩子的蓝,都正片叠底(记号不盖字:黑字叠上任何颜色还是黑的);遮、盖是故意挡住的,不透明。
 * 圈、划、加点照 markFresh 分新的(实色)和旧的(淡),收掉的淡出;在页上的记号不重画(圈的一笔画出来只放一次)。交给老师的窗图只画新的。
 * 孩子落一笔、擦掉都告诉页面(stroke / wipe),页面照 lessonStep 改状态、报给服务端,再把新的状态发回来。
 * 课本上的田字格(索引认的,BookPage.cells):点空格、描红格开写字格(./cell-pad.tsx),贴着那一格、页挪了跟着走;放好了告诉页面(cell),
 * 字照格里的坐标缩进那一格(铅笔色,.bk-cells),写字格挪到同一排下一个空格,没有了就收。范字格照常点字看笔顺。写了没放好时点页上别处、落笔不收它。
 * 能写的格平时不画;鼠标、悬着的笔移上去浅浅铺一层学科色,手指按住一会儿(TOC_PRESS_MS,刚滚起来的不算)深一点(同目录;.bk-cell-hint)。
 * 点读(语文课文,页面给了 read):标题、段首缩进的那两格(bookReadParts:连着头上的拼音)能点,平时不画,也不画出这块范围;鼠标、悬着的笔移上去只出一个淡淡的描边播放钮
 * (在两格正中、和汉字那一行齐),手指按住一会儿钮深一点;点一下(手指不等双击,笔、鼠标点一下不动)告诉页面(read,带这一课分好的几块各几句)。读不读、读到哪是页面的事(它放配音),
 * 它发来的 read.k / mode 照着画钮:playing 实心暂停钮、loading 转一个小圈(第一次要等整篇合成)、paused 描边播放钮;读到下一块钮跟着挪;
 * read.invite(进了这一课还没点过读):标题前的钮先摆着,描边播放形同暂停,不闪不动(手指没有悬着,孩子看不见能点哪;设计稿 https://claude.ai/artifact/RPqnrMdNvmqjvD14ES1nS5 的 V2)。
 * 正在读的那一句(read.s):字连拼音铺一层学科色(.bk-say,正片叠底,ReadPart.says 一行一个框),暂停时淡一半;段间、停下淡掉后不铺。别的不刷不画。
 * 读到窗外的一句:孩子 READ_IDLE_MS 内没动过手就把窗挪过去,动过就不抢。
 * 类名带 bk-(舞台页也装孩子端的 theme.css);没有工具那一栏(课本铺满屏宽):只有一颗「擦掉」浮在屏幕边上(.bk-wipe)。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type * as Pdfjs from 'pdfjs-dist';
import { openPdf } from './pdf.ts';
import { BOOK_ASPECT, BOOK_TOC, BOOK_W, KID_INK, KID_INK_WIDTH, bookCellsOf, bookFrame, bookPick, bookReadParts, bookRows, bookSheets, lessonBlocks, photoBookPage, turnedSkeletons, type BookSheet, type ChalkSkeleton, type ReadPart, type SceneCell, type PhotoLine, type PhotoWord } from '../../chalk/index.ts';
import { PHOTO_GAPS, lessonPage, lessonStrip, markFresh, photoDay, photoGaps, photoSheetBox, weekOf } from '../../board/lesson.ts';
import { stripLayout, type StripSlot } from '../../board/strip.ts';
import { CELL_UNIT, LESSON_INK_POINTS, PEN_ASKS, type BookPage, type Lesson, type LessonPage } from '../../schema/index.ts';
import { CellPad, WRITE_INK, WRITE_WIDTH } from './cell-pad.tsx';

/** 页面经它叫舞台:「给老师看」(先交窗里的图)、导一张小图(话题的预览图) */
export interface BookStageHandle {
  submit(): void;
  peek(): Promise<string | null>;
  /** 页面把点字的卡收了:不再跟着那个字、不再标着它 */
  unpick(): void;
}

export interface BookStageProps {
  /** 这节课(换了一节才重来) */
  id: string;
  /** 一节课此刻的样子(页面落好了老师念过的那几句的动作) */
  lesson: Lesson;
  /** 只看(录像、家长端、以前的) */
  readonly?: boolean;
  hand?: 'left' | 'right';
  /** 试用(电脑上):能落笔时鼠标当笔,不能落笔时还是当手指(拖着滚、点字) */
  mousePen?: boolean;
  /** 孩子落了一笔(场景坐标);strip = 落在开着的白纸条上 */
  onStroke(pts: [number, number][], strip?: string): void;
  /** 笔落下了(写着,应用不替他交给老师;抬笔就是 onStroke) */
  onPen?(): void;
  /** 白纸条里的方向盘转了一格(键 <白纸条>#<第几样>,转到多少度) */
  onTurn?(item: string, deg: number): void;
  /** 孩子擦掉了自己画的 */
  onWipe(): void;
  /** 「给老师看」:窗里的图先交(onShot),再说交了 */
  onSubmit(): void;
  /** 课本的目录上能点的那几项(场景坐标)和按下去铺的颜色;不是目录页、只读的不用 */
  toc?: { color: string; entries: { title: string; box: Box }[] } | null;
  /** 这一课后面还有一课(页面照目录算的):最后一页下面摆一行「下一课」 */
  next?: { title: string; k?: string } | null;
  /** 作业本:滚到那一天(目录上点的);n 变了才滚 */
  go?: { day: string; n: number } | null;
  /** 作业本:窗停在哪一天(YYYY-MM-DD;白纸是今天) */
  onDay?(day: string): void;
  /** 作业本最后那张白纸上按了拍照(camera)/ 从相册选 */
  onCapture?(camera: boolean): void;
  /**
   * 作业本:照片上以前的话题留下的记号(键是照片的 src;坐标是这张照片自己的,宽 1000、左上角起;src/runtime/homework.ts 的 homeworkPast)。
   * 垫在这一节老师的那层下面画,只看:擦不掉、不变旧、不收;交给老师的窗图里也有(新的那些)
   */
  past?: Readonly<Record<string, StagePast>> | null;
  /** 目录上点中了一项、一课最后那一行的「下一课」(页面先翻过去,再报给服务端) */
  onOpen?(title: string): void;
  /** 点中了一个字(页面弹田字格) */
  onPick?(text: string, at: Box | null): void;
  /** 点中的那个字在屏幕上挪到了哪;null = 卡该收了 */
  onPickAt?(at: Box | null): void;
  /** 在田字格(或填空)里写好了(放好):格的 id、笔画(格里的坐标)、照着写的字、是不是填空 */
  onCell?(id: string, strokes: [number, number][][], model: string | null, blank: boolean): void;
  /** 老师的学科色(写字格的「放好」、按着的那一格) */
  color?: string;
  /** 点开了一块盖住的(遮、盖) */
  onReveal?(text: string): void;
  /** 点读:这一页能点读就给(k = 在读哪一块,-1 没在读;mode 见文件头);不给 = 不点读 */
  read?: { k: number; s?: number; mode: string; invite?: boolean } | null;
  /** 点了第 k 块的钮:这一课分好的几块各几句(parts)、各是标题 0 还是第几段(nos) */
  onRead?(k: number, parts: number[], nos: number[]): void;
  /** 孩子挪完窗停下来的地方(场景坐标 [左, 上, 右, 下]) */
  onView?(box: [number, number, number, number]): void;
  /** 窗停下来以后(老师移完、孩子挪完、落了笔、刚铺好)窗里那一块的图(jpeg data URL):老师下一轮看得见孩子眼前的课本 */
  onShot?(box: [number, number, number, number], image: string): void;
  onError(message: string): void;
}

type Box = [number, number, number, number];
const SVG_NS = 'http://www.w3.org/2000/svg';
/** 老师的线:朱橙(红圈在孩子眼里是「错了」;数学的学科色和孩子的蓝笔同色,也不用) */
const TEACHER_INK = '#e8590c';
/** 收掉的记号淡出多久(同 stage.css 的 .bk-gone) */
const MARK_GONE_MS = 450;
const PAPER = '#f4f1ea';
/** 点读读到窗外的一块:孩子这么久没动过手才把窗挪过去 */
const READ_IDLE_MS = 4000;
/** 正在读的那一句的框往外多铺一点(场景坐标) */
const SAY_PAD = 3;
/** 动了多少像素以内算轻点 */
const TAP_PX = 10;
/** 停下来多久才算挪完(报给老师、重画清楚的那一块) */
const SETTLE_MS = 700;
/** 窗滑过去多久;远过三屏直接到 */
const GLIDE_MS = 600;
/** 每页先画的那一张最宽多少像素(iPad 上几页加起来的画布内存要收着) */
const BASE_PX = 1600;
/** 窗那一块重画时最多多少像素(iOS 一块画布的上限是 1677 万) */
const SHARP_MAX_PX = 6_000_000;
/** 两下轻点隔多久以内算双击 */
const DOUBLE_MS = 280;
/** 松手时快过这个(像素 / 毫秒)才带惯性;每 16 毫秒剩多少 */
const FLING_MIN = 0.25;
const FLING_KEEP = 0.95;
/** 白纸条开着时窗口里至少留几成给白纸条 */
const STRIP_SHOW = 0.45;
/** 老师的「看」滚过去时,那一块上面留多少像素(顶栏浮在板上) */
const LOOK_TOP_PX = 64;
/** 「看」刷荧光:窗滚过去以后开始(ms);一行刷多久;下一行晚多少;行多了所有行刷完也不超过多久;刷完停多久;淡掉多久;
 *  字行等多久还没来就整块铺(ms);字行往外宽出多少(场景单位:左右、上下) */
const LOOK_DELAY_MS = 250, LOOK_SWEEP_MS = 320, LOOK_STEP_MS = 140, LOOK_SPAN_MS = 1200, LOOK_HOLD_MS = 1900, LOOK_FADE_MS = 700, LOOK_WAIT_MS = 2000;
const LOOK_PAD: [number, number] = [5, 3.5];
/** 目录:手指按住多久才铺那一行(刚滚起来的不闪);松手后那一行停多久再翻过去;范围上下最多再撑开几成行高 */
const TOC_PRESS_MS = 80, TOC_HOLD_MS = 250, TOC_GROW = 0.2;
/** 一课最后一页下面「下一课」那一行:离页多远、这一截多高(场景坐标;窗能多往下滚这么多) */
const NEXT_GAP = 44, NEXT_H = 170;
/** 交给老师的那张图的长边 */
const SHOT_SIDE = 1024;
/** 窗停下来多久交窗里的图(清楚的那一块多半已经重画好了) */
const SHOT_MS = 1200;

const docs = new Map<string, Promise<Pdfjs.PDFDocumentProxy>>();
/** 一本 PDF 只开一次(老师换一课、换一张卡都还是它);分段取,只拉要画的那几页 */
function openDoc(url: string): Promise<Pdfjs.PDFDocumentProxy> {
  let d = docs.get(url);
  if (!d) {
    d = openPdf(url);
    docs.set(url, d);
    d.catch(() => docs.delete(url));
  }
  return d;
}

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const ease = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const icon = (paths: string): JSX.Element => (
  <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: paths }} />
);
const WIPE = '<path d="M4 15l8-8 6 6-6 6H8z"></path><path d="M12 21h8"></path>';

/** 窗:中心(场景坐标)与倍数(一个场景单位多少 CSS 像素) */
interface Cam { cx: number; cy: number; s: number }

/** 这一页铺好的样子:铺的什么(课本的 PDF、照片、白纸)、各页在场景里的位置、每页先画的那张、页的行与字(点字用,后到) */
interface Geo {
  key: string;
  /** 课本的 PDF(重画清楚的那一块要它);照片、白纸没有 */
  pdf: string | null;
  sheets: (BookSheet & { w: number; h: number })[];
  height: number;
  aspect: number;
  base: Map<number, HTMLCanvasElement>;
  /** 先画的那张已经画好的页(交窗里的图要等窗里的页都画好) */
  drawn: Set<number>;
  lines: BookPage[];
  /** 字行拉完了(课本拉到了、照片认完了;白纸本来就没有):这时还找不到字行的「看」整块铺底 */
  linesDone: boolean;
  /** 作业本:分割线、最后那张白纸 */
  hw: HwGeo | null;
}

/** 作业本最后那张白纸多高(场景坐标) */
const HW_PAPER_H = 760;
/** 作业本铺好的样子:今天、白纸的顶(tail)和底(end)、天与周的分割线(在照片之间空出来的那一截里)、每天从哪儿起(分割线的顶) */
interface HwGeo {
  today: string;
  tail: number;
  end: number;
  /** 今天拍过了(白纸上的话不一样) */
  shot: boolean;
  dividers: { top: number; h: number; day: string; week?: string }[];
  days: { day: string; top: number }[];
}
const WEEKDAY = '日一二三四五六';
const dateOf = (day: string): Date => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))));
/** 分割线上的一行:今天、星期一 */
const dayLabel = (day: string, today: string): string => (day === today ? '今天' : `星期${WEEKDAY[dateOf(day).getUTCDay()]}`);
/** 周的宽条:「11月23日 – 29日」,跨月「11月30日 – 12月6日」 */
function weekLabel(day: string): string {
  const a = dateOf(weekOf(day)), b = new Date(a.getTime() + 6 * 86_400_000);
  const m1 = a.getUTCMonth() + 1, m2 = b.getUTCMonth() + 1;
  return `${m1}月${a.getUTCDate()}日 – ${m2 === m1 ? '' : `${m2}月`}${b.getUTCDate()}日`;
}
/** 作业本的分割线和白纸照照片排好的位置算 */
function hwGeo(p: Extract<LessonPage, { kind: 'photo' }>, sheets: readonly BookSheet[]): HwGeo {
  const today = p.day!;
  const gaps = photoGaps(p.photos, today);
  const dividers: HwGeo['dividers'] = [];
  p.photos.forEach((ph, i) => {
    if (gaps[i] <= PHOTO_GAPS.same || !sheets[i]) return;
    dividers.push({ top: sheets[i].top - gaps[i], h: gaps[i], day: photoDay(ph, today), ...(gaps[i] >= PHOTO_GAPS.week ? { week: weekLabel(photoDay(ph, today)) } : {}) });
  });
  const lastSheet = sheets[sheets.length - 1];
  const bottom = lastSheet ? lastSheet.top + lastSheet.height : 0;
  const last = p.photos.length ? photoDay(p.photos[p.photos.length - 1], today) : null;
  let tail = bottom + PHOTO_GAPS.same;
  if (last !== today) {
    const g = last === null || weekOf(last) !== weekOf(today) ? PHOTO_GAPS.week : PHOTO_GAPS.day;
    dividers.push({ top: bottom, h: g, day: today, ...(g >= PHOTO_GAPS.week ? { week: weekLabel(today) } : {}) });
    tail = bottom + g;
  }
  return { today, tail, end: tail + HW_PAPER_H, shot: last === today, dividers, days: dividers.map((d) => ({ day: d.day, top: d.top })) };
}

/** 老师要看的那一块 → 窗里留出来的那一块(四周留边、太小放大;src/chalk/kit/book.ts 的 bookFrame) */
const frameBox = (box: Box, sheets: readonly BookSheet[]): Box => { const f = bookFrame(box, sheets); return [f[0], f[1], f[0] + f[2], f[1] + f[3]]; };

/** 白纸页多高(一张 A4 那么高;白纸条摆得多就跟着长) */
const WHITE_H = BOOK_W * BOOK_ASPECT;
/** 照片画进画布最宽多少像素 */
const PHOTO_PX = 2000;

/** 一页怎么铺:几张(各自的宽高,PDF 的点或照片的像素)、几号;白纸的高跟着白纸条 */
function sourceKey(p: LessonPage | null, whiteH: number): string {
  if (!p) return '';
  if (p.kind === 'book') return `book|${p.src}|${p.pages.join(',')}|${p.cut}`;
  if (p.kind === 'photo') return `photo|${p.photos.map((x) => x.src).join(',')}`;
  if (p.kind === 'workbook') return `workbook|${p.src}|${p.sheets.length}`;
  return `white|${Math.ceil(whiteH / 400)}`;
}
const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((ok, no) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => no(new Error(`照片打不开:${url}`)); img.src = url; });

/** 白纸条的底色(盖住下面的题;比纸色白一点,孩子看得出这是一条白纸) */
const STRIP_FILL = '#ffffff';
const STRIP_EDGE = '#d9c9a3';
/** 白纸条里一样图形的骨架摆到页上(转过的照转到的样子) */
const slotSkeletons = (slot: StripSlot, deg: number): ChalkSkeleton[] => (slot.scene ? (deg ? turnedSkeletons(slot.scene, { turn: Object.fromEntries(slot.scene.turns.map((t) => [t.id, deg])) }) : slot.scene.skeletons) : []);
const numOf = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** 一样骨架画成 SVG(白纸条里的点阵、方向盘只用到圆、线、字、框;不逐笔画,一下子画好) */
function skeletonEl(k: ChalkSkeleton): SVGElement | null {
  const x = numOf(k.x), y = numOf(k.y), w = numOf(k.width), h = numOf(k.height);
  const stroke = { stroke: String(k.strokeColor ?? '#1e1e1e'), 'stroke-width': String(numOf(k.strokeWidth, 2)), fill: typeof k.backgroundColor === 'string' && k.backgroundColor !== 'transparent' ? k.backgroundColor : 'none', 'stroke-linecap': 'round' };
  if (k.type === 'ellipse') return el('ellipse', { cx: String(x + w / 2), cy: String(y + h / 2), rx: String(w / 2), ry: String(h / 2), ...stroke });
  if (k.type === 'rectangle') return el('rect', { x: String(x), y: String(y), width: String(w), height: String(h), ...stroke });
  if (k.type === 'line' || k.type === 'arrow') return el('path', { d: pathD((k.points as [number, number][] ?? []).map(([px, py]) => [x + px, y + py] as [number, number])), ...stroke, fill: 'none' });
  if (k.type === 'text') { const t = el('text', { x: String(x + w / 2), y: String(y + h / 2), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': String(numOf(k.fontSize, 20)), fill: String(k.strokeColor ?? '#1e1e1e'), class: 'bk-strip-text' }); t.textContent = String(k.text ?? ''); return t; }
  return null;
}
/** 同一样骨架画在画布上(交给老师的那张图) */
function skeletonDraw(ctx: CanvasRenderingContext2D, k: ChalkSkeleton): void {
  const x = numOf(k.x), y = numOf(k.y), w = numOf(k.width), h = numOf(k.height);
  ctx.strokeStyle = String(k.strokeColor ?? '#1e1e1e'); ctx.fillStyle = String(k.strokeColor ?? '#1e1e1e'); ctx.lineWidth = numOf(k.strokeWidth, 2);
  if (k.type === 'ellipse') { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke(); return; }
  if (k.type === 'rectangle') { ctx.strokeRect(x, y, w, h); return; }
  if (k.type === 'line' || k.type === 'arrow') { ctx.beginPath(); (k.points as [number, number][] ?? []).forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py))); ctx.stroke(); return; }
  if (k.type === 'text') { ctx.font = `${numOf(k.fontSize, 20)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(k.text ?? ''), x + w / 2, y + h / 2); }
}

const pathD = (pts: readonly [number, number][]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

/** 同一处每次画得一样:照字算一个数 */
const seedOf = (t: string): number => Array.from(t).reduce((a, c) => (a * 31 + (c.codePointAt(0) ?? 0)) % 997, 7);

/** 手画的圈:贴着字块的超椭圆(方的字块也贴得住,不像椭圆那样切到邻行),起笔收笔错开一点、越画越松一点 */
function ringPath(box: Box, seed: number): [number, number][] {
  const [x1, y1, x2, y2] = box;
  const h = y2 - y1, pad = Math.max(4, h * 0.16);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2 + pad * 1.3, ry = h / 2 + pad;
  const N = 56, n = 3.4, start = -2.3 + (seed % 5) * 0.21, sweep = Math.PI * 2 + 0.42;
  const out: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = start + (sweep * i) / N, c = Math.cos(t), s = Math.sin(t);
    const wob = 1 + 0.02 * Math.sin(t * 3 + seed) + (i / N) * 0.04;
    out.push([cx + rx * Math.sign(c) * Math.abs(c) ** (2 / n) * wob, cy + ry * Math.sign(s) * Math.abs(s) ** (2 / n) * wob]);
  }
  return out;
}

/** 作业本一张照片上以前的记号(同 src/runtime/homework.ts 的 HomeworkPast) */
export interface StagePast { marks: { k: string; text: string; box: Box; old?: boolean }[]; ink: [number, number][][] }

/** 划:字下面一道,右头略低一点(手划的) */
const underPath = (box: Box): [number, number][] => { const h = box[3] - box[1], y = box[3] + h * 0.14; return [[box[0], y], [box[2], y + h * 0.03]]; };
/** 加点:每个字下面一个点(字按框等分;标点不算) */
function dotSpots(box: Box, text: string): { cx: number; cy: number; r: number }[] {
  const n = Math.max(1, Array.from(text).filter((c) => !/[\s,，。.!！?？、;；:：「」『』“”"']/.test(c)).length);
  const h = box[3] - box[1], w = (box[2] - box[0]) / n;
  return Array.from({ length: n }, (_, i) => ({ cx: box[0] + w * (i + 0.5), cy: box[3] + h * 0.24, r: Math.max(2, h * 0.065) }));
}

/** 目录上每一项能点的范围:那一行左右各宽一点,上下撑到和上下邻行(左右叠着的)之间的中线,最多再撑 TOC_GROW 行高 */
function tocAreas(entries: readonly { title: string; box: Box }[]): { title: string; box: Box; hit: Box }[] {
  return entries.map((e) => {
    const [x1, y1, x2, y2] = e.box;
    const h = y2 - y1, grow = h * TOC_GROW;
    const side = entries.filter((o) => o !== e && o.box[0] < x2 && o.box[2] > x1);
    const above = Math.max(-Infinity, ...side.filter((o) => o.box[3] <= y1).map((o) => o.box[3]));
    const below = Math.min(Infinity, ...side.filter((o) => o.box[1] >= y2).map((o) => o.box[1]));
    const top = Math.max(y1 - grow, Number.isFinite(above) ? (above + y1) / 2 : -Infinity);
    const bottom = Math.min(y2 + grow, Number.isFinite(below) ? (y2 + below) / 2 : Infinity);
    return { title: e.title, box: e.box, hit: [x1 - 12, top, x2 + 12, bottom] as Box };
  });
}

export const BookStage = forwardRef<BookStageHandle, BookStageProps>(function BookStage({ id: _id, lesson, readonly, hand, mousePen, toc, next, go, onDay, onCapture, past, onOpen, onStroke, onPen, onTurn, onWipe, onSubmit, onPick, onPickAt, onCell, color, onReveal, read, onRead, onView, onShot, onError }, ref) {
  const view = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const sharp = useRef<HTMLCanvasElement>(null);
  const geo = useRef<Geo | null>(null);
  const cam = useRef<Cam>({ cx: BOOK_W / 2, cy: 400, s: 1 });
  /** 孩子的笔画(这一页的;页面发来的状态为准,落笔时先在这里画上) */
  const ink = useRef<[number, number][][]>([]);
  /** 开着的白纸条上孩子的笔画 */
  const sInk = useRef<[number, number][][]>([]);
  const glide = useRef(0);
  const settle = useRef(0);
  const sharpTask = useRef<{ cancel(): void } | null>(null);
  /** 手指:按下的几根、这一下是轻点还是拖、两指时的起点 */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'tap' | 'pan' | 'pinch'; x0: number; y0: number; cam0: Cam; d0?: number; m0?: [number, number] } | null>(null);
  const moved = useRef(false);
  /** 窗的大小:页宽铺满(1)、两倍(2) */
  const zoom = useRef<1 | 2>(1);
  /** 拖的最后几个点(松手算惯性) */
  const trail = useRef<{ t: number; x: number; y: number }[]>([]);
  /** 手指轻点了一下,等着看是不是双击 */
  const lastTap = useRef<{ t: number; x: number; y: number; timer: number } | null>(null);
  /** 笔:正在画的一笔 */
  const pen = useRef<{ id: number; pts: [number, number][]; el: SVGPathElement; x0: number; y0: number; ok: boolean } | null>(null);
  /** 孩子手上动着的时候老师的新窗先记着,手停了再去(白纸条开着的另记,照 goStrip 去) */
  const pendingFrame = useRef<{ box: Box; rows?: Box[] } | null>(null);
  const pendingStrip = useRef<Box | null>(null);
  /** 移过窗的那一次「看」(look.n):同一次不再移 */
  const lookedN = useRef(-1);
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  /** 铺过几回页:分割线、白纸照 geo 画,换了一份(照片多了一张也算)要重画;照片页铺得快,loading 和 ready 同一下,phase 不变 */
  const [, setGeoRev] = useState(0);
  const [marks, setMarks] = useState(0);

  const page = lessonPage(lesson);
  /** 最新的状态(铺页是异步的,铺好时照最新的摆) */
  const latest = useRef(lesson);
  latest.current = lesson;
  const open = page?.open ?? [];
  /** 课本的目录:只能滚和点一项翻过去 */
  const tocOn = !readonly && page?.kind === 'book' && page.title === BOOK_TOC && Boolean(toc?.entries.length);
  const tocNow = useRef<{ on: boolean; color: string; areas: ReturnType<typeof tocAreas> }>({ on: false, color: '', areas: [] });
  tocNow.current = { on: tocOn, color: toc?.color ?? '#1c7ed6', areas: tocOn && toc ? tocAreas(toc.entries) : [] };
  // 一课最后一页下面的「下一课」:课本的一课、孩子能动手的时候才有
  const nextOn = !readonly && page?.kind === 'book' && page.title !== BOOK_TOC && Boolean(next?.title);
  const nextNow = useRef(false);
  nextNow.current = nextOn;
  const nextEl = useRef<HTMLDivElement>(null);
  /** 能落笔:课本页上随时(目录除外);别的页老师请了用笔才能 */
  const canMark = !tocOn && (page?.kind === 'book' || page?.kind === 'workbook' || open.some((o) => PEN_ASKS.includes(o)));
  const canPick = !tocOn && (Boolean(page?.pick) || open.includes('点'));
  const revealedKey = (page?.kid.revealed ?? []).join('\n');
  /** 开着的白纸条:排好的样子;孩子在上面画的、转的 */
  const strip = lessonStrip(lesson);
  const stripLay = strip ? stripLayout(strip) : null;
  /** 白纸页的高:白纸条摆得比一张纸长就跟着长 */
  const whiteH = Math.max(WHITE_H, (stripLay?.rect[3] ?? 0) + 40);
  const geoKey = sourceKey(page, whiteH);
  const latestStrip = useRef<{ key: string; lay: ReturnType<typeof stripLayout> } | null>(null);
  latestStrip.current = strip && stripLay ? { key: strip.key, lay: stripLay } : null;
  const canTurn = open.includes('转');
  /** 点读:页面给了 read、语文课本的一课(不是目录) */
  const readOn = !readonly && Boolean(read) && page?.kind === 'book' && page.layout !== 'math' && page.title !== BOOK_TOC;
  const readNow = useRef<{ on: boolean; read: { k: number; s?: number; mode: string; invite?: boolean } | null }>({ on: false, read: null });
  readNow.current = { on: readOn, read: read ?? null };
  /** 这一课点读的几块(场景坐标;文字层拉下来才有);悬着 / 按着的那一块;孩子上次动手的时刻(读到窗外时挪不挪窗) */
  const readParts = useRef<ReadPart[]>([]);
  const readHover = useRef<{ k: number; mode: 'hover' | 'press' } | null>(null);
  const readPressTimer = useRef(0);
  const readPainted = useRef('');
  /** 上回窗跟到的那一句(k.s);换了句才考虑挪窗 */
  const readPrevK = useRef('');
  const lastHand = useRef(0);

  // ---- 窗 ----
  /** 窗的大小(CSS 像素) */
  const vsize = (): [number, number] => { const r = view.current?.getBoundingClientRect(); return [r?.width || 1, r?.height || 1]; };
  /** 倍数的上下限:缩到整页看得全,放到一页宽的六倍 */
  const sRange = (): [number, number] => {
    const [vw, vh] = vsize();
    const g = geo.current;
    const pageH = g?.sheets[0]?.height ?? BOOK_W * BOOK_ASPECT;
    return [Math.min(vw / BOOK_W, vh / pageH) * 0.9, (vw / BOOK_W) * 6];
  };
  /** 窗不跑出这一条:孩子的窗大小定死(页宽 × zoom),边贴着书页;只读的照以前,中心留在条子里 */
  const clamp = (c: Cam): Cam => {
    if (!readonly) {
      const [vw, vh] = vsize();
      const h = bottomOf();
      const s = (vw / BOOK_W) * zoom.current;
      const hw = vw / 2 / s, hh = vh / 2 / s;
      return { s, cx: hw * 2 >= BOOK_W ? BOOK_W / 2 : Math.min(BOOK_W - hw, Math.max(hw, c.cx)), cy: hh * 2 >= h ? hh : Math.min(h - hh, Math.max(hh, c.cy)) };
    }
    const [lo, hi] = sRange();
    const s = Math.min(hi, Math.max(lo, c.s));
    const h = geo.current?.height ?? BOOK_W;
    return { s, cx: Math.min(BOOK_W, Math.max(0, c.cx)), cy: Math.min(h, Math.max(0, c.cy)) };
  };
  /** 这一条的底(窗能滚到哪):作业本到白纸的底,课本的一课多一行「下一课」 */
  const bottomOf = (): number => { const g = geo.current; return g?.hw && !readonly ? g.hw.end : (g?.height ?? BOOK_W) + (nextNow.current ? NEXT_H : 0); };
  /** 窗现在看着的那一块(场景坐标) */
  const viewBox = (c = cam.current): Box => { const [vw, vh] = vsize(); return [c.cx - vw / 2 / c.s, c.cy - vh / 2 / c.s, c.cx + vw / 2 / c.s, c.cy + vh / 2 / c.s]; };
  const apply = (): void => {
    const [vw, vh] = vsize();
    const c = cam.current;
    if (paper.current) { paper.current.style.transform = `translate(${vw / 2 - c.cx * c.s}px, ${vh / 2 - c.cy * c.s}px) scale(${c.s})`; paper.current.style.setProperty('--inv', String(1 / c.s)); }
    drawNear();
    dayNow();
    // 点中的那个字跟着窗:卡贴着它走,出了窗就收
    if (picked.current) { const at = screenOf(picked.current); if (at) pickAtRef.current?.(at); else unpickHere(true); }
    placePad();
  };
  /** 一块(场景坐标)此刻在屏幕上的框(舞台 iframe 里的 CSS 像素);整块都在窗外 = null */
  const screenOf = (b: Box): Box | null => {
    const v = view.current;
    if (!v) return null;
    const r = v.getBoundingClientRect(), c = cam.current;
    const x = (sx: number): number => r.left + r.width / 2 + (sx - c.cx) * c.s, y = (sy: number): number => r.top + r.height / 2 + (sy - c.cy) * c.s;
    const out: Box = [x(b[0]), y(b[1]), x(b[2]), y(b[3])];
    return out[2] < r.left || out[0] > r.right || out[3] < r.top || out[1] > r.bottom ? null : out.map((n) => Math.round(n)) as Box;
  };
  /** 写字格贴着它那一格:放在那一格下面,下面放不下、上面空大就放上面;左右照格居中、不出边。格出了窗:没写的收起来,写了没放好的留在原处 */
  const placePad = (): void => {
    const el = padEl.current, c = padCell.current, v = view.current;
    if (!el || !c || !v) return;
    const at = screenOf(c.box);
    if (!at) { if (!padDirty.current) closePad(); return; }
    const r = v.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, gap = 14, edge = 10;
    const below = r.bottom - at[3] - gap - edge, above = at[1] - r.top - gap - edge;
    const down = below >= h || below >= above;
    el.style.left = `${Math.max(r.left + edge, Math.min(r.right - w - edge, (at[0] + at[2]) / 2 - w / 2))}px`;
    el.style.top = `${down ? Math.min(at[3] + gap, r.bottom - h - edge) : Math.max(r.top + edge, at[1] - gap - h)}px`;
  };
  /** 不再跟着点中的那个字;tell = 告诉页面收卡(页面自己收的不用再说) */
  const unpickHere = (tell: boolean): void => {
    if (!picked.current) return;
    picked.current = null;
    svg.current?.querySelector('.bk-hl .bk-hit')?.remove();
    if (tell) pickAtRef.current?.(null);
  };

  // ---- 课本上的田字格:孩子写的字缩进格里;点空格开写字格 ----
  /** 这一课几页上的田字格(场景坐标);文字层还没拉下来是空的 */
  const cellsHere = (): SceneCell[] => {
    const g = geo.current, p = lessonPage(latest.current);
    return g && (p?.kind === 'book' || p?.kind === 'workbook') ? bookCellsOf(g.lines, g.sheets) : [];
  };
  /** 孩子在格里写的字:格里的坐标(长边 = CELL_UNIT)照格的框缩放 */
  const cellPaths = (c: SceneCell, strokes: [number, number][][]): [number, number][][] => {
    const [x1, y1, x2, y2] = c.box, k = Math.max(x2 - x1, y2 - y1) / CELL_UNIT;
    return strokes.map((st) => st.map(([x, y]) => [x1 + x * k, y1 + y * k] as [number, number]));
  };
  /** 格里的线宽:格的短边的 WRITE_WIDTH */
  const cellWidth = (c: SceneCell): number => Math.min(c.box[2] - c.box[0], c.box[3] - c.box[1]) * WRITE_WIDTH;
  const paintCells = (): void => {
    const layer = svg.current?.querySelector('.bk-cells');
    const p = lessonPage(latest.current);
    if (!layer) return;
    const written = p?.kid.cells ?? {};
    const out: SVGElement[] = [];
    for (const c of cellsHere()) {
      const st = written[c.id];
      if (!st?.length) continue;
      const w = String(cellWidth(c));
      for (const pts of cellPaths(c, st)) out.push(el('path', { d: pathD(pts.length === 1 ? [pts[0], [pts[0][0] + 0.1, pts[0][1]]] : pts), fill: 'none', stroke: WRITE_INK, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-cell': c.id }));
    }
    layer.replaceChildren(...out);
  };
  /** 点中的地方是不是能写的格:空格、描红格,或写过的格(范字格照常点字) */
  const cellAt = (sx: number, sy: number): SceneCell | null => {
    if (readonly) return null;
    const written = lessonPage(latest.current)?.kid.cells ?? {};
    return cellsHere().find((c) => (c.kind !== 'model' || written[c.id]) && sx >= c.box[0] && sx <= c.box[2] && sy >= c.box[1] && sy <= c.box[3]) ?? null;
  };
  /** 能写的格:悬着(鼠标、笔)浅浅铺一层,手指按住深一点;开着写字格的那一格不铺 */
  const cellHinted = useRef<{ id: string; mode: 'press' | 'hover' } | null>(null);
  const cellPressTimer = useRef(0);
  const cellHint = (c: SceneCell | null, mode: 'press' | 'hover'): void => {
    const hl = svg.current?.querySelector('.bk-hl');
    if (!c || c.id === padCell.current?.id) {
      if (cellHinted.current?.mode === mode || !c) { hl?.querySelector('.bk-cell-hint')?.remove(); cellHinted.current = null; }
      return;
    }
    if (cellHinted.current?.id === c.id && cellHinted.current.mode === mode) return;
    hl?.querySelector('.bk-cell-hint')?.remove();
    hl?.append(el('rect', { x: String(c.box[0]), y: String(c.box[1]), width: String(c.box[2] - c.box[0]), height: String(c.box[3] - c.box[1]), class: 'bk-cell-hint', fill: color ?? TEACHER_INK, 'fill-opacity': mode === 'press' ? '0.14' : '0.06', stroke: color ?? TEACHER_INK, 'stroke-opacity': mode === 'press' ? '0.6' : '0.42', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }));
    cellHinted.current = { id: c.id, mode };
  };
  const markCell = (c: SceneCell | null): void => {
    const hl = svg.current?.querySelector('.bk-hl');
    hl?.querySelector('.bk-cell-on')?.remove();
    if (hl && c) hl.append(el('rect', { x: String(c.box[0]), y: String(c.box[1]), width: String(c.box[2] - c.box[0]), height: String(c.box[3] - c.box[1]), class: 'bk-cell-on', fill: color ?? TEACHER_INK, 'fill-opacity': '0.12', stroke: color ?? TEACHER_INK, 'stroke-width': '2.5', 'vector-effect': 'non-scaling-stroke' }));
  };
  const openPad = (c: SceneCell): void => {
    unpickHere(true);
    window.clearTimeout(cellPressTimer.current);
    cellHint(null, 'press');
    padCell.current = c; padDirty.current = false;
    markCell(c);
    setPad(c);
  };
  const closePad = (): void => {
    padCell.current = null; padDirty.current = false;
    markCell(null);
    setPad(null);
  };
  /** 放好:交出去;同一排右边还有没写的空格就挪过去,没有就收 */
  const savePad = (strokes: [number, number][][]): void => {
    const c = padCell.current;
    if (!c) return;
    onCell?.(c.id, strokes, c.m ?? null, c.kind === 'blank');
    const written = lessonPage(latest.current)?.kid.cells ?? {};
    const next = strokes.length ? cellsHere().find((x) => x.kind === c.kind && x.kind !== 'trace' && !written[x.id] && x.id !== c.id && Math.abs(x.box[1] - c.box[1]) < 3 && x.box[0] > c.box[0]) : undefined;
    if (next) openPad(next); else closePad();
  };
  /** 一块(场景坐标)放进窗里:整块看得见,四周留点边 */
  const camFor = (b: Box): Cam => {
    const [vw, vh] = vsize();
    return clamp({ cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, s: Math.min(vw / (b[2] - b[0]), vh / (b[3] - b[1])) });
  };
  /** 老师的「看」:窗大小不变,滚到那一块——放得下就摆在窗中间,放不下就块顶贴着窗顶(让过顶栏);只读的照 camFor */
  const lookAt = (b: Box): Cam => {
    if (readonly) return camFor(b);
    const [vw, vh] = vsize();
    const s = (vw / BOOK_W) * zoom.current;
    const fits = (b[3] - b[1]) * s <= vh - LOOK_TOP_PX * 2;
    return clamp({ s, cx: (b[0] + b[2]) / 2, cy: fits ? (b[1] + b[3]) / 2 : b[1] - LOOK_TOP_PX / s + vh / 2 / s });
  };
  /** 老师「看」的那一块等着刷荧光:rows = 服务端找好的字行(look.rows);没给就照框(老师给的原框,不是留了边的 frameBox)在文字层里挑,字行还没到就先记着,到了(或等不到)再刷 */
  const looking = useRef<{ box: Box; rows?: Box[]; timer: number } | null>(null);
  const lookAnim = useRef(0);
  const flashLook = (b: Box, given?: Box[]): void => {
    if (readonly) return;
    if (looking.current) window.clearTimeout(looking.current.timer);
    looking.current = { box: b, ...(given?.length ? { rows: given } : {}), timer: window.setTimeout(() => paintLook(true), LOOK_WAIT_MS) };
    paintLook(false);
  };
  /** 刷荧光:块里的字行一行一行从左往右刷过去(行多了总共也不超过 LOOK_SPAN_MS),停一会儿淡掉;没有字行(白纸、没认出字)整块铺一层淡的。force = 不等字行了 */
  const paintLook = (force: boolean): void => {
    const L = looking.current, g = geo.current;
    const hl = svg.current?.querySelector('.bk-hl');
    if (!L || !g || !hl) return;
    const rows = L.rows ?? bookRows(g.lines, g.sheets, L.box);
    if (!rows.length && !force && !g.linesDone) return;
    window.clearTimeout(L.timer);
    looking.current = null;
    cancelAnimationFrame(lookAnim.current);
    hl.querySelector('.bk-look')?.remove();
    const wash = !rows.length;
    const grp = el('g', { class: wash ? 'bk-look bk-look-wash' : 'bk-look' });
    const boxes = wash ? [L.box] : rows.map((r): Box => [r[0] - LOOK_PAD[0], r[1] - LOOK_PAD[1], r[2] + LOOK_PAD[0], r[3] + LOOK_PAD[1]]);
    const rects = boxes.map((r) => { const e = el('rect', { x: String(r[0]), y: String(r[1]), width: '0', height: String(Math.max(4, r[3] - r[1])), rx: '6' }); grp.append(e); return { e, w: Math.max(4, r[2] - r[0]) }; });
    hl.append(grp);
    const still = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    const sweep = wash || still ? 0 : LOOK_SWEEP_MS;
    const step = wash || still || rects.length < 2 ? 0 : Math.min(LOOK_STEP_MS, (LOOK_SPAN_MS - LOOK_SWEEP_MS) / (rects.length - 1));
    const fadeAt = (rects.length - 1) * step + sweep + LOOK_HOLD_MS;
    const t0 = performance.now() + LOOK_DELAY_MS;
    const tick = (now: number): void => {
      if (!grp.isConnected) return;
      const t = now - t0;
      rects.forEach(({ e, w }, i) => { const k = sweep ? Math.min(1, Math.max(0, (t - i * step) / sweep)) : t >= 0 ? 1 : 0; e.setAttribute('width', String(w * (1 - (1 - k) ** 3))); });
      grp.setAttribute('opacity', String(Math.min(1, Math.max(0, 1 - (t - fadeAt) / LOOK_FADE_MS))));
      if (t < fadeAt + LOOK_FADE_MS) lookAnim.current = requestAnimationFrame(tick);
      else grp.remove();
    };
    lookAnim.current = requestAnimationFrame(tick);
  };
  /** 窗去老师看的那一块(frame = 留了边的,窗照它摆)、刷荧光(raw = 老师给的原框) */
  const goLook = (frame: Box, raw: Box, rows?: Box[]): void => { moveTo(lookAt(frame), true); flashLook(raw, rows); };
  /**
   * 白纸条开着:题目顶着窗口最上面,下面是白纸条;题目太高(带一大幅图),白纸条剩不下窗口的 STRIP_SHOW 就往下挪,
   * 让白纸条从窗口中间偏上开始(题目上面那截滚出去,孩子要看再往回拖)
   */
  const goStrip = (q: Box): void => {
    if (readonly) { goLook(q, q); return; }
    const [vw, vh] = vsize();
    const s = (vw / BOOK_W) * zoom.current;
    const top = LOOK_TOP_PX / s, win = vh / s;
    const y0 = q[3] - q[1] + top <= win * (1 - STRIP_SHOW) ? q[1] - top : q[3] - win * (1 - STRIP_SHOW);
    moveTo(clamp({ s, cx: BOOK_W / 2, cy: y0 + win / 2 }), true);
    flashLook(q);
  };
  /** 老师没写「看」:页宽铺满窗、第一页的顶贴着窗顶(2026-11-14:原来整页塞进窗,横屏两边各空一大块;顶栏浮在上面,不占地方) */
  const pageTop = (): Cam => {
    const [vw, vh] = vsize();
    const s = vw / BOOK_W;
    return clamp({ s, cx: BOOK_W / 2, cy: vh / 2 / s });
  };
  /** 作业本一进来:页宽铺满,白纸的顶在窗中间(上半是最近拍的那一张,下半是白纸) */
  const hwStart = (hw: HwGeo): Cam => {
    const [vw] = vsize();
    return clamp({ s: vw / BOOK_W, cx: BOOK_W / 2, cy: hw.tail });
  };
  /** 窗中间在哪一天;最后那张白纸露出来过半截窗就是今天(手机竖着窗高,白纸在下面露着时中间还在前一天);变了告诉页面 */
  const dayTold = useRef('');
  const dayNow = (): void => {
    const hw = geo.current?.hw;
    if (!hw || readonly) return;
    const cy = cam.current.cy, [, vh] = vsize(), half = vh / 2 / cam.current.s;
    let d = hw.days[0]?.day ?? hw.today;
    for (const x of hw.days) if (x.top <= cy) d = x.day;
    if (hw.tail <= cy + half * 0.5) d = hw.today;
    if (d !== dayTold.current) { dayTold.current = d; onDayRef.current?.(d); }
  };
  const onDayRef = useRef(onDay);
  onDayRef.current = onDay;
  const moveTo = (to: Cam, animate: boolean): void => {
    cancelAnimationFrame(glide.current);
    const from = { ...cam.current };
    const [, vh] = vsize();
    const far = Math.abs(to.cy - from.cy) * Math.min(from.s, to.s) > vh * 3;
    if (!animate || far) { cam.current = to; apply(); scheduleSharp(); return; }
    const t0 = performance.now();
    const tick = (now: number): void => {
      const x = Math.min(1, (now - t0) / GLIDE_MS), k = ease(x);
      // 倍数按比例插(放大缩小看着匀)
      cam.current = { cx: from.cx + (to.cx - from.cx) * k, cy: from.cy + (to.cy - from.cy) * k, s: from.s * Math.pow(to.s / from.s, k) };
      apply();
      if (x < 1) glide.current = requestAnimationFrame(tick); else scheduleSharp();
    };
    glide.current = requestAnimationFrame(tick);
  };

  // ---- 画面 ----
  /** 停下来以后把窗里那一块照屏幕的像素重画一张盖上去(先画的那张放大了糊) */
  const scheduleSharp = (): void => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => void drawSharp(), 250);
    scheduleShot();
  };
  // ---- 交窗里的图 ----
  const shotTimer = useRef(0);
  const shotKey = useRef('');
  const shotTries = useRef(0);
  /** 老师那一层的样子(记号变了,窗里的图要重交) */
  const teacherKey = useRef('');
  /** 开着的写字格:哪一格(state 画卡;ref 给摆位置、轻点用)、写了没放好 */
  const [pad, setPad] = useState<SceneCell | null>(null);
  const padCell = useRef<SceneCell | null>(null);
  const padEl = useRef<HTMLDivElement>(null);
  const padDirty = useRef(false);
  /** 点中的那个字(场景坐标):卡开着时跟着它 */
  const picked = useRef<Box | null>(null);
  const pickAtRef = useRef(onPickAt);
  pickAtRef.current = onPickAt;
  const scheduleShot = (): void => {
    if (!onShot || readonly) return;
    window.clearTimeout(shotTimer.current);
    shotTimer.current = window.setTimeout(shoot, SHOT_MS);
  };
  /** 田字格里写的字变过几回(窗图要不要重交照它;不拿整份笔画比,格子多了太长) */
  const cellsRev = useRef(0);
  /** 窗图的样子:窗、老师那一层、孩子的笔画、格子里写的、白纸条都没变就是同一张 */
  const shotKeyOf = (g: { key: string }, box: Box): string => `${g.key}|${box.join(',')}|${teacherKey.current}|${ink.current.length}|${cellsRev.current}|${stripKeyRef.current}|${sInk.current.length}`;
  /** 窗里的页都画好了才交;窗、老师的卡、孩子的笔画都没变就不再交 */
  const shoot = (): void => {
    const g = geo.current;
    if (!g || !onShot || readonly || touches.current.size || pen.current) return;
    const b = viewBox();
    const seen = g.sheets.filter((sh) => sh.top < b[3] && sh.top + sh.height > b[1]);
    if (seen.some((sh) => !g.drawn.has(sh.n))) { if (shotTries.current++ < 20) scheduleShot(); return; }
    shotTries.current = 0;
    const box = b.map((v) => Math.round(v)) as Box;
    const key = shotKeyOf(g, box);
    if (key === shotKey.current) return;
    const image = snapshot('image/jpeg');
    if (!image) return;
    shotKey.current = key;
    onShot(box, image);
  };
  const drawSharp = async (): Promise<void> => {
    const g = geo.current, cv = sharp.current;
    if (!g || !cv) return;
    sharpTask.current?.cancel();
    const c = cam.current;
    const dpr = window.devicePixelRatio || 1;
    const [x0, y0, x1, y1] = viewBox(c);
    // 先画的那张够清楚就不用
    const need = c.s * dpr;
    const have = Math.min(...g.sheets.map((sh) => (g.base.get(sh.n)?.width ?? 0) / BOOK_W));
    if (need <= have * 1.15) { cv.style.display = 'none'; return; }
    let k = need;
    const w = (x1 - x0) * k, h = (y1 - y0) * k;
    if (w * h > SHARP_MAX_PX) k *= Math.sqrt(SHARP_MAX_PX / (w * h));
    if (!g.pdf) { cv.style.display = 'none'; return; }
    const doc = await openDoc(g.pdf);
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.round((x1 - x0) * k));
    tmp.height = Math.max(1, Math.round((y1 - y0) * k));
    let cancelled = false;
    sharpTask.current = { cancel: () => { cancelled = true; } };
    // 一页一页画它露在窗里的那一截(白底),再拼进窗那一块;页和页之间的缝空着(透出底下先画的那层和纸色)。
    // 不能几页画进同一张透明画布:pdf.js 把透明底画成黑的
    const ctx = tmp.getContext('2d');
    for (const sh of g.sheets) {
      const ix0 = Math.max(x0, 0), iy0 = Math.max(y0, sh.top), ix1 = Math.min(x1, BOOK_W), iy1 = Math.min(y1, sh.top + sh.height);
      if (ix1 <= ix0 || iy1 <= iy0 || cancelled || !ctx) continue;
      const page = await doc.getPage(sh.n);
      if (cancelled) return;
      const part = document.createElement('canvas');
      part.width = Math.max(1, Math.round((ix1 - ix0) * k));
      part.height = Math.max(1, Math.round((iy1 - iy0) * k));
      const vp = page.getViewport({ scale: sh.s * k });
      const task = page.render({ canvas: part, viewport: vp, transform: [1, 0, 0, 1, -ix0 * k, (sh.top - iy0) * k], background: '#ffffff', annotationMode: 0 });
      sharpTask.current = { cancel: () => { cancelled = true; task.cancel(); } };
      try { await task.promise; } catch { return; }
      ctx.drawImage(part, Math.round((ix0 - x0) * k), Math.round((iy0 - y0) * k));
    }
    if (cancelled || geo.current !== g) return;
    cv.width = tmp.width; cv.height = tmp.height;
    cv.getContext('2d')?.drawImage(tmp, 0, 0);
    Object.assign(cv.style, { display: 'block', left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  };

  /**
   * 老师的记号:圈(一笔画出来)、划、加点、盖拼音的块、盖住印好的字;孩子揭开过的不再盖。
   * 已经在页上的不重画(圈的画出来那一下只放一次),只换新旧(.bk-old);状态里没了的圈、划、加点淡出再拿掉
   */
  const paintTeacher = useCallback((l: Lesson) => {
    const layer = svg.current?.querySelector('.bk-teacher');
    const p = lessonPage(l);
    if (!layer || !p) return;
    const opened = new Set(p.kid.revealed);
    const fresh = markFresh(l, p);
    const have = new Map<string, Element>();
    for (const e of Array.from(layer.children)) if (!e.classList.contains('bk-gone')) have.set(e.getAttribute('data-key') ?? '', e);
    const make = (k: string, text: string, box: Box): SVGElement => {
      const line = { fill: 'none', stroke: TEACHER_INK, 'stroke-width': '3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' };
      if (k === '圈') return el('path', { d: pathD(ringPath(box, seedOf(text))), ...line, class: 'bk-mark bk-ring', 'data-text': text, pathLength: '1' });
      if (k === '划') return el('path', { d: pathD(underPath(box)), ...line, class: 'bk-mark bk-ring', 'data-text': text, pathLength: '1' });
      if (k === '加点') {
        const g = el('g', { class: 'bk-mark bk-dots', 'data-text': text });
        for (const d of dotSpots(box, text)) g.append(el('circle', { cx: String(d.cx), cy: String(d.cy), r: String(d.r), fill: TEACHER_INK }));
        return g;
      }
      // 遮:字头上一条(拼音印在字的正上方);盖:印好的字整个盖住(和 book.ts 的 build 一样大)
      const h = box[3] - box[1];
      const r = k === '遮' ? [box[0] - h * 0.1, box[1] - h * 0.95, box[2] - box[0] + h * 0.2, h * 0.9, h * 0.15] : [box[0] - h * 0.25, box[1] - h * 0.2, box[2] - box[0] + h * 0.5, h * 1.4, h * 0.2];
      return el('rect', { x: String(r[0]), y: String(r[1]), width: String(r[2]), height: String(r[3]), rx: String(r[4]), fill: '#f1e6c8', stroke: '#d9c9a3', 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke', class: 'bk-cover', 'data-cover': text });
    };
    p.teacher.marks.forEach(({ k, text, box }, i) => {
      if ((k === '遮' || k === '盖') && opened.has(text)) return;
      const key = `${k}|${text}|${box.join(',')}`;
      let e = have.get(key);
      if (e) have.delete(key);
      else { e = make(k, text, box); e.setAttribute('data-key', key); layer.append(e); }
      if (e.classList.contains('bk-mark')) e.classList.toggle('bk-old', !fresh[i]);
    });
    // 状态里没了的:圈、划、加点淡出;揭开的、擦掉的盖住的直接拿掉
    for (const e of have.values()) {
      if (!e.classList.contains('bk-mark')) { e.remove(); continue; }
      e.classList.add('bk-gone');
      window.setTimeout(() => e.remove(), MARK_GONE_MS);
    }
  }, []);

  /** 作业本:照片上以前的记号(只看;照片在这一页上的哪儿就挪到哪儿) */
  const pastRef = useRef(past);
  pastRef.current = past;
  const paintPast = useCallback(() => {
    const layer = svg.current?.querySelector('.bk-past');
    if (!layer) return;
    const p = lessonPage(latest.current);
    const out: SVGElement[] = [];
    if (p?.kind === 'photo' && p.day) {
      p.photos.forEach((ph, i) => {
        const got = pastRef.current?.[ph.src];
        if (!got) return;
        const top = photoSheetBox(p.photos, i, p.day)[1];
        const g = el('g', { transform: `translate(0 ${top})` });
        const line = { fill: 'none', stroke: TEACHER_INK, 'stroke-width': '3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' };
        for (const m of got.marks) {
          const cls = `bk-mark${m.old ? ' bk-old' : ''}`;
          if (m.k === '圈') g.append(el('path', { d: pathD(ringPath(m.box, seedOf(m.text))), ...line, class: cls }));
          else if (m.k === '划') g.append(el('path', { d: pathD(underPath(m.box)), ...line, class: cls }));
          else if (m.k === '加点') {
            const d = el('g', { class: `${cls} bk-dots` });
            for (const s2 of dotSpots(m.box, m.text)) d.append(el('circle', { cx: String(s2.cx), cy: String(s2.cy), r: String(s2.r), fill: TEACHER_INK }));
            g.append(d);
          }
        }
        for (const st of got.ink) g.append(el('path', { d: pathD(st), fill: 'none', stroke: KID_INK, 'stroke-width': String(KID_INK_WIDTH * 0.7), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', opacity: '0.9', class: 'bk-past-ink' }));
        out.push(g);
      });
    }
    layer.replaceChildren(...out);
  }, []);

  /** 孩子画的几笔 */
  const paintInk = useCallback(() => {
    const layer = svg.current?.querySelector('.bk-ink');
    if (!layer) return;
    const common = { fill: 'none', stroke: KID_INK, 'stroke-width': String(KID_INK_WIDTH * 0.7), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', opacity: '0.9' };
    const out = ink.current.map((st) => el('path', { d: pathD(st), ...common }));
    layer.replaceChildren(...out, ...(pen.current ? [pen.current.el] : []));
    setMarks(ink.current.length + sInk.current.length);
  }, []);

  /** 白纸条:紧贴题的下沿盖一条白纸,上面照 stripLayout 摆图形、写字;孩子在上面画的跟着它;能转的图形旁边一颗转的钮 */
  const stripKeyRef = useRef('');
  const paintStrip = useCallback(() => {
    const layer = svg.current?.querySelector('.bk-strip');
    if (!layer) return;
    const st = latestStrip.current;
    const p = lessonPage(latest.current);
    if (!st || !p) { layer.replaceChildren(); return; }
    const [x1, y1, x2, y2] = st.lay.rect;
    const out: SVGElement[] = [
      el('rect', { x: String(x1), y: String(y1), width: String(x2 - x1), height: String(y2 - y1), fill: STRIP_FILL, class: 'bk-strip-bg' }),
      el('path', { d: `M${x1} ${y1}H${x2}`, stroke: STRIP_EDGE, 'stroke-width': '2', 'stroke-dasharray': '10 8', 'vector-effect': 'non-scaling-stroke', fill: 'none' }),
    ];
    for (const slot of st.lay.slots) {
      if (slot.item.kind === 'write') {
        const t = el('text', { x: String((slot.box[0] + slot.box[2]) / 2), y: String((slot.box[1] + slot.box[3]) / 2), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': String(slot.font), fill: '#1e1e1e', class: 'bk-strip-text' });
        t.textContent = slot.item.text;
        out.push(t);
        continue;
      }
      const deg = p.kid.turns[`${st.key}#${slot.n}`] ?? 0;
      const g = el('g', { transform: `translate(${slot.ox} ${slot.oy}) scale(${slot.scale})`, class: 'bk-shape' });
      for (const k of slotSkeletons(slot, deg)) { const e = skeletonEl(k); if (e) g.append(e); }
      out.push(g);
      // 方向盘:右边一颗转的钮(请了转才有)
      if (slot.scene?.turns.length && canTurnRef.current && !readonly) {
        const r = 34, cx = Math.min(BOOK_W - r - 8, slot.box[2] + r + 12), cy = slot.box[1] + r + 8;
        const b = el('g', { class: 'bk-turn', 'data-item': `${st.key}#${slot.n}`, 'data-deg': String(deg), 'data-x': String(cx), 'data-y': String(cy), 'data-r': String(r) });
        b.append(el('circle', { cx: String(cx), cy: String(cy), r: String(r), fill: '#fff4d6', stroke: '#e0a800', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke' }));
        b.append(el('path', { d: `M${cx + 14} ${cy - 6}A16 16 0 1 0 ${cx + 6} ${cy + 14}M${cx + 14} ${cy - 6}l2 -12M${cx + 14} ${cy - 6}l-12 -2`, fill: 'none', stroke: '#b07d00', 'stroke-width': '3', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
        out.push(b);
      }
    }
    const common = { fill: 'none', stroke: KID_INK, 'stroke-width': String(KID_INK_WIDTH * 0.7), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', opacity: '0.9' };
    for (const stroke of sInk.current) out.push(el('path', { d: pathD(stroke), ...common }));
    layer.replaceChildren(...out);
    setMarks(ink.current.length + sInk.current.length);
  }, [readonly]);
  const canTurnRef = useRef(canTurn);
  canTurnRef.current = canTurn;

  /** 一张照片认出的字(换成课本的样子);done = 认完了(没在认) */
  const photoWords = async (ph: { src: string; w: number; h: number }, i: number): Promise<{ page: BookPage; done: boolean }> => {
    const r = await fetch(`/api/kid/photo-words?p=${encodeURIComponent(ph.src)}`, { cache: 'no-store' }).catch(() => null);
    const j = r?.ok ? ((await r.json()) as { state?: string; items?: PhotoWord[]; lines?: PhotoLine[] }) : null;
    return { page: photoBookPage(i + 1, ph, j ? { items: j.items ?? [], lines: j.lines ?? [], questions: [] } : null).page, done: j?.state !== 'running' };
  };
  /** 照片页正在画的、拉过字的几张(键带这一页的 key,换页作废) */
  const drawing = useRef(new Set<string>());
  const worded = useRef(new Set<string>());
  /**
   * 照片只画窗附近的:上下各两屏以内的画上(照片画进画布),十屏以外画过的放掉(画布清空,纸色占位);
   * 作业本以前那天的照片到了附近顺手拉一次认出的字(点字、老师「看」刷荧光用)
   */
  const drawNear = (): void => {
    const g = geo.current, p = lessonPage(latest.current);
    if (!g || g.pdf || p?.kind !== 'photo' || g.key !== sourceKey(p, 0)) return;
    const [, vh] = vsize();
    const c = cam.current, half = vh / 2 / c.s;
    for (const sh of g.sheets) {
      const cv = g.base.get(sh.n), ph = p.photos[sh.n - 1];
      if (!cv || !ph) continue;
      const near = sh.top < c.cy + half * 5 && sh.top + sh.height > c.cy - half * 5;
      const far = sh.top > c.cy + half * 20 || sh.top + sh.height < c.cy - half * 20;
      const k = `${g.key}|${sh.n}`;
      if (far && g.drawn.has(sh.n)) { cv.width = 0; cv.height = 0; g.drawn.delete(sh.n); continue; }
      if (!near || g.drawn.has(sh.n) || drawing.current.has(k)) continue;
      drawing.current.add(k);
      void loadImage(`/api/kid/image?p=${encodeURIComponent(ph.src)}`).catch(() => null).then((img) => {
        drawing.current.delete(k);
        if (geo.current !== g || !img) return;
        const r = Math.min(1, PHOTO_PX / img.naturalWidth);
        cv.width = Math.round(img.naturalWidth * r); cv.height = Math.round(img.naturalHeight * r);
        cv.getContext('2d')?.drawImage(img, 0, 0, cv.width, cv.height);
        g.drawn.add(sh.n);
      });
      if (p.day && photoDay(ph, p.day) !== p.day && !worded.current.has(k)) {
        worded.current.add(k);
        void photoWords(ph, sh.n - 1).then((x) => { if (geo.current === g) g.lines[sh.n - 1] = x.page; });
      }
    }
  };

  // ---- 铺这一页:量页(课本开 PDF 量,照片照状态里记的宽高,白纸一张)、每页先画一张、拉行和字 ----
  useEffect(() => {
    const p = latest.current && lessonPage(latest.current);
    if (!p || !geoKey) return;
    if (geo.current?.key === geoKey) return;
    let cancelled = false;
    setPhase('loading');
    (async () => {
      const pdfUrl = p.kind === 'book' ? `/api/kid/textbook/pdf?b=${encodeURIComponent(p.src)}` : null;
      const doc = pdfUrl ? await openDoc(pdfUrl) : null;
      const dims: { n: number; w: number; h: number }[] = [];
      if (p.kind === 'book' && doc) for (const n of p.pages) { const pg = await doc.getPage(n); const vp = pg.getViewport({ scale: 1 }); dims.push({ n, w: vp.width, h: vp.height }); }
      else if (p.kind === 'photo') p.photos.forEach((ph, i) => dims.push({ n: i + 1, w: ph.w, h: ph.h }));
      else if (p.kind === 'workbook') p.sheets.forEach((sh, i) => dims.push({ n: i + 1, w: sh.w, h: sh.h }));
      else dims.push({ n: 1, w: BOOK_W, h: whiteH });
      if (cancelled) return;
      // 每页底下不铺的那一条(课本;应用照这一册算好的,bookCut):有它页和页就直接连着;作业本照天、周分开
      const cut = p.kind === 'book' ? p.cut : 0;
      const sheets = bookSheets(dims, undefined, cut, p.kind === 'photo' ? photoGaps(p.photos, p.day) : undefined).map((sh, i) => ({ ...sh, w: dims[i].w, h: dims[i].h }));
      const height = sheets.length ? sheets[sheets.length - 1].top + sheets[sheets.length - 1].height : p.kind === 'photo' ? 0 : BOOK_W;
      const aspect = dims.length ? Math.round((dims[0].h / dims[0].w) * 10000) / 10000 : BOOK_ASPECT;
      const hw = p.kind === 'photo' && p.day ? hwGeo(p, sheets) : null;
      const [vw] = vsize();
      const px = Math.min(BASE_PX, Math.round(vw * (window.devicePixelRatio || 1)));
      const base = new Map<number, HTMLCanvasElement>();
      const host = paper.current;
      if (!host) return;
      // 换了一页:旧的页拿掉(目录上按着的那一行也是)
      for (const old of Array.from(host.querySelectorAll('.bk-page'))) old.remove();
      tocShow(null, 'press');
      for (const sh of sheets) {
        const cv = document.createElement('canvas');
        cv.className = cut > 0 ? 'bk-page bk-joined' : 'bk-page';
        Object.assign(cv.style, { left: '0px', top: `${sh.top}px`, width: `${BOOK_W}px`, height: `${sh.height}px` });
        host.prepend(cv);
        base.set(sh.n, cv);
      }
      // 照片页的字行先占好位(一张一页,认出来的后到)
      const blank = p.kind === 'photo' ? p.photos.map((ph, i) => photoBookPage(i + 1, ph, null).page) : [];
      geo.current = { key: geoKey, pdf: pdfUrl, sheets, height, aspect, base, drawn: new Set(), lines: blank, linesDone: p.kind !== 'book' && p.kind !== 'photo' && p.kind !== 'workbook', hw };
      dayTold.current = '';
      setGeoRev((n) => n + 1);
      readParts.current = []; readHover.current = null; readPrevK.current = ''; paintRead();
      if (svg.current) { svg.current.setAttribute('viewBox', `0 0 ${BOOK_W} ${height}`); Object.assign(svg.current.style, { width: `${BOOK_W}px`, height: `${height}px` }); }
      if (sharp.current) sharp.current.style.display = 'none';
      // 这一页上孩子画的、老师的记号照状态摆(换页再回来还在)
      ink.current = (lessonPage(latest.current)?.kid.ink ?? []).map((st) => st.slice());
      paintInk();
      paintTeacher(latest.current);
      // 换了一页从页宽看起;老师让看过哪里就到那里;录像照孩子停下的窗
      zoom.current = 1;
      const L = latest.current.look;
      const fb = L ? frameBox(L.box, sheets) : null;
      lookedN.current = L?.n ?? -1;
      const v = readonly ? latest.current.view : null;
      // 孩子的窗:老师让看的那一块;没有就照状态里记的窗(目录上次翻到的那一课那一行、刷新前停的地方),摆在窗中间
      const kv = !readonly && !fb ? latest.current.view : null;
      cam.current = v ? camFor(v) : fb ? lookAt(fb) : kv ? camFor(kv) : hw && !readonly ? hwStart(hw) : pageTop();
      apply();
      if (L && !v) flashLook(L.box, L.rows);
      setPhase('ready');
      // 每页先画一张(从窗里看得见的那页起);照片只画窗附近的(drawNear,apply 里已经起了)
      const order = p.kind === 'photo' ? [] : [...sheets].sort((a, b) => Math.abs(a.top + a.height / 2 - cam.current.cy) - Math.abs(b.top + b.height / 2 - cam.current.cy));
      for (const sh of order) {
        const cv = base.get(sh.n)!;
        if (doc) {
          const pg = await doc.getPage(sh.n);
          if (cancelled) return;
          const k = px / sh.w;
          const vp = pg.getViewport({ scale: k });
          // 画布只有铺出来的那么高(页底裁掉的那一条不画);批注不画:平台盖在页顶的社标是一条水印批注
          cv.width = Math.round(vp.width); cv.height = Math.round(sh.height / sh.s * k);
          await pg.render({ canvas: cv, viewport: vp, annotationMode: 0 }).promise.catch(() => {});
        } else if (p.kind === 'workbook') {
          const url = `/api/kid/workbook/image?w=${encodeURIComponent(p.src)}&p=${sh.n}`;
          const img = await loadImage(url).catch(() => null);
          if (cancelled) return;
          if (img) {
            const k = Math.min(1, PHOTO_PX / img.naturalWidth);
            cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
            cv.getContext('2d')?.drawImage(img, 0, 0, cv.width, cv.height);
          }
        } else {
          cv.width = 4; cv.height = Math.max(4, Math.round(4 * sh.height / BOOK_W));
          const g = cv.getContext('2d');
          if (g) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height); }
        }
        geo.current?.drawn.add(sh.n);
      }
      scheduleSharp();
      // 点字要的行和字:课本照 PDF 的文字层,照片照认出来的(认完以前一直是空的,等一会儿再拉)
      if (p.kind === 'book') {
        const r = await fetch(`/api/kid/textbook/lines?b=${encodeURIComponent(p.src)}&p=${p.pages[0]}-${p.pages[p.pages.length - 1]}`, { cache: 'no-store' }).catch(() => null);
        const j = r?.ok ? ((await r.json()) as { pages?: BookPage[] }) : null;
        if (cancelled || geo.current?.key !== geoKey) return;
        if (Array.isArray(j?.pages)) geo.current.lines = j!.pages!;
        geo.current.linesDone = true;
        // 点读的几块:同服务端合成时一样的行、一样的分法(bookReadTexts),第几块第几句对得上
        readParts.current = p.layout !== 'math' && p.title !== BOOK_TOC ? bookReadParts(geo.current.lines, geo.current.sheets, lessonBlocks(geo.current.lines, p.layout)) : [];
        paintCells();
        paintLook(false);
        paintRead();
      } else if (p.kind === 'workbook') {
        // 练习册:行、题框、能写的格子都是排版时记下的,拉一次就全了
        const r = await fetch(`/api/kid/workbook/lines?w=${encodeURIComponent(p.src)}`, { cache: 'no-store' }).catch(() => null);
        const j = r?.ok ? ((await r.json()) as { pages?: BookPage[] }) : null;
        if (cancelled || geo.current?.key !== geoKey) return;
        if (Array.isArray(j?.pages)) geo.current.lines = j!.pages!;
        geo.current.linesDone = true;
        paintCells();
        paintLook(false);
      } else if (p.kind === 'photo') {
        // 认出的字:作业本只等今天拍的(以前的照片到了窗附近再拉一次,drawNear),别的照片页等全部
        const want = p.photos.flatMap((ph, i) => (!p.day || photoDay(ph, p.day) === p.day ? [i] : []));
        for (let round = 0; round < 40 && !cancelled; round++) {
          const got = await Promise.all(want.map((i) => photoWords(p.photos[i], i)));
          if (cancelled || geo.current?.key !== geoKey) return;
          got.forEach((x, k) => { geo.current!.lines[want[k]] = x.page; });
          if (got.every((x) => x.done)) geo.current.linesDone = true;
          paintLook(false);
          if (geo.current.linesDone) break;
          await new Promise((r) => window.setTimeout(r, 1500));
        }
      }
    })().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoKey]);

  // ---- 点读:页面说在读哪一块哪一句、什么样就照着画钮、铺那一句;读到窗外的一句,孩子一会儿没动手就把窗挪过去(动过就不抢) ----
  const readKey = JSON.stringify([readOn, read ?? null]);
  useEffect(() => {
    if (phase !== 'ready') return;
    paintRead();
    const r = readNow.current.read, prev = readPrevK.current;
    const now = readOn && r && r.k >= 0 ? `${r.k}.${r.s ?? 0}` : '';
    readPrevK.current = now;
    if (!readOn || !r || r.k < 0 || now === prev || r.mode === 'paused') return;
    const pt = readParts.current[r.k];
    if (!pt || performance.now() - lastHand.current < READ_IDLE_MS) return;
    // 这一句的框(没对上字的照这一块的钮)
    const say = pt.says[r.s ?? 0] ?? [];
    const top = say.length ? Math.min(...say.map((b) => b[1])) : pt.hit[1], bottom = say.length ? Math.max(...say.map((b) => b[3])) : pt.hit[3];
    const vb = viewBox(), h = vb[3] - vb[1];
    if (top >= vb[1] && bottom <= vb[3] - h * 0.2) return;
    const c = cam.current, [, vh] = vsize();
    moveTo(clamp({ ...c, cy: top - (vh * 0.15) / c.s + vh / 2 / c.s }), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey, phase]);

  // ---- 状态变了(页面落好了老师的动作、孩子做的事):记号、笔画照新的摆;老师新「看」了一处就把窗移过去,孩子手上动着就等他停 ----
  const teacherNow = JSON.stringify([page?.teacher, revealedKey, lesson.said ?? 0]);
  const inkNow = page?.kid.ink.length ?? 0;
  const cellsNow = JSON.stringify(page?.kid.cells ?? {});
  const cellsKey = useRef('');
  useEffect(() => {
    const g = geo.current;
    if (!g || g.key !== geoKey || phase !== 'ready') return;
    if (teacherKey.current !== teacherNow) { teacherKey.current = teacherNow; paintTeacher(lesson); scheduleShot(); }
    if (cellsKey.current !== cellsNow) { cellsKey.current = cellsNow; cellsRev.current++; paintCells(); scheduleShot(); }
    const want = page?.kid.ink ?? [];
    if (want.length !== ink.current.length || want.some((st, i) => st.length !== ink.current[i]?.length)) { ink.current = want.map((st) => st.slice()); paintInk(); scheduleShot(); }
    // 白纸条:换了一条、东西变了、孩子在上面画的变了就重摆
    const sk = JSON.stringify([strip, strip ? page?.kid.stripInk[strip.key] ?? [] : [], page?.kid.turns, canTurn]);
    const opened = (strip?.key ?? '') !== stripKeyRef.current.split('|')[0];
    if (sk !== stripKeyRef.current.slice(stripKeyRef.current.indexOf('|') + 1)) {
      stripKeyRef.current = `${strip?.key ?? ''}|${sk}`;
      sInk.current = strip ? (page?.kid.stripInk[strip.key] ?? []).map((x) => x.slice()) : [];
      paintStrip();
      scheduleShot();
    }
    const L = lesson.look;
    if (L && L.n !== lookedN.current) {
      lookedN.current = L.n;
      // 白纸条开着:题目在上、白纸条在下;没开:那一块摆到窗里
      if (strip && strip.key === L.label) { if (touches.current.size || pen.current) pendingStrip.current = strip.box; else goStrip(strip.box); }
      else if (touches.current.size || pen.current) pendingFrame.current = { box: L.box, rows: L.rows }; else goLook(frameBox(L.box, g.sheets), L.box, L.rows);
    } else if (strip && opened && !readonly) {
      if (touches.current.size || pen.current) pendingStrip.current = strip.box; else goStrip(strip.box);
    }
    // 录像:孩子的窗跟着
    if (readonly && lesson.view) moveTo(camFor(lesson.view), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherNow, inkNow, cellsNow, lesson.look?.n, lesson.view?.join(','), phase, geoKey, JSON.stringify([strip, strip ? page?.kid.stripInk[strip.key]?.length : 0, page?.kid.turns, canTurn])]);

  // 作业本:以前的记号到了、换了一天就重画(只看,和这一节的状态无关)
  const pastNow = page?.kind === 'photo' && page.day ? JSON.stringify(page.photos.map((ph) => past?.[ph.src] ?? null)) : '';
  useEffect(() => {
    if (!geo.current || geo.current.key !== geoKey || phase !== 'ready') return;
    paintPast();
    if (pastNow) scheduleShot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastNow, geoKey, phase]);

  // 写字格开了、换了一格:摆到那一格旁边
  useEffect(() => { if (pad) placePad(); }, [pad]);

  // 作业本:页面要去哪一天(目录上点的):滚到那一天的分割线,当孩子自己挪的(停下来报窗)
  const goN = useRef(go?.n ?? 0);
  useEffect(() => {
    const hw = geo.current?.hw;
    if (!go || go.n === goN.current || !hw || phase !== 'ready') return;
    goN.current = go.n;
    const at = hw.days.find((d) => d.day === go.day);
    if (!at) return;
    const [vw, vh] = vsize();
    const s = (vw / BOOK_W) * zoom.current;
    moveTo(clamp({ s, cx: cam.current.cx, cy: at.top - LOOK_TOP_PX / s + vh / 2 / s }), true);
    moved.current = true;
    settled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go?.n, phase]);

  useEffect(() => {
    const ro = new ResizeObserver(() => { cam.current = clamp(cam.current); apply(); scheduleSharp(); });
    if (view.current) ro.observe(view.current);
    return () => { ro.disconnect(); cancelAnimationFrame(glide.current); window.clearTimeout(settle.current); window.clearTimeout(shotTimer.current); window.clearTimeout(lastTap.current?.timer); sharpTask.current?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 手 ----
  const toScene = (x: number, y: number): [number, number] => {
    const r = view.current!.getBoundingClientRect();
    const [vw, vh] = [r.width, r.height];
    const c = cam.current;
    return [(x - r.left - vw / 2) / c.s + c.cx, (y - r.top - vh / 2) / c.s + c.cy];
  };
  /** 挪完了:等一下再报(连着挪就只报最后一次),顺手把窗里那块画清楚;手上动着时老师要看的那块这时去 */
  const settled = (): void => {
    scheduleSharp();
    if (pendingStrip.current) { const b = pendingStrip.current; pendingStrip.current = null; pendingFrame.current = null; goStrip(b); return; }
    if (pendingFrame.current && geo.current) { const f = pendingFrame.current; pendingFrame.current = null; goLook(frameBox(f.box, geo.current.sheets), f.box, f.rows); return; }
    if (!moved.current) return;
    moved.current = false;
    window.clearTimeout(reportTimer.current);
    reportTimer.current = window.setTimeout(() => { const b = viewBox(); onView?.([Math.round(b[0]), Math.round(b[1]), Math.round(b[2]), Math.round(b[3])]); }, SETTLE_MS);
  };
  const reportTimer = useRef(0);

  // ---- 目录:点一项翻过去 ----
  /** 铺着的那一行(一次只铺一行):按着的、悬着的 */
  // ---- 点读:标题、段首的钮 ----
  /** 那一块的钮:悬着 / 按着(淡淡的描边钮,按着深一点;不画能点的范围)、在读(实心暂停)、在等合成(转圈)、挪到下一块(转一圈)、暂停了(描边播放) */
  const readButton = (pt: ReadPart, mode: string, c: string): SVGGElement => {
    const [cx, cy] = pt.dot, r = pt.r;
    const g = el('g', { class: 'bk-read-btn', 'data-mode': mode });
    const soft = mode === 'hover' || mode === 'press';
    const solid = mode === 'playing';
    g.append(el('circle', { cx: String(cx), cy: String(cy), r: String(r), fill: solid ? c : soft ? c : '#ffffff', 'fill-opacity': soft ? (mode === 'press' ? '0.14' : '0.06') : '1', stroke: c, 'stroke-opacity': soft ? (mode === 'press' ? '0.6' : '0.42') : mode === 'paused' || mode === 'invite' ? '1' : '0', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke', class: solid || soft ? '' : 'bk-read-lift' }));
    if (mode === 'playing') {
      const w = r * 0.22, h = r * 0.8;
      for (const x of [cx - r * 0.36, cx + r * 0.14]) g.append(el('rect', { x: String(x), y: String(cy - h / 2), width: String(w), height: String(h), rx: String(w * 0.35), fill: '#ffffff' }));
    } else if (mode === 'loading') {
      g.append(el('circle', { cx: String(cx), cy: String(cy), r: String(r * 0.58), fill: 'none', stroke: c, 'stroke-width': '3', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', pathLength: '100', 'stroke-dasharray': '26 74', class: 'bk-read-spin' }));
    } else {
      g.append(el('path', { d: `M${cx - r * 0.26} ${cy - r * 0.4} L${cx + r * 0.46} ${cy} L${cx - r * 0.26} ${cy + r * 0.4} Z`, fill: c, 'fill-opacity': soft ? '0.62' : '1', stroke: c, 'stroke-opacity': soft ? '0.62' : '1', 'stroke-width': '1.5', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    }
    return g;
  };
  /** 照页面给的 read 和悬着的那一块画钮、铺正在读的那一句;没变不重画(转圈、转一圈的动画不重来),收掉的淡出 */
  const paintRead = (): void => {
    const layer = svg.current?.querySelector('.bk-read'), sayer = svg.current?.querySelector('.bk-say');
    if (!layer || !sayer) return;
    const { on, read: r } = readNow.current;
    const parts = readParts.current, hv = readHover.current;
    const active = on && r && r.k >= 0 && r.mode && parts[r.k] ? r : null;
    const hover = on && hv && parts[hv.k] && hv.k !== active?.k ? hv : null;
    // 还没点过读:标题前的钮先摆着(悬着、按着标题时照悬着画)
    const title = parts.findIndex((pt) => pt.no === 0);
    const invite = on && r?.invite && !active && title >= 0 && hover?.k !== title ? title : -1;
    // 正在读(等合成、暂停)的那一句
    const lit = active && (active.mode === 'playing' || active.mode === 'loading' || active.mode === 'paused') ? parts[active.k].says[active.s ?? 0] ?? [] : [];
    const key = JSON.stringify([active, hover, invite, parts.length]);
    if (key === readPainted.current) return;
    readPainted.current = key;
    const c = color ?? TEACHER_INK;
    for (const old of Array.from(layer.children)) { old.classList.add('bk-gone'); window.setTimeout(() => old.remove(), MARK_GONE_MS); }
    if (hover) layer.append(readButton(parts[hover.k], hover.mode, c));
    if (active) layer.append(readButton(parts[active.k], active.mode, c));
    if (invite >= 0) layer.append(readButton(parts[invite], 'invite', c));
    // 句框:换了句旧的淡出、新的淡入;同一句只改深浅(暂停淡一半)
    const sayKey = lit.length && active ? `${active.k}.${active.s ?? 0}` : '';
    const cur = sayer.querySelector<SVGGElement>('g:not(.bk-gone)');
    if (cur && cur.dataset.say !== sayKey) { cur.classList.add('bk-gone'); window.setTimeout(() => cur.remove(), MARK_GONE_MS); }
    if (!sayKey) return;
    let g = cur?.dataset.say === sayKey ? cur : null;
    if (!g) {
      g = el('g', { 'data-say': sayKey }) as SVGGElement;
      for (const b of lit) g.append(el('rect', { x: String(b[0] - SAY_PAD), y: String(b[1] - SAY_PAD), width: String(b[2] - b[0] + SAY_PAD * 2), height: String(b[3] - b[1] + SAY_PAD * 2), rx: '6', fill: c }));
      sayer.append(g);
    }
    g.classList.toggle('bk-soft', active!.mode === 'paused');
  };
  /** 点中的地方是哪一块的钮(场景里能点的那块空白;叠着的取钮离得近的);-1 = 不是 */
  const readAt = (x: number, y: number): number => {
    if (!readNow.current.on) return -1;
    const [sx, sy] = toScene(x, y);
    let best = -1, d = Infinity;
    readParts.current.forEach((pt, k) => {
      if (sx < pt.hit[0] || sx > pt.hit[2] || sy < pt.hit[1] || sy > pt.hit[3]) return;
      const dd = Math.abs(sy - pt.dot[1]);
      if (dd < d) { d = dd; best = k; }
    });
    return best;
  };
  const readHint = (k: number, mode: 'hover' | 'press'): void => {
    const now = readHover.current;
    if (k < 0) { if (now && (now.mode === mode || mode === 'press')) { readHover.current = null; paintRead(); } return; }
    if (now?.k === k && now.mode === mode) return;
    readHover.current = { k, mode };
    paintRead();
  };
  /** 点了第 k 块的钮:告诉页面(它读、停、接着读) */
  const readTap = (k: number): void => {
    window.clearTimeout(readPressTimer.current);
    readHover.current = null;
    paintRead();
    unpickHere(true);
    const ps = readParts.current;
    onRead?.(k, ps.map((pt) => pt.sents.length), ps.map((pt) => pt.no));
  };
  const tocShown = useRef<{ title: string; mode: 'press' | 'hover' } | null>(null);
  const tocPressTimer = useRef(0);
  /** 松手了、那一行停着等翻过去:这时别的手不算 */
  const tocGoing = useRef(false);
  /** 屏幕上这一点在目录的哪一项的范围里 */
  const tocAt = (x: number, y: number): ReturnType<typeof tocAreas>[number] | null => {
    const T = tocNow.current;
    if (!T.on || !view.current) return null;
    const [sx, sy] = toScene(x, y);
    return T.areas.find((a) => sx >= a.hit[0] && sx <= a.hit[2] && sy >= a.hit[1] && sy <= a.hit[3]) ?? null;
  };
  /** 铺那一项的范围(null = 拿掉):按着的深一点,悬着的浅一点 */
  const tocShow = (a: ReturnType<typeof tocAreas>[number] | null, mode: 'press' | 'hover'): void => {
    const hl = svg.current?.querySelector('.bk-hl');
    const old = hl?.querySelector('.bk-toc');
    if (!a || !hl) { old?.remove(); tocShown.current = null; return; }
    const c = tocNow.current.color, press = mode === 'press';
    const [x1, y1, x2, y2] = a.hit;
    const r = el('rect', { x: String(x1), y: String(y1 + 2), width: String(x2 - x1), height: String(Math.max(4, y2 - y1 - 4)), rx: '10', fill: c, 'fill-opacity': press ? '0.14' : '0.06', stroke: c, 'stroke-opacity': press ? '0.6' : '0.42', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke', class: 'bk-toc' });
    old?.remove();
    hl.append(r);
    tocShown.current = { title: a.title, mode };
  };
  /** 目录上轻点了一下:点在一项的范围里就铺上它、停一会儿告诉页面;点在空处什么都不做 */
  const tocTap = (x: number, y: number): void => {
    window.clearTimeout(tocPressTimer.current);
    const a = tocGoing.current ? null : tocAt(x, y);
    if (!a) { if (!tocGoing.current) tocShow(null, 'press'); return; }
    tocShow(a, 'press');
    tocGoing.current = true;
    window.setTimeout(() => {
      tocGoing.current = false;
      onOpen?.(a.title);
      // 页面翻过去了这一层跟着换掉;没翻过去(连不上)也别一直铺着
      window.setTimeout(() => { if (tocShown.current?.title === a.title && tocShown.current.mode === 'press') tocShow(null, 'press'); }, 1500);
    }, TOC_HOLD_MS);
  };

  /** 作业本上这一处(场景 y)能不能落笔:今天拍的照片上能;以前那天的(只看)、分割线、白纸上不能。别的页都能 */
  const inkHere = (y: number): boolean => {
    const g = geo.current, p = lessonPage(latest.current);
    if (!g?.hw || p?.kind !== 'photo' || !p.day) return true;
    const sh = g.sheets.find((x) => y >= x.top && y <= x.top + x.height);
    const ph = sh ? p.photos[sh.n - 1] : undefined;
    return Boolean(ph && photoDay(ph, p.day) === p.day);
  };
  /** 点中了作业本最后那张白纸上的「拍照」「从相册选」(同「下一课」照位置认) */
  const blankHit = (x: number, y: number): boolean => {
    for (const b of Array.from(paper.current?.querySelectorAll<HTMLElement>('.bk-blank [data-go]') ?? [])) {
      const r = b.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { onCapture?.(b.dataset.go === 'camera'); return true; }
    }
    return false;
  };
  /** 点中了一课最后那一行「下一课」:告诉页面翻过去(手指按着时舞台捕获了指针,行上的点按照位置认) */
  const nextHit = (x: number, y: number): boolean => {
    const r = nextNow.current ? nextEl.current?.getBoundingClientRect() : null;
    if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom || !next) return false;
    onOpen?.(next.title);
    return true;
  };
  /** 轻点:先看是不是盖住的拼音,再看是不是一个字 */
  const tap = (x: number, y: number): void => {
    if (nextHit(x, y) || blankHit(x, y)) return;
    // 点读的钮(笔、鼠标点一下不动)
    const rk = readAt(x, y);
    if (rk >= 0) { readTap(rk); return; }
    const [sx, sy] = toScene(x, y);
    // 白纸条里方向盘的转钮:一下转一格(90°)
    for (const b of Array.from(svg.current?.querySelectorAll<SVGGElement>('.bk-strip .bk-turn') ?? [])) {
      const bx = Number(b.dataset.x), by = Number(b.dataset.y), br = Number(b.dataset.r);
      if (Math.hypot(sx - bx, sy - by) <= br * 1.4) { onTurn?.(b.dataset.item ?? '', (Number(b.dataset.deg) + 90) % 360); return; }
    }
    const layer = svg.current?.querySelector('.bk-teacher');
    for (const c of Array.from(layer?.querySelectorAll<SVGRectElement>('.bk-cover') ?? [])) {
      const bx = Number(c.getAttribute('x')), by = Number(c.getAttribute('y')), bw = Number(c.getAttribute('width')), bh = Number(c.getAttribute('height'));
      const pad = bh * 0.3;
      if (sx >= bx - pad && sx <= bx + bw + pad && sy >= by - pad && sy <= by + bh + pad) {
        const t = c.getAttribute('data-cover') ?? '';
        c.remove();
        onReveal?.(t);
        return;
      }
    }
    // 田字格:点空格、描红格开写字格;写了没放好时点页上别处不收它
    if (padCell.current && padDirty.current) return;
    const cell = cellAt(sx, sy);
    if (cell) { openPad(cell); return; }
    if (padCell.current) closePad();
    const g = geo.current;
    const hit = g && canPick && !readonly ? bookPick(g.lines, g.sheets, sx, sy) : null;
    // 点了页上别处(不是字):开着的卡收起来
    if (!hit) { unpickHere(true); return; }
    // 点中的字一直标着,卡收了才拿掉
    const hl = svg.current?.querySelector('.bk-hl');
    if (hl) {
      const r = el('rect', { x: String(hit.box[0] - 3), y: String(hit.box[1] - 3), width: String(hit.box[2] - hit.box[0] + 6), height: String(hit.box[3] - hit.box[1] + 6), rx: '5', class: 'bk-hit' });
      hl.querySelector('.bk-hit')?.remove();
      hl.append(r);
    }
    picked.current = hit.box;
    onPick?.(hit.c, screenOf(hit.box));
  };

  /** 手指轻点:等一下看是不是双击;双击切窗的大小,不是双击就照轻点 */
  const fingerTap = (x: number, y: number): void => {
    if (readonly) { tap(x, y); return; }
    const L = lastTap.current, now = performance.now();
    if (L && now - L.t < DOUBLE_MS && Math.hypot(x - L.x, y - L.y) < TAP_PX * 4) {
      window.clearTimeout(L.timer);
      lastTap.current = null;
      toggleZoom(x, y);
      return;
    }
    if (L) { window.clearTimeout(L.timer); tap(L.x, L.y); }
    lastTap.current = { t: now, x, y, timer: window.setTimeout(() => { lastTap.current = null; tap(x, y); }, DOUBLE_MS) };
  };
  /** 双击:页宽 ↔ 两倍,点的那一点留在手指底下 */
  const toggleZoom = (x: number, y: number): void => {
    const [ax, ay] = toScene(x, y);
    zoom.current = zoom.current === 1 ? 2 : 1;
    const r = view.current!.getBoundingClientRect();
    const s = (r.width / BOOK_W) * zoom.current;
    moveTo(clamp({ s, cx: ax - (x - r.left - r.width / 2) / s, cy: ay - (y - r.top - r.height / 2) / s }), true);
    moved.current = true;
    settled();
  };
  /** 松手还在动:顺着滑一段慢慢停,停了才算挪完 */
  const fling = (): boolean => {
    const tr = trail.current;
    trail.current = [];
    if (readonly || tr.length < 2) return false;
    const a = tr[0], b = tr[tr.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0 || performance.now() - b.t > 80) return false;
    let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
    if (Math.hypot(vx, vy) < FLING_MIN) return false;
    let t0 = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(48, now - t0);
      t0 = now;
      const c = cam.current;
      const to = clamp({ ...c, cx: c.cx - (vx * dt) / c.s, cy: c.cy - (vy * dt) / c.s });
      // 撞到边就不再往那边走
      if (to.cx === c.cx) vx = 0;
      if (to.cy === c.cy) vy = 0;
      cam.current = to;
      apply();
      const k = Math.pow(FLING_KEEP, dt / 16);
      vx *= k; vy *= k;
      if (Math.hypot(vx, vy) > 0.02) glide.current = requestAnimationFrame(tick);
      else settled();
    };
    glide.current = requestAnimationFrame(tick);
    return true;
  };

  const down = (e: React.PointerEvent): void => {
    if (phase !== 'ready') return;
    cancelAnimationFrame(glide.current);
    lastHand.current = performance.now();
    // 目录上笔、鼠标都当手指(只滚和点一项)
    if (!tocNow.current.on && (e.pointerType === 'pen' || (mousePen && e.pointerType === 'mouse' && canMark && !readonly))) {
      // 笔:写画(开放了圈、画);点一下当轻点
      touches.current.clear(); gesture.current = null;
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* 合成的指针捕获不了 */ }
      const p = toScene(e.clientX, e.clientY);
      const path = el('path', { d: pathD([p]), fill: 'none', stroke: KID_INK, 'stroke-width': String(KID_INK_WIDTH * 0.7), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', opacity: '0.9' });
      const ok = canMark && !readonly && inkHere(p[1]);
      if (ok) { svg.current?.querySelector('.bk-ink')?.append(path); onPen?.(); unpickHere(true); if (padCell.current && !padDirty.current) closePad(); }
      pen.current = { id: e.pointerId, pts: [p], el: path, x0: e.clientX, y0: e.clientY, ok };
      return;
    }
    // 笔在纸上:别的手(手掌)不算;孩子的窗不两指缩放,第二根手指不算
    if (pen.current) return;
    if (!readonly && touches.current.size) return;
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* 同上 */ }
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...touches.current.values()];
    if (pts.length === 1) {
      gesture.current = { kind: 'tap', x0: e.clientX, y0: e.clientY, cam0: { ...cam.current } };
      trail.current = [];
      // 能写的格:按住一会儿还没滚起来,铺上按着的那一格
      if (!tocNow.current.on && !readonly) {
        window.clearTimeout(cellPressTimer.current);
        cellPressTimer.current = window.setTimeout(() => { const g = gesture.current; if (g?.kind !== 'tap' || touches.current.size !== 1) return; const [sx, sy] = toScene(g.x0, g.y0); const c = cellAt(sx, sy); if (c) cellHint(c, 'press'); }, TOC_PRESS_MS);
      }
      // 点读的钮:按住一会儿还没滚起来,钮深一点
      if (readNow.current.on) {
        window.clearTimeout(readPressTimer.current);
        readPressTimer.current = window.setTimeout(() => { const g = gesture.current; if (g?.kind !== 'tap' || touches.current.size !== 1) return; const k = readAt(g.x0, g.y0); if (k >= 0) readHint(k, 'press'); }, TOC_PRESS_MS);
      }
      // 目录:按住一会儿还没滚起来,铺上按着的那一项
      if (tocNow.current.on && !tocGoing.current) {
        window.clearTimeout(tocPressTimer.current);
        tocPressTimer.current = window.setTimeout(() => { const g = gesture.current; const a = g?.kind === 'tap' && touches.current.size === 1 ? tocAt(g.x0, g.y0) : null; if (a) tocShow(a, 'press'); }, TOC_PRESS_MS);
      }
    }
    else if (pts.length === 2) {
      const [a, b] = pts;
      gesture.current = { kind: 'pinch', x0: 0, y0: 0, cam0: { ...cam.current }, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: [(a.x + b.x) / 2, (a.y + b.y) / 2] };
      moved.current = true;
    }
  };
  const move = (e: React.PointerEvent): void => {
    // 目录:鼠标、悬着的笔(没按下)移到哪一项上就浅浅铺一层
    if (tocNow.current.on && e.pointerType !== 'touch' && !touches.current.has(e.pointerId) && !pen.current) {
      if (tocGoing.current) return;
      const a = e.buttons ? null : tocAt(e.clientX, e.clientY);
      if (a && (tocShown.current?.title !== a.title || tocShown.current.mode !== 'hover')) tocShow(a, 'hover');
      else if (!a && tocShown.current?.mode === 'hover') tocShow(null, 'hover');
      return;
    }
    // 能写的格:鼠标、悬着的笔(没按下)移上去浅浅铺一层
    if (e.pointerType !== 'touch' && !e.buttons && !pen.current && !touches.current.has(e.pointerId) && !readonly) {
      const [sx, sy] = toScene(e.clientX, e.clientY);
      const c = cellAt(sx, sy);
      if (c) cellHint(c, 'hover'); else if (cellHinted.current?.mode === 'hover') cellHint(null, 'hover');
      // 点读的钮:悬着的那一块出一个淡淡的描边钮
      readHint(readAt(e.clientX, e.clientY), 'hover');
    }
    // 手指按着的那一格、那一块:滚起来就拿掉
    if (cellHinted.current?.mode === 'press' && gesture.current?.kind !== 'tap') cellHint(null, 'press');
    if (readHover.current?.mode === 'press' && gesture.current?.kind !== 'tap') { window.clearTimeout(readPressTimer.current); readHint(-1, 'press'); }
    const p = pen.current;
    if (p && e.pointerId === p.id) {
      if (!p.ok) return;
      const q = toScene(e.clientX, e.clientY);
      const last = p.pts[p.pts.length - 1];
      if (Math.hypot(q[0] - last[0], q[1] - last[1]) * cam.current.s < 2) return;
      p.pts.push(q);
      p.el.setAttribute('d', pathD(p.pts));
      return;
    }
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...touches.current.values()];
    if (g.kind === 'pinch' && pts.length >= 2) {
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const r = view.current!.getBoundingClientRect();
      const [vw, vh] = [r.width, r.height];
      // 两指起点中间那个点(场景坐标)跟着两指现在的中间走
      const c0 = g.cam0;
      const ax = (g.m0![0] - r.left - vw / 2) / c0.s + c0.cx, ay = (g.m0![1] - r.top - vh / 2) / c0.s + c0.cy;
      const s = clamp({ ...c0, s: c0.s * (d / g.d0!) }).s;
      cam.current = clamp({ s, cx: ax - (m[0] - r.left - vw / 2) / s, cy: ay - (m[1] - r.top - vh / 2) / s });
      apply();
      return;
    }
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (g.kind === 'tap' && Math.hypot(dx, dy) < TAP_PX) return;
    // 滚起来了:不是点,按着的那一项拿掉
    if (g.kind === 'tap' && tocNow.current.on) { window.clearTimeout(tocPressTimer.current); if (!tocGoing.current) tocShow(null, 'press'); }
    g.kind = 'pan';
    moved.current = true;
    trail.current = [...trail.current, { t: performance.now(), x: e.clientX, y: e.clientY }].filter((p, _, all) => all[all.length - 1].t - p.t <= 100);
    cam.current = clamp({ ...g.cam0, cx: g.cam0.cx - dx / g.cam0.s, cy: g.cam0.cy - dy / g.cam0.s });
    apply();
  };
  const up = (e: React.PointerEvent): void => {
    const p = pen.current;
    if (p && e.pointerId === p.id) {
      pen.current = null;
      const tiny = Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < TAP_PX && p.pts.length < 6;
      if (tiny || !p.ok) { p.el.remove(); if (tiny) tap(e.clientX, e.clientY); settled(); return; }
      const step = Math.ceil(p.pts.length / LESSON_INK_POINTS);
      const pts = p.pts.filter((_, i) => i % step === 0 || i === p.pts.length - 1).slice(-LESSON_INK_POINTS).map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]);
      // 落在开着的白纸条上(中点在白纸条里):跟着白纸条
      const st = latestStrip.current;
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
      if (st && mx >= st.lay.rect[0] && mx <= st.lay.rect[2] && my >= st.lay.rect[1] && my <= st.lay.rect[3]) {
        p.el.remove();
        sInk.current = [...sInk.current, pts];
        paintStrip();
        onStroke(pts, st.key);
      } else {
        ink.current = [...ink.current, pts];
        paintInk();
        onStroke(pts);
      }
      settled();
      return;
    }
    if (!touches.current.has(e.pointerId)) return;
    touches.current.delete(e.pointerId);
    const g = gesture.current;
    const left = [...touches.current.values()];
    if (left.length === 1) {
      // 两指放开一指:剩下那根接着拖,从这里重新算起(不跳)
      gesture.current = { kind: 'pan', x0: left[0].x, y0: left[0].y, cam0: { ...cam.current } };
      return;
    }
    if (left.length) return;
    gesture.current = null;
    window.clearTimeout(cellPressTimer.current);
    if (cellHinted.current?.mode === 'press') cellHint(null, 'press');
    window.clearTimeout(readPressTimer.current);
    // 目录、点读的钮不等双击:点一下就是点一项
    const rk = g?.kind === 'tap' && e.type === 'pointerup' && !tocNow.current.on ? readAt(e.clientX, e.clientY) : -1;
    if (rk < 0 && readHover.current?.mode === 'press') readHint(-1, 'press');
    if (g?.kind === 'tap' && e.type === 'pointerup' && nextHit(e.clientX, e.clientY)) { /* 翻到下一课 */ }
    else if (rk >= 0) readTap(rk);
    else if (g?.kind === 'tap' && e.type === 'pointerup') { if (tocNow.current.on) tocTap(e.clientX, e.clientY); else fingerTap(e.clientX, e.clientY); }
    else if (tocNow.current.on && !tocGoing.current) { window.clearTimeout(tocPressTimer.current); tocShow(null, 'press'); }
    if (g?.kind === 'pan' && e.type === 'pointerup' && fling()) return;
    settled();
  };
  /** 鼠标、笔离开了课本:悬着铺的那一项拿掉 */
  const leave = (): void => { if (tocShown.current?.mode === 'hover') tocShow(null, 'hover'); if (cellHinted.current?.mode === 'hover') cellHint(null, 'hover'); if (readHover.current?.mode === 'hover') readHint(-1, 'hover'); };
  /** 电脑上:滚轮上下滚(两倍时也左右);只读的照以前滚轮放大缩小(围着鼠标那一点) */
  const wheel = (e: React.WheelEvent): void => {
    if (phase !== 'ready') return;
    lastHand.current = performance.now();
    leave();
    if (!readonly) {
      if (e.ctrlKey) return;
      const c = cam.current;
      cam.current = clamp({ ...c, cx: c.cx + e.deltaX / c.s, cy: c.cy + e.deltaY / c.s });
      apply();
      moved.current = true;
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(settled, 200);
      return;
    }
    const [ax, ay] = toScene(e.clientX, e.clientY);
    const c = cam.current;
    const s = clamp({ ...c, s: c.s * Math.exp(-e.deltaY * 0.0015) }).s;
    const r = view.current!.getBoundingClientRect();
    cam.current = clamp({ s, cx: ax - (e.clientX - r.left - r.width / 2) / s, cy: ay - (e.clientY - r.top - r.height / 2) / s });
    apply();
    moved.current = true;
    window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(settled, 200);
  };
  const wheelTimer = useRef(0);

  const wipe = useCallback(() => {
    if (readonly || (!ink.current.length && !sInk.current.length)) return;
    ink.current = [];
    sInk.current = [];
    paintInk();
    paintStrip();
    onWipe();
    scheduleShot();
  }, [readonly, paintInk, paintStrip, onWipe]);

  /** 窗此刻的样子导成一张图(交板是 png,交给老师看的窗是 jpeg):每页先画的那张、重画清楚的那一块 + 老师的圈 + 孩子的笔画,纸色打底 */
  const snapshot = useCallback((type: 'image/png' | 'image/jpeg' = 'image/png'): string | undefined => {
    const g = geo.current;
    if (!g) return undefined;
    try {
      const [x0, y0, x1, y1] = viewBox();
      const k = SHOT_SIDE / Math.max(x1 - x0, y1 - y0);
      const cv = document.createElement('canvas');
      cv.width = Math.round((x1 - x0) * k); cv.height = Math.round((y1 - y0) * k);
      const ctx = cv.getContext('2d');
      if (!ctx) return undefined;
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
      for (const sh of g.sheets) { const b = g.base.get(sh.n); if (b && b.width) ctx.drawImage(b, 0, sh.top, BOOK_W, sh.height); }
      // 窗那一块重画过的清楚的那张(盖在上面,和屏幕上一样)
      const sc = sharp.current;
      if (sc && sc.style.display === 'block' && sc.width) ctx.drawImage(sc, parseFloat(sc.style.left), parseFloat(sc.style.top), parseFloat(sc.style.width), parseFloat(sc.style.height));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // 老师的圈、划、加点:只画新的(淡了的画进去,老师会以为还圈着)
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = TEACHER_INK; ctx.fillStyle = TEACHER_INK; ctx.lineWidth = 3 / k;
      for (const e of Array.from(svg.current?.querySelectorAll<SVGPathElement>('.bk-teacher path.bk-mark:not(.bk-old):not(.bk-gone)') ?? [])) ctx.stroke(new Path2D(e.getAttribute('d') ?? ''));
      for (const c of Array.from(svg.current?.querySelectorAll<SVGCircleElement>('.bk-teacher .bk-dots:not(.bk-old):not(.bk-gone) circle') ?? [])) { ctx.beginPath(); ctx.arc(Number(c.getAttribute('cx')), Number(c.getAttribute('cy')), Number(c.getAttribute('r')), 0, Math.PI * 2); ctx.fill(); }
      // 作业本上以前的记号(只画没淡的;孩子的笔照画)
      const pp = lessonPage(latest.current);
      if (pp?.kind === 'photo' && pp.day) pp.photos.forEach((ph, i) => {
        const got = pastRef.current?.[ph.src];
        if (!got) return;
        const top = photoSheetBox(pp.photos, i, pp.day)[1];
        ctx.save();
        ctx.translate(0, top);
        ctx.strokeStyle = TEACHER_INK; ctx.fillStyle = TEACHER_INK; ctx.lineWidth = 3 / k;
        for (const m of got.marks) {
          if (m.old) continue;
          if (m.k === '加点') { for (const d of dotSpots(m.box, m.text)) { ctx.beginPath(); ctx.arc(d.cx, d.cy, d.r, 0, Math.PI * 2); ctx.fill(); } continue; }
          ctx.stroke(new Path2D(pathD(m.k === '圈' ? ringPath(m.box, seedOf(m.text)) : underPath(m.box))));
        }
        ctx.strokeStyle = KID_INK; ctx.lineWidth = (KID_INK_WIDTH * 0.7) / k;
        for (const st of got.ink) { ctx.beginPath(); st.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
        ctx.restore();
      });
      ctx.restore();
      // 盖住的(遮、盖):孩子眼前就是盖着的
      ctx.fillStyle = '#f1e6c8';
      for (const e of Array.from(svg.current?.querySelectorAll<SVGRectElement>('.bk-teacher .bk-cover') ?? [])) ctx.fillRect(Number(e.getAttribute('x')), Number(e.getAttribute('y')), Number(e.getAttribute('width')), Number(e.getAttribute('height')));
      // 孩子在田字格里写的字(铅笔色,线宽跟着格)
      const written = lessonPage(latest.current)?.kid.cells ?? {};
      ctx.strokeStyle = WRITE_INK;
      for (const c of cellsHere()) {
        if (!written[c.id]?.length) continue;
        ctx.lineWidth = cellWidth(c);
        for (const st of cellPaths(c, written[c.id])) { ctx.beginPath(); st.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (st.length === 1) ctx.lineTo(st[0][0] + 0.1, st[0][1]); ctx.stroke(); }
      }
      ctx.strokeStyle = KID_INK; ctx.lineWidth = (KID_INK_WIDTH * 0.7) / k;
      for (const st of ink.current) { ctx.beginPath(); st.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
      // 白纸条:白纸、摆的图形、写的字、孩子在上面画的
      const strip = latestStrip.current, p = lessonPage(latest.current);
      if (strip && p) {
        const [sx1, sy1, sx2, sy2] = strip.lay.rect;
        ctx.fillStyle = STRIP_FILL; ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
        for (const slot of strip.lay.slots) {
          if (slot.item.kind === 'write') { ctx.fillStyle = '#1e1e1e'; ctx.font = `${slot.font}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(slot.item.text, (slot.box[0] + slot.box[2]) / 2, (slot.box[1] + slot.box[3]) / 2); continue; }
          ctx.save();
          ctx.transform(slot.scale!, 0, 0, slot.scale!, slot.ox!, slot.oy!);
          for (const sk of slotSkeletons(slot, p.kid.turns[`${strip.key}#${slot.n}`] ?? 0)) skeletonDraw(ctx, sk);
          ctx.restore();
        }
        ctx.strokeStyle = KID_INK; ctx.lineWidth = (KID_INK_WIDTH * 0.7) / k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const st of sInk.current) { ctx.beginPath(); st.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
      }
      return type === 'image/jpeg' ? cv.toDataURL('image/jpeg', 0.8) : cv.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }, []);

  useImperativeHandle(ref, () => ({
    submit() {
      // 「给老师看」:窗里的图这时就交(不等停下来),老师这一轮看到的是他刚写完的样子
      const g = geo.current;
      const image = g && onShot && !readonly ? snapshot('image/jpeg') : undefined;
      if (image) { const b = viewBox().map((v) => Math.round(v)) as Box; shotKey.current = shotKeyOf(g!, b); onShot!(b, image); }
      onSubmit();
    },
    peek() { return Promise.resolve(snapshot('image/jpeg') ?? null); },
    unpick() { unpickHere(false); },
  }), [onSubmit, snapshot]);

  return (
    <div className={`kt-wrap${hand === 'left' ? ' kt-hand-left' : ''}`}>
      <div className="kt-board bk-board" data-phase={phase} data-marks={marks}>
        <div className="bk-view" ref={view} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={leave} onWheel={wheel}>
          <div className="bk-paper" ref={paper}>
            <canvas className="bk-sharp" ref={sharp} />
            <svg className="bk-svg" ref={svg} xmlns={SVG_NS}>
              <g className="bk-hl" />
              <g className="bk-say" />
              <g className="bk-past" />
              <g className="bk-teacher" />
              <g className="bk-cells" />
              <g className="bk-strip" />
              <g className="bk-ink" />
              <g className="bk-read" />
            </svg>
            {phase === 'ready' && geo.current?.hw ? geo.current.hw.dividers.map((d) => (
              <div className="bk-div" key={`${d.day}|${d.top}`} style={{ top: `${d.top}px`, height: `${d.h}px` }}>
                {d.week ? <div className="wk"><span>{d.week}</span></div> : null}
                <div className="dy"><i /><span>{dayLabel(d.day, geo.current!.hw!.today)}</span><i /></div>
              </div>
            )) : null}
            {phase === 'ready' && geo.current?.hw && !readonly ? (
              <div className="bk-blank" style={{ top: `${geo.current.hw.tail}px`, height: `${HW_PAPER_H}px`, ...(color ? { ['--bk-c' as string]: color } : {}) }}>
                <div className="in">
                  {icon('<path d="M4 8h3.5l2-3h5l2 3H20v11H4z"></path><circle cx="12" cy="13" r="3.2"></circle>')}
                  <b>{geo.current.hw.shot ? '接着拍下一页' : '把写好的作业拍进来'}</b>
                  {geo.current.hw.shot ? null : <small>拍正一点,整页都拍进来;几张都行</small>}
                  <div className="go">
                    <span className="cam" data-go="camera">{icon('<path d="M4 8h3.5l2-3h5l2 3H20v11H4z"></path><circle cx="12" cy="13" r="3.2"></circle>')}拍照</span>
                    <span className="alb" data-go="album">{icon('<rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M4 16l5-5 4 4 2.5-2.5L20 17"></path>')}从相册选</span>
                  </div>
                </div>
              </div>
            ) : null}
            {nextOn && phase === 'ready' && geo.current ? (
              <div className="bk-next" ref={nextEl} style={{ left: `${BOOK_W / 2}px`, top: `${geo.current.height + NEXT_GAP}px` }}>
                <span className="k">{next!.k ?? '下一课'}</span><span className="t">{next!.title}</span>{icon('<path d="M9 5l7 7-7 7"></path>')}
              </div>
            ) : null}
          </div>
        </div>
        {/* 课本铺满屏宽,没有工具那一栏:「擦掉」贴着屏幕边、在页面那张老师签的正下方,画了才出现 */}
        {readonly || !canMark || !marks || phase !== 'ready' ? null : <button type="button" className="bk-wipe" onClick={wipe} aria-label="擦掉">{icon(WIPE)}<span>擦掉</span></button>}
        {phase === 'loading' && <div className="stage-wait">翻课本…</div>}
        {pad ? <CellPad key={pad.id} ref={padEl} model={pad.m} trace={pad.kind === 'trace'} blank={pad.kind === 'blank'} w={pad.box[2] - pad.box[0]} h={pad.box[3] - pad.box[1]} strokes={lessonPage(lesson)?.kid.cells?.[pad.id] ?? []} color={color ?? TEACHER_INK} onSave={savePad} onClose={closePad} onDirty={(d) => { padDirty.current = d; }} /> : null}
      </div>
    </div>
  );
});
