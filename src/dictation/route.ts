/**
 * /dictation 与 /api/dictation/*:听写的页面与接口(《wip/听写设想.md》)。
 * cotutor 只在 app.ts 的 route() 里接一行、kid-page 画首页那张卡;这里引用 cotutor 的东西,cotutor 别处不引用这里。拆掉 = 删 src/dictation/、cards/dictation/ 与那两处。
 * 词是答案:孩子端交卷(check)之前只拿得到几个词、每个词几个字和念的音频;交了才拿到字与「要不要再写一遍」。
 *
 *   GET  /dictation?home=<id>&n=<k>          孩子的听写页(从首页那张卡点进来);不带 home 是拍照开始(首页固定的「拍照听写」)
 *   GET  /dictation/parent                   家长看结果
 *   POST /api/dictation/photos               {image: data:image/jpeg;base64,…} 拍的照片:存下、后台开始认,回 {id}
 *   GET  /api/dictation/photos/<id>          认的进度:{state, items, lesson};页面轮询着一项一项画框
 *   GET  /api/dictation/photos/<id>/image    那张照片
 *   POST /api/dictation                      {home, n, fresh?} 从首页的卡开始;今天这张卡有没写完的就接着(fresh 另开一次)
 *                                            {photo, words: [{chars, say?}]} 拍照开始:照片上点选的词
 *   GET  /api/dictation                      全部听写(家长)
 *   GET  /api/dictation/<id>                 一次听写的全部(家长)
 *   GET  /api/dictation/<id>/kid             孩子端的样子(交卷前没有字)
 *   GET  /api/dictation/<id>/say/<i>         第 i 个词念的音频;没有音色 / 合成失败 404,?text=1 给要念的字(页面退浏览器合成声)
 *   PUT  /api/dictation/<id>/first/<i>       {chars: [{strokes, undos}]} 第一遍写的(交卷前可以改)
 *   POST /api/dictation/<id>/check           交卷:逐字比对,回字与「再写一遍?」
 *   POST /api/dictation/<id>/rewrites/<i>    {chars, self} 再写一遍(交卷后)
 *   POST /api/dictation/<id>/events          {kind, word, char?} 对答案时做了什么
 *   POST /api/dictation/<id>/done            对好了
 */
import { createHash } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DICTATION_SAY_MAX, DICTATION_WORD_MAX, DICTATION_WORDS_MAX, DictationPropsSchema, HAN, type DictationProps, type DictationWord } from '../cards/index.ts';
import { localDate } from '../lib/conversation.ts';
import type { AppContext, RouteResult } from '../server/app.ts';
import { readPublished } from '../server/home.ts';
import { tianzigeData } from '../server/tianzige.ts';
import { synthesize } from '../server/tts.ts';
import { judgeChar, type CharJudge, type InkPoint } from './lib/match.ts';
import { recognizePhoto, type Recognize } from './recognize.ts';
import { DICTATION_PAGE } from './page.ts';
import { DICTATION_PARENT_PAGE } from './parent-page.ts';
import { ID_RE, createPhoto, createSession, listSessions, photoFile, readPhotoRecord, readSession, writePhotoRecord, writeSession, type PhotoRecord, type Attempt, type CharInk, type Session, type DictationEvent } from './store.ts';

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
  /** 合成一句的音频文件;没有音色、合成失败 → null */
  say(text: string, tutor: string | null): Promise<string | null>;
  /** 一个字的笔画中线(hanzi-writer-data);数据里没有 → null */
  medians(ch: string): Promise<number[][][] | null>;
  /** 认一张照片(流式,每认出一项回调一次) */
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
    async say(text, tutor) {
      const voice = tutor ? ws().config.tutors[tutor]?.voice : undefined;
      if (!voice) return null;
      const dir = join(ws().root, '.cotutor', 'dictation-say');
      const file = join(dir, `${createHash('sha1').update(`${voice}\n${text}`).digest('hex').slice(0, 20)}.mp3`);
      if ((await stat(file).catch(() => null))?.isFile()) return file;
      await mkdir(dir, { recursive: true });
      const r = await synthesize(ws().config.tts, { text, voice, out: file }, { env: process.env });
      return r.file;
    },
    async medians(ch) {
      return (await tianzigeData(ch))?.medians ?? null;
    },
    recognize: (image, onItem) => recognizePhoto(image, onItem),
  };
}

/** app.ts 接的那一行 */
export function dictationRoute(method: string, url: URL, ctx: AppContext, body: unknown): Promise<RouteResult | null> {
  if (!isOurs(url.pathname)) return Promise.resolve(null);
  return handleDictation(method, url, dictationDeps(ctx), body);
}

const isOurs = (p: string): boolean => p === '/dictation' || p.startsWith('/dictation/') || p === '/api/dictation' || p.startsWith('/api/dictation/');

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (message: string): RouteResult => ({ status: 400, json: { error: 'bad_request', message } });
const HOME_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?$/;

