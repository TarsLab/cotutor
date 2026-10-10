/**
 * /talk 与 /api/talk/*:口语课的页面与接口(《wip/口语课设想.md》)。
 * cotutor 只在 app.ts 的 route() 里接一行、serve.ts 的 upgrade 里接一行;这里引用 cotutor 的东西,cotutor 别处不引用这里。拆掉 = 删 src/talk/ 和那两行。
 *
 *   GET    /talk                       页面(家长与孩子同一页,按 hash 切)
 *   GET    /api/talk                   开关、有没有 key、设置、全部口语课(新的在前)
 *   POST   /api/talk                   {photo?: dataURL} 开一次;有照片就交给 omni 读口语单
 *   GET    /api/talk/<id>              一次的全部(口语单、通话的字、有没有声音)
 *   PUT    /api/talk/<id>/list         {words, sentences, ready?} 家长改口语单;ready = 给孩子
 *   DELETE /api/talk/<id>
 *   GET    /api/talk/<id>/photo        那页照片
 *   GET    /api/talk/<id>/audio/<who>  kid / tutor 的声音(wav)
 *   WS     /api/talk/<id>/ws           通话(serve 的 upgrade 交给 talkUpgrade)
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { join } from 'node:path';
import type { AppContext, RouteResult } from '../server/app.ts';
import type { ListItem } from './lib/used.ts';
import { readList } from './list.ts';
import { TALK_PAGE } from './page.ts';
import { dashscopeAuth } from './realtime.ts';
import { TalkCall } from './relay.ts';
import { ID_RE, createTalk, deleteTalk, dirOf, listTalks, readMeta, readTalk, writeMeta } from './store.ts';
import { acceptWebSocket, isUpgrade } from './ws.ts';

export interface TalkDeps {
  /** 照片 → 口语单(测试换假的) */
  readList: typeof readList;
  /** realtime 端点(测试换假的);不给用真的 */
  endpoint?: string;
  env?: NodeJS.ProcessEnv;
  onFinished?(id: string, why: string): void;
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

/** 家长改的口语单:两组各最多 12 / 8 条,去空去重 */
export function parseItems(v: unknown, max: number): ListItem[] | null {
  if (!Array.isArray(v) || v.length > 50) return null;
  const out: ListItem[] = [];
  for (const x of v as unknown[]) {
    if (!isObj(x) || typeof x.en !== 'string') return null;
    const en = x.en.replace(/\s+/g, ' ').trim();
    const zh = typeof x.zh === 'string' ? x.zh.replace(/\s+/g, ' ').trim() : '';
    if (!en || en.length > 120 || zh.length > 120) continue;
    if (out.some((o) => o.en.toLowerCase() === en.toLowerCase())) continue;
    out.push({ en, zh });
    if (out.length >= max) break;
  }
  return out;
}

export function makeTalkRoute(deps: TalkDeps = { readList }) {
  return async function talkRoute(method: string, url: URL, ctx: AppContext, body: unknown): Promise<RouteResult | null> {
    const p = url.pathname;
    if (p === '/talk' || p === '/talk/') return method === 'GET' ? { status: 200, html: TALK_PAGE } : { status: 405, json: { error: 'method_not_allowed' } };
    if (p !== '/api/talk' && !p.startsWith('/api/talk/')) return null;
    const ws = ctx.ws;
    const cfg = ws.config.talk;
    const root = ws.root;
    const env = deps.env ?? process.env;

    if (p === '/api/talk') {
      if (method === 'GET') return { status: 200, json: { enabled: cfg.enabled, auth: Boolean(deps.endpoint) || dashscopeAuth(env) !== null, voice: cfg.voice, minutes: cfg.minutes, interrupt: cfg.interrupt, model: cfg.model, kid: ws.config.kid.name ?? '', talks: await listTalks(root) } };
      if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
      if (!cfg.enabled) return { status: 404, json: { error: 'talk_disabled', message: 'cotutor.json 的 talk.enabled 还是 false' } };
      const b = isObj(body) ? body : {};
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

    if (rest === '' && method === 'GET') return { status: 200, json: await readTalk(root, id) };
    if (rest === '' && method === 'DELETE') { await deleteTalk(root, id); return { status: 200, json: { ok: true } }; }
    if (rest === 'list' && method === 'PUT') {
      const b = isObj(body) ? body : {};
      const words = parseItems(b.words ?? [], 12);
      const sentences = parseItems(b.sentences ?? [], 8);
      if (!words || !sentences) return bad('words / sentences 要是 [{en, zh}]');
      const changed = JSON.stringify({ words, sentences }) !== JSON.stringify(meta.list);
      meta.list = { words, sentences };
      if (changed) meta.listBy = 'parent';
      if (b.ready === true) meta.status = words.length + sentences.length ? 'ready' : 'draft';
      else if (meta.status !== 'done') meta.status = 'draft';
      await writeMeta(root, meta);
      return { status: 200, json: meta };
    }
    if (rest === 'photo' && method === 'GET') return meta.photo ? { status: 200, file: join(dir, meta.photo), contentType: 'image/jpeg', cacheControl: 'private, max-age=3600' } : { status: 404, json: { error: 'no_photo' } };
    const a = /^audio\/(kid|tutor)$/.exec(rest);
    if (a && method === 'GET') return { status: 200, file: join(dir, `${a[1]}.wav`), contentType: 'audio/wav', cacheControl: 'no-cache' };
    if (rest === 'ws') return { status: 426, json: { error: 'upgrade_required' } };
    return { status: 404, json: { error: 'not_found' } };
  };
}

/** serve 的 upgrade:/api/talk/<id>/ws 交给这里;不是它的回 false(调用方把 socket 销掉) */
export function makeTalkUpgrade(deps: TalkDeps = { readList }) {
  return async function talkUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, ctx: AppContext): Promise<boolean> {
    const m = /^\/api\/talk\/([^/?]+)\/ws(?:\?.*)?$/.exec(req.url ?? '');
    if (!m || !isUpgrade(req)) return false;
    const id = m[1];
    const ws = ctx.ws;
    const cfg = ws.config.talk;
    const refuse = (status: number, why: string): boolean => { socket.end(`HTTP/1.1 ${status} ${why}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return true; };
    if (!cfg.enabled) return refuse(404, 'talk disabled');
    if (!ID_RE.test(id)) return refuse(404, 'not found');
    const meta = await readMeta(ws.root, id);
    if (!meta) return refuse(404, 'not found');
    let call: TalkCall | null = null;
    const sock = acceptWebSocket(req, socket, head, {
      onText: (t) => call?.onText(t),
      onBinary: (b) => call?.onAudio(b),
      onClose: () => call?.onSocketClose(),
    });
    call = new TalkCall(meta, sock, { root: ws.root, config: cfg, kidName: ws.config.kid.name ?? '', env: deps.env, endpoint: deps.endpoint, now: ctx.now, onFinished: (why) => deps.onFinished?.(id, why) });
    void call.start();
    return true;
  };
}

/** 探针用:COTUTOR_TALK_ENDPOINT 指向假 realtime(tests/_fake-realtime.ts),不花钱 */
const PROBE_DEPS: TalkDeps = { readList, ...(process.env.COTUTOR_TALK_ENDPOINT ? { endpoint: process.env.COTUTOR_TALK_ENDPOINT, env: { ...process.env, DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY ?? 'sk-probe' } } : {}) };
export const talkRoute = makeTalkRoute(PROBE_DEPS);
export const talkUpgrade = makeTalkUpgrade(PROBE_DEPS);
