/**
 * 一节课的状态怎么变:一个纯函数 lessonStep(这节课, 事) → 这节课。
 * 老师讲稿里的动作(落到页上以后的样子,LessonAct;src/board/lesson-fit.ts 填好)和孩子在页上做的事(实时那条连接报来的)都走它。
 * 服务端照它记一节课的状态(src/runtime/journal/lesson-store.ts),孩子端照它一句一句把动作落到页上(念完一句落那一句的),舞台照状态画。
 * 规矩:
 *  - 翻:换到那一页(课本的一课、照片页、白纸页;还没铺过就铺上:老师的一层、孩子的一层都是空的、什么都没请);窗回到页顶,白纸条收起来。翻回铺过的,原来画的都在
 *    (离开的那一页上老师指着字的记号收掉:圈、划、加点跟着话走,不跟着去)
 *  - 孩子拍来了照片(photo):接在照片页后面(没有就开一页,最多 PAGE_PHOTOS_MAX 张),换到照片页,窗移到新拍的第一张的顶上
 *  - 看:窗移到那一处;那一处有白纸条就打开它(回到这道题,原来摆的还在),没有就收起开着的;小课堂上是放那一段(at)。
 *    看的是别处:这一页上老师的圈、划、加点收掉
 *  - 圈、划、加点、遮、盖:记号加在这一页上(同一处不重复;再圈一遍算新的)。圈、划、加点记下画它时念完了几句(at)
 *  - said:老师念完一句,said 加一;round:老师开始说新的一轮,各页上老师的圈、划、加点都收掉。
 *    圈、划、加点什么时候是新的、旧的(淡)由 markFresh 算(舞台画、交给老师的窗图都照它);遮、盖留到孩子揭开
 *  - 写、摆:落进「看」着的那道题的白纸条(没有就开一条,紧贴题的下沿);白纸页上整页就是一条(从页顶摆起);课本、照片上没在看哪一道题就不做
 *  - 擦:白纸条开着擦它的最后一样(擦 全部:整条收掉);没开着擦老师最后一个记号
 *  - 请:这一步开放什么(换掉上一次请的;翻到新的一课清空)
 *  - 孩子的事都落在现在这一页上:一笔、擦掉自己的、揭开、点字、窗停在哪、白纸条里的图形转到哪、田字格里写的字(cell;「擦掉」不擦它,是作业)
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
/** 指着字的记号(同 src/schema/lesson.ts 的 LINE_MARKS、MARKS_NEW_MAX、MARK_FRESH_LINES) */
const LS_LINE_MARKS: readonly string[] = ['圈', '划', '加点'];
const LS_NEW_MAX = 3;
const LS_FRESH_LINES = 2;
/** 田字格(同 src/schema/lesson.ts 的 LESSON_CELLS_MAX、LESSON_CELL_STROKES) */
const LS_CELLS_MAX = 120;
const LS_CELL_STROKES = 40;
/** 上限与几个名字(测试拿去和 schema、chalk 比) */
export const LESSON_CAPS = { PAGES_MAX: LS_PAGES_MAX, INK_MAX: LS_INK_MAX, INK_POINTS: LS_INK_POINTS, PICK_MAX: LS_PICK_MAX, MARKS_MAX: LS_MARKS_MAX, STRIP_ITEMS_MAX: LS_STRIP_MAX, JOBS_MAX: LS_JOBS_MAX, PHOTOS_MAX: LS_PHOTOS_MAX, PHOTO_PAGE: LS_PHOTO_PAGE, WHITE_PAGE: LS_WHITE_PAGE, W: LS_W, GAP: LS_GAP, LINE_MARKS: LS_LINE_MARKS, MARKS_NEW_MAX: LS_NEW_MAX, MARK_FRESH_LINES: LS_FRESH_LINES, CELLS_MAX: LS_CELLS_MAX, CELL_STROKES: LS_CELL_STROKES };

/** 一页上老师的圈、划、加点都收掉(遮、盖留着) */
const dropLineMarks = (p: LessonPage): LessonPage => (p.teacher.marks.some((m) => LS_LINE_MARKS.includes(m.k)) ? { ...p, teacher: { ...p.teacher, marks: p.teacher.marks.filter((m) => !LS_LINE_MARKS.includes(m.k)) } } : p);

/**
 * 这一页上老师的每个记号此刻是新的还是旧的(照 marks 的先后):
 * 圈、划、加点画它那一句和下一句是新的,再往后是旧的;同时新的最多 3 处(划一句跨行的几截算一处),多的最早那几处算旧的。遮、盖、以前没记 at 的都是新的
 */
export function markFresh(l: Lesson, p: LessonPage): boolean[] {
  const said = l.said ?? 0;
  const fresh = p.teacher.marks.map((m) => m.at === undefined || !LS_LINE_MARKS.includes(m.k) || said - m.at <= LS_FRESH_LINES);
  const seen: string[] = [];
  for (let i = p.teacher.marks.length - 1; i >= 0; i--) {
    const m = p.teacher.marks[i];
    if (!fresh[i] || m.at === undefined || !LS_LINE_MARKS.includes(m.k)) continue;
    const key = `${m.k}|${m.text}`;
    if (!seen.includes(key)) seen.push(key);
    if (seen.indexOf(key) >= LS_NEW_MAX) fresh[i] = false;
  }
  return fresh;
}

