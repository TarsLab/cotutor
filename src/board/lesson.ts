/**
 * 一节课的状态怎么变(2026-11-16《多模态教学harness-开发计划》阶段 2 任务 2):一个纯函数 lessonStep(这节课, 事) → 这节课。
 * 老师讲稿里的动作(落到页上以后的样子,LessonAct;src/board/lesson-fit.ts 填好)和孩子在页上做的事(实时那条连接报来的)都走它。
 * 服务端照它记一节课的状态(src/runtime/journal/lesson-store.ts),孩子端照它一句一句把动作落到页上(念完一句落那一句的),舞台照状态画。
 * 规矩:
 *  - 翻:换到那一页(课本的一课、照片页、白纸页;还没铺过就铺上:老师的一层、孩子的一层都是空的、什么都没请);窗回到页顶,白纸条收起来。翻回铺过的,原来画的都在
 *  - 孩子拍来了照片(photo):接在照片页后面(没有就开一页,最多 PAGE_PHOTOS_MAX 张),换到照片页,窗移到新拍的第一张的顶上
 *  - 看:窗移到那一处;那一处有白纸条就打开它(回到这道题,原来摆的还在),没有就收起开着的
 *  - 圈、遮、盖:记号加在这一页上(同一处不重复)
 *  - 写、摆:落进「看」着的那道题的白纸条(没有就开一条,紧贴题的下沿);白纸页上整页就是一条(从页顶摆起);课本、照片上没在看哪一道题就不做
 *  - 擦:白纸条开着擦它的最后一样(擦 全部:整条收掉);没开着擦老师最后一个记号
 *  - 请:这一步开放什么(换掉上一次请的;翻到新的一课清空)
 *  - 孩子的事都落在现在这一页上:一笔、擦掉自己的、揭开、点字、窗停在哪、白纸条里的图形转到哪
 * 内联进孩子端页面(剥类型),所以这里只 import type;上限的数和 src/schema/lesson.ts 的一样(tests/lesson.test.ts 盯着)。
 */
import type { Box, Lesson, LessonAct, LessonEvent, LessonPage, PagePhoto, Strip } from '../schema/index.ts';

const LS_PAGES_MAX = 8;
const LS_INK_MAX = 160;
const LS_INK_POINTS = 120;
const LS_PICK_MAX = 30;
const LS_MARKS_MAX = 24;
const LS_STRIP_MAX = 8;
const LS_JOBS_MAX = 60;
const LS_PHOTOS_MAX = 6;
const LS_PHOTO_PAGE = '作业';
const LS_WHITE_PAGE = '白纸';
/** 场景里一页多宽、照片和照片之间空多少(同 src/chalk/kit/book.ts 的 BOOK_W、BOOK_GAP) */
const LS_W = 1000;
const LS_GAP = 30;
/** 上限与几个名字(测试拿去和 schema、chalk 比) */
export const LESSON_CAPS = { PAGES_MAX: LS_PAGES_MAX, INK_MAX: LS_INK_MAX, INK_POINTS: LS_INK_POINTS, PICK_MAX: LS_PICK_MAX, MARKS_MAX: LS_MARKS_MAX, STRIP_ITEMS_MAX: LS_STRIP_MAX, JOBS_MAX: LS_JOBS_MAX, PHOTOS_MAX: LS_PHOTOS_MAX, PHOTO_PAGE: LS_PHOTO_PAGE, WHITE_PAGE: LS_WHITE_PAGE, W: LS_W, GAP: LS_GAP };

/** 照片页上第 i 张(从 0 起)在场景里的框:一张宽 1000,高照宽高比,从上往下连着,中间空 LS_GAP */
export function photoSheetBox(photos: readonly PagePhoto[], i: number): Box {
  let top = 0;
  for (let k = 0; k < i; k++) top += (LS_W * photos[k].h) / photos[k].w + LS_GAP;
  return [0, top, LS_W, top + (LS_W * photos[i].h) / photos[i].w];
}

/** 白纸页上的白纸条:整页就是一条,从页顶摆起(Strip.box 是它上面那道「题」,白纸页上是页顶一条线) */
const WHITE_LOOK = { label: LS_WHITE_PAGE, box: [0, 0, LS_W, 0] as Box };

/** 还什么都没铺的一节课 */
export const lessonInit = (): Lesson => ({ v: 1, pages: [], at: null, look: null, view: null, strip: null, jobs: [] });

