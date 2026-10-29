/**
 * /dictation 与 /api/dictation/*:听写的页面与接口。
 * cotutor 只在 app.ts 的 route() 里接一行、kid-page 画首页那张卡;这里引用 cotutor 的东西,cotutor 别处不引用这里。拆掉 = 删 src/dictation/、cards/dictation/ 与那两处。
 * 词是答案:孩子端交卷(check)之前只拿得到几个词、每个词几个字和念的音频;交了才拿到字与「要不要再写一遍」。
 *
 *   GET  /dictation?home=<id>&n=<k>          孩子的听写页(从首页的听写卡点进来);不带 home 是拍照开始(老师卡上常驻的「拍照听写」,?tutor=<老师>)
 *   GET  /parent/dictation                   家长看结果(家长端)
 *   GET  /parent/dictation/reel?id=<id>      家长看录像(家长端;上半 iframe 开 /dictation?reel=<id>)
 *   POST /api/dictation/photos               {image: data:image/jpeg;base64,…} 拍的照片:存下、后台开始认,回 {id}
 *   GET  /api/dictation/photos/<id>          认的进度:{state, items, lesson, full};页面轮询着一项一项画框
 *   GET  /api/dictation/photos/<id>/image    那张照片
 *   POST /api/dictation                      {home, n, fresh?} 从首页的卡开始;今天这张卡有没写完的就接着(fresh 另开一次)
 *                                            {photo, words: [{chars, say?}], tutor?} 拍照开始:照片上点选的词;tutor = 从哪位老师卡上进来的(用他的声音)
 *   GET  /api/dictation                      全部听写(家长)
 *   GET  /api/dictation/<id>                 一次听写的全部(家长)
 *   GET  /api/dictation/<id>/kid             孩子端的样子(交卷前没有字)
 *   GET  /api/dictation/<id>/say/<i>         第 i 个词念的音频;没有音色 / 合成失败 404(页面直接提示叫家长,不念浏览器合成声),?text=1 给要念的字
 *   PUT  /api/dictation/<id>/first/<i>       {chars: [{strokes, undos, gone?}]} 第一遍写的(交卷前可以改);gone 是擦掉的笔,录像用
 *   POST /api/dictation/<id>/check           交卷:逐字比对,回字与「再写一遍?」
 *   POST /api/dictation/<id>/rewrites/<i>    {chars, self} 再写一遍(交卷后)
 *   POST /api/dictation/<id>/reveal/<i>      {char} 不会写,给答案:回这一个字(交卷前);记下这个字看过答案
 *   POST /api/dictation/<id>/events          {kind, word, char?, t?, n?, w?, h?} 孩子做了什么(录像按它排)
 *   POST /api/dictation/<id>/done            对好了
 */
import { createHash } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DICTATION_SAY_MAX, DICTATION_WORD_MAX, DICTATION_WORDS_MAX, DictationPropsSchema, dictationEmoji, dictationWordLang, type DictationLang, type DictationProps, type DictationWord } from '../cards/index.ts';
import { localDate } from '../lib/conversation.ts';
import type { AppContext, RouteResult } from '../server/app.ts';
import { readPublished } from '../server/home.ts';
import { tianzigeData } from '../server/tianzige.ts';
import { synthesize } from '../server/tts.ts';
import { judgeChar, type CharJudge, type InkPoint } from '../scenes/dictation/match.ts';
import { photoPromptFrom, recognizePhoto, type Recognize } from './recognize.ts';
import { readFile } from 'node:fs/promises';
import { listActivities } from '../runtime/activities.ts';
import { parseActivity } from '../lib/activity.ts';
import { DICTATION_PAGE } from './page.ts';
import { DICTATION_EN_PAGE } from './en-page.ts';
import { backTutorJson, backTutorOf } from '../server/tutor-face.ts';
import { DICTATION_PARENT_PAGE } from './parent-page.ts';
import { DICTATION_REEL_PAGE } from './reel-page.ts';
import { EVENT_KINDS, ID_RE, createPhoto, createSession, listSessions, photoFile, readPhotoRecord, readSession, writePhotoRecord, writeSession, type PhotoRecord, type Attempt, type CharInk, type InkGone, type Session, type DictationEvent } from '../scenes/dictation/store.ts';

