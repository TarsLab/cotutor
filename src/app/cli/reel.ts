/**
 * cotutor reel:一段录像(一个话题)写成一条时间线,给人读、给 AI 助手分析(2026-11-14)。
 * 录像本身是给家长看的、会动的页面(/reel),AI 去「看」它又慢又不准;这里把同一份轨道(app.ts 的 parentReel、ui/kid/reel.ts)
 * 连同话题的消息、板的日志,排成一行一件事:孩子说了什么、按了多久、老师第一声等了几秒、老师念的每句、出了什么卡、
 * 课本翻到哪、点了哪个字、动了卡、哪一轮没成和原因。--shots 再在要紧的时刻截孩子的屏幕:
 * 本进程起一个只听 127.0.0.1 的服务(同 serve 的路由)、无头 Chrome 开 /reel?bare=1(不带录像栏)、跳到那一刻(seekWall)、截图。
 *
 * 链接:家长端录像顶上「复制链接」拷的(/parent?tutor=&date=&thread=),孩子屏幕那页(/reel?…)也认;或者直接写 老师 话题 [日期]。
 * 这份时间线有孩子的原话:只在这台电脑上打印,不往外发。
 */
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cardTitle, type BoardCard, type BoardSection } from '../../board/presentation.ts';
import { readBoard } from '../../runtime/journal/board-log.ts';
import { readIndex } from '../../runtime/journal/store.ts';
import { threads, type ConversationMessage } from '../../schema/index.ts';
import type { Reel } from '../../ui/kid/reel.ts';
import { createHandler, parentReel, type AppContext } from '../http/app.ts';
import { withBrowser } from './chalk/browser.ts';

export interface ReelRef {
  tutor: string;
  date: string;
  thread: string;
}

/** 链接(家长端的 /parent?tutor=&date=&thread=、孩子屏幕的 /reel?…)或「老师 话题 [日期]」→ 哪一段;日期缺省今天。写错了回 {error}(main 报参数错) */
export function parseReelRef(args: readonly string[], today: string): ReelRef | { error: string } {
  const [a, b, c] = args;
  if (!a) return { error: 'reel 要一个链接(家长端录像顶上「复制链接」),或者 老师 话题 [日期],如 cotutor reel chinese-tutor 1833-9 2026-11-14' };
  if (/^https?:\/\/|^\//.test(a)) {
    let u: URL;
    try { u = new URL(a, 'http://localhost'); } catch { return { error: `读不懂这个链接:${a}` }; }
    const tutor = u.searchParams.get('tutor') ?? '', thread = u.searchParams.get('thread') ?? '';
    const d = u.searchParams.get('date') ?? '';
    if (!tutor || !thread) return { error: '这个链接里没有是哪一段录像(要 tutor= 和 thread=):在家长端打开那段录像,点顶上「复制链接」' };
    return { tutor, thread, date: !d || d === 'today' ? today : d };
  }
  if (!b) return { error: `reel 要老师和话题,如 cotutor reel ${a} 1833-9(话题在录像链接的 thread= 里)` };
  return { tutor: a, thread: b, date: c ?? today };
}

/** 时间线的一行:at 是当时的墙钟,ms 是录像里的位置(从录像开头算),round = 孩子第几次开口(0 = 开口之前) */
export interface ReelLine {
  at: number;
  ms: number;
  round: number;
  kind: 'kid' | 'teacher' | 'say' | 'wait' | 'error' | 'hold' | 'type' | 'photo' | 'stage' | 'card' | 'board' | 'view' | 'away' | 'lecture' | 'parent';
  text: string;
  job?: string;
  /** --shots:这一行那一刻的截图 */
  shot?: string;
}

export interface ReelReport {
  ref: ReelRef;
  title: string;
  /** 孩子屏幕的 CSS 尺寸(没记 = 按设备取常见的) */
  screen: [number, number];
  realtime: boolean;
  startAt: number;
  endAt: number;
  rounds: number;
  failed: number;
  lines: ReelLine[];
}

const SIZES: Record<string, [number, number]> = { 'tablet-landscape': [1180, 820], 'tablet-portrait': [820, 1180], phone: [390, 844] };
const HOLD_RESULT: Record<string, string> = { sent: '发了', unclear: '没听清(没发)', cancel: '上滑取消了' };
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} 秒`;
/** 长的时长:几分几秒、几小时几分 */
const span = (ms: number): string => { const s = Math.round(ms / 1000); if (s < 60) return secs(ms); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} 小时 ${m} 分` : `${m} 分 ${s % 60} 秒`; };
const clock = (ms: number): string => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const quote = (s: string, n = 80): string => { const t = s.replace(/\s+/g, ' ').trim(); return `「${t.length > n ? `${t.slice(0, n)}…` : t}」`; };
const startOf = (m: ConversationMessage): number => { const t = Date.parse(m.timing?.startedAt ?? ''); return Number.isNaN(t) ? Date.parse(m.at) : t; };

