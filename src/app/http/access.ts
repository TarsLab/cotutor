/**
 * 家长端与工作台的锁:一个机器级 PIN,孩子端永远不要。
 * - **没设 PIN:行为和以前一字不差**,局域网全开。家长在旁边、用完收回 iPad 的家可以不设;doctor 的 server.access 提一句,不算错。
 * - 设了:孩子端的路径(下面的白名单)照旧开;其余页面与接口要凭证。**本机(127.0.0.1 / ::1)免密**,所以电脑上开工作台、
 *   探针脚本、测试都不用改;别的设备在 /parent、/dev 上输一次 PIN,拿一枚 HttpOnly cookie:HMAC 签的过期时间(90 天),不存会话表,重启 serve 还在。
 * - PIN 存 ~/.config/cotutor/pin.json(scrypt 哈希,不存明文),签 cookie 的密钥在同目录 secret;**改 PIN 换密钥**,所有设备重输。连错 5 次锁 60 秒(挡孩子的好奇心够了)。
 * - 白名单而不是黑名单:漏一条孩子端坏,马上看得见;黑名单漏一条就是又一个洞。
 * - PIN 不放 cotutor.json:它能被工作台的 PATCH /api/config 改;放机器级和证书一样,几个孩子的 workspace 共用一个。
 * 想想为什么不是「只许 loopback」:家长的主设备是 iPad(扫码进 /parent,打星、记账、删话题都在上面),工作台在手机上也要能开(侧栏收成顶上一条)。
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { USER_CONFIG } from '../workspace.ts';
import { DEV_CSS } from '../../ui/dev/dev-theme.ts';
import { BRAND_FOOTER } from '../../ui/shared/brand.ts';

/** 请求是谁发的:local = 本机(免密);parent = 带着有效 cookie;anon = 别的设备、没凭证 */
export type Who = 'local' | 'parent' | 'anon';

export const USER_PIN_FILE = join(dirname(USER_CONFIG), 'pin.json');
export const USER_SECRET_FILE = join(dirname(USER_CONFIG), 'secret');
export const COOKIE_NAME = 'cotutor_parent';
/** cookie 活多久:90 天;到了在 iPad 上再输一次 */
export const COOKIE_DAYS = 90;
export const PIN_RE = /^\d{4,8}$/;
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

interface PinRecord {
  salt: string;
  hash: string;
  at: string;
}

/** 孩子端的路径:设了 PIN 也开;别的都要凭证。改孩子端加了新接口要来这里登记(tests/access.test.ts 盯着孩子端页面源码里用到的每条) */
const KID_EXACT = new Set(['/', '/manifest.webmanifest', '/favicon.svg', '/favicon-32.png', '/favicon.ico', '/api/health', '/api/auth', '/dictation', '/dictation/', '/talk', '/talk/', '/api/dictation', '/api/talk']);
const KID_PREFIX = ['/kid/', '/stage/', '/api/kid/', '/api/audio/', '/api/bundles/', '/api/dictation/', '/api/talk/', '/api/live/'];
export function isKidPath(p: string): boolean {
  return KID_EXACT.has(p) || KID_PREFIX.some((x) => p.startsWith(x)) || /^\/icon-\d{2,4}\.png$/.test(p);
}

export async function readPin(file = USER_PIN_FILE): Promise<PinRecord | null> {
  try {
    const j = JSON.parse(await readFile(file, 'utf8')) as Partial<PinRecord>;
    return typeof j.salt === 'string' && typeof j.hash === 'string' ? { salt: j.salt, hash: j.hash, at: j.at ?? '' } : null;
  } catch {
    return null;
  }
}

const hashPin = (pin: string, salt: string): string => scryptSync(pin, salt, 32).toString('hex');

