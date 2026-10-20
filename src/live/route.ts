/**
 * 实时老师的那条 WebSocket(《wip/实时老师开发计划.md》P2.5):WS /api/live/<老师>/ws,一次连接一个 LiveCall(call.ts)。
 * serve.ts 的 upgrade 里接一行;没开(live.enabled)、老师不在 live.voices、老师关着都回 404,孩子端就走板书。
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { AppContext } from '../server/app.ts';
import { LiveCall } from './call.ts';
import { acceptWebSocket, isUpgrade } from './ws.ts';

export interface LiveRouteDeps {
  /** realtime 端点(测试、探针换假的);不给用真的 */
  endpoint?: string;
  env?: NodeJS.ProcessEnv;
  /** 测试:心跳间隔、多久没动静停跳、输入多少 token 换连接、多久没讲稿垫一句 */
  heartbeatMs?: number;
  keepAliveMs?: number;
  swapTokens?: number;
  fillMs?: number;
  onFinished?(tutor: string, why: string): void;
}

export function makeLiveUpgrade(deps: LiveRouteDeps = {}) {
  return async function liveUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, ctx: AppContext): Promise<boolean> {
    const m = /^\/api\/live\/([a-z0-9][a-z0-9-]*)\/ws(?:\?.*)?$/.exec(req.url ?? '');
    if (!m || !isUpgrade(req)) return false;
    const tutor = m[1];
    const cfg = ctx.ws.config;
    const refuse = (status: number, why: string): boolean => { socket.end(`HTTP/1.1 ${status} ${why}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return true; };
    if (!cfg.live.enabled) return refuse(404, 'live disabled');
    const t = cfg.tutors[tutor];
    if (!t || !t.enabled || t.hidden || !cfg.live.voices[tutor]) return refuse(404, 'not live');
    let call: LiveCall | null = null;
    const sock = acceptWebSocket(req, socket, head, {
      onText: (x) => call?.onText(x),
      onBinary: (b) => call?.onAudio(b),
      onClose: () => call?.onSocketClose(),
    });
    call = new LiveCall(sock, { ctx, tutor, endpoint: deps.endpoint, env: deps.env, heartbeatMs: deps.heartbeatMs, keepAliveMs: deps.keepAliveMs, swapTokens: deps.swapTokens, fillMs: deps.fillMs, onFinished: (why) => deps.onFinished?.(tutor, why) });
    void call.start();
    return true;
  };
}

/** 探针:COTUTOR_LIVE_ENDPOINT 指到假百炼(同口语课的 COTUTOR_TALK_ENDPOINT) */
export const liveUpgrade = makeLiveUpgrade(process.env.COTUTOR_LIVE_ENDPOINT ? { endpoint: process.env.COTUTOR_LIVE_ENDPOINT, env: { ...process.env, DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY ?? 'sk-probe' } } : {});