/** 卡的状态说成一句(孩子做了什么);认不出的只说动过 */
function stateText(state: unknown): string {
  if (!state || typeof state !== 'object') return '动了';
  const s = state as Record<string, unknown>;
  const bits: string[] = [];
  if (Array.isArray(s.marks)) bits.push(`画了 ${s.marks.length} 笔`);
  if (Array.isArray(s.picked)) bits.push(`选了第 ${(s.picked as number[]).map((i) => i + 1).join('、')} 项`);
  if (Array.isArray(s.answers)) bits.push(`填了 ${(s.answers as unknown[]).filter((x) => typeof x === 'string' && x.trim()).length} 空`);
  if (s.submitted || s.image) bits.push('交了');
  return bits.join(',') || '动了';
}

/** 板上的底说成一句 */
function ownText(card: { props: Record<string, unknown> }): string {
  const p = card.props, params = (p.params ?? {}) as Record<string, string>;
  if (p.kit === '课本') return `课本《${String(params['书'] ?? '').replace(/\.pdf$/i, '')}》${params['课'] ?? ''}`;
  if (p.kit === '照片') return `孩子的照片 ${params['图'] ?? ''}`;
  return '白板';
}

/**
 * 孩子挪课本是一串一串的(停一下报一次,一分钟几十次):中间没别的事的几次并成一行——挪了几次、从几点到几点、
 * 依次停在哪(连着一样的算一处,最多写 4 处,多的只写最后停在哪)
 */
function mergeViews(lines: readonly Omit<ReelLine, 'ms' | 'round'>[]): Omit<ReelLine, 'ms' | 'round'>[] {
  const out: Omit<ReelLine, 'ms' | 'round'>[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind !== 'view') { out.push(lines[i]); continue; }
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].kind === 'view') j++;
    const run = lines.slice(i, j + 1);
    const spots = run.map((x) => x.text).filter((t, k, a) => k === 0 || t !== a[k - 1]);
    const where = spots.length <= 4 ? spots.join(' → ') : `${spots.slice(0, 2).join(' → ')} → …(${spots.length - 3} 处)→ ${spots[spots.length - 1]}`;
    const n = run.length;
    const dur = run[n - 1].at - run[0].at;
    out.push({ at: run[0].at, kind: 'board', text: n === 1 ? `孩子挪课本:${where}` : `孩子挪课本 ${n} 次(${span(dur)}):${where}` });
    i = j;
  }
  return out;
}

