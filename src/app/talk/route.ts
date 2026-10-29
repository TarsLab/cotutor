/**
 * /talk 与 /api/talk/*:口语课的页面与接口。孩子在这里拍一页、改好口语单,交给英语老师的实时页上课
 * (src/runtime/talk-run.ts,activity「口语课」);这一页自己不打电话。
 * cotutor 只在 app.ts 的 route() 里接一行;这里引用 cotutor 的东西,cotutor 别处不引用这里。拆掉 = 删 src/{app,ui,scenes}/talk/ 和那一行(实时页里口语课热身那几处另算)。
 *
 *   GET    /talk                       孩子端的页面:拍照、看口语单(按 hash 切;家长端没有这一页)
 *   GET    /api/talk                   开关、全部口语单(新的在前)
 *   POST   /api/talk                   {photo?: dataURL} 开一次;有照片就交给 omni 读口语单(孩子拍的,读完才回)
 *                                      {from: 'latest'} 拍照屏的「接着上」:最近那份改好了的口语单(404 = 还没有)
 *   GET    /api/talk/<id>              一次的全部({meta})
 *   PUT    /api/talk/<id>/list         {words, sentences, ready?} 改过的口语单;ready = 交给老师
 *   DELETE /api/talk/<id>
 *   GET    /api/talk/<id>/photo        那页照片
 */
import { join } from 'node:path';
import type { AppContext, RouteResult } from '../http/app.ts';
import { readList, wordCardOf, type ListItem } from './list.ts';
import { talkPage } from '../../ui/talk/page.ts';
import { backTutorOf } from '../../ui/kid/tutor-face.ts';
import { ID_RE, createTalk, deleteTalk, dirOf, listTalks, readMeta, writeMeta } from '../../scenes/talk/store.ts';