export interface DictationDeps {
  /** workspace 根 */
  root: string;
  now(): Date;
  /** 首页 home 里的第 n 张听写卡(0 起);home 不是现在发布的那份、没有这张 → null */
  card(home: string | null, n: number): Promise<DictationProps | null>;
  /** 谁念:卡上写的老师在就用他,不然语文老师,再不然第一位配了音色的;都没有 null */
  reader(tutor: string | undefined): string | null;
  /** 老师的显示名(听写页的气泡上) */
  display(tutor: string | null): string;
  /** 胶囊上的老师:颜色、首字、名字;没有这位老师 → null */
  face(tutor: string | null): { color: string; initial: string; display: string } | null;
  /** 合成一句的音频文件;没有音色、合成失败 → null */
  say(text: string, tutor: string | null): Promise<string | null>;
  /** 念的老师配了音色没有:没有就孩子端直接提示叫家长,不念浏览器合成声 */
  voiced(tutor: string | null): boolean;
  /** 一个字的笔画中线(hanzi-writer-data);数据里没有 → null */
  medians(ch: string): Promise<number[][][] | null>;
  /** 认一张照片(流式,每认出一项回调一次);lang = en 认英文单词 */
  recognize: Recognize;
}

/** 真服务的依赖:首页从 home/published.json 读,音色从 cotutor.json,配音缓存在 .cotutor/dictation-say/ */
export function dictationDeps(ctx: AppContext): DictationDeps {
  const ws = (): AppContext['ws'] => ctx.ws;
  const voiced = (t: string): boolean => Boolean(ws().config.tutors[t]?.voice);
  return {
    root: ctx.ws.root,
    now: ctx.now,
    async card(home, n) {
      const { home: pub } = await readPublished(ws());
      if (!pub || pub.id !== home) return null;
      const c = pub.cards.filter((x) => x.kind === 'dictation')[n];
      const r = c ? DictationPropsSchema.safeParse(c.props) : null;
      return r?.success ? r.data : null;
    },
    reader(tutor) {
      const tutors = ws().config.tutors;
      if (tutor && tutors[tutor]) return tutor;
      if (tutors['chinese-tutor']) return 'chinese-tutor';
      return Object.keys(tutors).find(voiced) ?? null;
    },
    display(tutor) {
      return (tutor && ws().config.tutors[tutor]?.display) || '老师';
    },
    face(tutor) {
      return backTutorOf(ws().config.tutors, tutor);
    },
    voiced(tutor) {
      return Boolean(tutor && voiced(tutor));
    },
    async say(text, tutor) {
      const voice = tutor ? ws().config.tutors[tutor]?.voice : undefined;
      if (!voice) return null;
      const dir = join(ws().root, '.cotutor', 'dictation-say');
      const file = join(dir, `${createHash('sha1').update(`${voice}\n${text}`).digest('hex').slice(0, 20)}.mp3`);
      if ((await stat(file).catch(() => null))?.isFile()) return file;
      await mkdir(dir, { recursive: true });
      const r = await synthesize(ws().config.tts, { text, voice, out: file }, { env: process.env });
      // 孩子端只说「叫爸爸妈妈来看一下」;原因只在这里说
      if (r.error) console.error(`dictation: 「${text}」没合成(${r.error});孩子端提示叫家长`);
      return r.file;
    },
    async medians(ch) {
      return (await tianzigeData(ch))?.medians ?? null;
    },
    // 每次现读(家长改了要求不用重起服务):听写 activity 文件「认字收到什么」;没有这份文件照出厂的要求
    recognize: async (image, onProgress, lang) => {
      const tpl = await dictationTemplate(ws().root, lang ?? 'zh');
      return recognizePhoto(image, onProgress, { model: ws().config.dictation.model, lang, ...(tpl ? { text: photoPromptFrom(tpl, lang) } : {}) });
    },
  };
}