/** 一段录像的时间线;没有这段 → null */
export async function reelReport(ctx: AppContext, ref: ReelRef): Promise<ReelReport | null> {
  const pr = await parentReel(ctx, ref.tutor, ref.date, ref.thread);
  if (!pr) return null;
  const R: Reel = pr.reel;
  const index = await readIndex(ctx.ws, ref.tutor, ref.date);
  const ths = threads(index.messages);
  const mine = index.messages.filter((m, i) => ths[i] === ref.thread && !m.bookkeep && !m.tidy);
  const secOf = new Map<string, BoardSection>();
  for (const m of mine) if (m.result === 'ok' && m.section) secOf.set(m.job, m.section as BoardSection);
  const lines: Omit<ReelLine, 'ms' | 'round'>[] = [];
  const add = (at: number, kind: ReelLine['kind'], text: string, job?: string): void => { if (Number.isFinite(at)) lines.push({ at, kind, text, ...(job ? { job } : {}) }); };
  const said = new Map(R.marks.filter((x) => x.kind === 'said').map((x) => [x.job, x.at]));
  const kidAts: number[] = [];

  for (const m of mine) {
    const t0 = startOf(m);
    const at = said.get(m.job) ?? t0;
    if (m.from === 'kid') {
      kidAts.push(at);
      const what = [
        m.text ? quote(m.text, 200) : '',
        m.via ? `(点了首页「${m.via.label}」)` : '',
        m.action === 'submit' ? '交给老师' : '',
        m.photos?.length ? `发了 ${m.photos.length} 张照片` : '',
        m.cards?.length ? `带上卡上做的 ${m.cards.length} 张` : '',
      ].filter(Boolean).join(' ');
      add(at, 'kid', `孩子:${what || '(空)'}`, m.job);
    } else add(at, 'kid', `应用替孩子叫老师:${quote(m.text, 120)}`, m.job);
    const done = m.timing?.doneMs !== undefined ? t0 + m.timing.doneMs : NaN;
    const took = m.timing?.doneMs !== undefined ? `(写了 ${secs(m.timing.doneMs)})` : '';
    if (m.result === 'error') add(Number.isFinite(done) ? done : t0, 'error', `老师这一轮没成${took}:${m.error ?? '?'}`, m.job);
    else if (m.result === 'ok') {
      const sec = secOf.get(m.job);
      const tr = R.tracks.find((x) => x.job === m.job);
      const cards = sec?.cards.map((c: BoardCard) => `${c.kind}${cardTitle(c) ? `「${cardTitle(c)}」` : ''}`) ?? [];
      add(tr?.at ?? done, 'teacher', sec ? `老师写好这一轮${took}:讲稿 ${sec.lines.length} 句${cards.length ? `;卡 ${cards.join('、')}` : ';没有卡'}` : `老师这一轮什么都没写${took}`, m.job);
    }
    const tail = Number.isFinite(done) ? done : t0;
    if (m.parentText) add(tail, 'parent', `给家长:${quote(m.parentText, 160)}`, m.job);
    if (m.warnings?.length) add(tail, 'parent', `提醒:${m.warnings.join(';')}`, m.job);
  }
  // 没成的那轮没有第一声(轨道照收尾算的,不是老师出声)
  const failedJobs = new Set(mine.filter((m) => m.result === 'error').map((m) => m.job));
  for (const w of R.waits) if (!failedJobs.has(w.job)) add(w.to, 'wait', `等老师第一声 ${secs(w.to - w.from)}`, w.job);
  for (const x of R.says) {
    const t = secOf.get(x.job)?.lines[x.line]?.text;
    if (t) add(x.from, 'say', `老师:${quote(t, 200)}`, x.job);
  }
  for (const c of R.clips) if (c.kind === 'mouth' && c.text) add(c.from, 'say', `老师(先接一句):${quote(c.text)}`, c.job);
  // 实时的轮写了讲稿、录像里一句也没念:写出来(嘴没念、通话断了、孩子走开了都会这样),分析时要知道老师本来要说什么
  for (const m of mine) {
    const sec = secOf.get(m.job);
    if (!m.live || !sec?.lines.length || R.says.some((x) => x.job === m.job)) continue;
    const tr = R.tracks.find((x) => x.job === m.job);
    add((tr?.at ?? startOf(m)) + 1, 'say', `讲稿没有念的记录(${sec.lines.length} 句):${sec.lines.map((l) => quote(l.text, 60)).join(' ')}`, m.job);
  }
  for (const h of R.holds) add(h.from, 'hold', `按住说话 ${secs((h.upAt ?? h.to) - h.from)} → ${h.result ? HOLD_RESULT[h.result] ?? h.result : '没收尾'}`);
  for (const t of R.types) add(t.from, 'type', `打字${t.vals.length ? quote(t.vals[t.vals.length - 1].v) : ''} → ${t.sent ? '发了' : '没发'}`);
  for (const p of R.photoScreens) add(p.from, 'photo', `拍照屏${p.tools.length ? `(用了 ${[...new Set(p.tools.map((x) => x.tool))].join('、')})` : ''} → ${p.sent ? '发了' : '取消了'}`);
  const cardOf = (job: string, n: number): BoardCard | undefined => secOf.get(job)?.cards[n];
  // 同一张卡切回来又开一次(从后台回来、重连)不算
  let lastStage = '';
  for (const s of R.stages) {
    const key = `${s.job}/${s.card}`;
    if (key === lastStage) continue;
    lastStage = key;
    const c = cardOf(s.job, s.card);
    add(s.from, 'stage', `打开卡:${c ? `${c.kind}「${cardTitle(c)}」` : key}`, s.job);
  }
  // 卡的状态:说法变了才写(开卡时回一遍原样的、连着几笔的,只写变了的那次);一笔没动的开头不写
  const said2 = new Map<string, string>();
  for (const c of R.cards) {
    const key = `${c.job}/${c.card}`, text = stateText(c.state);
    if ((said2.get(key) ?? '画了 0 笔') === text) continue;
    said2.set(key, text);
    const card = cardOf(c.job, c.card);
    add(c.at, 'card', `孩子在卡上:${card ? `「${cardTitle(card)}」` : key} ${text}`, c.job);
  }
  for (const a of R.aways) if (a.to - a.from >= 1000) add(a.from, 'away', `切到别处 ${span(a.to - a.from)}`);
  for (const l of R.lectures ?? []) add(l.from, 'lecture', `看小课堂「${l.title}」`, l.job);
  for (const o of R.owns ?? []) add(Math.max(o.at, R.startAt), 'board', `板上铺好:${ownText(o.card)}`);
  for (const e of await readBoard(ctx.ws, ref.tutor, ref.date, ref.thread)) {
    const at = Date.parse(e.at);
    if (e.k === 'pick') add(at, 'board', `孩子点了「${e.text}」`);
    else if (e.k === 'reveal') add(at, 'board', `孩子揭开了「${e.text}」的拼音`);
    else if (e.k === 'view') add(at, 'view', e.text);
    else if (e.k === 'still') add(at, 'board', '孩子动了手一直没出声,应用替他叫了一次老师');
  }

  lines.sort((x, y) => x.at - y.at);
  kidAts.sort((x, y) => x - y);
  const merged = mergeViews(lines);
  const out: ReelLine[] = merged.map((l) => ({ ...l, ms: Math.max(0, l.at - R.startAt), round: kidAts.filter((k) => k <= l.at).length }));
  const first = mine[0];
  const t = ctx.ws.config.tutors[ref.tutor];
  const what = first?.via?.label ?? first?.activity?.name ?? (first?.text ? quote(first.text, 20) : '');
  const hhmm = first ? new Date(startOf(first)).toTimeString().slice(0, 5) : '';
  const v = R.views[0];
  return {
    ref,
    title: [t?.display ?? ref.tutor, what, `${ref.date} ${hhmm}`.trim()].filter(Boolean).join(' · '),
    screen: v ? [v.w, v.h] : SIZES[pr.device ?? ''] ?? SIZES['tablet-landscape'],
    realtime: pr.realtime,
    startAt: R.startAt,
    endAt: R.endAt,
    rounds: kidAts.length,
    failed: mine.filter((m) => m.result === 'error').length,
    lines: out,
  };
}

