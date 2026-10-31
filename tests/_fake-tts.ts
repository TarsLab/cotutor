/**
 * 假百炼配音(Qwen-Audio-TTS 非实时,不花钱):测试经 COTUTOR_TTS_ENDPOINT 指到它(src/media/tts.ts)。
 * POST {model, input: {text, voice}} → {output: {audio: {url}}, usage};GET 那个 url 拿「音频」,内容是 fake-mp3:<音色>:<字>。
 * 音色是 fail 时回 400 InvalidParameter「音色不存在」;requests 记每次合成(看缓存省没省)。
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function startFakeTts(): Promise<{ url: string; requests: { model: string; voice: string; text: string }[]; close(): Promise<void> }> {
  const requests: { model: string; voice: string; text: string }[] = [];
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
    requests.push({ model: body.model ?? '', voice, text });
    res.setHeader('content-type', 'application/json');
    if (voice === 'fail') {
      res.writeHead(400).end(JSON.stringify({ request_id: 'r-fail', code: 'InvalidParameter', message: '音色不存在' }));
      return;
    }
    const path = `/audio/${requests.length}.mp3`;
    audio.set(path, Buffer.from(`fake-mp3:${voice}:${text}`));
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
