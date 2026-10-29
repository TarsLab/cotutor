/**
 * 孩子端发一条的验与拼:HTTP 的 POST /api/kid/conversations/<老师>/messages 与实时老师那条线(src/live/call.ts)共用,
 * 都经 Runner.accept 进来。验正文、话题、首页按钮、小课堂、activity、照片,拼成 Runner.send 的入参;不对回 reject(状态码 + 错误名),
 * 怎么告诉孩子端由各自的协议定(HTTP 回 JSON,WS 回 err)。不起老师。
 */
import { FocusSchema, HomeViaSchema, DeviceSchema, type ActivityValue, type ConversationMessage } from '../schema/index.ts';
import { BUNDLE_ID_RE } from '../cards/kind.ts';
import { threads } from '../lib/conversation.ts';
import { submittedCards } from '../lib/kid-view.ts';
import { MARK_MAX, MARK_MAX_POINTS, MARK_MAX_STROKES } from '../lib/lecture.ts';
import type { Workspace } from '../cli/workspace.ts';
import { messageVia, resolveVia } from './home.ts';
import { validDevice } from './kid-log.ts';
import type { IncomingMark } from './lecture.ts';
import { PAPER_KEY_RE, paperDrawing, readPaper } from './paper.ts';
import type { SendInput } from './runner.ts';
import { capturePathOk, readIndex } from './store.ts';
import { talkRun } from './talk-run.ts';

export interface KidReject {
  status: 400 | 409;
  error: 'bad_request' | 'submitted' | 'bad_via' | 'bad_talk';
  /** 给人看的一句(多数没有) */
  message?: string;
}

export type KidAccept = { input: SendInput } | { reject: KidReject };