/** 给人、给 AI 读的那份 */
export function formatReelReport(r: ReelReport): string {
  const out: string[] = [];
  out.push(`${r.title} · 话题 ${r.ref.thread}`);
  out.push(`孩子的屏幕 ${r.screen[0]}×${r.screen[1]} · ${r.realtime ? '实时老师' : '不是实时的'} · 录像 ${clock(r.endAt - r.startAt)} · 孩子开口 ${r.rounds} 次${r.failed ? ` · ${r.failed} 轮没成` : ''}`);
  out.push('时间是录像里的位置(从开头算,没压空白);[n] = 孩子第 n 次开口以后');
  out.push('');
  let round = -1;
  for (const l of r.lines) {
    if (l.round !== round) { round = l.round; out.push(round ? `── 第 ${round} 轮 ──` : '── 开口之前 ──'); }
    out.push(`${clock(l.ms).padStart(5)}  ${l.text}`);
    if (l.shot) out.push(`       截图 ${l.shot}`);
  }
  return `${out.join('\n')}\n`;
}

/** 要截图的行:看得见的变化落定以后那一刻;挨得太近的(2.5 秒内)只截一张 */
const SHOT_AFTER: Partial<Record<ReelLine['kind'], number>> = { kid: 1200, teacher: 2500, stage: 1500, card: 600, board: 1500, error: 500, photo: 800, lecture: 1500 };
const SHOT_GAP_MS = 2500;
const SHOT_MAX = 80;
/** 跳过去以后等多久再截(课本要 pdf.js 现画) */
const SHOT_SETTLE_MS = 1800;

/** 在要紧的时刻截孩子的屏幕,写进 dir,填 lines[].shot;本进程起服务、无头 Chrome。回截了几张 */
export async function reelShots(ctx: AppContext, r: ReelReport, dir: string, log: (s: string) => void = () => {}): Promise<number> {
  const plan: { line: ReelLine; at: number }[] = [];
  let last = -Infinity;
  for (const line of r.lines) {
    const after = SHOT_AFTER[line.kind];
    if (after === undefined) continue;
    const at = Math.min(line.at + after, r.endAt);
    if (at - last < SHOT_GAP_MS) continue;
    plan.push({ line, at });
    last = at;
    if (plan.length >= SHOT_MAX) break;
  }
  if (!plan.length) return 0;
  await mkdir(dir, { recursive: true });
  const server = createServer(createHandler(ctx));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  try {
    const q = new URLSearchParams({ tutor: r.ref.tutor, date: r.ref.date, thread: r.ref.thread, bare: '1' });
    await withBrowser(async (page) => {
      await page.goto(`http://127.0.0.1:${port}/reel?${q}`);
      await page.waitFor('window.cotutorReel && window.cotutorReel.get()', 30_000);
      for (const [i, p] of plan.entries()) {
        await page.evaluate(`window.cotutorReel.seekWall(${p.at})`);
        await new Promise((ok) => setTimeout(ok, SHOT_SETTLE_MS));
        const name = `${String(i + 1).padStart(2, '0')}-${clock(p.at - r.startAt).replace(':', 'm')}s.png`;
        await writeFile(join(dir, name), await page.screenshot('body'));
        p.line.shot = join(dir, name);
        log(`截图 ${i + 1}/${plan.length}`);
      }
    }, { width: r.screen[0], height: r.screen[1] });
  } finally {
    server.close();
  }
  return plan.length;
}
