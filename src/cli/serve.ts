/**
 * cotutor serve:一 workspace 一进程(2026-09-08 拍板),端口读 cotutor.json(--port 覆盖)。
 * 启动打印解析结果与体检警告(配置坏了直接不起,骨架缺失只警告)。
 */
import { createServer, type Server } from 'node:http';
import { hostname } from 'node:os';
import { doctorWorkspace } from './doctor.ts';
import { createHandler } from '../server/app.ts';
import { loadWorkspace, type ResolveOptions, type Workspace } from './workspace.ts';

export interface ServeOptions extends ResolveOptions {
  workspace?: string;
  port?: number;
  host?: string;
}

export interface ServeResult {
  server: Server;
  ws: Workspace;
  port: number;
  url: string;
  warnings: string[];
}

export async function serveWorkspace(opts: ServeOptions = {}): Promise<ServeResult> {
  const ws = loadWorkspace(opts.workspace, opts);
  const report = await doctorWorkspace(ws.root, { ...opts, probeEnv: false });
  const warnings = report.checks.filter((c) => !c.ok).map((c) => `${c.name}:${c.detail}${c.fix ? `(${c.fix})` : ''}`);
  const port = opts.port ?? ws.config.server.port;
  const server = createServer(createHandler(ws));
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, opts.host ?? '0.0.0.0', () => resolveListen());
  });
  const actual = (server.address() as { port: number }).port;
  return { server, ws, port: actual, url: `http://${hostname()}:${actual}/`, warnings };
}