export interface TalkDeps {
  /** 照片 → 口语单(测试换假的) */
  readList: typeof readList;
  env?: NodeJS.ProcessEnv;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (message: string): RouteResult => ({ status: 400, json: { error: 'bad_request', message } });
const PHOTO_MIME: Record<string, string> = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const PHOTO_B64_MAX = 5_600_000;

/** data:image/…;base64,… → 字节;不是图、太大 → undefined */
export function photoData(v: unknown): { data: Buffer; mime: string } | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^data:image\/([a-z]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(v);
  const mime = m ? PHOTO_MIME[m[1]] : undefined;
  if (!m || !mime || m[2].length > PHOTO_B64_MAX) return undefined;
  return { data: Buffer.from(m[2], 'base64'), mime };
}

/** 改过的口语单:两组各最多 12 / 8 条,去空去重;词带回来的 emoji 与分段再过一遍单词卡的 parse(改了词,旧分段拼不回就丢) */
export function parseItems(v: unknown, max: number, card = false): ListItem[] | null {
  if (!Array.isArray(v) || v.length > 50) return null;
  const out: ListItem[] = [];
  for (const x of v as unknown[]) {
    if (!isObj(x) || typeof x.en !== 'string') return null;
    const en = x.en.replace(/\s+/g, ' ').trim();
    const zh = typeof x.zh === 'string' ? x.zh.replace(/\s+/g, ' ').trim() : '';
    if (!en || en.length > 120 || zh.length > 120) continue;
    if (out.some((o) => o.en.toLowerCase() === en.toLowerCase())) continue;
    const ch = (x as { chunks?: unknown }).chunks;
    out.push(card ? { en, zh, ...wordCardOf(en, x.emoji, Array.isArray(ch) ? ch.join('-') : undefined) } : { en, zh });
    if (out.length >= max) break;
  }
  return out;
}

export function makeTalkRoute(deps: TalkDeps = { readList }) {
  return async function talkRoute(method: string, url: URL, ctx: AppContext, body: unknown): Promise<RouteResult | null> {
    const p = url.pathname;
    if (p === '/talk' || p === '/talk/') return method === 'GET' ? { status: 200, html: talkPage(backTutorOf(ctx.ws.config.tutors, url.searchParams.get('tutor'))) } : { status: 405, json: { error: 'method_not_allowed' } };
    if (p !== '/api/talk' && !p.startsWith('/api/talk/')) return null;
    const ws = ctx.ws;
    const cfg = ws.config.talk;
    const root = ws.root;
    const env = deps.env ?? process.env;

    if (p === '/api/talk') {
      if (method === 'GET') return { status: 200, json: { enabled: cfg.enabled, talks: await listTalks(root) } };
      if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
      if (!cfg.enabled) return { status: 404, json: { error: 'talk_disabled', message: 'cotutor.json 的 talk.enabled 还是 false' } };
      const b = isObj(body) ? body : {};
      if (b.from !== undefined) {
        if (b.from !== 'latest') return bad("from 只认 'latest'");
        const last = (await listTalks(root)).find((t) => t.status === 'ready' && t.list.words.length + t.list.sentences.length > 0);
        if (!last) return { status: 404, json: { error: 'no_list', message: '还没有给孩子的口语单' } };
        return { status: 200, json: last };
      }
      const photo = b.photo === undefined ? null : photoData(b.photo);
      if (photo === undefined) return bad('photo 要是 data:image/…;base64,…,不超过 4MB');
      const meta = await createTalk(root, ctx.now(), photo?.data ?? null);
      if (photo) {
        const r = await deps.readList(photo, { env, model: cfg.listModel });
        if (r.ok) { meta.list = r.list; meta.listBy = 'omni'; meta.listMs = r.ms; }
        else { meta.listError = r.error; meta.listMs = r.ms; }
        await writeMeta(root, meta);
      }
      return { status: 201, json: meta };
    }

    const m = /^\/api\/talk\/([^/]+)(?:\/(.*))?$/.exec(p);
    if (!m) return null;
    const id = m[1];
    const rest = m[2] ?? '';
    if (!ID_RE.test(id)) return { status: 404, json: { error: 'not_found' } };
    const meta = await readMeta(root, id);
    if (!meta) return { status: 404, json: { error: 'not_found' } };
    const dir = dirOf(root, id);

    if (rest === '' && method === 'GET') return { status: 200, json: { meta } };
    if (rest === '' && method === 'DELETE') { await deleteTalk(root, id); return { status: 200, json: { ok: true } }; }
    if (rest === 'list' && method === 'PUT') {
      const b = isObj(body) ? body : {};
      const words = parseItems(b.words ?? [], 12, true);
      const sentences = parseItems(b.sentences ?? [], 8);
      if (!words || !sentences) return bad('words / sentences 要是 [{en, zh}]');
      const changed = JSON.stringify({ words, sentences }) !== JSON.stringify(meta.list);
      meta.list = { words, sentences };
      if (changed) meta.listBy = 'parent';
      meta.status = b.ready === true && words.length + sentences.length ? 'ready' : 'draft';
      await writeMeta(root, meta);
      return { status: 200, json: meta };
    }
    if (rest === 'photo' && method === 'GET') return meta.photo ? { status: 200, file: join(dir, meta.photo), contentType: 'image/jpeg', cacheControl: 'private, max-age=3600' } : { status: 404, json: { error: 'no_photo' } };
    return { status: 404, json: { error: 'not_found' } };
  };
}

/** 探针用的假读口语单(COTUTOR_TALK_FAKE_LIST=1):不看照片,0.8 秒后回一个词一句 */
const fakeReadList: typeof readList = async () => {
  await new Promise((r) => setTimeout(r, 800));
  return { ok: true, list: { words: [{ en: 'red', zh: '红色', emoji: '🔴' }], sentences: [{ en: 'It is a red car.', zh: '这是一辆红色的车。' }] }, model: 'fake', ms: 800 };
};
export const talkRoute = makeTalkRoute({ readList: process.env.COTUTOR_TALK_FAKE_LIST ? fakeReadList : readList });