const MAX_STROKES = 60;
const MAX_POINTS = 3000;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** 页面交来的一个词:每个格 {strokes: [[x,y,t]...], undos};格数要对上 */
export function parseChars(v: unknown, size: number): CharInk[] | null {
  if (!isObj(v) || !Array.isArray(v.chars) || v.chars.length !== size) return null;
  const out: CharInk[] = [];
  for (const c of v.chars as unknown[]) {
    if (!isObj(c) || !Array.isArray(c.strokes) || c.strokes.length > MAX_STROKES) return null;
    const undos = c.undos === undefined ? 0 : c.undos;
    if (!num(undos, 0, 10_000) || !Number.isInteger(undos)) return null;
    const strokes: InkPoint[][] = [];
    for (const s of c.strokes as unknown[]) {
      if (!Array.isArray(s) || s.length === 0 || s.length > MAX_POINTS) return null;
      const pts: InkPoint[] = [];
      for (const p of s as unknown[]) {
        if (!Array.isArray(p) || p.length !== 3 || !num(p[0], -2048, 3072) || !num(p[1], -2048, 3072) || !num(p[2], 0, 6 * 3600_000)) return null;
        pts.push([Math.round(p[0]), Math.round(p[1]), Math.round(p[2])]);
      }
      strokes.push(pts);
    }
    out.push({ strokes, undos });
  }
  return out;
}

async function judge(deps: DictationDeps, chars: string, ink: CharInk[]): Promise<CharJudge[]> {
  const out: CharJudge[] = [];
  const cs = Array.from(chars);
  for (let i = 0; i < cs.length; i++) out.push(judgeChar(ink[i]?.strokes ?? [], await deps.medians(cs[i])));
  return out;
}

const sizes = (s: Session): number[] => s.words.map((w) => Array.from(w.chars).length);
const latestOf = (s: Session, i: number): Attempt | null => {
  const r = s.rewrites.filter((x) => x.word === i);
  return r.length ? r[r.length - 1].attempt : s.first[i];
};

/** 孩子端看到的:交卷前只有几个词、每个词几个字、写了哪几个;交了才有字、问不问再写一遍、最近写的那遍 */
export function kidView(s: Session, display: string): unknown {
  return {
    id: s.id,
    tutor: display,
    sizes: sizes(s),
    written: s.first.map((a) => a !== null),
    checked: s.checkedAt !== null,
    done: s.doneAt !== null,
    reveal: s.checkedAt
      ? s.words.map((w, i) => ({
          chars: w.chars,
          ask: s.asked.includes(i) && !s.rewrites.some((r) => r.word === i),
          rewrote: s.rewrites.some((r) => r.word === i),
          ink: (latestOf(s, i)?.chars ?? []).map((c) => c.strokes),
        }))
      : null,
  };
}

/** 家长的列表一行 */
function summary(s: Session): unknown {
  const firstOk = s.first.filter((a) => a && a.judges.every((j) => !j.ask)).length;
  return { id: s.id, startedAt: s.startedAt, words: s.words.map((w) => w.chars), checked: s.checkedAt !== null, done: s.doneAt !== null, firstOk, asked: s.asked.length };
}

const PHOTO_MAX_BYTES = 3_000_000;