/** 现在铺着的那一页 */
export const lessonPage = (l: Lesson): LessonPage | null => l.pages.find((p) => p.id === l.at) ?? null;

/** 现在开着的白纸条 */
export function lessonStrip(l: Lesson): Strip | null {
  const p = lessonPage(l);
  return (l.strip && p ? p.teacher.strips.find((s) => s.key === l.strip) : null) ?? null;
}

/** 换掉现在这一页(别的页原样) */
const onLessonPage = (l: Lesson, f: (p: LessonPage) => LessonPage): Lesson => {
  const at = lessonPage(l);
  const to = at ? f(at) : at;
  return at && to !== at ? { ...l, pages: l.pages.map((p) => (p === at ? to! : p)) } : l;
};

const sameLessonBox = (a: Box, b: Box): boolean => a.every((v, i) => v === b[i]);
const emptyLayers = (): Pick<LessonPage, 'teacher' | 'kid' | 'open'> => ({ teacher: { marks: [], strips: [] }, kid: { ink: [], stripInk: {}, revealed: [], picked: [], turns: {} }, open: [] });

function lessonAct(l: Lesson, a: LessonAct): Lesson {
  switch (a.k) {
    case '翻': {
      const had = l.pages.find((p) => p.id === a.page.id);
      const fresh: LessonPage = { ...a.page, ...emptyLayers() };
      // 铺过的留着(翻回来原来画的都在);多了丢最早的
      const pages = had ? l.pages : [...l.pages, fresh].slice(-LS_PAGES_MAX);
      // 白纸页:整页就是那一条白纸条,翻回来照样开着
      const white = a.page.kind === 'white' && had?.teacher.strips.some((s) => s.key === LS_WHITE_PAGE) ? LS_WHITE_PAGE : null;
      return { ...l, pages, at: a.page.id, look: null, view: null, strip: white };
    }
    case '看': {
      const p = lessonPage(l);
      const strip = p?.teacher.strips.some((s) => s.key === a.label) ? a.label : null;
      return { ...l, look: { label: a.label, box: a.box, n: (l.look?.n ?? 0) + 1 }, strip };
    }
    case '圈':
    case '遮':
    case '盖':
      return onLessonPage(l, (p) => {
        const add = a.spots.filter((s) => !p.teacher.marks.some((m) => m.k === a.k && m.text === s.text && sameLessonBox(m.box, s.box))).map((s) => ({ k: a.k, text: s.text, box: s.box }));
        return add.length ? { ...p, teacher: { ...p.teacher, marks: [...p.teacher.marks, ...add].slice(-LS_MARKS_MAX) } } : p;
      });
    case '写':
    case '摆': {
      const look = lessonPage(l)?.kind === 'white' ? WHITE_LOOK : l.look;
      if (!look || !lessonPage(l)) return l;
      const item = a.k === '写' ? { kind: 'write' as const, text: a.text, size: a.size } : { kind: 'shape' as const, kit: a.kit, params: a.params, size: a.size };
      const next = onLessonPage(l, (p) => {
        const had = p.teacher.strips.find((s) => s.key === look.label);
        const strip: Strip = had ? { ...had, items: [...had.items, item].slice(-LS_STRIP_MAX) } : { key: look.label, box: look.box, items: [item] };
        return { ...p, teacher: { ...p.teacher, strips: had ? p.teacher.strips.map((s) => (s === had ? strip : s)) : [...p.teacher.strips, strip] } };
      });
      return { ...next, strip: look.label };
    }
    case '擦': {
      const open = lessonStrip(l);
      if (open) {
        const items = a.all ? [] : open.items.slice(0, -1);
        const next = onLessonPage(l, (p) => {
          const strips = items.length ? p.teacher.strips.map((s) => (s === open ? { ...s, items } : s)) : p.teacher.strips.filter((s) => s !== open);
          if (items.length) return { ...p, teacher: { ...p.teacher, strips } };
          // 整条收掉:孩子在上面画的、转的跟着没了(再开一条是新的)
          const stripInk = { ...p.kid.stripInk };
          delete stripInk[open.key];
          const turns = Object.fromEntries(Object.entries(p.kid.turns).filter(([k]) => !k.startsWith(`${open.key}#`)));
          return { ...p, teacher: { ...p.teacher, strips }, kid: { ...p.kid, stripInk, turns } };
        });
        return items.length ? next : { ...next, strip: null };
      }
      return onLessonPage(l, (p) => (p.teacher.marks.length ? { ...p, teacher: { ...p.teacher, marks: a.all ? [] : p.teacher.marks.slice(0, -1) } } : p));
    }
    case '请':
      return onLessonPage(l, (p) => ({ ...p, open: [...a.ops] }));
  }
}

