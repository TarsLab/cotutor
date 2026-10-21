/**
 * mock 的实时老师(`cotutor mock --live`,《wip/实时老师开发计划.md》P2.9):不经百炼、不花钱看实时老师页。
 * 协议同 src/live/call.ts:松手(或打字、拍照、交卡)马上接住一句 → 发一条消息给 mock 的老师(照脚本出节,带 live)→ 老师写完,讲稿一句一句「念」:
 * 字幕 + 静音的声音(按字数估长短,孩子端照常排着放),read 按孩子端的排法算好时刻发;按下 = 打断(清了,没念的不念)。
 * 讲稿的 [[play]]:那句念完先停,孩子端放完小课堂那一段(staged)再接着念。没有转写:按住说的当成「(按住说的话)」。
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { playsLecture } from '../lib/board.ts';
import { lineDurationMs, plainLine, type BoardCard, type BoardLine } from '../lib/kid-board.ts';
import { LEAD_MS } from '../live/lib/playback.ts';
import { acceptWebSocket, isUpgrade } from '../live/ws.ts';
import type { KidDay } from './app.ts';
import type { Mock } from './mock.ts';

/** 按住说的那句(mock 没有转写) */
export const MOCK_LIVE_SAID = '(按住说的话)';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function mockLiveUpgrade(mock: Mock) {
  return (req: IncomingMessage, socket: Duplex, head: Buffer): boolean => {
    const m = /^\/api\/live\/([a-z0-9][a-z0-9-]*)\/ws(?:\?.*)?$/.exec(req.url ?? '');
    if (!m || !isUpgrade(req)) return false;
    const tutor = m[1];
    const timers = new Set<NodeJS.Timeout>();
    /** 孩子端的声音排到哪(墙钟);turn 每打断一次加一,在路上的那一轮看见变了就不念了 */
    let playEnd = 0;
    let turn = 0;
    let holding = false;
    const clear = (): void => { for (const t of timers) clearTimeout(t); timers.clear(); };
    const later = (ms: number, f: () => void): void => { const t = setTimeout(() => { timers.delete(t); f(); }, Math.max(0, ms)); timers.add(t); };
    const sock = acceptWebSocket(req, socket, head, { onText: (x) => onText(x), onBinary: () => {}, onClose: () => { clear(); turn++; } });
    const send = (o: Record<string, unknown>): void => { sock.sendText(JSON.stringify(o)); };
    /** 嘴说一段:字幕 + 静音的声音;回它在孩子端开始放的时刻(上一段放完或到达 + 60 毫秒,取晚的) */
    const say = (of: 'catch' | 'read', text: string): number => {
      const ms = lineDurationMs(text);
      const start = Math.max(Date.now() + LEAD_MS, playEnd);
      playEnd = start + ms;
      send({ t: 'tutor', of, done: text });
      sock.sendBinary(Buffer.alloc(Math.round(ms * 48)));
      return start;
    };
    const interrupt = (): void => {
      clear();
      turn++;
      if (playEnd > Date.now()) send({ t: 'flush' });
      playEnd = 0;
    };
    /** 一轮:(拍照先说一句)交给 mock 的老师、写完了一句一句念;别的嘴不先说(《wip/实时老师设想.md》拍板 14) */
    const begin = async (body: Record<string, unknown>, caught: string | null): Promise<void> => {
      const my = turn;
      if (caught) say('catch', caught);
      const r = await mock.route('POST', `/api/kid/conversations/${tutor}/messages`, { ...body, live: true });
      if (my !== turn) return;
      if (r.status !== 202) { send({ t: 'err', status: r.status, error: (r.json as { error?: string } | undefined)?.error ?? 'error' }); return; }
      const { job, thread } = r.json as { job: string; thread: string };
      send({ t: 'turn', job, thread });
      await mock.settleJob(job);
      if (my !== turn) return;
      const day = (await mock.route('GET', `/api/kid/conversations/${tutor}/today`)).json as KidDay;
      const sec = day.messages.find((x) => x.job === job)?.section;
      readFrom(job, sec?.lines ?? [], sec?.cards ?? [], 0, my);
    };
    /** 讲稿一句一句「念」;[[play]] 那句念完先停,孩子端放完小课堂那一段(staged)再接着念 */
    let rest: (() => void) | null = null;
    const readFrom = (job: string, lines: BoardLine[], cards: BoardCard[], from: number, my: number): void => {
      for (let i = from; i < lines.length; i++) {
        const text = plainLine(lines[i].text);
        const start = say('read', text);
        const play = playsLecture(lines[i], cards);
        later(start - Date.now(), () => send({ t: 'read', job, line: i, text, ...(play ? { play: true } : {}) }));
        if (play) { rest = () => { if (my === turn) readFrom(job, lines, cards, i + 1, my); }; return; }
      }
    };
    const onText = (raw: string): void => {
      let x: Record<string, unknown>;
      try { x = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
      switch (x.t) {
        case 'hold': holding = true; interrupt(); send({ t: 'state', speaking: false, holding: true }); break;
        case 'release':
          if (!holding) return;
          holding = false;
          send({ t: 'kid', text: MOCK_LIVE_SAID });
          void begin({ ...(isObj(x.body) ? x.body : {}), text: MOCK_LIVE_SAID }, null);
          break;
        case 'hush': holding = false; interrupt(); break;
        case 'staged': { const r = rest; rest = null; r?.(); break; }
        case 'send': {
          if (!isObj(x.body)) return;
          const b = x.body;
          interrupt();
          void begin(b, Array.isArray(b.photos) && b.photos.length ? '我看一看图片' : null);
          break;
        }
        case 'bye': sock.close(1000, 'bye'); break;
        default: break;
      }
    };
    send({ t: 'ready' });
    return true;
  };
}