/**
 * 认词的要求:workspace 里头上写着这一页(page: dictation / dictation-en)、有「认字收到什么」的那份听写 activity(按老师排第一份);
 * 没有 → null(照出厂的要求)
 */
export async function dictationTemplate(root: string, lang: DictationLang): Promise<string | null> {
  const page = lang === 'en' ? 'dictation-en' : 'dictation';
  for (const r of await listActivities(join(root, 'agents'))) {
    const a = parseActivity(await readFile(r.file, 'utf8').catch(() => '')).activity;
    const t = a.page === page ? a.tools.find((x) => x.tool === '认字') : undefined;
    if (t) return t.prompt;
  }
  return null;
}

/** app.ts 接的那一行 */
export function dictationRoute(method: string, url: URL, ctx: AppContext, body: unknown): Promise<RouteResult | null> {
  if (!isOurs(url.pathname)) return Promise.resolve(null);
  return handleDictation(method, url, dictationDeps(ctx), body);
}

const isOurs = (p: string): boolean => p === '/dictation' || p === '/dictation/' || p === '/parent/dictation' || p === '/parent/dictation/reel' || p === '/api/dictation' || p.startsWith('/api/dictation/');

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (message: string): RouteResult => ({ status: 400, json: { error: 'bad_request', message } });
const HOME_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?$/;

const MAX_STROKES = 60;
/** 点与事件的时刻:离开始多少毫秒,一天以内 */
const MAX_T = 24 * 3600_000;
const MAX_POINTS = 3000;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** 一笔:[[x, y, t], …];坏的 → null */
function parseStroke(s: unknown): InkPoint[] | null {
  if (!Array.isArray(s) || s.length === 0 || s.length > MAX_POINTS) return null;
  const pts: InkPoint[] = [];
  for (const p of s as unknown[]) {
    if (!Array.isArray(p) || p.length !== 3 || !num(p[0], -2048, 3072) || !num(p[1], -2048, 3072) || !num(p[2], 0, MAX_T)) return null;
    pts.push([Math.round(p[0]), Math.round(p[1]), Math.round(p[2])]);
  }
  return pts;
}

/** 页面交来的一个词:每个格 {strokes: [[x,y,t]...], undos, gone?: [{t, pts}]};格数要对上 */
export function parseChars(v: unknown, size: number): CharInk[] | null {
  if (!isObj(v) || !Array.isArray(v.chars) || v.chars.length !== size) return null;
  const out: CharInk[] = [];
  for (const c of v.chars as unknown[]) {
    if (!isObj(c) || !Array.isArray(c.strokes) || c.strokes.length > MAX_STROKES) return null;
    const undos = c.undos === undefined ? 0 : c.undos;
    if (!num(undos, 0, 10_000) || !Number.isInteger(undos)) return null;
    const strokes: InkPoint[][] = [];
    for (const s of c.strokes as unknown[]) {
      const pts = parseStroke(s);
      if (!pts) return null;
      strokes.push(pts);
    }
    // 擦掉的笔(录像用):形状不对的整个不要,留下的照收
    const gone: InkGone[] = [];
    if (Array.isArray(c.gone) && c.gone.length <= MAX_STROKES) {
      for (const g of c.gone as unknown[]) {
        if (!isObj(g) || !num(g.t, 0, MAX_T)) continue;
        const pts = parseStroke(g.pts);
        if (pts) gone.push({ t: Math.round(g.t), pts });
      }
    }
    out.push({ strokes, undos, ...(c.revealed === true ? { revealed: true } : {}), ...(gone.length ? { gone } : {}) });
  }
  return out;
}

