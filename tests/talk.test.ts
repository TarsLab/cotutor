/**
 * 口语课的底层(《wip/口语课设想.md》§三),不花钱:
 * ws.ts 的帧与握手(Node 自带的 WebSocket 客户端连上来,文本 / 二进制 / 分片 / close);
 * realtime.ts 对一个假百炼:连上先 session.update、updated 才算好;喂音频、commit、response.create;声音与字幕回调;转写;cancel 只在有回答时发;
 * setTurn 的成与败;连接时报错、服务端断线都不抛。
 */
import { createServer } from 'node:http';
import { check, done } from './_check.ts';
import { acceptWebSocket, decodeFrame, encodeFrame, isUpgrade, acceptKey, type ServerSocket } from '../src/talk/ws.ts';
import { RealtimeSession, sessionConfig, turnDetection, endpointOf, type Usage } from '../src/talk/realtime.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 3000): Promise<boolean> => { const t = Date.now() + ms; while (!f() && Date.now() < t) await sleep(10); return f(); };

// ---- 帧 ----
function masked(opcode: number, payload: Buffer, fin = true): Buffer {
  const mask = Buffer.from([1, 2, 3, 4]);
  const len = payload.length;
  let head: Buffer;
  if (len < 126) { head = Buffer.alloc(2); head[1] = 0x80 | len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = (fin ? 0x80 : 0) | opcode;
  const body = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
  return Buffer.concat([head, mask, body]);
}
{
  const small = decodeFrame(masked(0x1, Buffer.from('hi')));
  const mid = decodeFrame(masked(0x2, Buffer.alloc(300, 7)));
  const big = decodeFrame(masked(0x2, Buffer.alloc(70000, 9)));
  check('解帧:三种长度、去掩码、opcode', small?.payload.toString() === 'hi' && small.fin && small.opcode === 1 && mid?.payload.length === 300 && mid.payload[299] === 7 && big?.payload.length === 70000 && big.size === 10 + 4 + 70000, JSON.stringify([small?.size, mid?.size, big?.size]));
  check('解帧:不够一帧回 null;客户端没掩码抛', decodeFrame(masked(0x1, Buffer.from('hello')).subarray(0, 5)) === null && (() => { try { decodeFrame(encodeFrame(0x1, Buffer.from('x'))); return false; } catch { return true; } })());
  const e = encodeFrame(0x2, Buffer.alloc(200));
  check('编帧:服务端不打掩码,126 长度形式', e[0] === 0x82 && e[1] === 126 && e.readUInt16BE(2) === 200 && e.length === 204);
  check('握手 key', acceptKey('dGhlIHNhbXBsZSBub25jZQ==') === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
}

// ---- 假百炼:一个 http 服务,升级后照 realtime 的样子回事件 ----
type Seen = { session?: Record<string, unknown>; updates: unknown[]; audio: number; items: unknown[]; commits: number; creates: number; cancels: number };
const conns: { sock: ServerSocket; seen: Seen }[] = [];
let mode: 'ok' | 'error-on-update' | 'close-after-created' = 'ok';
const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
server.on('upgrade', (req, socket, head) => {
  if (!isUpgrade(req)) { socket.destroy(); return; }
  const seen: Seen = { updates: [], audio: 0, items: [], commits: 0, creates: 0, cancels: 0 };
  let active = 0;
  const sock = acceptWebSocket(req, socket, head, {
    onText: (text) => {
      const m = JSON.parse(text) as Record<string, any>;
      const send = (o: unknown): boolean => sock.sendText(JSON.stringify(o));
      if (m.type === 'session.update') {
        seen.updates.push(m.session);
        if (!seen.session) seen.session = m.session;
        if (mode === 'error-on-update') { send({ type: 'error', error: { code: 'bad', message: 'Voice not supported' } }); return; }
        if (mode === 'close-after-created') return; // 不答,让它断在没配好的时候
        const td = m.session?.turn_detection;
        if (seen.audio > 0 && td && td.silence_duration_ms) { send({ type: 'error', error: { message: 'turn_detection.silence_duration_ms cannot change after audio append' } }); return; }
        send({ type: 'session.updated', session: { turn_detection: td ?? null } });
      } else if (m.type === 'input_audio_buffer.append') seen.audio += Buffer.from(String(m.audio), 'base64').length;
      else if (m.type === 'input_audio_buffer.commit') { seen.commits++; send({ type: 'input_audio_buffer.committed' }); send({ type: 'conversation.item.input_audio_transcription.completed', transcript: ' It\'s a red car. ' }); }
      else if (m.type === 'conversation.item.create') seen.items.push(m.item);
      else if (m.type === 'response.cancel') { seen.cancels++; if (active) { active--; send({ type: 'response.done', response: { status: 'cancelled' } }); } else send({ type: 'error', error: { message: 'no active response' } }); }
      else if (m.type === 'response.create') {
        seen.creates++;
        active++;
        send({ type: 'response.created' });
        const long = seen.items.some((it: any) => String(it?.content?.[0]?.text ?? '').includes('LONG'));
        send({ type: 'response.audio.delta', delta: Buffer.alloc(4800, 1).toString('base64') });
        send({ type: 'response.audio_transcript.delta', delta: 'It\'s a ' });
        if (long) return; // 留着,等 cancel
        send({ type: 'response.audio_transcript.delta', delta: 'red car.' });
        send({ type: 'response.audio_transcript.done', transcript: 'It\'s a red car.' });
        active--;
        send({ type: 'response.done', response: { status: 'completed', usage: { input_tokens: 865, output_tokens: 28, input_token_details: { audio_tokens: 30 }, output_token_details: { audio_tokens: 20 } } } });
      }
    },
  });
  conns.push({ sock, seen });
  sock.sendText(JSON.stringify({ type: 'session.created', session: { voice: 'Tina' } }));
  if (mode === 'close-after-created') setTimeout(() => sock.close(1011, 'bye'), 30);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

// ---- 裸 WebSocket:Node 自带的客户端连上来 ----
{
  const got: string[] = [];
  const bins: number[] = [];
  const closes: [number, string][] = [];
  const echo = createServer();
  echo.on('upgrade', (req, socket, head) => {
    const s = acceptWebSocket(req, socket, head, { onText: (t) => { got.push(t); s.sendText('re:' + t); }, onBinary: (b) => { bins.push(b.length); s.sendBinary(b); }, onClose: (c, r) => closes.push([c, r]) });
  });
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r));
  const ws = new WebSocket(`ws://127.0.0.1:${(echo.address() as { port: number }).port}/x`);
  ws.binaryType = 'arraybuffer';
  const back: unknown[] = [];
  ws.onmessage = (m) => back.push(m.data);
  await new Promise<void>((r) => { ws.onopen = () => r(); });
  ws.send('hello');
  ws.send(new Uint8Array(3200));
  ws.send('x'.repeat(70000));
  const ok1 = await until(() => back.length === 3);
  check('握手 + 文本 / 二进制 / 大帧来回', ok1 && got[0] === 'hello' && back[0] === 're:hello' && bins[0] === 3200 && (back[1] as ArrayBuffer).byteLength === 3200 && got[1]?.length === 70000, JSON.stringify([got.map((g) => g.length), bins, back.length]));
  ws.close(4001, 'done');
  const ok2 = await until(() => closes.length === 1);
  check('客户端 close:码与原因到服务端', ok2 && closes[0][0] === 4001 && closes[0][1] === 'done', JSON.stringify(closes));
  echo.close();
}

// ---- RealtimeSession ----
const endpoint = `ws://127.0.0.1:${port}/api-ws/v1/realtime?model=test`;
{
  const audio: Buffer[] = [];
  const tutor: [string, string | null][] = [];
  const kid: string[] = [];
  const resp: [string, string | null, Usage | null][] = [];
  const errors: string[] = [];
  let closed = '';
  const s = new RealtimeSession({ instructions: '你是英语老师', voice: 'Serena', turn: 'manual', endpoint, env: { DASHSCOPE_API_KEY: 'sk-x' } }, {
    onAudio: (b) => audio.push(b), onTutorText: (d, w) => tutor.push([d, w]), onKidText: (t) => kid.push(t), onResponse: (st, status, u) => resp.push([st, status, u]), onError: (m) => errors.push(m), onClose: (r) => { closed = r; },
  });
  check('没连上时发什么都回 false', !s.appendAudio(Buffer.alloc(10)) && !s.commit() && !s.createResponse() && !s.addText('x') && !s.isReady);
  const why = await s.connect();
  const c = conns[conns.length - 1];
  const sess = c.seen.session as Record<string, any>;
  check('连上:session.update 带人设、音色、PCM 16k 进 24k 出、手动轮次、转写模型;updated 后就绪', why === null && s.isReady && sess.instructions === '你是英语老师' && sess.audio?.output?.voice === 'Serena' && sess.audio?.input?.format?.sample_rate === 16000 && sess.audio?.output?.format?.sample_rate === 24000 && sess.turn_detection === null && sess.input_audio_transcription?.model === 'qwen3-asr-flash-realtime' && JSON.stringify(sess.modalities) === '["text","audio"]', JSON.stringify([why, sess]).slice(0, 400));
  s.addText('读这句:It\'s a red car.');
  s.appendAudio(Buffer.alloc(3200, 5));
  s.appendAudio(Buffer.alloc(1600, 5));
  s.commit();
  s.createResponse();
  const ok3 = await until(() => resp.some((r) => r[0] === 'done'));
  check('喂音频按字节到了;commit → 孩子转写(去空白);response.create → 声音块、字幕 delta 与整句、done 带 usage', ok3 && c.seen.audio === 4800 && c.seen.commits === 1 && kid[0] === 'It\'s a red car.' && audio[0]?.length === 4800 && tutor.filter((t) => t[1] === null).map((t) => t[0]).join('') === 'It\'s a red car.' && tutor.at(-1)?.[1] === 'It\'s a red car.' && resp[0][0] === 'created' && resp[1][1] === 'completed' && resp[1][2]?.input === 865 && resp[1][2]?.outputAudio === 20, JSON.stringify({ audio: c.seen.audio, kid, tutor, resp }).slice(0, 400));
  const item = c.seen.items[0] as Record<string, any>;
  check('addText 的形状:user 消息,input_text', item?.type === 'message' && item.role === 'user' && item.content?.[0]?.type === 'input_text' && item.content[0].text.startsWith('读这句'), JSON.stringify(item));
  check('没有回答在出时 cancel 不发', !s.cancel() && c.seen.cancels === 0 && !s.responding);
  s.addText('LONG');
  s.createResponse();
  await until(() => s.responding);
  const cancelled = s.cancel();
  const ok4 = await until(() => resp.some((r) => r[1] === 'cancelled'));
  check('有回答在出时 cancel 发了,回答 cancelled', cancelled && ok4 && c.seen.cancels === 1 && !s.responding, JSON.stringify(resp.slice(-2)));
  const t1 = await s.setTurn('semantic_vad');
  const t2 = await s.setTurn('manual');
  check('setTurn:切 VAD 只给 type(喂过音频 silence 改不了)、切回手动给 null;都等到 updated', t1 && t2 && s.turnMode === 'manual' && (c.seen.updates[1] as any)?.turn_detection?.type === 'semantic_vad' && (c.seen.updates[1] as any)?.turn_detection?.silence_duration_ms === undefined && (c.seen.updates[2] as any)?.turn_detection === null, JSON.stringify(c.seen.updates.slice(1)));
  check('服务端没报过错', errors.length === 0, errors.join('|'));
  s.close();
  check('close:onClose 一次,之后不再就绪', closed === 'bye' && !s.isReady);
}
{
  const td = turnDetection('semantic_vad', 1200) as Record<string, unknown>;
  check('turnDetection / sessionConfig:VAD 带 silence 与 interrupt;手动是 null', td.type === 'semantic_vad' && td.silence_duration_ms === 1200 && td.interrupt_response === true && turnDetection('manual', 800) === null && (sessionConfig({ instructions: 'x', voice: 'Tina', turn: 'server_vad', silenceMs: 900 }).turn_detection as Record<string, unknown>).silence_duration_ms === 900);
  check('端点按业务空间拼', endpointOf('llm-abc', 'm1') === 'wss://llm-abc.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=m1');
  const noAuth = new RealtimeSession({ instructions: 'x', env: { HOME: '/nonexistent' } });
  check('没 key / 业务空间 id:connect 回 no_auth', (await noAuth.connect()) === 'no_auth');
}
{
  mode = 'error-on-update';
  const errs: string[] = [];
  const s = new RealtimeSession({ instructions: 'x', endpoint, env: { DASHSCOPE_API_KEY: 'sk-x' } }, { onError: (m) => errs.push(m) });
  const why = await s.connect();
  check('配会话时服务端报错:connect 回它的话,不抛', why === 'bad: Voice not supported' && !s.isReady, JSON.stringify([why, errs]));
  mode = 'close-after-created';
  let closed = '';
  const s2 = new RealtimeSession({ instructions: 'x', endpoint, env: { DASHSCOPE_API_KEY: 'sk-x' }, timeoutMs: 2000 }, { onClose: (r) => { closed = r; } });
  const why2 = await s2.connect();
  check('还没配好服务端就断:connect 回 closed:码,onClose 一次', why2 === 'closed:1011' && closed.startsWith('closed:1011'), JSON.stringify([why2, closed]));
  mode = 'ok';
  const s3 = new RealtimeSession({ instructions: 'x', endpoint: `ws://127.0.0.1:1/x`, env: { DASHSCOPE_API_KEY: 'sk-x' }, timeoutMs: 2000 });
  const why3 = await s3.connect();
  check('连不上:connect 回 connect / closed,不抛', why3 !== null && !s3.isReady, String(why3));
}

for (const c of conns) c.sock.close();
server.close();
done();
