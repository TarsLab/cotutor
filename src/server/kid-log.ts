/**
 * 孩子端的流水:孩子端各页往服务端记的事,一件一行,按天存 .cotutor/kid-log/<日期>.jsonl。
 * 这期两件:open = 孩子端模式下打开一次(带认设备要的浏览器信息,登记进设备表 .cotutor/devices.json);error = 页面脚本出错(各种模式都记)。
 * 设备是服务端种的 cookie(cotutor_kid,src/lib/kid-device.ts);消息上的 deviceId 也由服务端从 cookie 取,不靠页面带。
 * 孩子端照旧什么都不显示;删话题不动流水。
 */
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace } from '../cli/workspace.ts';
import { localDate } from '../lib/conversation.ts';
import { DEVICE_COOKIE, DEVICE_COOKIE_DAYS, DEVICE_ID_RE, deviceLabel } from '../lib/kid-device.ts';

/**
 * 各页共用的那段脚本:装上出错的监听,kidLog.start({page, mode, v, ctx}) 报一次打开(只在 mode 是 kid 时)。
 * 孩子端模式下还在前台计时(7.4):切到后台、离开页面时记一笔 fg,一直开着每 5 分钟也记一笔;不满 1 秒的不记。
 * 打开那行带 caps(7.2):麦克风权限(问 navigator.permissions,问不出 unknown;最多等 1.5 秒)、有没有 getUserMedia;
 * 麦克风权限变了、kidLog.blocked('autoplay')(老师的声音被浏览器拦了,一次打开只记一次)各记一行 perm。
 * 连接(7.3):kidLog.offline(on) 心跳断了 / 又通了,通了那一下记 net offline 与断了多久;kidLog.live(opened, ms) 实时老师的连接不是孩子自己收的、自己关了。
 * 同一次打开里同一条报错只报一次、最多 20 条(防一个死循环写满文件,是护栏不是限额);只收脚本错,图片、声音读不出不收。
 * 用在首页 / 老师页(kid-page.ts,各种模式都带)、听写(中、英)、口语课;tests/kid-log.test.ts 盯着这几页都带它。
 * 脚本是 ES5、没有反斜杠与反引号(插进各页的模板字符串)。
 */
export const KID_LOG_JS = `
  var kidLog = (function () {
    var sent = {}, n = 0, page = '', mode = 'kid', v = '', ctx = null, fgSince = 0, blocked = {}, offSince = 0;
    var cut = function (s, k) { s = String(s == null ? '' : s); return s.length > k ? s.slice(0, k) : s; };
    var post = function (row) { try { fetch('/api/kid/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row), keepalive: true, credentials: 'same-origin' }).catch(function () {}); } catch (e) {} };
    var report = function (msg, where, stack) {
      var key = msg + '@' + where;
      if (sent[key] || n >= 20) return;
      sent[key] = 1; n++;
      var c = null;
      try { c = ctx ? ctx() : null; } catch (e) { c = null; }
      post({ k: 'error', page: page, mode: mode, v: v, msg: cut(msg, 300), where: where, stack: cut(stack, 1500), ua: cut(navigator.userAgent, 400), ctx: c });
    };
    window.addEventListener('error', function (e) {
      if (!e || typeof e.message !== 'string') return;
      report(e.message || 'error', (e.lineno || 0) + ':' + (e.colno || 0), e.error && e.error.stack);
    });
    var flushFg = function () {
      if (!fgSince) return;
      var ms = Date.now() - fgSince;
      if (ms < 1000 && !document.hidden) return;
      fgSince = document.hidden ? 0 : Date.now();
      if (ms >= 1000) post({ k: 'fg', page: page, ms: Math.round(ms) });
    };
    window.addEventListener('unhandledrejection', function (e) {
      var r = e ? e.reason : null;
      report('unhandledrejection: ' + (r && r.message ? r.message : String(r)), '', r && r.stack);
    });
    return {
      offline: function (on) {
        if (mode !== 'kid') return;
        if (on) { if (!offSince) offSince = Date.now(); return; }
        if (!offSince) return;
        var ms = Date.now() - offSince;
        offSince = 0;
        post({ k: 'net', page: page, what: 'offline', ms: Math.round(ms) });
      },
      live: function (opened, ms) {
        if (mode !== 'kid') return;
        post({ k: 'net', page: page, what: 'live', opened: Boolean(opened), ms: Math.round(ms || 0) });
      },
      blocked: function (what) {
        if (mode !== 'kid' || blocked[what]) return;
        blocked[what] = 1;
        post({ k: 'perm', page: page, what: what, state: 'blocked' });
      },
      start: function (o) {
        page = o.page || ''; mode = o.mode || 'kid'; v = o.v || ''; ctx = o.ctx || null;
        if (mode !== 'kid') return;
        var standalone = Boolean(navigator.standalone);
        try { standalone = standalone || matchMedia('(display-mode: standalone)').matches; } catch (e) {}
        var caps = { mic: 'unknown', gum: Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) };
        var opened = false;
        var sendOpen = function (mic) {
          if (opened) return;
          opened = true; caps.mic = mic;
          post({ k: 'open', page: page, v: v, ua: cut(navigator.userAgent, 400), touch: navigator.maxTouchPoints || 0, standalone: standalone, w: screen.width, h: screen.height, vw: innerWidth, vh: innerHeight, dpr: window.devicePixelRatio || 1, lang: cut(navigator.language, 20), caps: caps });
        };
        setTimeout(function () { sendOpen('unknown'); }, 1500);
        try {
          navigator.permissions.query({ name: 'microphone' }).then(function (st) {
            sendOpen(st.state);
            st.onchange = function () { post({ k: 'perm', page: page, what: 'mic', state: st.state }); };
          }, function () { sendOpen('unknown'); });
        } catch (e) { sendOpen('unknown'); }
        fgSince = document.hidden ? 0 : Date.now();
        document.addEventListener('visibilitychange', function () { if (document.hidden) flushFg(); else fgSince = Date.now(); });
        window.addEventListener('pagehide', flushFg);
        setInterval(function () { if (!document.hidden) flushFg(); }, 300000);
      },
    };
  })();
`;