async function judge(deps: DictationDeps, chars: string, ink: CharInk[], lang?: 'en'): Promise<CharJudge[]> {
  // 英文单词不逐字母比:孩子自己对
  if (lang === 'en') return [];
  const out: CharJudge[] = [];
  const cs = Array.from(chars);
  for (let i = 0; i < cs.length; i++) out.push(judgeChar(ink[i]?.strokes ?? [], await deps.medians(cs[i])));
  return out;
}

/** 每个词几个格:汉字一个字一格;英文一个单词一格 */
const sizes = (s: Session): number[] => s.words.map((w) => (s.lang === 'en' ? 1 : Array.from(w.chars).length));
const latestOf = (s: Session, i: number): Attempt | null => {
  const r = s.rewrites.filter((x) => x.word === i);
  return r.length ? r[r.length - 1].attempt : s.first[i];
};

/** 孩子端看到的:交卷前只有几个词、每个词几个字、写了哪几个;交了才有字、问不问再写一遍、最近写的那遍 */
export function kidView(s: Session, display: string, voiced: boolean): unknown {
  return {
    id: s.id,
    tutor: display,
    /** 念的老师配了音色没有:false 时孩子端不开始、直接提示叫家长 */
    voice: voiced,
    /** 哪位老师(cotutor.json 的键):左上角胶囊画他的头像 */
    tutorName: s.tutor ?? null,
    ...(s.lang ? { lang: s.lang } : {}),
    sizes: sizes(s),
    startedAt: s.startedAt,
    written: s.first.map((a) => a !== null),
    /** 自己写过的(笔迹不是答案):中途回来接着写、听写本上画小格 */
    mine: s.first.map((a) => (a ? a.chars.map((c) => ({ strokes: c.strokes, revealed: c.revealed === true })) : null)),
    checked: s.checkedAt !== null,
    done: s.doneAt !== null,
    answers: s.checkedAt
      ? s.words.map((w, i) => ({
          chars: w.chars,
          ...(w.emoji ? { emoji: w.emoji } : {}),
          ask: s.asked.includes(i) && !s.rewrites.some((r) => r.word === i),
          revealed: (s.first[i]?.chars ?? []).some((c) => c.revealed === true),
          rewrote: s.rewrites.some((r) => r.word === i),
          ink: (latestOf(s, i)?.chars ?? []).map((c) => c.strokes),
        }))
      : null,
  };
}

/**
 * 一格的笔迹缩成一条 SVG path(家长端记录的听写格子画它):点取整、隔一个丢一个(首尾留着),不要时刻。
 * 坐标照原样(汉字是 hanzi-writer 的 1024 尺、y 朝上;英文是 2048 × 512、y 朝下),画的那头自己翻
 */
export function inkPath(strokes: InkPoint[][]): string {
  return strokes
    .filter((st) => st.length)
    .map((st) => {
      const pts = st.filter((_p, k) => k === 0 || k === st.length - 1 || k % 2 === 0);
      if (pts.length === 1) pts.push([pts[0][0] + 1, pts[0][1], 0]);
      return pts.map((p, k) => (k ? 'L' : 'M') + Math.round(p[0]) + ' ' + Math.round(p[1])).join('');
    })
    .join('');
}

