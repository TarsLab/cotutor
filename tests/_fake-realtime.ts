/**
 * 假百炼 realtime(口语课的测试与探针用,不花钱):一个 http 服务,升级后照 realtime 的事件说话。
 *   session.created → 收 session.update 回 session.updated(喂过音频再改 silence 就报错,和真的一样)
 *   append 记字节;手动 commit → committed + 孩子转写(缓冲不到 100 毫秒、或 failCommit,同真的回 error「buffer too small」,没有转写);
 *   response.create → created、一块声音(缺省 100 毫秒 = 4800 字节,audioMs 改)、字幕、done(带 usage)
 *   VAD 会话(turn_detection 非空):收到有声的块(有采样过 300)→ speech_started;有声之后收到安静的块 → speech_stopped、committed、转写、自动回一次(create_response:false 不回);
 *   kidTexts 排着的先用(一段一句),vadReject > 0 这一段回「not accepted by semantic turn detection」(没有 committed),failTranscript 回转写失败
 *   long = true 时回答只出一半、不 done(等 cancel);cancel 在有回答时回 done:cancelled,没有就报错
 *   response.create 带 response.instructions(实时老师):记进 responses;指令里有「说完就停:「…」」(照念)就把引号里的当字幕说,别的照旧
 */
import { createServer, type Server } from 'node:http';
import { acceptWebSocket, isUpgrade, type ServerSocket } from '../src/live/ws.ts';

export interface FakeConn {
  sock: ServerSocket;
  session: Record<string, any> | null;
  updates: unknown[];
  audio: number;
  /** 收到几块图(input_image_buffer.append) */
  images: number;
  items: Record<string, any>[];
  commits: number;
  clears: number;
  creates: number;
  cancels: number;
  /** 每次 response.create 带的 response(没带是 null) */
  responses: ({ instructions?: string } | null)[];
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
  /** 孩子那句转写成什么;kidTexts 排着的先用(VAD 会话一段一句) */
  kidText: string;
  kidTexts: string[];
  /** VAD 会话:接下来几段 semantic_vad 不收 */
  vadReject: number;
  /** VAD 会话:下一段 commit 了转写失败 */
  failTranscript: boolean;
  /** commit 一律回「buffer too small」 */
  failCommit: boolean;
  /** 每次回答的声音多长(毫秒,24k 单声道);探针拉长了好在嘴说着时按下 */
  audioMs: number;
  close(): void;
}

export async function startFakeRealtime(): Promise<FakeRealtime> {
  const server: Server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const fake: FakeRealtime = { endpoint: '', conns: [], long: false, failUpdate: false, dropEarly: false, kidText: "It's a red car.", kidTexts: [], vadReject: 0, failTranscript: false, failCommit: false, audioMs: 100, close: () => { for (const c of fake.conns) c.sock.close(); server.close(); } };
  server.on('upgrade', (req, socket, head) => {
    if (!isUpgrade(req)) { socket.destroy(); return; }
    let active = 0;
    let speaking = false;
    /** 缓冲里还没 commit / clear 的字节 */
    let buffered = 0;
    const c: FakeConn = { sock: null as unknown as ServerSocket, session: null, updates: [], audio: 0, images: 0, items: [], commits: 0, clears: 0, creates: 0, cancels: 0, responses: [], closed: false };
    const send = (o: unknown): boolean => c.sock.sendText(JSON.stringify(o));
    const respond = (response: { instructions?: string } | null = null): void => {
      c.creates++;
      c.responses.push(response);
      active++;
      const ins = response?.instructions ?? '';
      const at = ins.indexOf('说完就停:「');
      const said = at >= 0 && ins.endsWith('」') ? ins.slice(at + '说完就停:「'.length, -1) : "It's a red car.";
      send({ type: 'response.created' });
      send({ type: 'response.audio.delta', delta: Buffer.alloc(Math.round(fake.audioMs * 48), 1).toString('base64') });
      send({ type: 'response.audio_transcript.delta', delta: said.slice(0, 7) });
      if (fake.long) return;
      send({ type: 'response.audio_transcript.delta', delta: said.slice(7) });
      send({ type: 'response.audio_transcript.done', transcript: said });
      active--;
      send({ type: 'response.done', response: { status: 'completed', usage: { input_tokens: 865, output_tokens: 28, input_token_details: { audio_tokens: 30 }, output_token_details: { audio_tokens: 20 } } } });
    };
    const transcribe = (): void => {
      send({ type: 'input_audio_buffer.committed' });
      if (fake.failTranscript) { fake.failTranscript = false; send({ type: 'conversation.item.input_audio_transcription.failed', error: { message: 'asr failed' } }); return; }
      send({ type: 'conversation.item.input_audio_transcription.completed', transcript: ` ${fake.kidTexts.length ? fake.kidTexts.shift() : fake.kidText} ` });
    };
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
          buffered += buf.length;
          if (c.session?.turn_detection) {
            // 有声 = 有一个采样过 300(约 -40 dBFS):Chrome 假麦克风开着音频处理时,两声嘀之间不是纯零、是很小的底噪(2026-10-20 probe-live-page 一直听那段)
            let loud = false;
            for (let i = 0; i + 1 < buf.length && !loud; i += 2) loud = Math.abs(buf.readInt16LE(i)) > 300;
            if (loud && !speaking) { speaking = true; send({ type: 'input_audio_buffer.speech_started' }); }
            else if (!loud && speaking) {
              speaking = false;
              buffered = 0;
              if (fake.vadReject > 0) { fake.vadReject--; send({ type: 'error', error: { code: 'invalid_request_error', message: 'Input speech was not accepted by semantic turn detection.' } }); }
              else { send({ type: 'input_audio_buffer.speech_stopped' }); transcribe(); if (c.session?.turn_detection?.create_response !== false) respond(); }
            }
          }
        } else if (m.type === 'input_audio_buffer.commit') {
          c.commits++;
          const small = buffered < 3200 || fake.failCommit;
          buffered = 0;
          if (small) send({ type: 'error', error: { message: 'Error committing input audio buffer: buffer too small, or have no audio.' } });
          else transcribe();
        } else if (m.type === 'input_audio_buffer.clear') { c.clears++; buffered = 0; }
        else if (m.type === 'conversation.item.create') c.items.push(m.item);
        else if (m.type === 'input_image_buffer.append') c.images++;
        else if (m.type === 'response.cancel') { c.cancels++; if (active) { active--; send({ type: 'response.done', response: { status: 'cancelled' } }); } else send({ type: 'error', error: { message: 'no active response' } }); }
        else if (m.type === 'response.create') respond(m.response ?? null);
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
