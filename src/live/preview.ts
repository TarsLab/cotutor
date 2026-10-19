/**
 * 试听嘴的一个音色(工作台音色页「实时的嘴」):真连一次百炼 realtime,让它照念一句(同实时老师的照念指令),收下 24k PCM 包成 wav。
 * 几分钱一次;调用方按「音色 + 句子」缓存,同一句同一个音色只念一次。
 */
import { readCue } from './lib/cue.ts';
import { wavOfPcm } from './lib/wav.ts';
import { OUTPUT_RATE, RealtimeSession } from './realtime.ts';

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
  if (why !== null) return { error: why === 'no_auth' ? '没有百炼的 key 或业务空间 id(DASHSCOPE_API_KEY、DASHSCOPE_WORKSPACE_ID)' : `连不上:${why}` };
  s.createResponse(readCue([o.text]));
  const until = Date.now() + (o.timeoutMs ?? 20_000);
  while (!done && !err && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  s.close('preview');
  if (err) return { error: err };
  if (!chunks.length) return { error: done ? '没出声' : '超时' };
  return { wav: wavOfPcm(Buffer.concat(chunks), OUTPUT_RATE) };
}