/** 家长的列表一行;ink = 每个词最近写的那遍(一格一条 path;shown 第一遍看了答案、again 重写过),practice = 要再练的词(看了答案、重写过、被问了再写一遍的) */
function summary(s: Session): unknown {
  const firstOk = s.first.filter((a) => a && a.judges.every((j) => !j.ask) && a.chars.every((c) => !c.revealed)).length;
  const revealed = s.first.filter((a) => a && a.chars.some((c) => c.revealed)).length;
  const shown = (i: number): boolean => (s.first[i]?.chars ?? []).some((c) => c.revealed === true);
  const again = (i: number): boolean => s.rewrites.some((r) => r.word === i);
  const ink = s.words.map((_w, i) => { const a = latestOf(s, i); return a ? { d: a.chars.map((c) => inkPath(c.strokes)), shown: shown(i), again: again(i) } : null; });
  const practice = s.words.filter((_w, i) => shown(i) || again(i) || s.asked.includes(i)).map((w) => w.chars);
  return { id: s.id, startedAt: s.startedAt, doneAt: s.doneAt, tutor: s.tutor ?? null, ...(s.lang ? { lang: s.lang } : {}), words: s.words.map((w) => w.chars), written: s.first.filter((a) => a !== null).length, checked: s.checkedAt !== null, done: s.doneAt !== null, firstOk, asked: s.asked.length, revealed, photo: s.photo ?? null, lesson: s.lesson ?? null, ink, practice };
}

const PHOTO_MAX_BYTES = 3_000_000;

/** 拍照开始时页面交来的词:1–20 个,每个 1–4 个汉字(lang = en:一个英文单词),念法可有可无(超长的丢掉念法);一种也不能混 */
export function parseWords(v: unknown, lang: DictationLang = 'zh'): DictationWord[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > DICTATION_WORDS_MAX) return null;
  const out: DictationWord[] = [];
  for (const w of v as unknown[]) {
    if (!isObj(w) || typeof w.chars !== 'string') return null;
    const chars = lang === 'en' ? w.chars.trim() : w.chars.replace(/\s+/g, '');
    if (dictationWordLang(chars) !== lang) return null;
    const say = typeof w.say === 'string' && w.say.trim() && Array.from(w.say.trim()).length <= DICTATION_SAY_MAX ? w.say.trim() : undefined;
    const emoji = lang === 'en' ? dictationEmoji(w.emoji) : undefined;
    out.push({ chars, ...(say ? { say } : {}), ...(emoji ? { emoji } : {}) });
  }
  return out;
}

/** 后台认着的照片(测试等它们认完) */
const recognizing = new Set<Promise<void>>();
export function photosIdle(): Promise<void> {
  return Promise.all([...recognizing]).then(() => undefined);
}

/** 后台认一张:每认出一项就落一次盘(串起来写,后写的盖前写的),页面轮询读到的就是认到哪儿了 */
function startRecognizing(deps: DictationDeps, rec: PhotoRecord, image: { data: Buffer; mime: string }): void {
  let chain = Promise.resolve();
  const save = (): void => {
    const snap: PhotoRecord = { ...rec, items: [...rec.items] };
    chain = chain.then(() => writePhotoRecord(deps.root, snap)).catch(() => {});
  };
  const job = deps
    .recognize(image, (p) => {
      rec.items = p.items;
      rec.lesson = p.lesson;
      rec.full = p.full;
      save();
    }, rec.lang)
    .then((r) => {
      rec.items = r.items;
      rec.lesson = r.lesson;
      rec.full = r.full;
      rec.ms = r.ms;
      if (r.ok) {
        rec.state = 'done';
        rec.model = r.model;
      } else {
        rec.state = 'failed';
        rec.error = r.error;
      }
      save();
      return chain;
    })
    .catch(() => {
      rec.state = 'failed';
      rec.error = 'crashed';
      save();
      return chain;
    })
    .finally(() => recognizing.delete(job));
  recognizing.add(job);
}

