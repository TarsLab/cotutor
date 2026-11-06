/**
 * cotutor serve:一 workspace 一进程,端口读 cotutor.json(--port 覆盖)。
 * 启动打印解析结果与体检警告(配置坏了直接不起,骨架缺失只警告)。
 * 扫码页:/qr 现画一张二维码(编 <本机名>.local 那条,不随 Wi-Fi 变),iPad 用相机扫;listen 之后把真端口交给 ctx.listen。
 * HTTPS(iPad 上录音要):server.https 指了证书就用它(单个 workspace 的例外);没指就看机器级 ~/.config/cotutor/certs/(cotutor cert 用 mkcert 建);都没有走 HTTP。
 * macOS:有通话开着、或有老师在写,就拦着这台电脑闲置睡眠(caffeinate -i);闲着不拦(家长定)。网络流量挡不住闲置睡眠,上着课没人碰 Mac 也会睡过去。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { doctorWorkspace } from './doctor.ts';
import type { ListenInfo } from '../../ui/parent/qr-page.ts';
import { createContext, createHandler, type AppContext } from '../http/app.ts';
import { liveUpgrade } from '../ws/route.ts';
import { AUTO_BOOKKEEP_EVERY_MS, autoBookkeep } from '../../runtime/auto-bookkeep.ts';
import { USER_CERT_DIR, expandPath, loadWorkspace, type ResolveOptions, type Workspace } from '../workspace.ts';

export interface ServeOptions extends ResolveOptions {
  workspace?: string;
  port?: number;
  host?: string;
  /** 强制走 HTTP(哪怕证书在) */
  http?: boolean;
  /** macOS 上有事时拦着睡眠;缺省开 */
  awake?: boolean;
}

export interface ServeResult {
  server: Server;
  ctx: AppContext;
  ws: Workspace;
  port: number;
  https: boolean;
  /** 本机名与局域网 IPv4 各一条 */
  urls: string[];
  /** 家长端首页:在这台电脑上打开的那条(localhost,证书里签了);serve 只打印它,扫码在它里面 */
  parentPage: string;
  warnings: string[];
}

/** 证书路径:cotutor.json 的 server.https 优先(相对 workspace 根),否则机器级 ~/.config/cotutor/certs/;都没有 → null */
export function httpsFiles(ws: Workspace): { cert: string; key: string } | null {
  const h = ws.config.server.https;
  if (h) return { cert: expandPath(h.cert, ws.root), key: expandPath(h.key, ws.root) };
  const cert = join(USER_CERT_DIR, 'cert.pem');
  const key = join(USER_CERT_DIR, 'key.pem');
  try {
    readFileSync(cert);
    readFileSync(key);
    return { cert, key };
  } catch {
    return null;
  }
}

/** 局域网 IPv4(iPad / iPhone 用它访问;.local 名不一定解析得到,有些设备还会挑中走不通的 IPv6) */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

/** 本机的 mDNS 名(与 cotutor cert 签的那条同一个写法) */
export function localName(host: string = hostname()): string {
  return host.endsWith('.local') ? host : `${host}.local`;
}

/** 证书认不认这个主机名;读不了当作不认 */
export function certCovers(certFile: string, host: string): boolean {
  try {
    return new X509Certificate(readFileSync(certFile)).checkHost(host) !== undefined;
  } catch {
    return false;
  }
}

/** 扫码页要的三样;listen 之后才知道真端口 */
export function listenInfo(https: boolean, port: number): ListenInfo {
  const scheme = https ? 'https' : 'http';
  const ip = lanAddresses()[0];
  return { name: `${scheme}://${localName()}:${port}/`, ip: ip ? `${scheme}://${ip}:${port}/` : null, https };
}

export async function serveWorkspace(opts: ServeOptions = {}): Promise<ServeResult> {
  const ws = loadWorkspace(opts.workspace, opts);
  // 不探 CLI(起服务不用等它);防火墙要查:平板连不上时这里是家长唯一看得到提醒的地方
  const report = await doctorWorkspace(ws.root, { ...opts, probeEnv: false, firewall: true });
  const warnings = report.checks.filter((c) => !c.ok).map((c) => `${c.name}:${c.detail}${c.fix ? `(${c.fix})` : ''}`);
  const port = opts.port ?? ws.config.server.port;
  const ctx = createContext(ws);
  const handler = createHandler(ctx);
  const tls = opts.http ? null : httpsFiles(ws);
  const server = tls ? createHttps({ cert: readFileSync(tls.cert), key: readFileSync(tls.key) }, handler) : createHttp(handler);
  // WebSocket:实时老师的那条线(src/app/ws/);不认就关掉
  server.on('upgrade', (req, socket, head) => { void liveUpgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }, () => socket.destroy()); });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, opts.host ?? '0.0.0.0', () => resolveListen());
  });
  const actual = (server.address() as { port: number }).port;
  const scheme = tls ? 'https' : 'http';
  const urls = [hostname(), ...lanAddresses()].map((h) => `${scheme}://${h}:${actual}/`);
  ctx.listen = () => listenInfo(Boolean(tls), actual);
  // 自动记账(cotutor.json vault.autoBookkeep,缺省关;src/runtime/auto-bookkeep.ts):隔一阵看一次,开关跟着 cotutor.json 热重载;上一次没跑完不叠
  let booking = false;
  const timer = setInterval(() => {
    if (booking) return;
    booking = true;
    void (async () => {
      await ctx.reload();
      await autoBookkeep(ctx.runner, ctx.ws, ctx.now());
    })().catch(() => undefined).finally(() => { booking = false; });
  }, AUTO_BOOKKEEP_EVERY_MS);
  timer.unref();
  server.once('close', () => clearInterval(timer));
  if (opts.awake !== false) {
    const stop = holdAwake(() => liveUpgrade.openCalls() > 0 || Object.keys(ctx.ws.config.tutors).some((t) => ctx.runner.running(t) !== null));
    server.once('close', stop);
  }
  if (tls && !certCovers(tls.cert, localName())) warnings.push(`证书不含 ${localName()}:扫码打开会报「不安全」(重跑 cotutor cert,再重启 serve)`);
  return { server, ctx, ws, port: actual, https: Boolean(tls), urls, parentPage: `${scheme}://localhost:${actual}/parent/home`, warnings };
}

/** 多久看一次有没有事 */
const AWAKE_CHECK_MS = 15_000;

/**
 * macOS:busy() 为真就起一个 caffeinate -i(拦闲置睡眠;-w 跟着这个进程,serve 没了它自己退),为假就停;别的系统什么都不做。
 * 合盖照样睡(那是家长的事,iPad 那篇写着);返回停掉的函数
 */
export function holdAwake(busy: () => boolean, platform: NodeJS.Platform = process.platform, everyMs = AWAKE_CHECK_MS): () => void {
  if (platform !== 'darwin') return () => {};
  let child: ChildProcess | null = null;
  const tick = (): void => {
    const b = busy();
    if (b && !child) {
      const c = spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
      c.on('error', () => { if (child === c) child = null; });
      c.on('exit', () => { if (child === c) child = null; });
      child = c;
    } else if (!b && child) {
      child.kill();
      child = null;
    }
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return () => { clearInterval(timer); child?.kill(); child = null; };
}
