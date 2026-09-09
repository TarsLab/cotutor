/**
 * cotutor serve:一 workspace 一进程(2026-09-08 拍板),端口读 cotutor.json(--port 覆盖)。
 * 启动打印解析结果与体检警告(配置坏了直接不起,骨架缺失只警告)。
 * HTTPS(iPad 上录音要):server.https 指了证书就用它;没指就看 certs/cert.pem + certs/key.pem(cotutor cert 用 mkcert 建);都没有走 HTTP。
 */
import { readFileSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { doctorWorkspace } from './doctor.ts';
import { createContext, createHandler, type AppContext } from '../server/app.ts';
import { expandPath, loadWorkspace, type ResolveOptions, type Workspace } from './workspace.ts';

export interface ServeOptions extends ResolveOptions {
  workspace?: string;
  port?: number;
  host?: string;
  /** 强制走 HTTP(哪怕证书在) */
  http?: boolean;
}

export interface ServeResult {
  server: Server;
  ctx: AppContext;
  ws: Workspace;
  port: number;
  https: boolean;
  /** 本机名与局域网 IPv4 各一条 */
  urls: string[];
  /** 兼容:urls[0] */
  url: string;
  warnings: string[];
}

export const CERT_DIR = 'certs';

/** 证书路径:配置优先,否则约定目录;都没有 → null */
export function httpsFiles(ws: Workspace): { cert: string; key: string } | null {
  const h = ws.config.server.https;
  if (h) return { cert: expandPath(h.cert, ws.root), key: expandPath(h.key, ws.root) };
  const cert = join(ws.root, CERT_DIR, 'cert.pem');
  const key = join(ws.root, CERT_DIR, 'key.pem');
  try {
    readFileSync(cert);
    readFileSync(key);
    return { cert, key };
  } catch {
    return null;
  }
}

/** 局域网 IPv4(iPad 用它访问;.local 名不一定解析得到) */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

export async function serveWorkspace(opts: ServeOptions = {}): Promise<ServeResult> {
  const ws = loadWorkspace(opts.workspace, opts);
  const report = await doctorWorkspace(ws.root, { ...opts, probeEnv: false });
  const warnings = report.checks.filter((c) => !c.ok).map((c) => `${c.name}:${c.detail}${c.fix ? `(${c.fix})` : ''}`);
  const port = opts.port ?? ws.config.server.port;
  const ctx = createContext(ws);
  const handler = createHandler(ctx);
  const tls = opts.http ? null : httpsFiles(ws);
  const server = tls ? createHttps({ cert: readFileSync(tls.cert), key: readFileSync(tls.key) }, handler) : createHttp(handler);
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, opts.host ?? '0.0.0.0', () => resolveListen());
  });
  const actual = (server.address() as { port: number }).port;
  const scheme = tls ? 'https' : 'http';
  const urls = [hostname(), ...lanAddresses()].map((h) => `${scheme}://${h}:${actual}/`);
  return { server, ctx, ws, port: actual, https: Boolean(tls), urls, url: urls[0], warnings };
}