/** 设 PIN(4–8 位数字):写哈希,换签 cookie 的密钥(所有设备重输) */
export async function setPin(pin: string, files: { pin?: string; secret?: string } = {}): Promise<void> {
  if (!PIN_RE.test(pin)) throw new Error('PIN 要 4 到 8 位数字');
  const pinFile = files.pin ?? USER_PIN_FILE;
  await mkdir(dirname(pinFile), { recursive: true });
  const salt = randomBytes(16).toString('hex');
  await writeFile(pinFile, `${JSON.stringify({ salt, hash: hashPin(pin, salt), at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  await writeFile(files.secret ?? USER_SECRET_FILE, randomBytes(32).toString('hex'), { mode: 0o600 });
}

/** 撤掉 PIN:回到全开 */
export async function clearPin(files: { pin?: string; secret?: string } = {}): Promise<void> {
  await rm(files.pin ?? USER_PIN_FILE, { force: true });
  await rm(files.secret ?? USER_SECRET_FILE, { force: true });
}

export function verifyPin(pin: string, rec: PinRecord): boolean {
  if (!PIN_RE.test(pin)) return false;
  const a = Buffer.from(hashPin(pin, rec.salt), 'hex');
  const b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const sign = (secret: string, exp: number): string => createHmac('sha256', secret).update(String(exp)).digest('hex');
/** 令牌 = 过期时刻.签名;只认签名对、没过期的 */
export function signToken(secret: string, exp: number): string {
  return `${exp}.${sign(secret, exp)}`;
}
export function verifyToken(secret: string, token: string, now: number): boolean {
  const m = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!(exp > now)) return false;
  const a = Buffer.from(m[2], 'hex');
  const b = Buffer.from(sign(secret, exp), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieOf(header: string | undefined, name = COOKIE_NAME): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLoopback = (addr: string | undefined): boolean => LOOPBACK.has(addr ?? '');

export interface LoginResult {
  ok: boolean;
  /** ok 时 Set-Cookie 的值 */
  cookie?: string;
  /** 连错锁着:还要等多少毫秒 */
  retryMs?: number;
}

export interface Access {
  pinSet(): Promise<boolean>;
  login(pin: string, opts?: { secure?: boolean }): Promise<LoginResult>;
  whoOf(req: { headers: { cookie?: string }; socket: { remoteAddress?: string } }): Promise<Who>;
}

export function createAccess(opts: { now?: () => Date; files?: { pin?: string; secret?: string } } = {}): Access {
  const now = (): number => (opts.now ?? (() => new Date()))().getTime();
  const files = { pin: opts.files?.pin ?? USER_PIN_FILE, secret: opts.files?.secret ?? USER_SECRET_FILE };
  let fails = 0;
  let lockedUntil = 0;
  const secret = async (): Promise<string | null> => readFile(files.secret, 'utf8').then((s) => s.trim() || null, () => null);
  return {
    pinSet: async () => (await readPin(files.pin)) !== null,
    async login(pin, o = {}) {
      const rec = await readPin(files.pin);
      if (!rec) return { ok: false };
      const t = now();
      if (t < lockedUntil) return { ok: false, retryMs: lockedUntil - t };
      if (!verifyPin(pin, rec)) {
        fails++;
        if (fails >= MAX_FAILS) { fails = 0; lockedUntil = t + LOCK_MS; return { ok: false, retryMs: LOCK_MS }; }
        return { ok: false };
      }
      fails = 0;
      const key = await secret();
      if (!key) return { ok: false };
      const maxAge = COOKIE_DAYS * 86400;
      const token = signToken(key, t + maxAge * 1000);
      return { ok: true, cookie: `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${o.secure ? '; Secure' : ''}` };
    },
    async whoOf(req) {
      if (isLoopback(req.socket.remoteAddress)) return 'local';
      const token = cookieOf(req.headers.cookie);
      if (!token) return 'anon';
      const key = await secret();
      return key && verifyToken(key, token, now()) ? 'parent' : 'anon';
    },
  };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 没凭证的设备开家长端 / 工作台看到的那页:输 PIN,对了原地重载。孩子端的源码里没有它;mock 不接 */
export function gatePage(title: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · 家长</title>
<style>
${DEV_CSS}
  body { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px 16px; }
  .gate { width:100%; max-width:360px; padding:28px 24px; box-shadow:var(--lift); }
  .gate h1 { margin:0 0 4px; font:600 18px/1.3 var(--sans); }
  .gate p { margin:0 0 18px; color:var(--muted); font-size:13px; }
  .gate input { width:100%; height:48px; padding:0 14px; border:0; border-radius:var(--r-ctl); background:var(--sunk); font:600 22px/1 var(--mono); letter-spacing:.3em; text-align:center; }
  .gate .btn { width:100%; height:44px; margin-top:12px; justify-content:center; font-size:15px; }
  .gate .msg { min-height:20px; margin-top:10px; font-size:13px; color:var(--err); }
  .gate small { display:block; margin-top:16px; color:var(--faint); font-size:12px; }
</style>
</head>
<body>
<form class="gate card-w" id="gate" autocomplete="off">
  <h1>家长的页</h1>
  <p>${esc(title)}:输一次这台电脑上设的 PIN,这台设备以后就不用再输。</p>
  <input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="8" aria-label="家长 PIN" autofocus>
  <button class="btn primary" type="submit">进去</button>
  <div class="msg" id="msg" role="alert"></div>
  <small>忘了?在电脑上重设:<code>cotutor pin</code>;不想要锁:<code>cotutor pin off</code>。</small>
</form>
${BRAND_FOOTER}
<script>
(() => {
  const f = document.getElementById('gate'), pin = document.getElementById('pin'), msg = document.getElementById('msg');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: pin.value }) }).catch(() => null);
    if (r && r.ok) { location.reload(); return; }
    let j = null; try { j = r ? await r.json() : null; } catch {}
    msg.textContent = j && j.retryMs ? '连错几次了,等 ' + Math.ceil(j.retryMs / 1000) + ' 秒再试' : '不对,再试一次';
    pin.value = ''; pin.focus();
  });
})();
</script>
</body>
</html>
`;
}