export function lessonStep(l: Lesson, ev: LessonEvent): Lesson {
  switch (ev.t) {
    case 'act':
      return lessonAct(l, ev.act);
    case 'stroke': {
      if (!ev.pts.length) return l;
      const pts = ev.pts.slice(0, LS_INK_POINTS);
      // 落在白纸条上的(那一条开着才算):跟着白纸条,收起来就看不见
      const strip = ev.strip && ev.strip === l.strip && lessonStrip(l) ? ev.strip : null;
      if (strip) return onLessonPage(l, (p) => ({ ...p, kid: { ...p.kid, stripInk: { ...p.kid.stripInk, [strip]: [...(p.kid.stripInk[strip] ?? []), pts].slice(-LS_INK_MAX) } } }));
      return onLessonPage(l, (p) => ({ ...p, kid: { ...p.kid, ink: [...p.kid.ink, pts].slice(-LS_INK_MAX) } }));
    }
    case 'wipe':
      return onLessonPage(l, (p) => {
        const open = l.strip && p.kid.stripInk[l.strip]?.length ? l.strip : null;
        if (!p.kid.ink.length && !open) return p;
        const stripInk = { ...p.kid.stripInk };
        if (open) delete stripInk[open];
        return { ...p, kid: { ...p.kid, ink: [], stripInk } };
      });
    case 'reveal':
      return onLessonPage(l, (p) => (p.kid.revealed.includes(ev.text) ? p : { ...p, kid: { ...p.kid, revealed: [...p.kid.revealed, ev.text] } }));
    case 'pick':
      return onLessonPage(l, (p) => ({ ...p, kid: { ...p.kid, picked: [...p.kid.picked, ev.text].slice(-LS_PICK_MAX) } }));
    case 'view':
      return lessonPage(l) ? { ...l, view: ev.box } : l;
    case 'turn':
      return onLessonPage(l, (p) => ({ ...p, kid: { ...p.kid, turns: { ...p.kid.turns, [ev.item]: ((Math.round(ev.deg) % 360) + 360) % 360 } } }));
    case 'photo': {
      const had = l.pages.find((p) => p.id === LS_PHOTO_PAGE);
      const old = had && had.kind === 'photo' ? had.photos : [];
      const add = ev.photos.filter((x) => x.w > 0 && x.h > 0 && !old.some((o) => o.src === x.src)).slice(0, LS_PHOTOS_MAX - old.length);
      if (!add.length) return had ? { ...l, at: LS_PHOTO_PAGE } : l;
      const photos = [...old, ...add];
      const page: LessonPage = had && had.kind === 'photo' ? { ...had, photos } : { id: LS_PHOTO_PAGE, kind: 'photo', title: LS_PHOTO_PAGE, photos, pick: ev.pick, ...emptyLayers() };
      const pages = had ? l.pages.map((p) => (p === had ? page : p)) : [...l.pages, page].slice(-LS_PAGES_MAX);
      // 窗移到新拍的第一张的顶上(当老师「看」了它:舞台照 look.n 移窗)
      const first = old.length;
      const b = photoSheetBox(photos, first);
      return { ...l, pages, at: LS_PHOTO_PAGE, strip: null, view: null, look: { label: `第${first + 1}张`, box: [b[0], b[1], b[2], Math.min(b[3], b[1] + LS_W * 0.6)], n: (l.look?.n ?? 0) + 1 } };
    }
  }
}

/** 这一节(老师那一轮)落进来了:记下它的 job(孩子端回来时不再落一遍) */
export const lessonDone = (l: Lesson, job: string): Lesson => (l.jobs.includes(job) ? l : { ...l, jobs: [...l.jobs, job].slice(-LS_JOBS_MAX) });

/** 一节里的动作照先后都落上(第一句前面的、每一句的;落不了的跳过) */
export function lessonActs(l: Lesson, acts: readonly { do?: LessonAct }[]): Lesson {
  return acts.reduce((s, a) => (a.do ? lessonStep(s, { t: 'act', act: a.do }) : s), l);
}