/** 照片页上第 i 张(从 0 起)在场景里的框:一张宽 1000,高照宽高比,从上往下连着,中间空 LS_GAP */
export function photoSheetBox(photos: readonly PagePhoto[], i: number): Box {
  let top = 0;
  for (let k = 0; k < i; k++) top += (LS_W * photos[k].h) / photos[k].w + LS_GAP;
  return [0, top, LS_W, top + (LS_W * photos[i].h) / photos[i].w];
}

/** 白纸页上的白纸条:整页就是一条,从页顶摆起(Strip.box 是它上面那道「题」,白纸页上是页顶一条线) */
const WHITE_LOOK = { label: LS_WHITE_PAGE, box: [0, 0, LS_W, 0] as Box };

/** 还什么都没铺的一节课 */
export const lessonInit = (): Lesson => ({ v: 1, pages: [], at: null, look: null, view: null, strip: null, jobs: [], said: 0 });

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
      const left = l.at !== a.page.id ? pages.map((p) => (p.id === l.at ? dropLineMarks(p) : p)) : pages;
      return { ...l, pages: left, at: a.page.id, look: null, view: null, strip: white };
    }
    case '看': {
      const p = lessonPage(l);
      const strip = p?.teacher.strips.some((s) => s.key === a.label) ? a.label : null;
      const base = l.look && l.look.label !== a.label ? onLessonPage(l, dropLineMarks) : l;
      return { ...base, look: { label: a.label, box: a.box, n: (l.look?.n ?? 0) + 1, ...(a.at ? { at: a.at } : {}), ...(a.rows?.length ? { rows: a.rows } : {}) }, strip };
    }
    case '圈':
    case '划':
    case '加点':
    case '遮':
    case '盖':
      return onLessonPage(l, (p) => {
        const line = LS_LINE_MARKS.includes(a.k);
        const same = (m: { k: string; text: string; box: Box }, s: { text: string; box: Box }): boolean => m.k === a.k && m.text === s.text && sameLessonBox(m.box, s.box);
        // 再圈一遍同一处:挪到最后、算新的
        const keep = line ? p.teacher.marks.filter((m) => !a.spots.some((s) => same(m, s))) : p.teacher.marks;
        const add = a.spots.filter((s) => line || !p.teacher.marks.some((m) => same(m, s))).map((s) => ({ k: a.k, text: s.text, box: s.box, ...(line ? { at: l.said ?? 0 } : {}) }));
        return add.length ? { ...p, teacher: { ...p.teacher, marks: [...keep, ...add].slice(-LS_MARKS_MAX) } } : p;
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
    case 'cell': {
      if (!ev.id) return l;
      return onLessonPage(l, (p) => {
        const cells = { ...(p.kid.cells ?? {}) };
        const strokes = ev.strokes.filter((st) => st.length).slice(0, LS_CELL_STROKES).map((st) => st.slice(0, LS_INK_POINTS));
        if (!strokes.length && !cells[ev.id]) return p;
        delete cells[ev.id];
        if (strokes.length) {
          // 写满了丢最早写的那一格
          const keys = Object.keys(cells);
          if (keys.length >= LS_CELLS_MAX) delete cells[keys[0]];
          cells[ev.id] = strokes;
        }
        return { ...p, kid: { ...p.kid, cells } };
      });
    }
    case 'said':
      return { ...l, said: (l.said ?? 0) + 1 };
    case 'round': {
      const pages = l.pages.map(dropLineMarks);
      return pages.some((p, i) => p !== l.pages[i]) ? { ...l, pages } : l;
    }
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

/** 带动作没有 */
const hasActs = (sec: { acts?: readonly { do?: LessonAct }[]; lines: readonly { acts?: readonly { do?: LessonAct }[] }[] }): boolean => Boolean(sec.acts?.some((a) => a.do) || sec.lines.some((x) => x.acts?.some((a) => a.do)));

/**
 * 老师的一节整个落进这节课(服务端定稿时;孩子端一句一句落,照的是同一个先后):
 * 先收上一轮的圈、划、加点(round),再落第一句前面的动作,再一句一句:落这一句的动作、said 加一。没带动作的一节只收上一轮的
 */
export function lessonSection(l: Lesson, sec: { acts?: readonly { do?: LessonAct }[]; lines: readonly { acts?: readonly { do?: LessonAct }[] }[] }): Lesson {
  let s = lessonStep(l, { t: 'round' });
  if (!hasActs(sec)) return s;
  s = lessonActs(s, sec.acts ?? []);
  for (const line of sec.lines) s = lessonStep(lessonActs(s, line.acts ?? []), { t: 'said' });
  return s;
}