export async function handleDictation(method: string, url: URL, deps: DictationDeps, body: unknown): Promise<RouteResult | null> {
  const p = url.pathname;
  if (!isOurs(p)) return null;
  // 英文单词听写另一页(四线三格写整个单词)
  if (p === '/dictation' || p === '/dictation/') {
    if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
    // 胶囊带上念的老师:听写一定有念的老师——老师牌「拍照听写」带 ?tutor=,首页听写卡上写了谁就是谁、没写的公共卡 reader() 给语文老师;
    // 出页面时就插进去,打开就是他的颜色和首字。录像(?reel=)里胶囊藏着,不用
    const q = url.searchParams;
    let who: string | null = null;
    if (!q.get('reel')) {
      if (q.get('home') !== null) who = deps.reader((await deps.card(q.get('home'), Number(q.get('n')) || 0))?.tutor);
      else who = deps.reader(q.get('tutor') ?? undefined);
    }
    const page = q.get('lang') === 'en' ? DICTATION_EN_PAGE : DICTATION_PAGE;
    return { status: 200, html: page.replace('__BACK_TUTOR__', () => backTutorJson(deps.face(who))) };
  }
  if (p === '/parent/dictation') return method === 'GET' ? { status: 200, html: DICTATION_PARENT_PAGE } : { status: 405, json: { error: 'method_not_allowed' } };
  if (p === '/parent/dictation/reel') return method === 'GET' ? { status: 200, html: DICTATION_REEL_PAGE } : { status: 405, json: { error: 'method_not_allowed' } };
  if (!p.startsWith('/api/')) return { status: 404, json: { error: 'not_found' } };
  const root = deps.root;
  const now = deps.now();

  if (p === '/api/dictation/photos') {
    if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
    const m = isObj(body) && typeof body.image === 'string' ? /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null;
    if (!m) return bad('要 {image: data:image/jpeg;base64,…}');
    const data = Buffer.from(m[2], 'base64');
    if (!data.length || data.length > PHOTO_MAX_BYTES) return { status: 413, json: { error: 'too_large', message: `一张最多 ${PHOTO_MAX_BYTES / 1_000_000} MB,页面该先缩到长边 2000` } };
    const rec = await createPhoto(root, data, now, isObj(body) && body.lang === 'en' ? 'en' : undefined);
    startRecognizing(deps, rec, { data, mime: `image/${m[1]}` });
    return { status: 201, json: { id: rec.id } };
  }
  const ph = /^\/api\/dictation\/photos\/([^/]+)(\/image)?$/.exec(p);
  if (ph) {
    if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
    const rec = await readPhotoRecord(root, ph[1]);
    if (!rec) return { status: 404, json: { error: 'no_such_photo' } };
    if (ph[2]) return { status: 200, file: photoFile(root, rec.id), contentType: 'image/jpeg' };
    return { status: 200, json: rec };
  }

  if (p === '/api/dictation') {
    if (method === 'GET') return { status: 200, json: { sessions: (await listSessions(root)).map(summary) } };
    if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
    if (isObj(body) && typeof body.photo === 'string') {
      const rec = await readPhotoRecord(root, body.photo);
      if (!rec) return { status: 404, json: { error: 'no_such_photo' } };
      const lang: DictationLang = rec.lang === 'en' || body.lang === 'en' ? 'en' : 'zh';
      const words = parseWords(body.words, lang);
      if (!words) return bad(lang === 'en' ? `要 {photo, words: [{chars, say?}]}:1 到 ${DICTATION_WORDS_MAX} 个英文单词` : `要 {photo, words: [{chars, say?}]}:1 到 ${DICTATION_WORDS_MAX} 个词,每个 1 到 ${DICTATION_WORD_MAX} 个汉字`);
      // 从哪位老师卡上的「拍照听写」进来就用他的声音
      const tutor = deps.reader(typeof body.tutor === 'string' ? body.tutor : undefined);
      const s = await createSession(root, { home: null, n: -1, tutor, words, photo: rec.id, lesson: rec.lesson, ...(lang === 'en' ? { lang } : {}) }, now);
      return { status: 201, json: kidView(s, deps.display(tutor), deps.voiced(tutor)) };
    }
    if (!isObj(body) || !(body.home === null || (typeof body.home === 'string' && HOME_ID_RE.test(body.home))) || !num(body.n, 0, 99) || !Number.isInteger(body.n)) return bad('要 {home, n}');
    const home = body.home as string | null;
    const n = body.n as number;
    const card = await deps.card(home, n);
    if (!card || !card.words.length) return { status: 404, json: { error: 'no_such_card', message: '首页换过了,这张听写卡不在了' } };
    // 今天这张卡开过、还没对好:接着(孩子中途回了首页、页面刷新了)
    if (body.fresh !== true) {
      const today = localDate(now);
      const same = (await listSessions(root)).find((s) => s.home === home && s.n === n && localDate(new Date(s.startedAt)) === today);
      if (same) return { status: 200, json: kidView(same, deps.display(same.tutor), deps.voiced(same.tutor)) };
    }
    const tutor = deps.reader(card.tutor);
    const s = await createSession(root, { home, n, tutor, words: card.words, ...(card.lang ? { lang: card.lang } : {}) }, now);
    return { status: 201, json: kidView(s, deps.display(tutor), deps.voiced(tutor)) };
  }

  const m = /^\/api\/dictation\/([^/]+)(?:\/([a-z]+)(?:\/(\d{1,2}))?)?$/.exec(p);
  if (!m || !ID_RE.test(m[1])) return { status: 404, json: { error: 'not_found' } };
  // 同一次听写的请求一个一个来:每个都是读 → 改 → 写整个文件,并发的(出词与念、写好了与事件)会互相盖掉
  return serially(`${root}\n${m[1]}`, () => handleSession(method, url, deps, body, m, now));
}

