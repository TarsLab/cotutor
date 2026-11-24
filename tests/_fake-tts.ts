/**
 * 假百炼配音(Qwen-Audio-TTS 非实时,不花钱):测试经 COTUTOR_TTS_ENDPOINT 指到它(src/media/tts.ts)。
 * POST {model, input: {text, voice}} → {output: {audio: {url}}, usage};GET 那个 url 拿「音频」,内容是 fake-mp3:<音色>:<字>。
 * 带 X-DashScope-SSE: enable(点读整篇,src/media/tts.ts 的 synthesizeTimed):回 text/event-stream,一个事件带整份音频(base64)和每个字的时间
 * (一个字 WORD_MS,从 WORD_MS 起;空白不算),内容同上;tone 时 WAV 照字数一样长(不封顶)。
 * 音色是 fail 时回 400 InvalidParameter「音色不存在」;requests 记每次合成(看缓存省没省;sse 标出走的哪种)。
 * tone = true 时音频是解得开的 WAV(24k 单声道,一段 300Hz 的音,字越多越长):浏览器要真解码的探针用(试用把打的字配成声音推给嘴)。
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** SSE 回的字:一个字多少毫秒 */
export const WORD_MS = 150;

/** 一段解得开的 WAV:24k 单声道 16 位,300Hz、三成音量,0.4 秒 + 每个字 0.15 秒(最长 4 秒;sec 给了就照它) */
function toneWav(text: string, sec?: number): Buffer {
  const rate = 24000;
  const n = Math.round(rate * (sec ?? Math.min(4, 0.4 + 0.15 * Array.from(text).length)));
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 300 * i) / rate) * 0.3 * 32767), 44 + i * 2);
  return b;
}

export async function startFakeTts(opts: { tone?: boolean } = {}): Promise<{ url: string; requests: { model: string; voice: string; text: string; sse?: boolean }[]; close(): Promise<void> }> {
  const requests: { model: string; voice: string; text: string; sse?: boolean }[] = [];
  const audio = new Map<string, Buffer>();
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/audio/')) {
      const bytes = audio.get(req.url);
      if (!bytes) res.writeHead(404).end();
      else res.writeHead(200, { 'content-type': 'audio/mpeg' }).end(bytes);
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as { model?: string; input?: { text?: string; voice?: string } };
    const voice = body.input?.voice ?? '';
    const text = body.input?.text ?? '';
    const sse = req.headers['x-dashscope-sse'] === 'enable';
    requests.push({ model: body.model ?? '', voice, text, ...(sse ? { sse: true } : {}) });
    res.setHeader('content-type', 'application/json');
    if (voice === 'fail') {
      res.writeHead(400).end(JSON.stringify({ request_id: 'r-fail', code: 'InvalidParameter', message: '音色不存在' }));
      return;
    }
    if (sse) {
      const cs = Array.from(text).filter((c) => !/\s/.test(c));
      const words = cs.map((c, i) => ({ text: c, begin_index: i, end_index: i + 1, begin_time: WORD_MS * (i + 1), end_time: WORD_MS * (i + 2) }));
      const bytes = opts.tone ? toneWav(text, (WORD_MS * (cs.length + 2)) / 1000) : Buffer.from(`fake-mp3:${voice}:${text}`);
      const ev = { request_id: `r-${requests.length}`, output: { type: 'sentence-end', audio: { data: bytes.toString('base64') }, sentence: { index: 0, words } }, usage: { characters: cs.length } };
      res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`id:1\nevent:result\ndata:${JSON.stringify(ev)}\n\n`);
      return;
    }
    const path = `/audio/${requests.length}.mp3`;
    audio.set(path, opts.tone ? toneWav(text) : Buffer.from(`fake-mp3:${voice}:${text}`));
    res.writeHead(200).end(JSON.stringify({ request_id: `r-${requests.length}`, output: { audio: { url: `${base}${path}` } }, usage: { characters: text.length } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: `${base}/api/v1/services/audio/tts/SpeechSynthesizer`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
