/**
 * cotutor serve:一 workspace 一进程,端口读 cotutor.json(--port 覆盖)。
 * 启动打印解析结果与体检警告(配置坏了直接不起,骨架缺失只警告)。
 * 扫码页:/qr 现画一张二维码(编 <电脑名>.local 那条,不随 Wi-Fi 变),iPad 用相机扫;listen 之后把真端口交给 ctx.listen。端口是 443 时地址里不写端口(siteUrl)。
 * HTTPS(iPad 上录音要):server.https 指了证书就用它(单个 workspace 的例外);没指就看机器级 ~/.config/cotutor/certs/(cotutor cert 用 mkcert 建);都没有走 HTTP。
 * 有通话开着、或有老师在写,就拦着这台电脑闲置睡眠(macOS caffeinate -i,Windows SetThreadExecutionState);闲着不拦(家长定)。网络流量挡不住闲置睡眠,上着课没人碰电脑也会睡过去。
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createServer as createHttp, type RequestListener, type Server } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import { rootCaFile } from './root-ca.ts';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { siteUrl } from '../../shared/site-url.ts';
import { doctorWorkspace } from './doctor.ts';
import { answersLocally } from './port.ts';
import { awakeScript, psArgs } from './service-windows.ts';
import type { ListenInfo } from '../../ui/parent/qr-page.ts';
import { createContext, createHandler, type AppContext } from '../http/app.ts';
import { liveUpgrade } from '../ws/route.ts';
import { startDailyBackups } from './backup.ts';
import { BUILD } from '../build.ts';
import { AUTO_BOOKKEEP_EVERY_MS, autoBookkeep } from '../../runtime/auto-bookkeep.ts';
import { USER_CERT_DIR, expandPath, loadWorkspace, type ResolveOptions, type Workspace } from '../workspace.ts';

export { siteUrl };

export interface ServeOptions extends ResolveOptions {
  workspace?: string;
  port?: number;
  host?: string;
  /** 强制走 HTTP(哪怕证书在) */
  http?: boolean;
  /** 有事时拦着睡眠;缺省开 */
  awake?: boolean;
}

export interface ServeResult {
  /** 用 https 时是前面那层(同一个端口分给 https 和 http);不用 https 就是 http 服务本身 */
  server: NetServer;
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
const BAILIAN_RECHECK_MS = 120_000;

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

/**
 * 这台电脑在局域网里的名字(不带 .local)。macOS 读「本地主机名」(系统设置 › 通用 › 共享 里那个,就是 Bonjour 名,改了系统才变);
 * 别的系统用 os.hostname()。读不到退回 os.hostname()。serve、证书、二维码都从这里拿
 */
export function computerName(platform: NodeJS.Platform = process.platform, read: () => string = () => execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }), fallback: string = hostname()): string {
  if (platform === 'darwin') {
    try {
      const name = read().trim();
      if (name) return name;
    } catch { /* 没设过本地主机名 */ }
  }
  return fallback.replace(/\.local$/i, '');
}

/** 读 scutil 要起一个进程,登录、发一条这些请求里都会问到:记一分钟 */
let nameCache: { at: number; name: string } | null = null;
function currentName(): string {
  const now = Date.now();
  if (!nameCache || now - nameCache.at > 60_000) nameCache = { at: now, name: computerName() };
  return nameCache.name;
}

/** 本机的 mDNS 名(与 cotutor cert 签的那条同一个写法) */
export function localName(name: string = currentName()): string {
  return name.endsWith('.local') ? name : `${name}.local`;
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
  return { name: siteUrl(scheme, localName(), port), ip: ip ? siteUrl(scheme, ip, port) : null, https };
}

/**
 * 用 https 时 http 那一面只做两件事:给根证书(平板扫码装证书,这时还不信任 https,所以走 http)、别的都跳到 https
 * (切到 https 以前开着的页面、旧书签、手输的 http 地址)。只给 rootCA.pem,私钥永远不给;找不到就说怎么弄。
 */