const queues = new Map<string, Promise<unknown>>();
function serially<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(job, job);
  const tail = next.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return next;
}

async function handleSession(method: string, url: URL, deps: DictationDeps, body: unknown, m: RegExpExecArray, now: Date): Promise<RouteResult> {
  const root = deps.root;
  const [, id, sub, idx] = m;
  const s = await readSession(root, id);
  if (!s) return { status: 404, json: { error: 'no_such_session' } };
  const i = idx === undefined ? -1 : Number(idx);
  if (idx !== undefined && i >= s.words.length) return { status: 404, json: { error: 'no_such_word' } };

  if (!sub) return method === 'GET' ? { status: 200, json: s } : { status: 405, json: { error: 'method_not_allowed' } };
  if (sub === 'kid' && method === 'GET') return { status: 200, json: kidView(s, deps.display(s.tutor), deps.voiced(s.tutor)) };

  if (sub === 'say' && method === 'GET' && i >= 0) {
    const w = s.words[i];
    const text = w.say ?? w.chars;
    if (url.searchParams.get('text')) return { status: 200, json: { text } };
    const file = await deps.say(text, s.tutor);
    if (!file) return { status: 404, json: { error: 'no_audio' } };
    return { status: 200, file, contentType: file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' };
  }

  if (sub === 'first' && method === 'PUT' && i >= 0) {
    if (s.checkedAt) return { status: 409, json: { error: 'checked', message: '已经交了' } };
    const chars = parseChars(body, sizes(s)[i]);
    if (!chars) return bad('要 {chars: [{strokes, undos}]},格数对上');
    s.first[i] = { at: now.toISOString(), chars, judges: await judge(deps, s.words[i].chars, chars, s.lang) };
    await writeSession(root, s);
    return { status: 200, json: { ok: true } };
  }

  if (sub === 'check' && method === 'POST') {
    if (!s.checkedAt) {
      // 没写的词按空着判(孩子跳过了、页面丢了那一笔)
      for (let k = 0; k < s.words.length; k++) {
        if (!s.first[k]) {
          const empty = Array.from({ length: sizes(s)[k] }, () => ({ strokes: [], undos: 0 }));
          s.first[k] = { at: now.toISOString(), chars: empty, judges: await judge(deps, s.words[k].chars, empty, s.lang) };
        }
      }
      // 看过答案的词不问「再写一遍?」:已经照着写过一遍了
      s.asked = s.first.map((a, k) => (a!.judges.some((j) => j.ask) && !a!.chars.some((c) => c.revealed) ? k : -1)).filter((k) => k >= 0);
      s.checkedAt = now.toISOString();
      await writeSession(root, s);
    }
    return { status: 200, json: kidView(s, deps.display(s.tutor), deps.voiced(s.tutor)) };
  }

  if (sub === 'rewrites' && method === 'POST' && i >= 0) {
    if (!s.checkedAt) return { status: 409, json: { error: 'not_checked', message: '还没交' } };
    const chars = parseChars(body, sizes(s)[i]);
    if (!chars) return bad('要 {chars: [{strokes, undos}]},格数对上');
    const self = isObj(body) && body.self === true;
    s.rewrites.push({ word: i, self, attempt: { at: now.toISOString(), chars, judges: await judge(deps, s.words[i].chars, chars, s.lang) } });
    await writeSession(root, s);
    return { status: 200, json: kidView(s, deps.display(s.tutor), deps.voiced(s.tutor)) };
  }

  if (sub === 'reveal' && method === 'POST' && i >= 0) {
    if (s.checkedAt) return { status: 409, json: { error: 'checked', message: '已经交了' } };
    // 英文:一个单词一格,给的是整个单词
    const cs = s.lang === 'en' ? [s.words[i].chars] : Array.from(s.words[i].chars);
    const ch = isObj(body) ? body.char : undefined;
    if (!num(ch, 0, cs.length - 1) || !Number.isInteger(ch)) return bad('要 {char}:第几个字');
    const t = isObj(body) && num(body.t, 0, MAX_T) ? Math.round(body.t) : undefined;
    if (s.events.length < 4000) s.events.push({ at: now.toISOString(), kind: 'reveal', word: i, char: ch, ...(t !== undefined ? { t } : {}) });
    await writeSession(root, s);
    return { status: 200, json: { ch: cs[ch] } };
  }

  if (sub === 'events' && method === 'POST') {
    const kind = isObj(body) ? (body.kind as DictationEvent['kind']) : undefined;
    if (!isObj(body) || kind === undefined || !EVENT_KINDS.includes(kind) || kind === 'reveal' || !num(body.word, 0, s.words.length - 1) || !Number.isInteger(body.word)) return bad('要 {kind, word, char?, t?, n?}');
    const ch = body.char;
    if (ch !== undefined && (!num(ch, 0, 3) || !Number.isInteger(ch))) return bad('char 是第几个字');
    const t = body.t === undefined ? undefined : num(body.t, 0, MAX_T) ? Math.round(body.t) : null;
    const n = body.n === undefined ? undefined : num(body.n, 1, 99) && Number.isInteger(body.n) ? body.n : null;
    if (t === null || n === null) return bad('t 是离开始的毫秒,n 是第几遍');
    // view:孩子屏幕的 CSS 尺寸(录像按它开)
    const pad = body.pad === 'l' || body.pad === 'm' || body.pad === 's' ? { pad: body.pad as 'l' | 'm' | 's' } : {};
    const size = kind === 'view' && num(body.w, 200, 4000) && num(body.h, 200, 4000) ? { w: Math.round(body.w), h: Math.round(body.h), ...pad } : kind === 'view' ? null : {};
    if (size === null) return bad('view 要 {w, h, pad?}');
    if (s.events.length < 4000) s.events.push({ at: now.toISOString(), kind, word: body.word as number, ...(ch !== undefined ? { char: ch as number } : {}), ...(t !== undefined ? { t } : {}), ...(n !== undefined ? { n } : {}), ...size });
    await writeSession(root, s);
    return { status: 200, json: { ok: true } };
  }

  if (sub === 'done' && method === 'POST') {
    if (!s.checkedAt) return { status: 409, json: { error: 'not_checked', message: '还没交' } };
    if (!s.doneAt) {
      s.doneAt = now.toISOString();
      await writeSession(root, s);
    }
    return { status: 200, json: { ok: true } };
  }

  return { status: 405, json: { error: 'method_not_allowed' } };
}
