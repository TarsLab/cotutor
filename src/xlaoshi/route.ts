/**
 * /xlaoshi 与 /api/xlaoshi/*:小老师的页面与接口(《wip/小老师设想.md》)。
 * cotutor 只在 app.ts 的 route() 里接一行;这里引用 cotutor 的东西,cotutor 别处不引用这里。拆掉 = 删 src/xlaoshi/ 和那一行。
 *
 *   GET  /xlaoshi                        页面
 *   GET  /api/xlaoshi                    讲过的(新的在前)
 *   POST /api/xlaoshi                    {topic} 出一道题
 *   GET  /api/xlaoshi/<id>               一次讲课的全部
 *   PUT  /api/xlaoshi/<id>/audio         {data: dataURL} 原声(先传它)
 *   PUT  /api/xlaoshi/<id>/talk          {ms, sr, levels, segs, strokes, audio} 讲完了;浏览器那份不够就在后台叫 paraformer
 *   GET  /api/xlaoshi/<id>/audio         原声
 *   PUT  /api/xlaoshi/<id>/transcript    {lines: string[]} 家长改字
 *   POST /api/xlaoshi/<id>/transcribe    家长要 paraformer 重转
 *   PUT  /api/xlaoshi/<id>/check         {line, on} 追问前的勾
 *   POST /api/xlaoshi/<id>/asks          {q, heard, note, ms, strokes?, audio?} 一个追问的回答
 *   GET  /api/xlaoshi/<id>/asks/<n>      那个回答的录音
 *   PUT  /api/xlaoshi/<id>/memo          {memo} 家长记一句
 *   GET  /api/xlaoshi/<id>/frame.png?t=  那一刻的画面
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace } from '../cli/workspace.ts';
import type { RouteResult } from '../server/app.ts';
import { parseNotes, questions, setCheck } from './lib/notes.ts';
import { framePng } from './lib/png.ts';
import { parseStrokes, type Strokes } from './lib/strokes.ts';
import { applyEdits, fromBrowser, fromParaformer, mergeRetranscribe, needParaformer, type AsrSentence, type BrowserSeg, type TalkMeta, type Transcript } from './lib/transcript.ts';
import type { AskRecord } from './lib/timeline.ts';
import { dashscopeKey, transcribeFile } from './paraformer.ts';
import { XLAOSHI_PAGE } from './page.ts';
import { ID_RE, createSession, dirOf, ensureGuide, listSessions, readSession, regenerate, writeJson, type SessionData, type Talk } from './store.ts';

export interface XlaoshiDeps {
  /** 一个音频文件 → paraformer 的句子 */
  transcribe(file: string): Promise<AsrSentence[]>;
  /** 拿不拿得到百炼 key */
  hasKey(): boolean;
}