/** 打开时的权限与能力(7.2):麦克风权限、有没有 getUserMedia(2026-10-22 删了浏览器识别,不再探语音识别;老设备表里的 sr 留着不读) */
export interface KidCaps {
  mic: 'granted' | 'denied' | 'prompt' | 'unknown';
  gum: boolean;
}
const MIC_STATES = ['granted', 'denied', 'prompt', 'unknown'] as const;
const micState = (v: unknown): KidCaps['mic'] => ((MIC_STATES as readonly unknown[]).includes(v) ? (v as KidCaps['mic']) : 'unknown');

/** 流水的一行(服务端补 at、device、ip) */
export type KidLogRow =
  | { k: 'open'; page: string; v: string; ua: string; touch: number; standalone: boolean; w: number; h: number; vw: number; vh: number; dpr: number; lang: string; caps?: KidCaps }
  /** 在前台多久(7.4):这一笔的毫秒,时刻是这一笔记下的那一刻 */
  | { k: 'fg'; page: string; ms: number }
  /** 权限变了(7.2):mic = 麦克风权限变成 state;autoplay = 老师的声音被拦了(state blocked) */
  | { k: 'perm'; page: string; what: 'mic' | 'autoplay'; state: string }
  /** 连接(7.3):offline = 心跳断了多久(通了才报);live = 实时老师的连接自己关了,opened false = 没连上,true = 连上 ms 毫秒后断了 */
  | { k: 'net'; page: string; what: 'offline'; ms: number }
  | { k: 'net'; page: string; what: 'live'; opened: boolean; ms: number }
  | { k: 'error'; page: string; mode: string; v: string; msg: string; where: string; stack: string; ua: string; ctx: Record<string, unknown> | null };
/** 服务端那时跑的是哪份代码(打开那行补) */
export interface KidLogSrv {
  v: string | null;
  commit: string | null;
  started: string;
}
export type KidLogLine = KidLogRow & { at: string; device: string; ip?: string; srv?: KidLogSrv };

/** 设备表的一项 */
export interface KidDevice {
  first: string;
  last: string;
  opens: number;
  ua: string;
  touch: number;
  standalone: boolean;
  label: string;
  /** 家长在工作台起的名 */
  name?: string;
  /** 最近一次打开时服务端的提交 */
  commit?: string;
  /** 最近的权限与能力(打开时记,麦克风权限变了跟着改) */
  caps?: KidCaps;
  /** 老师的声音最近一次被浏览器拦的时刻 */
  blockedAt?: string;
}
export type KidDevices = Record<string, KidDevice>;

const MAX_BODY = 4000;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 页面交来的一行:形状不对、太长、k 不认得 → null(回 400) */
export function parseKidLog(body: unknown): KidLogRow | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > MAX_BODY) return null;
  const b = body as Record<string, unknown>;
  if (b.k === 'open') {
    const c = b.caps && typeof b.caps === 'object' ? (b.caps as Record<string, unknown>) : null;
    return { k: 'open', page: str(b.page, 40), v: str(b.v, 40), ua: str(b.ua, 400), touch: num(b.touch), standalone: b.standalone === true, w: num(b.w), h: num(b.h), vw: num(b.vw), vh: num(b.vh), dpr: num(b.dpr), lang: str(b.lang, 20), ...(c ? { caps: { mic: micState(c.mic), gum: c.gum === true } } : {}) };
  }
  if (b.k === 'net') {
    const ms = typeof b.ms === 'number' && b.ms >= 0 && b.ms <= 86_400_000 ? Math.round(b.ms) : null;
    if (ms === null) return null;
    if (b.what === 'offline') return { k: 'net', page: str(b.page, 40), what: 'offline', ms };
    if (b.what === 'live') return { k: 'net', page: str(b.page, 40), what: 'live', opened: b.opened === true, ms };
    return null;
  }
  if (b.k === 'perm') return b.what === 'mic' || b.what === 'autoplay' ? { k: 'perm', page: str(b.page, 40), what: b.what, state: b.what === 'mic' ? micState(b.state) : 'blocked' } : null;
  // 一笔最多算 6 小时(页面每 5 分钟记一笔,长了是钟跳了)
  if (b.k === 'fg') return typeof b.ms === 'number' && b.ms > 0 && b.ms <= 6 * 3600_000 ? { k: 'fg', page: str(b.page, 40), ms: Math.round(b.ms) } : null;
  if (b.k === 'error') {
    const ctx = b.ctx && typeof b.ctx === 'object' && !Array.isArray(b.ctx) ? (b.ctx as Record<string, unknown>) : null;
    return { k: 'error', page: str(b.page, 40), mode: str(b.mode, 20), v: str(b.v, 40), msg: str(b.msg, 300), where: str(b.where, 40), stack: str(b.stack, 1500), ua: str(b.ua, 400), ctx };
  }
  return null;
}

