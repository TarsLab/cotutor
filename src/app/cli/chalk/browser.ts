/**
 * 做课包用的浏览器(2026-10-31 替掉 drawtell 的 playwright):起本机的 Chrome(无头、自己的临时 profile,不碰平时用的那个),
 * 走 DevTools 协议(CDP)开页面、等、取值、截图。不另装浏览器:烤画面、截图与孩子端是同一种渲染就够。
 * 每条命令都有超时(回包不来就报错,不挂着);收尾杀进程、删临时 profile,出错也在 finally 里收(scripts/_guard.mjs 那次的教训:无头 Chrome 挂了两天)。
 * Chrome 在哪:环境变量 CHROME > macOS 的 /Applications/Google Chrome.app > PATH 里的 google-chrome / chromium。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
/** 一条 CDP 命令最多等多久 */
const SEND_MS = 60_000;

/** 本机 Chrome 的可执行文件;找不到 null */
export function chromePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const set = env.CHROME?.trim();
  if (set) return existsSync(set) ? set : null;
  if (process.platform === 'darwin' && existsSync(MAC_CHROME)) return MAC_CHROME;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    for (const name of PATH_NAMES) if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  return null;
}

export interface Page {
  goto(url: string): Promise<void>;
  /** 轮询到页面里这个表达式为真;超时报错 */
  waitFor(expr: string, timeoutMs?: number): Promise<void>;
  evaluate<T>(expr: string): Promise<T>;
  /** 截一个元素(CSS 选择器)那一块,png */
  screenshot(selector: string): Promise<Buffer>;
}

/** Chrome 起来时在 stderr 报 DevTools 的地址 */
function devtoolsUrl(chrome: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let err = '';
    const timer = setTimeout(() => reject(new Error(`Chrome 15 秒没起来:${err.trim().slice(-300)}`)), 15_000);
    chrome.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    chrome.once('error', (e) => { clearTimeout(timer); reject(e); });
    chrome.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome 退出了(${code}):${err.trim().slice(-300)}`)); });
  });
}

type Send = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<Record<string, unknown>>;

async function connect(url: string): Promise<{ send: Send; close(): void }> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('连不上 Chrome 的 DevTools')), { once: true });
  });
  let seq = 0;
  const pending = new Map<number, { resolve(v: Record<string, unknown>): void; reject(e: Error): void; timer: NodeJS.Timeout }>();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
    const p = m.id === undefined ? undefined : pending.get(m.id);
    if (!p) return;
    pending.delete(m.id!);
    clearTimeout(p.timer);
    if (m.error) p.reject(new Error(m.error.message));
    else p.resolve(m.result ?? {});
  });
  const send: Send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome 没回 ${method}(${SEND_MS / 1000} 秒)`)); }, SEND_MS);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return {
    send,
    close() {
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('关了')); }
      pending.clear();
      ws.close();
    },
  };
}

/** 起一个 Chrome、开一页交给 fn;不论成败都收干净 */
export async function withBrowser<T>(fn: (page: Page) => Promise<T>, opts: { width?: number; height?: number; env?: NodeJS.ProcessEnv } = {}): Promise<T> {
  const bin = chromePath(opts.env);
  if (!bin) throw new Error('找不到 Chrome:装 Google Chrome,或环境变量 CHROME 指到 Chrome / Chromium 的可执行文件');
  const width = opts.width ?? 1280;
  const height = opts.height ?? 960;
  const profile = await mkdtemp(join(tmpdir(), 'cotutor-chalk-'));
  const chrome = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars', `--user-data-dir=${profile}`, '--remote-debugging-port=0', `--window-size=${width},${height}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const cdp = await connect(await devtoolsUrl(chrome));
    try {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const s = (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> => cdp.send(method, params, String(sessionId));
      await s('Page.enable');
      await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const evaluate = async <T>(expression: string): Promise<T> => {
        const r = (await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } };
        if (r.exceptionDetails) throw new Error(`页面里出错:${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? '?'}`);
        return r.result?.value as T;
      };
      const page: Page = {
        async goto(url) {
          const r = await s('Page.navigate', { url });
          if (typeof r.errorText === 'string' && r.errorText) throw new Error(`打不开 ${url}:${r.errorText}`);
        },
        async waitFor(expr, timeoutMs = 30_000) {
          const until = Date.now() + timeoutMs;
          while (!(await evaluate<boolean>(`Boolean(${expr})`).catch(() => false))) {
            if (Date.now() > until) throw new Error(`页面 ${timeoutMs / 1000} 秒没好(${expr})`);
            await new Promise((r) => setTimeout(r, 100));
          }
        },
        evaluate,
        async screenshot(selector) {
          const box = await evaluate<{ x: number; y: number; width: number; height: number } | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
          if (!box || box.width < 1 || box.height < 1) throw new Error(`页面里没有 ${selector}`);
          const r = await s('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } });
          return Buffer.from(String(r.data), 'base64');
        },
      };
      return await fn(page);
    } finally {
      cdp.close();
    }
  } finally {
    chrome.kill();
    await Promise.race([new Promise((r) => (chrome.exitCode !== null || chrome.signalCode !== null ? r(null) : chrome.once('exit', r))), new Promise((r) => setTimeout(r, 3000))]);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}
