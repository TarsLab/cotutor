/**
 * 服务的路由层:route(method, path, ctx, body) → {status, json|html},测试不用起端口。
 * R1 的查询接口照旧;R2 加:对话(列日期、看一天的家长视图、发消息)、cotutor.json 补丁(老师团页)、家长页 /parent。
 * R3 加:孩子端 `/`(KID_PAGE)与 /api/kid/*(首页:课程表 + 老师 + 今天的产物叠;对话:服务端过滤后的孩子视图;发消息:from 固定 kid、每日上限 429)、配音文件 /api/audio。
 * 配置热重载:每个请求先看 cotutor.json 的 mtime,改了就重读;改坏了留旧配置并把错误挂在 /api/health 上。
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { foldRuns, type TranscriptRow } from '../lib/transcript.ts';
import { RuntimeError } from '../lib/run-plan.ts';
import { localDate } from '../lib/conversation.ts';
import { kidConversation, kidMessageCount, type KidMessage } from '../lib/kid-view.ts';
import { mergeArtifacts, parseArtifactEvents } from '../lib/ledger.ts';
import { currentSlot, dayOf, parseTimetable, slotLabel } from '../lib/timetable.ts';
import { DATE_RE, FocusSchema, MESSAGE_FROM, listTutors, resolvePolicy, type Artifact, type ConversationIndex, type TimetableEntry } from '../schema/index.ts';
import { ConfigError, UsageError, redactHome, workspaceReport, type Workspace } from '../cli/workspace.ts';
import { tutorStatuses } from '../cli/tutors.ts';
import { configGapsOf, upgradeConfig } from '../cli/migrate.ts';
import { KID_PAGE } from './kid-page.ts';
import { PARENT_PAGE } from './parent-page.ts';
import { BusyError, Runner } from './runner.ts';
import { IndexError, listDates, patchConfig, readErrLog, readIndex, readTranscript, reloadIfChanged, scanCards, writeCardImage, writeCardState } from './store.ts';
import { IMAGE_EXT, parseCardState, stripSecrets } from '../cards/index.ts';
import { resolve, sep } from 'node:path';
import { bundleAsset, stageAsset } from './stage.ts';
import { enrichScenes } from './scene-props.ts';
import { addTutorFile, readTutorFile, removeTutorFile, writeTutorFile } from '../cli/tutors.ts';

export interface RouteResult {
  status: number;
  json?: unknown;
  html?: string;
  /** 静态文件(配音);handler 流式发 */
  file?: string;
  contentType?: string;
}

export interface AppContext {
  ws: Workspace;
  runner: Runner;
  /** 当前时间(测试可注入;孩子端「今天」与 today 别名都按它) */
  now: () => Date;
  /** 上次重载失败的原因(配置改坏了),健康接口回报 */
  configError: string | null;
  /** 重读 cotutor.json(改了才读) */
  reload(): Promise<void>;
}

export function createContext(ws: Workspace, opts: { now?: () => Date; env?: NodeJS.ProcessEnv } = {}): AppContext {
  let mtime = -1;
  const ctx: AppContext = {
    ws,
    runner: new Runner(() => ctx.ws, opts),
    now: opts.now ?? (() => new Date()),
    configError: null,
    async reload() {
      try {
        const r = await reloadIfChanged(ctx.ws, mtime);
        ctx.ws = r.ws;
        mtime = r.mtime;
        ctx.configError = null;
      } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        ctx.configError = err.message;
      }
    },
  };
  return ctx;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** 一天的家长视图:索引 + 每条消息的转录行(主线 + 子代理折叠)+ 出错时的 err.log 尾巴 */
export interface DayView {
  index: ConversationIndex;
  running: string | null;
  runs: Record<string, TranscriptRow[]>;
  errors: Record<string, string>;
}