export const newDeviceId = (): string => randomBytes(6).toString('hex');
export const validDevice = (id: string | null | undefined): string | null => (id && DEVICE_ID_RE.test(id) ? id : null);
export const deviceCookie = (id: string, secure: boolean): string => `${DEVICE_COOKIE}=${id}; Path=/; Max-Age=${DEVICE_COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

const logDir = (ws: Workspace): string => join(ws.root, '.cotutor', 'kid-log');
const devicesFile = (ws: Workspace): string => join(ws.root, '.cotutor', 'devices.json');

export async function readDevices(ws: Workspace): Promise<KidDevices> {
  try {
    const j = JSON.parse(await readFile(devicesFile(ws), 'utf8')) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as KidDevices) : {};
  } catch {
    return {};
  }
}

/** 设备表一次只一个人写(同一进程一条队),写到临时文件再换上 */
let chain: Promise<unknown> = Promise.resolve();
function updateDevices<T>(ws: Workspace, f: (d: KidDevices) => T): Promise<T> {
  const run = async (): Promise<T> => {
    const d = await readDevices(ws);
    const out = f(d);
    await mkdir(join(ws.root, '.cotutor'), { recursive: true });
    const file = devicesFile(ws);
    await writeFile(`${file}.tmp`, `${JSON.stringify(d, null, 2)}\n`);
    await rename(`${file}.tmp`, file);
    return out;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

/** 记一行流水;是孩子端的打开就顺手登记设备 */
export async function recordKidLog(ws: Workspace, row: KidLogRow, who: { device: string; ip?: string; srv?: KidLogSrv }, now: Date): Promise<void> {
  const line: KidLogLine = { at: now.toISOString(), ...row, device: who.device, ...(who.ip ? { ip: who.ip } : {}), ...(row.k === 'open' && who.srv ? { srv: who.srv } : {}) };
  await mkdir(logDir(ws), { recursive: true });
  await appendFile(join(logDir(ws), `${localDate(now)}.jsonl`), `${JSON.stringify(line)}\n`);
  if (row.k === 'perm') {
    // 权限变了:只改登记过的设备(家长端那几页不报 perm)
    await updateDevices(ws, (d) => {
      const dev = d[who.device];
      if (!dev) return;
      if (row.what === 'autoplay') dev.blockedAt = line.at;
      else dev.caps = { ...(dev.caps ?? { gum: true }), mic: micState(row.state) };
    });
    return;
  }
  if (row.k !== 'open') return;
  await updateDevices(ws, (d) => {
    const was = d[who.device];
    const hint = { ua: row.ua, touch: row.touch, standalone: row.standalone };
    d[who.device] = { first: was?.first ?? line.at, last: line.at, opens: (was?.opens ?? 0) + 1, ...hint, label: deviceLabel(hint), ...(was?.name ? { name: was.name } : {}), ...(who.srv?.commit ? { commit: who.srv.commit } : {}), ...(row.caps ? { caps: row.caps } : was?.caps ? { caps: was.caps } : {}), ...(was?.blockedAt ? { blockedAt: was.blockedAt } : {}) };
  });
}

/** 家长起名;空着 = 去掉名字。没有这台 → false */
export function renameDevice(ws: Workspace, id: string, name: string): Promise<boolean> {
  return updateDevices(ws, (d) => {
    const dev = d[id];
    if (!dev) return false;
    const n = name.trim().slice(0, 30);
    if (n) dev.name = n;
    else delete dev.name;
    return true;
  });
}

/** 这几天的流水,坏行丢掉 */
export async function readKidLog(ws: Workspace, dates: readonly string[]): Promise<KidLogLine[]> {
  const out: KidLogLine[] = [];
  for (const date of dates) {
    const text = await readFile(join(logDir(ws), `${date}.jsonl`), 'utf8').catch(() => '');
    for (const l of text.split('\n')) {
      if (!l.trim()) continue;
      try { out.push(JSON.parse(l) as KidLogLine); } catch { /* 写到一半的行 */ }
    }
  }
  return out;
}