const reject = (status: KidReject['status'], error: KidReject['error'], message?: string): { reject: KidReject } => ({ reject: { status, error, ...(message ? { message } : {}) } });

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export async function kidInput(ws: Workspace, tutor: string, body: unknown, date: string, deviceId?: string | null): Promise<KidAccept> {
  if (!isObj(body) || typeof body.text !== 'string') return reject(400, 'bad_request');
  const focus = body.focus === undefined ? undefined : FocusSchema.safeParse(body.focus);
  if (focus && !focus.success) return reject(400, 'bad_request');
  const action = body.action === undefined ? undefined : body.action === 'submit' ? ('submit' as const) : null;
  if (action === null) return reject(400, 'bad_request');
  const photos = await photosOf(ws, body.photos);
  if (photos === null) return reject(400, 'bad_request');
  // 左栏的纸交的画:{key, image};图得在 captures/ 里,摘要按那张纸上的笔迹算
  let drawing: NonNullable<ConversationMessage['drawing']> | undefined;
  if (body.drawing !== undefined) {
    const d = body.drawing;
    if (!isObj(d) || typeof d.key !== 'string' || !PAPER_KEY_RE.test(d.key) || typeof d.image !== 'string' || !(await capturePathOk(ws, d.image))) return reject(400, 'bad_request');
    drawing = paperDrawing(await readPaper(ws, tutor, date, d.key), d.image);
  }
  const thread = body.thread === undefined ? undefined : typeof body.thread === 'string' && /^\d{4}-\d+$/.test(body.thread) ? body.thread : null;
  if (thread === null) return reject(400, 'bad_request');
  const today = await readIndex(ws, tutor, date);
  // 交过的卡不能再交(kid-view 的 submittedCards)
  if (action === 'submit' && focus?.data?.card && submittedCards(today).has(focus.data.card)) return reject(409, 'submitted');
  const device = body.device === undefined ? undefined : DeviceSchema.safeParse(body.device);
  if (device && !device.success) return reject(400, 'bad_request');
  // 首页的按钮:via 只带 id,按钮是什么、讲法是什么都从服务端的发布件查;对不上就 400(孩子端刷新首页)
  const via = body.via === undefined ? undefined : HomeViaSchema.safeParse(body.via);
  if (via && !via.success) return reject(400, 'bad_request');
  const button = via ? await resolveVia(ws, tutor, via.data!) : null;
  if (via && !button) return reject(400, 'bad_via');
  let text = body.text;
  let newThread = body.newThread === true;
  let pick = thread;
  let home: { button: string; brief?: string } | undefined;
  let continues: { date: string; thread: string } | undefined;
  let activity: { name: string; params: Record<string, ActivityValue> } | undefined;
  // 小课堂:看完才能开口——这一条要带 lecture(哪份课包、看完了、看了多久、停过几次、画过的几处),字是孩子说的;新开话题。
  // 问过以后「再看一遍」:同一话题的下一条带 lecture(新画的、又看的过程;话题得是从这份课包开始的)
  let lecture: (NonNullable<ReturnType<typeof lectureOf>> & { again?: true }) | null | undefined = lectureOf(body.lecture);
  if (lecture === null) return reject(400, 'bad_request');
  if (lecture) {
    const shots = lecture.marks.flatMap((k) => (k.image ? [k.image] : []));
    if (shots.length + (photos?.length ?? 0) > 9) return reject(400, 'bad_request', '照片和画的截图一共最多 9 张');
    for (const x of shots) if (!(await capturePathOk(ws, x))) return reject(400, 'bad_request');
  }
  if (lecture && button?.kind !== 'lecture') {
    const idx = thread && !via ? await readIndex(ws, tutor, date) : null;
    const ths = idx ? threads(idx.messages) : [];
    const from = idx?.messages.find((m, i) => ths[i] === thread && m.lecture && !m.lecture.again);
    if (!from || from.lecture?.bundle !== lecture.bundle || (!lecture.marks.length && !lecture.log.length)) return reject(400, 'bad_request');
    lecture = { ...lecture, again: true };
  }
  if (button?.kind === 'lecture') {
    if (!lecture || lecture.bundle !== button.bundle || !lecture.finished) return reject(400, 'bad_request', '小课堂要看完才能问');
    home = { button: button.label, ...(button.brief ? { brief: button.brief } : {}) };
    if (button.activity) activity = button.activity;
    newThread = true;
    pick = undefined;
  }
  if (button && (button.kind === 'start' || button.kind === 'continue')) {
    text = button.label;
    home = { button: button.label, ...(button.brief ? { brief: button.brief } : {}) };
    if (button.kind === 'continue' && button.date === date) {
      newThread = false;
      pick = button.thread;
    } else {
      newThread = true;
      pick = undefined;
      if (button.kind === 'continue') continues = { date: button.date, thread: button.thread };
    }
  }
  // activity 按钮:和开场按钮一样新开话题、发按钮上的字;参数是 resolveVia 按 activity 文件解析好的,记在这条消息上
  if (button?.kind === 'activity') {
    text = button.label;
    home = { button: button.label, ...(button.brief ? { brief: button.brief } : {}) };
    newThread = true;
    pick = undefined;
    activity = { name: button.activity, params: button.params };
  }
  // 口语课:口语课页拍好、改好的那份口语单,新开话题跑这位老师的 activity「口语课」
  let talk: string | undefined;
  if (body.talk !== undefined) {
    const t = await talkRun(ws, tutor, body.talk);
    if (!t) return reject(400, 'bad_talk');
    newThread = true;
    pick = undefined;
    activity = t.run;
    talk = t.id;
  }
  if (!text.trim() && !action && !photos?.length && !drawing) return reject(400, 'bad_request');
  return { input: { ...(talk ? { talk } : {}), from: 'kid', text, focus: focus?.data, action, newThread, thread: pick, device: device?.data, ...(validDevice(deviceId) ? { deviceId: deviceId! } : {}), photos, ...(drawing ? { drawing } : {}), ...(via && button ? { via: messageVia(via.data!, button) } : {}), ...(home ? { home } : {}), ...(continues ? { continues } : {}), ...(activity ? { activity } : {}), ...(lecture ? { lecture } : {}) } };
}

/** 消息里的 photos[]:都得是 captures/ 里在的文件(相对 workspace 根);不合法 → null */
export async function photosOf(ws: Workspace, v: unknown): Promise<string[] | null | undefined> {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 9 || !v.every((p): p is string => typeof p === 'string')) return null;
  for (const p of v) if (!(await capturePathOk(ws, p))) return null;
  return v;
}