const DEFAULT_DEPS: XlaoshiDeps = { transcribe: (f) => transcribeFile(f), hasKey: () => dashscopeKey() !== null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (message: string): RouteResult => ({ status: 400, json: { error: 'bad_request', message } });
const MAX_MS = 60 * 60_000;
const AUDIO_EXT: Record<string, string> = { webm: 'webm', mp4: 'm4a', 'x-m4a': 'm4a', aac: 'aac', ogg: 'ogg', mpeg: 'mp3', wav: 'wav' };
const AUDIO_TYPE: Record<string, string> = { webm: 'audio/webm', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };
const AUDIO_B64_MAX = 5_800_000;

function audioOf(data: unknown): { ext: string; buf: Buffer } | null {
  if (typeof data !== 'string') return null;
  const m = /^data:audio\/([a-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(data);
  const ext = m ? AUDIO_EXT[m[1]] : undefined;
  if (!m || !ext || m[2].length > AUDIO_B64_MAX) return null;
  return { ext, buf: Buffer.from(m[2], 'base64') };
}

function parseSegs(v: unknown): BrowserSeg[] | null {
  if (!Array.isArray(v) || v.length > 2000) return null;
  const out: BrowserSeg[] = [];
  for (const s of v as unknown[]) {
    if (!isObj(s) || typeof s.at !== 'number' || typeof s.end !== 'number' || typeof s.text !== 'string' || !(s.at >= 0) || s.at > MAX_MS || !(s.end >= 0) || s.end > MAX_MS || s.text.length > 1000) return null;
    out.push({ at: Math.round(s.at), end: Math.round(Math.max(s.at, s.end)), text: s.text });
  }
  return out;
}

function parseTalk(v: unknown): (TalkMeta & { strokes: Strokes; audio: string | null }) | null {
  if (!isObj(v) || typeof v.ms !== 'number' || !(v.ms >= 0) || v.ms > MAX_MS || typeof v.sr !== 'boolean' || !Array.isArray(v.levels) || v.levels.length > 36_000) return null;
  const levels = (v.levels as unknown[]).map((x) => (typeof x === 'number' && x >= 0 && x <= 100 ? Math.round(x) : -1));
  if (levels.some((x) => x < 0)) return null;
  const segs = parseSegs(v.segs);
  const strokes = parseStrokes(v.strokes);
  const audio = v.audio === null || v.audio === undefined ? null : typeof v.audio === 'string' && /^audio\.[a-z0-9]{2,4}$/.test(v.audio) ? v.audio : undefined;
  if (!segs || !strokes || audio === undefined) return null;
  return { ms: Math.round(v.ms), sr: v.sr, levels, segs, strokes, audio };
}

/** 后台的补转:一次讲课同时只跑一个;测试等它们跑完 */
const running = new Map<string, Promise<void>>();
export async function xlaoshiIdle(): Promise<void> {
  while (running.size) await Promise.all([...running.values()]);
}

async function saveTalk(wsRoot: string, id: string, patch: Partial<Talk>): Promise<void> {
  const d = await readSession(wsRoot, id);
  if (!d?.talk) return;
  await writeJson(join(dirOf(wsRoot, id), 'talk.json'), { ...d.talk, ...patch });
}

/** 叫 paraformer:没 key → nokey;跑完把句子并进转写(家长改过的行留着),重生成时间线 */
async function kick(wsRoot: string, id: string, why: string, deps: XlaoshiDeps): Promise<'started' | 'nokey' | 'busy' | 'noaudio'> {
  const key = `${wsRoot}\0${id}`;
  if (running.has(key)) return 'busy';
  const d = await readSession(wsRoot, id);
  if (!d?.talk?.audio || !existsSync(join(dirOf(wsRoot, id), d.talk.audio))) return 'noaudio';
  if (!deps.hasKey()) {
    await saveTalk(wsRoot, id, { asr: { state: 'nokey', why } });
    return 'nokey';
  }
  await saveTalk(wsRoot, id, { asr: { state: 'running', why } });
  const file = join(dirOf(wsRoot, id), d.talk.audio);
  const job = (async () => {
    try {
      const fresh = fromParaformer(await deps.transcribe(file));
      const cur = (await readSession(wsRoot, id))?.transcript ?? null;
      if (fresh.length === 0 && cur && cur.lines.length) {
        await saveTalk(wsRoot, id, { asr: { state: 'done', why, error: 'paraformer 没认出字,留着浏览器那份' } });
      } else {
        const tr: Transcript = { source: 'paraformer', why, lines: mergeRetranscribe(cur?.lines ?? [], fresh) };
        await writeJson(join(dirOf(wsRoot, id), 'transcript.json'), tr);
        await saveTalk(wsRoot, id, { asr: { state: 'done', why, source: 'paraformer' } });
      }
      await regenerate(wsRoot, id);
    } catch (e) {
      await saveTalk(wsRoot, id, { asr: { state: 'failed', why, error: e instanceof Error ? e.message : String(e) } });
    } finally {
      running.delete(key);
    }
  })();
  running.set(key, job);
  return 'started';
}

/** 补一条追问回答的字:转完写回 asks.json 那一条(heardBy: paraformer),失败就留空 */
function hearAsk(wsRoot: string, id: string, k: number, deps: XlaoshiDeps): void {
  const key = `${wsRoot}\0${id}\0ask${k}`;
  if (running.has(key)) return;
  const job = (async () => {
    try {
      const d = await readSession(wsRoot, id);
      const a = d?.asks[k - 1];
      if (!a?.audio) return;
      const text = fromParaformer(await deps.transcribe(join(dirOf(wsRoot, id), a.audio))).map((l) => l.text).join('');
      if (!text) return;
      const cur = (await readSession(wsRoot, id))?.asks ?? [];
      if (!cur[k - 1] || cur[k - 1].heard.trim()) return;
      cur[k - 1] = { ...cur[k - 1], heard: text, heardBy: 'paraformer' };
      await writeJson(join(dirOf(wsRoot, id), 'asks.json'), cur);
      await regenerate(wsRoot, id);
    } catch {
      // 补不上就留空:timeline.md 里写「没认出字,听录音」
    } finally {
      running.delete(key);
    }
  })();
  running.set(key, job);
}

/** 列表那一行:走到哪一步 */
function summary(d: SessionData): Record<string, unknown> {
  const qs = d.notes ? questions(parseNotes(d.notes)) : [];
  return {
    id: d.session.id,
    topic: d.session.topic,
    createdAt: d.session.createdAt,
    memo: d.session.memo ?? null,
    ms: d.talk?.ms ?? null,
    strokes: d.strokes ? d.strokes.strokes.filter((s) => s.c !== 'erase').length : 0,
    transcript: d.transcript ? { source: d.transcript.source, edited: d.transcript.lines.filter((l) => l.edited).length, lines: d.transcript.lines.length } : null,
    asr: d.talk?.asr ?? null,
    notes: d.notes !== null,
    questions: qs.filter((q) => q.checked).length,
    asks: d.asks.length,
  };
}

function full(d: SessionData, hasKey: boolean): Record<string, unknown> {
  const parsed = d.notes ? parseNotes(d.notes) : null;
  return {
    ...summary(d),
    hasKey,
    talk: d.talk,
    strokesData: d.strokes,
    lines: d.transcript?.lines ?? [],
    why: d.transcript?.why ?? null,
    notesParsed: parsed,
    asksData: d.asks.map((a) => ({ ...a, strokes: undefined, drew: a.strokes ? a.strokes.strokes.length : 0 })),
  };
}

export async function xlaoshiRoute(method: string, url: URL, ctx: { ws: Workspace; now: () => Date }, body: unknown, deps: XlaoshiDeps = DEFAULT_DEPS): Promise<RouteResult | null> {
  const p = url.pathname;
  if (p === '/xlaoshi' || p === '/xlaoshi/') return method === 'GET' ? { status: 200, html: XLAOSHI_PAGE } : { status: 405, json: { error: 'method_not_allowed' } };
  if (p !== '/api/xlaoshi' && !p.startsWith('/api/xlaoshi/')) return null;
  const root = ctx.ws.root;

  if (p === '/api/xlaoshi') {
    if (method === 'GET') {
      await ensureGuide(root);
      return { status: 200, json: { sessions: (await listSessions(root)).map(summary), hasKey: deps.hasKey() } };
    }
    if (method === 'POST') {
      const topic = isObj(body) && typeof body.topic === 'string' ? body.topic.trim() : '';
      if (!topic || topic.length > 300) return bad('题目要有,300 字以内');
      await ensureGuide(root);
      const s = await createSession(root, topic, ctx.now());
      return { status: 201, json: { id: s.id } };
    }
    return { status: 405, json: { error: 'method_not_allowed' } };
  }

  const m = /^\/api\/xlaoshi\/([^/]+)(?:\/([a-z.]+)(?:\/(\d{1,3}))?)?$/.exec(p);
  if (!m || !ID_RE.test(m[1])) return { status: 404, json: { error: 'not_found' } };
  const [, id, sub, n] = m;
  const dir = dirOf(root, id);
  const d = await readSession(root, id);
  if (!d) return { status: 404, json: { error: 'no_such_session' } };

  if (!sub) return method === 'GET' ? { status: 200, json: full(d, deps.hasKey()) } : { status: 405, json: { error: 'method_not_allowed' } };

  if (sub === 'audio') {
    if (method === 'GET') {
      if (!d.talk?.audio || !existsSync(join(dir, d.talk.audio))) return { status: 404, json: { error: 'no_audio' } };
      const ext = d.talk.audio.split('.').pop() ?? '';
      return { status: 200, file: join(dir, d.talk.audio), contentType: AUDIO_TYPE[ext] ?? 'application/octet-stream', cacheControl: 'no-cache' };
    }
    if (method === 'PUT') {
      if (d.talk) return { status: 409, json: { error: 'talked', message: '这道题已经讲过了' } };
      const a = isObj(body) ? audioOf(body.data) : null;
      if (!a) return bad('原声要是 data:audio/…;base64,…,不超过约 4MB');
      for (const f of await readdir(dir)) if (/^audio\./.test(f)) await rm(join(dir, f), { force: true });
      const name = `audio.${a.ext}`;
      await writeFile(join(dir, name), a.buf);
      return { status: 200, json: { audio: name } };
    }
  }

  if (sub === 'talk' && method === 'PUT') {
    if (d.talk) return { status: 409, json: { error: 'talked', message: '这道题已经讲过了' } };
    const t = parseTalk(body);
    if (!t) return bad('讲课的数据形状不对');
    if (t.audio && !existsSync(join(dir, t.audio))) return bad('原声还没传上来');
    const need = needParaformer(t);
    const talk: Talk = { startedAt: new Date(ctx.now().getTime() - t.ms).toISOString(), ms: t.ms, sr: t.sr, levels: t.levels, segs: t.segs, audio: t.audio, asr: { state: 'none', ...(need.need ? { why: need.why } : {}) } };
    await writeJson(join(dir, 'strokes.json'), t.strokes);
    await writeJson(join(dir, 'talk.json'), talk);
    const lines = fromBrowser(t.segs);
    if (lines.length) await writeJson(join(dir, 'transcript.json'), { source: 'browser', lines } satisfies Transcript);
    await regenerate(root, id);
    const asr = need.need && t.audio ? await kick(root, id, need.why, deps) : null;
    return { status: 200, json: { ok: true, need: need.need, why: need.why || null, asr } };
  }

  if (sub === 'transcript' && method === 'PUT') {
    if (!d.transcript) return { status: 409, json: { error: 'no_transcript' } };
    const lines = isObj(body) && Array.isArray(body.lines) && body.lines.every((x) => typeof x === 'string' && x.length <= 1000) ? (body.lines as string[]) : null;
    const next = lines ? applyEdits(d.transcript.lines, lines) : null;
    if (!next) return bad('要和现在的转写一样多行');
    await writeJson(join(dir, 'transcript.json'), { ...d.transcript, lines: next });
    await regenerate(root, id);
    return { status: 200, json: { ok: true, lines: next } };
  }

  if (sub === 'transcribe' && method === 'POST') {
    const r = await kick(root, id, '家长重转', deps);
    if (r === 'busy') return { status: 409, json: { error: 'busy', message: '正在转' } };
    if (r === 'noaudio') return { status: 409, json: { error: 'no_audio', message: '没有原声' } };
    if (r === 'nokey') return { status: 400, json: { error: 'nokey', message: '拿不到百炼 key(DASHSCOPE_API_KEY,或本机 qwen / voxtell 的配置)' } };
    return { status: 202, json: { ok: true } };
  }

  if (sub === 'check' && method === 'PUT') {
    if (d.notes === null) return { status: 409, json: { error: 'no_notes' } };
    if (!isObj(body) || typeof body.line !== 'number' || typeof body.on !== 'boolean') return bad('要 {line, on}');
    const next = setCheck(d.notes, body.line, body.on);
    if (next === null) return bad('那一行不是一条追问');
    await writeFile(join(dir, 'notes.md'), next);
    return { status: 200, json: { ok: true, notesParsed: parseNotes(next) } };
  }

  if (sub === 'asks') {
    if (method === 'GET' && n !== undefined) {
      const a = d.asks[Number(n) - 1];
      if (!a?.audio || !existsSync(join(dir, a.audio))) return { status: 404, json: { error: 'no_audio' } };
      return { status: 200, file: join(dir, a.audio), contentType: AUDIO_TYPE[a.audio.split('.').pop() ?? ''] ?? 'application/octet-stream', cacheControl: 'no-cache' };
    }
    if (method === 'POST' && n === undefined) {
      if (!isObj(body) || typeof body.q !== 'string' || !body.q.trim() || body.q.length > 500 || typeof body.heard !== 'string' || body.heard.length > 4000 || typeof body.note !== 'string' || body.note.length > 1000 || typeof body.ms !== 'number' || !(body.ms >= 0) || body.ms > MAX_MS) return bad('要 {q, heard, note, ms}');
      const strokes = body.strokes === undefined || body.strokes === null ? undefined : parseStrokes(body.strokes);
      if (strokes === null) return bad('笔迹形状不对');
      const k = d.asks.length + 1;
      let audio: string | undefined;
      if (body.audio !== undefined && body.audio !== null) {
        const a = audioOf(body.audio);
        if (!a) return bad('录音要是 data:audio/…;base64,…');
        await mkdir(join(dir, 'asks'), { recursive: true });
        audio = `asks/${k}.${a.ext}`;
        await writeFile(join(dir, audio), a.buf);
      }
      const rec: AskRecord = { q: body.q.trim(), at: ctx.now().toISOString(), ms: Math.round(body.ms), heard: body.heard, note: body.note, ...(audio ? { audio } : {}), ...(strokes ? { strokes } : {}) };
      await writeJson(join(dir, 'asks.json'), [...d.asks, rec]);
      await regenerate(root, id);
      // 浏览器没认出字:照拍板 7 叫 paraformer 补这一条(后台,拿不到 key 就算了)
      if (audio && !rec.heard.trim() && deps.hasKey()) hearAsk(root, id, k, deps);
      return { status: 201, json: { ok: true, n: k } };
    }
  }

  if (sub === 'memo' && method === 'PUT') {
    if (!isObj(body) || typeof body.memo !== 'string' || body.memo.length > 500) return bad('要 {memo},500 字以内');
    const memo = body.memo.trim();
    const { memo: _old, ...rest } = d.session;
    await writeJson(join(dir, 'session.json'), memo ? { ...rest, memo } : rest);
    return { status: 200, json: { ok: true } };
  }

  if (sub === 'frame.png' && method === 'GET') {
    if (!d.strokes) return { status: 404, json: { error: 'no_strokes' } };
    const t = Number(url.searchParams.get('t') ?? Number.MAX_SAFE_INTEGER);
    const w = Math.min(1600, Math.max(80, Number(url.searchParams.get('w') ?? 480) || 480));
    return { status: 200, body: framePng(d.strokes, Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER, w), contentType: 'image/png' };
  }

  return { status: 405, json: { error: 'method_not_allowed' } };
}

/** 给测试:读一个文件(不存在 null) */
export async function readXlaoshiFile(wsRoot: string, id: string, rel: string): Promise<string | null> {
  return readFile(join(dirOf(wsRoot, id), rel), 'utf8').catch(() => null);
}
