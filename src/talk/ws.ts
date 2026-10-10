/**
 * 最小的 WebSocket 服务端(RFC 6455),零依赖:口语课的孩子端 ↔ 本服务那条线用它(《wip/口语课设想.md》§三),测试里也拿它假扮百炼。
 * 只做用得上的:握手、文本 / 二进制帧、分片拼接、ping/pong、close;不做扩展(permessage-deflate 不协商就不会来)。
 * 客户端发来的帧必须带掩码(浏览器、Node 都带);服务端发出去的不带。
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** 一帧最多收这么大(一块音频 100 毫秒 3200 字节;JSON 控制消息更小) */
const MAX_FRAME = 4 * 1024 * 1024;

export interface SocketEvents {
  onText?(text: string): void;
  onBinary?(data: Buffer): void;
  onClose?(code: number, reason: string): void;
}

export interface ServerSocket {
  sendText(text: string): boolean;
  sendBinary(data: Buffer | Uint8Array): boolean;
  close(code?: number, reason?: string): void;
  readonly open: boolean;
}

/** 是不是 WebSocket 升级请求 */
export function isUpgrade(req: IncomingMessage): boolean {
  return (req.headers.upgrade ?? '').toLowerCase() === 'websocket' && typeof req.headers['sec-websocket-key'] === 'string';
}

export function acceptKey(key: string): string {
  return createHash('sha1').update(key + GUID).digest('base64');
}

/** 把一帧编出来(服务端不打掩码) */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let head: Buffer;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}

export interface Frame { fin: boolean; opcode: number; payload: Buffer; size: number }

/** 从缓冲区头上解一帧;不够一帧回 null;坏帧抛 */
export function decodeFrame(buf: Buffer): Frame | null {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let p = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); p = 4; }
  else if (len === 127) { if (buf.length < 10) return null; const big = buf.readBigUInt64BE(2); if (big > BigInt(MAX_FRAME)) throw new Error('frame too large'); len = Number(big); p = 10; }
  if (len > MAX_FRAME) throw new Error('frame too large');
  if (!masked) throw new Error('client frame without mask');
  if (buf.length < p + 4 + len) return null;
  const mask = buf.subarray(p, p + 4);
  p += 4;
  const payload = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) payload[i] = buf[p + i] ^ mask[i & 3];
  return { fin, opcode, payload, size: p + len };
}

/**
 * 接受一条升级请求:写握手响应,之后 socket 归这里管。
 * 回的对象发消息;事件在 ev 里。只在 isUpgrade(req) 为真时调。
 */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer, ev: SocketEvents): ServerSocket {
  const key = String(req.headers['sec-websocket-key']);
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  let buf: Buffer = head.length ? Buffer.from(head) : Buffer.alloc(0);
  let open = true;
  let partial: { opcode: number; chunks: Buffer[] } | null = null;
  const closeWith = (code: number, reason: string): void => {
    if (!open) return;
    open = false;
    try { socket.end(); } catch { /* 已经断了 */ }
    ev.onClose?.(code, reason);
  };
  const raw = (opcode: number, payload: Buffer): boolean => {
    if (!open || socket.destroyed) return false;
    socket.write(encodeFrame(opcode, payload));
    return true;
  };
  const deliver = (opcode: number, payload: Buffer): void => {
    if (opcode === 0x1) ev.onText?.(payload.toString('utf8'));
    else if (opcode === 0x2) ev.onBinary?.(payload);
  };
  socket.on('data', (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    try {
      for (;;) {
        const f = decodeFrame(buf);
        if (!f) break;
        buf = buf.subarray(f.size);
        if (f.opcode === 0x8) {
          const code = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1005;
          raw(0x8, f.payload.subarray(0, 2));
          closeWith(code, f.payload.length > 2 ? f.payload.subarray(2).toString('utf8') : '');
          return;
        }
        if (f.opcode === 0x9) { raw(0xa, f.payload); continue; }
        if (f.opcode === 0xa) continue;
        if (f.opcode === 0x0) {
          if (!partial) throw new Error('continuation without start');
          partial.chunks.push(f.payload);
          if (f.fin) { const whole = Buffer.concat(partial.chunks); const op = partial.opcode; partial = null; deliver(op, whole); }
          continue;
        }
        if (!f.fin) { partial = { opcode: f.opcode, chunks: [f.payload] }; continue; }
        deliver(f.opcode, f.payload);
      }
    } catch (err) {
      raw(0x8, Buffer.from([0x03, 0xea]));
      closeWith(1002, err instanceof Error ? err.message : 'protocol error');
    }
  });
  socket.on('error', () => closeWith(1006, 'socket error'));
  socket.on('close', () => closeWith(1006, 'socket closed'));
  socket.on('end', () => closeWith(1006, 'socket ended'));
  return {
    get open() { return open; },
    sendText: (text) => raw(0x1, Buffer.from(text, 'utf8')),
    sendBinary: (data) => raw(0x2, Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)),
    close: (code = 1000, reason = '') => {
      if (!open) return;
      const r = Buffer.from(reason, 'utf8');
      const p = Buffer.alloc(2 + r.length);
      p.writeUInt16BE(code, 0);
      r.copy(p, 2);
      raw(0x8, p);
      closeWith(code, reason);
    },
  };
}