/** 一处画里一笔最多几个点(播放器抽到 MARK_STROKE_POINTS,这里松一点);一条消息最多几处、一处几笔几个点见 src/lib/lecture.ts */
const MAX_STROKE_POINTS = 400;
/** 看的过程最多几条(拖进度条只记松手那一下,一堂课几十条) */
const MAX_WATCH_LOG = 500;
type WatchLog = { t: number; pos: number; play: boolean }[];

/** 孩子看完小课堂带来的:{bundle, watchedMs, finished, pauses, marks?};没带 undefined,形状不对 null(路由回 400) */
function lectureOf(v: unknown): { bundle: string; watchedMs: number; finished: boolean; pauses: number; marks: IncomingMark[]; log: WatchLog } | null | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v) || typeof v.bundle !== 'string' || !BUNDLE_ID_RE.test(v.bundle) || typeof v.watchedMs !== 'number' || !(v.watchedMs >= 0) || v.watchedMs > 6 * 3600_000 || typeof v.finished !== 'boolean') return null;
  const pauses = v.pauses === undefined ? 0 : v.pauses;
  if (typeof pauses !== 'number' || !Number.isInteger(pauses) || pauses < 0 || pauses > 999) return null;
  const raw = v.marks === undefined ? [] : v.marks;
  if (!Array.isArray(raw) || raw.length > MARK_MAX) return null;
  const marks: IncomingMark[] = [];
  const point = (p: unknown): [number, number] | null => (Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e5) ? [Math.round(p[0] as number), Math.round(p[1] as number)] : null);
  for (const m of raw as unknown[]) {
    if (!isObj(m) || typeof m.atMs !== 'number' || !(m.atMs >= 0) || m.atMs > 6 * 3600_000) return null;
    // 一处 = 停在同一刻画的几笔(strokes);2026-10-19 以前一笔一处(path),照读
    const rawStrokes = Array.isArray(m.strokes) ? (m.strokes as unknown[]) : Array.isArray(m.path) ? [m.path] : null;
    if (!rawStrokes || !rawStrokes.length || rawStrokes.length > MARK_MAX_STROKES) return null;
    const strokes: [number, number][][] = [];
    for (const st of rawStrokes) {
      if (!Array.isArray(st) || st.length < 2 || st.length > MAX_STROKE_POINTS) return null;
      const pts = st.map(point);
      if (pts.some((p) => p === null)) return null;
      strokes.push(pts as [number, number][]);
    }
    if (strokes.reduce((n, st) => n + st.length, 0) > MARK_MAX_POINTS) return null;
    // 截图(先 POST photos 拿到的 captures/ 路径;在不在由路由再查)
    if (m.image !== undefined && (typeof m.image !== 'string' || m.image.length > 200)) return null;
    // 画下去的那一刻(离发出去多少毫秒,≤ 0;录像用)
    const t = m.t === undefined ? undefined : typeof m.t === 'number' && Number.isFinite(m.t) && m.t <= 0 && m.t > -6 * 3600_000 ? Math.round(m.t) : null;
    if (t === null) return null;
    marks.push({ atMs: Math.round(m.atMs), strokes, ...(typeof m.image === 'string' ? { image: m.image } : {}), ...(t !== undefined ? { t } : {}) });
  }
  // 看的过程(录像用):放 / 停 / 拖到哪,一次一条,t ≤ 0
  const rawLog = v.log === undefined ? [] : v.log;
  if (!Array.isArray(rawLog) || rawLog.length > MAX_WATCH_LOG) return null;
  const log: WatchLog = [];
  for (const e of rawLog as unknown[]) {
    if (!isObj(e) || typeof e.t !== 'number' || !Number.isFinite(e.t) || e.t > 0 || e.t < -6 * 3600_000 || typeof e.pos !== 'number' || !(e.pos >= 0) || e.pos > 6 * 3600_000 || typeof e.play !== 'boolean') return null;
    log.push({ t: Math.round(e.t), pos: Math.round(e.pos), play: e.play });
  }
  return { bundle: v.bundle, watchedMs: Math.round(v.watchedMs), finished: v.finished, pauses, marks, log };
}