/** 拍照开始时页面交来的词:1–20 个,每个 1–4 个汉字,念法可有可无(超长的丢掉念法) */
export function parseWords(v: unknown): DictationWord[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > DICTATION_WORDS_MAX) return null;
  const out: DictationWord[] = [];
  for (const w of v as unknown[]) {
    if (!isObj(w) || typeof w.chars !== 'string') return null;
    const cs = Array.from(w.chars.replace(/\s+/g, ''));
    if (!cs.length || cs.length > DICTATION_WORD_MAX || !cs.every((c) => HAN.test(c))) return null;
    const say = typeof w.say === 'string' && w.say.trim() && Array.from(w.say.trim()).length <= DICTATION_SAY_MAX ? w.say.trim() : undefined;
    out.push({ chars: cs.join(''), ...(say ? { say } : {}) });
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
    .recognize(image, (item, lesson) => {
      if (item) rec.items.push(item);
      rec.lesson = lesson;
      save();
    })
    .then((r) => {
      rec.items = r.items;
      rec.lesson = r.lesson;
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
  if (p === '/dictation' || p === '/dictation/') return method === 'GET' ? { status: 200, html: DICTATION_PAGE } : { status: 405, json: { error: 'method_not_allowed' } };
  if (p === '/dictation/parent') return method === 'GET' ? { status: 200, html: DICTATION_PARENT_PAGE } : { status: 405, json: { error: 'method_not_allowed' } };
  if (!p.startsWith('/api/')) return { status: 404, json: { error: 'not_found' } };
  const root = deps.root;
  const now = deps.now();

  if (p === '/api/dictation/photos') {
    if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
    const m = isObj(body) && typeof body.image === 'string' ? /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.image) : null;
    if (!m) return bad('要 {image: data:image/jpeg;base64,…}');
    const data = Buffer.from(m[2], 'base64');
    if (!data.length || data.length > PHOTO_MAX_BYTES) return { status: 413, json: { error: 'too_large', message: `一张最多 ${PHOTO_MAX_BYTES / 1_000_000} MB,页面该先缩到长边 2000` } };
    const rec = await createPhoto(root, data, now);
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
      const words = parseWords(body.words);
      if (!words) return bad(`要 {photo, words: [{chars, say?}]}:1 到 ${DICTATION_WORDS_MAX} 个词,每个 1 到 ${DICTATION_WORD_MAX} 个汉字`);
      const tutor = deps.reader(undefined);
      const s = await createSession(root, { home: null, n: -1, tutor, words, photo: rec.id, lesson: rec.lesson }, now);
      return { status: 201, json: kidView(s, deps.display(tutor)) };
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
      if (same) return { status: 200, json: kidView(same, deps.display(same.tutor)) };
    }
    const tutor = deps.reader(card.tutor);
    const s = await createSession(root, { home, n, tutor, words: card.words }, now);
    return { status: 201, json: kidView(s, deps.display(tutor)) };
  }

  const m = /^\/api\/dictation\/([^/]+)(?:\/([a-z]+)(?:\/(\d{1,2}))?)?$/.exec(p);
  if (!m || !ID_RE.test(m[1])) return { status: 404, json: { error: 'not_found' } };
  const [, id, sub, idx] = m;
  const s = await readSession(root, id);
  if (!s) return { status: 404, json: { error: 'no_such_session' } };
  const i = idx === undefined ? -1 : Number(idx);
  if (idx !== undefined && i >= s.words.length) return { status: 404, json: { error: 'no_such_word' } };

  if (!sub) return method === 'GET' ? { status: 200, json: s } : { status: 405, json: { error: 'method_not_allowed' } };
  if (sub === 'kid' && method === 'GET') return { status: 200, json: kidView(s, deps.display(s.tutor)) };

  if (sub === 'say' && method === 'GET' && i >= 0) {
    const w = s.words[i];
    const text = w.say ?? w.chars;
    if (url.searchParams.get('text')) return { status: 200, json: { text } };
    const file = await deps.say(text, s.tutor);
    if (!file) return { status: 404, json: { error: 'no_audio' } };
    return { status: 200, file, contentType: 'audio/mpeg' };
  }

  if (sub === 'first' && method === 'PUT' && i >= 0) {
    if (s.checkedAt) return { status: 409, json: { error: 'checked', message: '已经交了' } };
    const chars = parseChars(body, sizes(s)[i]);
    if (!chars) return bad('要 {chars: [{strokes, undos}]},格数对上');
    s.first[i] = { at: now.toISOString(), chars, judges: await judge(deps, s.words[i].chars, chars) };
    await writeSession(root, s);
    return { status: 200, json: { ok: true } };
  }

  if (sub === 'check' && method === 'POST') {
    if (!s.checkedAt) {
      // 没写的词按空着判(孩子跳过了、页面丢了那一笔)
      for (let k = 0; k < s.words.length; k++) {
        if (!s.first[k]) {
          const empty = Array.from(s.words[k].chars).map(() => ({ strokes: [], undos: 0 }));
          s.first[k] = { at: now.toISOString(), chars: empty, judges: await judge(deps, s.words[k].chars, empty) };
        }
      }
      s.asked = s.first.map((a, k) => (a!.judges.some((j) => j.ask) ? k : -1)).filter((k) => k >= 0);
      s.checkedAt = now.toISOString();
      await writeSession(root, s);
    }
    return { status: 200, json: kidView(s, deps.display(s.tutor)) };
  }

  if (sub === 'rewrites' && method === 'POST' && i >= 0) {
    if (!s.checkedAt) return { status: 409, json: { error: 'not_checked', message: '还没交' } };
    const chars = parseChars(body, sizes(s)[i]);
    if (!chars) return bad('要 {chars: [{strokes, undos}]},格数对上');
    const self = isObj(body) && body.self === true;
    s.rewrites.push({ word: i, self, attempt: { at: now.toISOString(), chars, judges: await judge(deps, s.words[i].chars, chars) } });
    await writeSession(root, s);
    return { status: 200, json: kidView(s, deps.display(s.tutor)) };
  }

  if (sub === 'events' && method === 'POST') {
    const kinds: DictationEvent['kind'][] = ['strokeOrder', 'rewrite', 'self', 'again'];
    if (!isObj(body) || !kinds.includes(body.kind as DictationEvent['kind']) || !num(body.word, 0, s.words.length - 1) || !Number.isInteger(body.word)) return bad('要 {kind, word, char?}');
    const ch = body.char;
    if (ch !== undefined && (!num(ch, 0, 3) || !Number.isInteger(ch))) return bad('char 是第几个字');
    if (s.events.length < 2000) s.events.push({ at: now.toISOString(), kind: body.kind as DictationEvent['kind'], word: body.word as number, ...(ch !== undefined ? { char: ch as number } : {}) });
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
