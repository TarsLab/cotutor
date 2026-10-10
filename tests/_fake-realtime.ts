/**
 * 假百炼 realtime(口语课的测试与探针用,不花钱):一个 http 服务,升级后照 realtime 的事件说话。
 *   session.created → 收 session.update 回 session.updated(喂过音频再改 silence 就报错,和真的一样)
 *   append 记字节;手动 commit → committed + 孩子转写;response.create → created、一块 4800 字节的声音、字幕、done(带 usage)
 *   VAD 会话(turn_detection 非空):收到有声的块 → speech_started;有声之后收到全零的块 → speech_stopped、committed、转写、自动回一次
 *   long = true 时回答只出一半、不 done(等 cancel);cancel 在有回答时回 done:cancelled,没有就报错
 */
import { createServer, type Server } from 'node:http';
import { acceptWebSocket, isUpgrade, type ServerSocket } from '../src/talk/ws.ts';

export interface FakeConn {
  sock: ServerSocket;
  session: Record<string, any> | null;
  updates: unknown[];
  audio: number;
  items: Record<string, any>[];
  commits: number;
  clears: number;
  creates: number;
  cancels: number;
  closed: boolean;
}

export interface FakeRealtime {
  endpoint: string;
  conns: FakeConn[];
  /** 下一次回答只出一半、不 done */
  long: boolean;
  /** 配会话时就报错 */
  failUpdate: boolean;
  /** 发了 created 就断 */
  dropEarly: boolean;
  /** 孩子那句转写成什么 */
  kidText: string;
  close(): void;
}

export async function startFakeRealtime(): Promise<FakeRealtime> {
  const server: Server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const fake: FakeRealtime = { endpoint: '', conns: [], long: false, failUpdate: false, dropEarly: false, kidText: "It's a red car.", close: () => { for (const c of fake.conns) c.sock.close(); server.close(); } };
  server.on('upgrade', (req, socket, head) => {
    if (!isUpgrade(req)) { socket.destroy(); return; }
    let active = 0;
    let speaking = false;
    const c: FakeConn = { sock: null as unknown as ServerSocket, session: null, updates: [], audio: 0, items: [], commits: 0, clears: 0, creates: 0, cancels: 0, closed: false };
    const send = (o: unknown): boolean => c.sock.sendText(JSON.stringify(o));
    const respond = (): void => {
      c.creates++;
      active++;
      send({ type: 'response.created' });
      send({ type: 'response.audio.delta', delta: Buffer.alloc(4800, 1).toString('base64') });
      send({ type: 'response.audio_transcript.delta', delta: "It's a " });
      if (fake.long) return;
      send({ type: 'response.audio_transcript.delta', delta: 'red car.' });
      send({ type: 'response.audio_transcript.done', transcript: "It's a red car." });
      active--;
      send({ type: 'response.done', response: { status: 'completed', usage: { input_tokens: 865, output_tokens: 28, input_token_details: { audio_tokens: 30 }, output_token_details: { audio_tokens: 20 } } } });
    };
    const transcribe = (): void => { send({ type: 'input_audio_buffer.committed' }); send({ type: 'conversation.item.input_audio_transcription.completed', transcript: ` ${fake.kidText} ` }); };
    c.sock = acceptWebSocket(req, socket, head, {
      onText: (text) => {
        const m = JSON.parse(text) as Record<string, any>;
        if (m.type === 'session.update') {
          c.updates.push(m.session);
          if (!c.session) c.session = m.session;
          if (fake.failUpdate) { send({ type: 'error', error: { code: 'bad', message: 'Voice not supported' } }); return; }
          if (fake.dropEarly) return;
          const td = m.session?.turn_detection;
          if (c.audio > 0 && td && td.silence_duration_ms) { send({ type: 'error', error: { message: 'turn_detection.silence_duration_ms cannot change after audio append' } }); return; }
          if (c.updates.length > 1 && c.session) c.session = { ...c.session, ...m.session };
          send({ type: 'session.updated', session: { turn_detection: td ?? null } });
        } else if (m.type === 'input_audio_buffer.append') {
          const buf = Buffer.from(String(m.audio), 'base64');
          c.audio += buf.length;
          if (c.session?.turn_detection) {
            const loud = buf.some((b) => b !== 0);
            if (loud && !speaking) { speaking = true; send({ type: 'input_audio_buffer.speech_started' }); }
            else if (!loud && speaking) { speaking = false; send({ type: 'input_audio_buffer.speech_stopped' }); transcribe(); respond(); }
          }
        } else if (m.type === 'input_audio_buffer.commit') { c.commits++; transcribe(); }
        else if (m.type === 'input_audio_buffer.clear') c.clears++;
        else if (m.type === 'conversation.item.create') c.items.push(m.item);
        else if (m.type === 'response.cancel') { c.cancels++; if (active) { active--; send({ type: 'response.done', response: { status: 'cancelled' } }); } else send({ type: 'error', error: { message: 'no active response' } }); }
        else if (m.type === 'response.create') respond();
      },
      onClose: () => { c.closed = true; },
    });
    fake.conns.push(c);
    send({ type: 'session.created', session: { voice: 'Tina' } });
    if (fake.dropEarly) setTimeout(() => c.sock.close(1011, 'bye'), 30);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  fake.endpoint = `ws://127.0.0.1:${(server.address() as { port: number }).port}/api-ws/v1/realtime?model=test`;
  return fake;
}
