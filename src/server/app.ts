/**
 * 服务的路由层:纯函数 route(method, path, ws) → {status, json|html},测试不用起端口。
 * R1 只有查询接口;发消息 / 会话 / 页面在 R2。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { listTeachers } from '../schema/index.ts';
import { workspaceReport, type Workspace } from '../cli/workspace.ts';

export interface RouteResult {
  status: number;
  json?: unknown;
  html?: string;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export function route(method: string, path: string, ws: Workspace): RouteResult {
  if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
  const url = new URL(path, 'http://x');
  switch (url.pathname) {
    case '/api/health':
      return { status: 200, json: { ok: true } };
    case '/api/workspace':
      return { status: 200, json: workspaceReport(ws) };
    case '/api/config':
      return {
        status: 200,
        json: { title: ws.config.title, kid: ws.config.kid, server: ws.config.server, agent: ws.config.agents.default, teachers: listTeachers(ws.config) },
      };
    case '/api/teachers':
      return { status: 200, json: listTeachers(ws.config, { kidOnly: url.searchParams.get('kid') === '1' }) };
    case '/': {
      const teachers = listTeachers(ws.config, { kidOnly: true })
        .map((t) => `<li>${esc(t.avatar ?? '')} ${esc(t.display)}${t.subject ? `<small> · ${esc(t.subject)}</small>` : ''}</li>`)
        .join('');
      return {
        status: 200,
        html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ws.config.title)}</title><h1>${esc(ws.config.title)}</h1><p>R1 骨架:老师们已就位,对话页在 R2。</p><ul>${teachers}</ul>`,
      };
    }
    default:
      return { status: 404, json: { error: 'not_found', path: url.pathname } };
  }
}

export function createHandler(ws: Workspace): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const r = route(req.method ?? 'GET', req.url ?? '/', ws);
    if (r.html !== undefined) {
      res.writeHead(r.status, { 'content-type': 'text/html; charset=utf-8' });
      res.end(r.html);
    } else {
      res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(r.json ?? null));
    }
  };
}
