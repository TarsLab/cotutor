/**
 * 孩子端的流水(《孩子端流水设计.md》):孩子端各页往服务端记的事,一件一行,按天存 .cotutor/kid-log/<日期>.jsonl。
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
 * 同一次打开里同一条报错只报一次、最多 20 条(防一个死循环写满文件,是护栏不是限额);只收脚本错,图片、声音读不出不收。
 * 用在首页 / 老师页(kid-page.ts,各种模式都带)、听写(中、英)、口语课;tests/kid-log.test.ts 盯着这几页都带它。
 * 脚本是 ES5、没有反斜杠与反引号(插进各页的模板字符串)。
 */
export const KID_LOG_JS = `
  var kidLog = (function () {
    var sent = {}, n = 0, page = '', mode = 'kid', v = '', ctx = null;
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
    window.addEventListener('unhandledrejection', function (e) {
      var r = e ? e.reason : null;
      report('unhandledrejection: ' + (r && r.message ? r.message : String(r)), '', r && r.stack);
    });
    return {
      start: function (o) {
        page = o.page || ''; mode = o.mode || 'kid'; v = o.v || ''; ctx = o.ctx || null;
        if (mode !== 'kid') return;
        var standalone = Boolean(navigator.standalone);
        try { standalone = standalone || matchMedia('(display-mode: standalone)').matches; } catch (e) {}
        post({ k: 'open', page: page, v: v, ua: cut(navigator.userAgent, 400), touch: navigator.maxTouchPoints || 0, standalone: standalone, w: screen.width, h: screen.height, vw: innerWidth, vh: innerHeight, dpr: window.devicePixelRatio || 1, lang: cut(navigator.language, 20) });
      },
    };
  })();
`;

/** 流水的一行(服务端补 at、device、ip) */
export type KidLogRow =
  | { k: 'open'; page: string; v: string; ua: string; touch: number; standalone: boolean; w: number; h: number; vw: number; vh: number; dpr: number; lang: string }
  | { k: 'error'; page: string; mode: string; v: string; msg: string; where: string; stack: string; ua: string; ctx: Record<string, unknown> | null };
export type KidLogLine = KidLogRow & { at: string; device: string; ip?: string };

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
}
export type KidDevices = Record<string, KidDevice>;

const MAX_BODY = 4000;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 页面交来的一行:形状不对、太长、k 不认得 → null(回 400) */
export function parseKidLog(body: unknown): KidLogRow | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > MAX_BODY) return null;
  const b = body as Record<string, unknown>;
  if (b.k === 'open') return { k: 'open', page: str(b.page, 40), v: str(b.v, 40), ua: str(b.ua, 400), touch: num(b.touch), standalone: b.standalone === true, w: num(b.w), h: num(b.h), vw: num(b.vw), vh: num(b.vh), dpr: num(b.dpr), lang: str(b.lang, 20) };
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
export async function recordKidLog(ws: Workspace, row: KidLogRow, who: { device: string; ip?: string }, now: Date): Promise<void> {
  const line: KidLogLine = { at: now.toISOString(), ...row, device: who.device, ...(who.ip ? { ip: who.ip } : {}) };
  await mkdir(logDir(ws), { recursive: true });
  await appendFile(join(logDir(ws), `${localDate(now)}.jsonl`), `${JSON.stringify(line)}\n`);
  if (row.k !== 'open') return;
  await updateDevices(ws, (d) => {
    const was = d[who.device];
    const hint = { ua: row.ua, touch: row.touch, standalone: row.standalone };
    d[who.device] = { first: was?.first ?? line.at, last: line.at, opens: (was?.opens ?? 0) + 1, ...hint, label: deviceLabel(hint), ...(was?.name ? { name: was.name } : {}) };
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