export async function dayView(ctx: AppContext, tutor: string, date: string): Promise<DayView> {
  const index = await readIndex(ctx.ws, tutor, date);
  const runs: Record<string, TranscriptRow[]> = {};
  const errors: Record<string, string> = {};
  for (const m of index.messages) {
    const t = await readTranscript(ctx.ws, tutor, date, m.job);
    runs[m.job] = t ? foldRuns(t.items) : [];
    if (m.result === 'error') {
      const tail = (await readErrLog(ctx.ws, tutor, date, m.job)).trim().split('\n').slice(-5).join('\n');
      if (tail) errors[m.job] = tail;
    }
  }
  const active = ctx.runner.running(tutor);
  return { index, running: active && active.date === date ? active.job : null, runs, errors };
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** 孩子端看到的老师:enabled 且不 hidden;每日上限用完 available = false(头像灰) */
export interface KidTutor {
  name: string;
  display: string;
  avatar: string | null;
  subject: string | null;
  hasVoice: boolean;
  remaining: number;
  available: boolean;
}

export async function kidTutors(ctx: AppContext, date: string): Promise<KidTutor[]> {
  const out: KidTutor[] = [];
  for (const t of listTutors(ctx.ws.config, { kidOnly: true })) {
    const used = kidMessageCount(await readIndex(ctx.ws, t.name, date));
    const remaining = Math.max(0, t.policy.dailyMessages - used);
    out.push({ name: t.name, display: t.display, avatar: t.avatar ?? null, subject: t.subject ?? null, hasVoice: Boolean(t.voice), remaining, available: remaining > 0 });
  }
  return out;
}

export interface KidHome {
  title: string;
  date: string;
  /** 1–7 */
  day: number;
  timetable: TimetableEntry[];
  slot: string | null;
  tutors: KidTutor[];
  /** 今天的产物,按学科(老师的 subject)分叠;验收开关开着的老师只给 accepted 的 */
  stacks: { subject: string; tutor: string | null; items: Artifact[] }[];
}

export async function kidHome(ctx: AppContext, now: Date): Promise<KidHome> {
  const ws = ctx.ws;
  const date = localDate(now);
  let timetable: TimetableEntry[] = [];
  try {
    timetable = parseTimetable(await readFile(ws.paths.timetable, 'utf8')).entries;
  } catch {
    /* 没课程表:今天照画 */
  }
  const slot = currentSlot(timetable, now);
  let artifacts: Artifact[] = [];
  try {
    artifacts = mergeArtifacts(parseArtifactEvents(await readFile(ws.files.artifacts, 'utf8')).rows).artifacts;
  } catch {
    /* 账本还没有 */
  }
  const bySubject = new Map<string, { subject: string; tutor: string | null; items: Artifact[] }>();
  for (const a of artifacts) {
    if (!a.at.startsWith(date) || a.status === 'draft' || a.status === 'retired') continue;
    const tutor = ws.config.tutors[a.by];
    if (tutor && resolvePolicy(ws.config, a.by).reviewGate && a.status !== 'accepted') continue;
    const subject = tutor?.subject ?? tutor?.display ?? a.by;
    const stack = bySubject.get(subject) ?? { subject, tutor: tutor ? a.by : null, items: [] };
    stack.items.push(a);
    bySubject.set(subject, stack);
  }
  return { title: ws.config.title, date, day: dayOf(now), timetable, slot: slot ? slotLabel(slot) : null, tutors: await kidTutors(ctx, date), stacks: [...bySubject.values()] };
}

export interface KidDay {
  tutor: string;
  date: string;
  messages: KidMessage[];
  remaining: number;
  /** 老师正在回的那条 job */
  pending: string | null;
}

export async function kidDay(ctx: AppContext, tutor: string, date: string): Promise<KidDay> {
  const index = await readIndex(ctx.ws, tutor, date);
  const policy = resolvePolicy(ctx.ws.config, tutor);
  const active = ctx.runner.running(tutor);
  const { states, assets } = await scanCards(ctx.ws, tutor, date);
  const messages = kidConversation(index, states, assets);
  // 流式:正在回的那条带上已经出来的板书(partial),卡随围栏闭合逐张出现;答案照样剥
  const partial = active && active.date === date ? ctx.runner.partial(tutor) : null;
  if (partial) {
    const m = messages.find((x) => x.job === active!.job);
    if (m) m.section = stripSecrets(partial);
  }
  // 场景卡:课包在不在、题面、步数、缩略图,每次现读(课包落地卡就变成可播)
  const sceneDirs = { bundles: ctx.ws.dirs.bundles, snaps: ctx.ws.dirs.snaps, thumbBase: 'snaps' };
  for (const m of messages) if (m.section) m.section = await enrichScenes(sceneDirs, m.section);
  return { tutor, date, messages, remaining: Math.max(0, policy.dailyMessages - kidMessageCount(index)), pending: active && active.date === date ? active.job : null };
}

/** <日期>.<job>.mp3(整段)/ .<n>.mp3(讲稿第 n 句)/ .cards/<n>/<k>.mp3(第 n 张卡的第 k 个资产) */
const AUDIO_FILE_RE = /^\d{4}-\d{2}-\d{2}\.\d{4}-\d+(?:\.\d+|\.cards\/\d+\/\d+)?\.mp3$/;
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

export async function route(method: string, path: string, ctx: AppContext, body?: unknown): Promise<RouteResult> {
  await ctx.reload();
  const ws = ctx.ws;
  const url = new URL(path, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/health') return { status: 200, json: { ok: true, configError: ctx.configError } };
    if (p === '/api/workspace' && method === 'GET') return { status: 200, json: workspaceReport(ws) };
    if (p === '/api/config') {
      if (method === 'GET') {
        return {
          status: 200,
          json: {
            title: ws.config.title,
            kid: ws.config.kid,
            server: ws.config.server,
            runtime: ws.config.runtimes.default,
            runtimes: Object.keys(ws.config.runtimes).filter((k) => k !== 'default'),
            policyDefaults: ws.config.policyDefaults,
            paths: ws.config.paths,
            resolvedPaths: Object.fromEntries(Object.entries(ws.paths).map(([k, v]) => [k, redactHome(v)])),
            tts: ws.config.tts,
            https: ws.config.server.https ?? null,
            shipped: (await tutorStatuses(ws.root)).map((s) => s.name),
            /** 老 workspace 的政策文件缺的出厂件(新老师 / 新运行时 / 模板里的新旗标);设置页据此提示一行 */
            migrate: await configGapsOf(ws.root),
            tutors: listTutors(ws.config),
            /** 老师条目的原始政策补丁(页面区分「继承」与「覆盖」) */
            tutorPatches: Object.fromEntries(Object.entries(ws.config.tutors).map(([k, t]) => [k, t.policy ?? {}])),
          },
        };
      }
      if (method === 'PATCH') {
        if (!isObj(body)) return { status: 400, json: { error: 'bad_request', message: '要一个 JSON 对象' } };
        await patchConfig(ws, body);
        await ctx.reload();
        return { status: 200, json: { ok: true, tutors: listTutors(ctx.ws.config), runtime: ctx.ws.config.runtimes.default } };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }
    // 政策文件补缺(与 cotutor upgrade --config 同一条路):只加缺的出厂件,家长写过的值不动
    if (p === '/api/config/migrate' && method === 'POST') {
      const r = await upgradeConfig(ws.root);
      await ctx.reload();
      return { status: 200, json: { ok: true, gaps: r.gaps, applied: r.applied, installed: r.installed } };
    }
    if (p === '/api/tutors' && method === 'GET') {
      return { status: 200, json: listTutors(ws.config, { kidOnly: url.searchParams.get('kid') === '1' }) };
    }
    // ---- 加老师 / 老师文件 / 删老师:与 cotutor add 同一条路 ----
    if (p === '/api/tutors' && method === 'POST') {
      if (!isObj(body) || typeof body.name !== 'string' || typeof body.display !== 'string' || !body.display.trim()) return { status: 400, json: { error: 'bad_request', message: '要 {name, display, subject?, avatar?, hidden?, description?}' } };
      const name = body.name.trim();
      if (ws.config.tutors[name]) return { status: 409, json: { error: 'exists', message: `cotutor.json 里已经有 ${name}` } };
      const str = (k: string): string | undefined => (typeof body[k] === 'string' && (body[k] as string).trim() ? (body[k] as string).trim() : undefined);
      const r = await addTutorFile(ws.root, { name, display: body.display.trim(), subject: str('subject'), description: str('description') });
      await patchConfig(ws, { tutors: { [name]: { display: body.display.trim(), ...(str('subject') ? { subject: str('subject') } : {}), ...(str('avatar') ? { avatar: str('avatar') } : {}), enabled: true, ...(body.hidden === true ? { hidden: true } : {}) } } });
      await ctx.reload();
      return { status: 201, json: { ok: true, ...r, tutors: listTutors(ctx.ws.config) } };
    }
    const tf = /^\/api\/tutors\/([a-z0-9][a-z0-9-]*)(\/file)?$/.exec(p);
    if (tf) {
      const [, name, isFile] = tf;
      if (!ws.config.tutors[name]) return { status: 404, json: { error: 'no_such_tutor', tutor: name } };
      if (isFile && method === 'GET') return { status: 200, json: await readTutorFile(ws.root, name) };
      if (isFile && method === 'PUT') {
        if (!isObj(body) || typeof body.text !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 {text}' } };
        return { status: 200, json: await writeTutorFile(ws.root, name, body.text) };
      }
      if (!isFile && method === 'DELETE') {
        const r = await removeTutorFile(ws.root, name);
        await patchConfig(ws, { tutors: { [name]: null } });
        await ctx.reload();
        return { status: 200, json: { ok: true, ...r, tutors: listTutors(ctx.ws.config) } };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }

    // ---- 孩子端:过滤在服务端做,永远不带工具 / 错误 / 评判 ----
    if (p === '/api/kid/home' && method === 'GET') return { status: 200, json: await kidHome(ctx, ctx.now()) };
    const kid = /^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|messages)$/.exec(p);
    if (kid) {
      const [, tutor, tail] = kid;
      const t = ws.config.tutors[tutor];
      if (!t || !t.enabled || t.hidden) return { status: 404, json: { error: 'no_such_tutor' } };
      const date = localDate(ctx.now());
      if (tail === 'today' && method === 'GET') return { status: 200, json: await kidDay(ctx, tutor, date) };
      if (tail === 'messages' && method === 'POST') {
        if (!isObj(body) || typeof body.text !== 'string') return { status: 400, json: { error: 'bad_request' } };
        const focus = body.focus === undefined ? undefined : FocusSchema.safeParse(body.focus);
        if (focus && !focus.success) return { status: 400, json: { error: 'bad_request' } };
        const action = body.action === undefined ? undefined : body.action === 'continue' || body.action === 'submit' ? body.action : null;
        if (action === null) return { status: 400, json: { error: 'bad_request' } };
        if (!body.text.trim() && !action) return { status: 400, json: { error: 'bad_request' } };
        const policy = resolvePolicy(ws.config, tutor);
        // 「继续」不计每日上限:到了上限也能把老师讲完的听完
        if (action !== 'continue' && kidMessageCount(await readIndex(ws, tutor, date)) >= policy.dailyMessages) return { status: 429, json: { error: 'limit', remaining: 0 } };
        const started = await ctx.runner.send(tutor, { from: 'kid', text: body.text, focus: focus?.data, action });
        return { status: 202, json: { tutor, date: started.date, job: started.job } };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }
    // 卡的状态:孩子在舞台里选了、填了 → 存 <日期>.<job>.cards/<n>.json,不起老师;下一条消息带给老师
    const card = /^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/cards\/(\d{4}-\d+)\/(\d+)$/.exec(p);
    if (card) {
      const [, tutor, job, nStr] = card;
      const t = ws.config.tutors[tutor];
      if (!t || !t.enabled || t.hidden) return { status: 404, json: { error: 'no_such_tutor' } };
      if (method !== 'PUT') return { status: 405, json: { error: 'method_not_allowed' } };
      const date = localDate(ctx.now());
      const index = await readIndex(ws, tutor, date);
      const msg = index.messages.find((m) => m.job === job);
      const n = Number(nStr);
      const target = msg?.result === 'ok' ? msg.section?.cards[n] : undefined;
      if (!target) return { status: 404, json: { error: 'no_such_card' } };
      // 画板:body 里可以带 image(data:image/png;base64,…),存成 .cards/<n>.png,状态里只留路径(相对 workspace 根,老师 Read 看)
      let state = body;
      if (target.kind === 'canvas' && isObj(body) && typeof body.image === 'string') {
        const { image, ...rest } = body;
        const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image);
        if (!m || m[1].length > 8_000_000) return { status: 400, json: { error: 'bad_state' } };
        const png = await writeCardImage(ws, tutor, date, job, n, Buffer.from(m[1], 'base64'));
        state = { ...rest, image: `conversations/${tutor}/${png}` };
      }
      const r = parseCardState(target, state);
      if (!r.ok) return { status: 400, json: { error: 'bad_state' } };
      const last = index.messages[index.messages.length - 1];
      await writeCardState(ws, tutor, date, job, n, { at: ctx.now().toISOString(), turn: last.job, state: r.state });
      return { status: 200, json: { ok: true, card: `${job}/${n}` } };
    }
    // 图片卡的图:只认 workspace 根以内的图片文件(产物、照片);越界、不是图、不存在都 404
    if (p === '/api/kid/image' && method === 'GET') {
      const rel = url.searchParams.get('p') ?? '';
      const file = resolve(ws.root, rel);
      const ext = IMAGE_EXT.exec(rel)?.[1]?.toLowerCase() ?? '';
      if (!rel || rel.startsWith('/') || !file.startsWith(ws.root + sep) || !IMAGE_TYPES[ext]) return { status: 404, json: { error: 'not_found' } };
      if (!(await stat(file).catch(() => null))?.isFile()) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, file, contentType: IMAGE_TYPES[ext] };
    }
    const audio = /^\/api\/audio\/([a-z0-9][a-z0-9-]*)\/(.+)$/.exec(p);
    if (audio && method === 'GET') {
      const [, tutor, name] = audio;
      if (!ws.config.tutors[tutor] || !AUDIO_FILE_RE.test(name)) return { status: 404, json: { error: 'not_found' } };
      const file = join(ws.dirs.conversations, tutor, name);
      if (!(await stat(file).catch(() => null))?.isFile()) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, file, contentType: 'audio/mpeg' };
    }

    const conv = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)(?:\/([^/]+))?$/.exec(p);
    if (conv) {
      const [, tutor, tail] = conv;
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      if (tail === undefined && method === 'GET') {
        return { status: 200, json: { tutor, today: localDate(ctx.now()), dates: await listDates(ws, tutor), running: ctx.runner.running(tutor) } };
      }
      if (tail === 'messages' && method === 'POST') {
        if (!isObj(body) || typeof body.text !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 {text, from?, focus?, runtime?}' } };
        const from = body.from ?? 'parent';
        if (!(MESSAGE_FROM as readonly unknown[]).includes(from)) return { status: 400, json: { error: 'bad_request', message: `from 只能是 ${MESSAGE_FROM.join(' / ')}` } };
        const focus = body.focus === undefined ? undefined : FocusSchema.safeParse(body.focus);
        if (focus && !focus.success) return { status: 400, json: { error: 'bad_request', message: 'focus 形状不对' } };
        const started = await ctx.runner.send(tutor, {
          from: from as (typeof MESSAGE_FROM)[number],
          text: body.text,
          focus: focus?.data,
          runtime: typeof body.runtime === 'string' ? body.runtime : undefined,
        });
        return { status: 202, json: { tutor, date: started.date, job: started.job, runtime: started.plan.runtime, resume: started.plan.resume } };
      }
      if (tail !== undefined && tail !== 'messages' && method === 'GET') {
        const date = tail === 'today' ? localDate(ctx.now()) : tail;
        if (!DATE_RE.test(date)) return { status: 400, json: { error: 'bad_request', message: '日期要是 YYYY-MM-DD 或 today' } };
        return { status: 200, json: await dayView(ctx, tutor, date) };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }

    // 舞台包(重卡在 iframe 里开)与课包文件:静态,越界 404
    if (method === 'GET' && p.startsWith('/stage/')) {
      const f = await stageAsset(p);
      return f ? { status: 200, file: f.file, contentType: f.contentType } : { status: 404, json: { error: 'not_found' } };
    }
    if (method === 'GET' && p.startsWith('/api/bundles/')) {
      const f = await bundleAsset(ws.dirs.bundles, p);
      return f ? { status: 200, file: f.file, contentType: f.contentType } : { status: 404, json: { error: 'not_found' } };
    }
    if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
    if (p === '/parent') return { status: 200, html: PARENT_PAGE };
    if (p === '/') return { status: 200, html: KID_PAGE.replace('__TITLE__', esc(ws.config.title)) };
    return { status: 404, json: { error: 'not_found', path: p } };
  } catch (err) {
    if (err instanceof BusyError) return { status: 409, json: { error: 'busy', message: err.message } };
    if (err instanceof RuntimeError) return { status: 400, json: { error: 'bad_runtime', message: err.message } };
    if (err instanceof ConfigError) return { status: 422, json: { error: 'config', message: err.message } };
    if (err instanceof IndexError) return { status: 500, json: { error: 'index', message: err.message } };
    if (err instanceof UsageError) return { status: 400, json: { error: 'usage', message: err.message } };
    throw err;
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new UsageError('请求体超过 1MB');
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError('请求体不是合法 JSON');
  }
}

export function createHandler(ctx: AppContext): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      let r: RouteResult;
      try {
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        r = await route(req.method ?? 'GET', req.url ?? '/', ctx, body);
      } catch (err) {
        r = err instanceof UsageError ? { status: 400, json: { error: 'usage', message: err.message } } : { status: 500, json: { error: 'internal', message: err instanceof Error ? err.message : String(err) } };
        if (r.status === 500) console.error(err);
      }
      if (r.file !== undefined) {
        res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=86400' });
        createReadStream(r.file).on('error', () => res.end()).pipe(res);
      } else if (r.html !== undefined) {
        res.writeHead(r.status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(r.html);
      } else {
        res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(r.json ?? null));
      }
    })();
  };
}
