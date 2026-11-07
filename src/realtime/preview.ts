/**
 * 试听嘴的一个音色(工作台音色页「实时的嘴」):真连一次百炼 realtime,让它照念一句(同实时老师的照念指令),收下 24k PCM 包成 wav。
 * 几分钱一次;调用方按「音色 + 句子」缓存,同一句同一个音色只念一次。
 */
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readCue } from './cues.ts';
import { wavOfPcm } from '../shared/wav.ts';
import { OUTPUT_RATE, REALTIME_MODEL, RealtimeSession, dashscopeAuth, endpointOf } from './bailian.ts';

export async function previewVoice(o: { voice: string; text: string; model?: string; env?: NodeJS.ProcessEnv; endpoint?: string; timeoutMs?: number }): Promise<{ wav: Buffer } | { error: string }> {
  const chunks: Buffer[] = [];
  let err = '';
  let done = false;
  const s = new RealtimeSession({ instructions: '你是一位小学老师。', voice: o.voice, model: o.model, turn: 'manual', env: o.env, endpoint: o.endpoint }, {
    onAudio: (pcm) => { chunks.push(pcm); },
    onError: (m) => { err = m; },
    onResponse: (st) => { if (st === 'done') done = true; },
  });
  const why = await s.connect();
  if (why !== null) return { error: why === 'no_auth' ? '没有百炼的 key 或业务空间 id(家长端「首页」里填,存在 ~/.config/cotutor/bailian.json)' : `连不上:${why}` };
  s.createResponse(readCue([o.text]));
  const until = Date.now() + (o.timeoutMs ?? 20_000);
  while (!done && !err && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  s.close('preview');
  if (err) return { error: err };
  if (!chunks.length) return { error: done ? '没出声' : '超时' };
  return { wav: wavOfPcm(Buffer.concat(chunks), OUTPUT_RATE) };
}

/** 试连一次(家长端配百炼、doctor --live):握手到 session.updated 就挂,不出声、不花钱;null = 通,否则是原因(no_auth / connect / timeout / 服务端的话) */
export async function probeRealtime(o: { auth?: { key: string; workspaceId: string }; model?: string; env?: NodeJS.ProcessEnv; endpoint?: string; timeoutMs?: number } = {}): Promise<string | null> {
  const s = new RealtimeSession({ instructions: '试连。', turn: 'manual', model: o.model, auth: o.auth, env: o.env, endpoint: o.endpoint, timeoutMs: o.timeoutMs }, {});
  const why = await s.connect();
  s.close('probe');
  if (why !== null && UNCLEAR.test(why)) return (await askRealtime(o)) ?? why;
  return why;
}

/** WebSocket 只告诉我们「连不上」的那几种:握手被拒、连上又断 */
const UNCLEAR = /^(connect|closed:)/;
export const unclearWhy = (why: string): boolean => UNCLEAR.test(why);

/**
 * 连不上时问清原因。Node 的 WebSocket 客户端握手被拒只给 error,看不到状态码,key 错和断网一个样;
 * 同一个地址发一次普通的升级请求,被拒时百炼回 401 和 {"code":"InvalidApiKey"}(2026-11-07 假 key 实测)。不花钱,升级成了也当场断。
 * 回错误码,没有错误码回 http:<状态码>;答应升级了回 null(key 是好的,刚才那次是别的原因);根本连不上回 network。
 */
export function askRealtime(o: { auth?: { key: string; workspaceId: string }; model?: string; env?: NodeJS.ProcessEnv; endpoint?: string; timeoutMs?: number } = {}): Promise<string | null> {
  const auth = o.endpoint ? null : o.auth ?? dashscopeAuth(o.env);
  if (!o.endpoint && !auth) return Promise.resolve('no_auth');
  const url = new URL((o.endpoint ?? endpointOf((auth as { workspaceId: string }).workspaceId, o.model ?? REALTIME_MODEL)).replace(/^ws/, 'http'));
  return new Promise((resolve) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, {
      method: 'GET',
      timeout: o.timeoutMs ?? 5000,
      headers: { authorization: `Bearer ${auth?.key ?? 'sk-test'}`, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64') },
    });
    req.on('upgrade', (_res, socket) => { socket.destroy(); resolve(null); });
    req.on('response', (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { if (body.length < 4096) body += c; });
      res.on('end', () => {
        // 只取错误码:别的留给人看没用,也不让对面的长文本跟着往下传
        const code = /"code"\s*:\s*"([A-Za-z0-9_.-]{2,64})"/.exec(body)?.[1];
        resolve(code ?? `http:${res.statusCode ?? 0}`);
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve('network'));
    req.end();
  });
}