export function plainHandler(caFile: () => string | null): RequestListener {
  return (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && (path === '/ca.crt' || path === '/ca')) {
      const file = caFile();
      if (file && existsSync(file)) {
        res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="cotutor-ca.crt"', 'cache-control': 'no-store' });
        createReadStream(file).pipe(res);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('这台电脑上没找到根证书:先在电脑上跑 cotutor cert');
      return;
    }
    res.writeHead(301, { location: `https://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, 'cache-control': 'no-store' });
    res.end();
  };
}

/** 同一个端口既认 https 又认 http:看第一个字节,TLS 握手(0x16)交给 https,别的交给 http 那一面 */
export function httpAndHttps(secure: Server, plain: Server): NetServer {
  const front = createNetServer((sock) => {
    sock.on('error', () => undefined);
    sock.once('data', (first: Buffer) => {
      sock.pause();
      sock.unshift(first);
      (first[0] === 0x16 ? secure : plain).emit('connection', sock);
      process.nextTick(() => sock.resume());
    });
  });
  front.once('close', () => {
    for (const s of [secure, plain]) { s.close(); s.closeAllConnections(); }
  });
  return front;
}

export async function serveWorkspace(opts: ServeOptions = {}): Promise<ServeResult> {
  const ws = loadWorkspace(opts.workspace, opts);
  // 不探 CLI(起服务不用等它);防火墙要查:平板连不上时这里是家长唯一看得到提醒的地方
  const report = await doctorWorkspace(ws.root, { ...opts, probeEnv: false, firewall: true });
  const warnings = report.checks.filter((c) => !c.ok).map((c) => `${c.name}:${c.detail}${c.fix ? `(${c.fix})` : ''}`);
  const port = opts.port ?? ws.config.server.port;
  const ctx = createContext(ws);
  ctx.openCalls = () => liveUpgrade.openCalls();
  const handler = createHandler(ctx);
  const tls = opts.http ? null : httpsFiles(ws);
  const app = tls ? createHttps({ cert: readFileSync(tls.cert), key: readFileSync(tls.key) }, handler) : createHttp(handler);
  // WebSocket:实时老师的那条线(src/app/ws/);不认就关掉
  app.on('upgrade', (req, socket, head) => { void liveUpgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }, () => socket.destroy()); });
  // 用 https 时同一个端口也认 http(给平板装根证书、把 http 的跳过去)
  const caFile = tls ? await rootCaFile() : null;
  const server: NetServer = tls ? httpAndHttps(app, createHttp(plainHandler(() => caFile))) : app;
  // 别的程序只占着 127.0.0.1 时,绑通配地址照样成功:平板连到这边,这台电脑上开 localhost 却到了别的程序。先问一声,当被占处理(main.ts 接)
  if (port !== 0 && (await answersLocally(port))) throw Object.assign(new Error(`port ${port} answers on 127.0.0.1`), { code: 'EADDRINUSE', port });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, opts.host ?? '0.0.0.0', () => resolveListen());
  });
  const actual = (server.address() as { port: number }).port;
  const scheme = tls ? 'https' : 'http';
  const urls = [localName(), ...lanAddresses()].map((h) => siteUrl(scheme, h, actual));
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
  // 嘴连不上时隔一阵再试:充上钱、网回来了,没人点也会恢复,孩子端和图标跟着好
  const recheck = setInterval(() => { void ctx.bailian.recheck().catch(() => undefined); }, BAILIAN_RECHECK_MS);
  recheck.unref();
  server.once('close', () => clearInterval(recheck));
  // 每天备份一份(backup.ts):试用的不备;孩子在通话时往后推
  const stopBackups = startDailyBackups({
    target: () => (ctx.ws.sandbox ? null : { root: ctx.ws.root, vault: ctx.ws.paths.vault }),
    busy: () => liveUpgrade.openCalls() > 0,
    version: BUILD.version,
  });
  server.once('close', stopBackups);
  if (opts.awake !== false) {
    const stop = holdAwake(() => liveUpgrade.openCalls() > 0 || Object.keys(ctx.ws.config.tutors).some((t) => ctx.runner.running(t) !== null));
    server.once('close', stop);
  }
  if (tls && !certCovers(tls.cert, localName())) warnings.push(`证书不含 ${localName()}:多半是电脑名变了(改过名,或局域网里有同名设备时 macOS 会自动加 -2),扫码打开会报「不安全」。重跑 cotutor cert 再重启服务,平板重新扫码`);
  return { server, ctx, ws, port: actual, https: Boolean(tls), urls, parentPage: siteUrl(scheme, 'localhost', actual, '/parent/home'), warnings };
}

/** 多久看一次有没有事 */
const AWAKE_CHECK_MS = 15_000;

/**
 * busy() 为真就起一个拦闲置睡眠的子进程,为假就停;serve 没了它自己退:macOS 是 caffeinate -i -w <pid>,Windows 是一段 PowerShell(service-windows.ts 的 awakeScript);Linux 什么都不做。
 * 合盖照样睡(那是家长的事,iPad 那篇写着);返回停掉的函数
 */
export function holdAwake(busy: () => boolean, platform: NodeJS.Platform = process.platform, everyMs = AWAKE_CHECK_MS): () => void {
  if (platform !== 'darwin' && platform !== 'win32') return () => {};
  const start = (): ChildProcess => (platform === 'darwin'
    ? spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
    : spawn('powershell.exe', psArgs(awakeScript(process.pid)), { stdio: 'ignore', windowsHide: true }));
  let child: ChildProcess | null = null;
  const tick = (): void => {
    const b = busy();
    if (b && !child) {
      const c = start();
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
