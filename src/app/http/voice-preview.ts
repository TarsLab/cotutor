/**
 * 试听一个音色(家长端「样子与声音」):
 * 嘴(realtime)真连一次照念这一句(几分钱),存在 .cotutor/live-preview/,同一句同一音色以后直接给文件;
 * 卡的配音合成一句,在配音缓存里(.cotutor/tts/),之后直接给文件。失败回 JSON 说原因(页面拿 message 显示)。
 */
import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { synthesize } from '../../media/tts.ts';
import { previewVoice } from '../../realtime/preview.ts';
import { isRealtimeVoice } from '../../realtime/voices.ts';
import type { Workspace } from '../../schema/index.ts';
import type { RouteResult } from './app.ts';

const VOICE_ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;

export async function mouthPreview(ws: Workspace, voice: string, text: string): Promise<RouteResult> {
  if (!isRealtimeVoice(voice)) return { status: 400, json: { error: 'bad_voice', message: `这个模型不认「${voice}」这个音色` } };
  const dir = join(ws.root, '.cotutor', 'live-preview');
  const file = join(dir, `${createHash('sha1').update(`${ws.config.live.model}\n${voice}\n${text}`).digest('hex').slice(0, 20)}.wav`);
  if (!(await stat(file).catch(() => null))?.isFile()) {
    const r = await previewVoice({ voice, text, model: ws.config.live.model, env: process.env, endpoint: process.env.COTUTOR_LIVE_ENDPOINT });
    if ('error' in r) return { status: 502, json: { error: 'realtime_failed', voice, message: r.error } };
    await mkdir(dir, { recursive: true });
    await writeFile(file, r.wav);
  }
  return { status: 200, file, contentType: 'audio/wav' };
}

export async function cardPreview(ws: Workspace, voice: string, text: string): Promise<RouteResult> {
  if (!VOICE_ID_RE.test(voice)) return { status: 400, json: { error: 'bad_voice', message: '音色 id 只能是字母数字与 . _ : -' } };
  const r = await synthesize({ text, voice }, { cacheDir: ws.dirs.tts, env: process.env });
  if (!r.file) return { status: 502, json: { error: 'tts_failed', voice, message: r.error } };
  return { status: 200, file: r.file, contentType: 'audio/mpeg' };
}
