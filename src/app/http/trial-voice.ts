/**
 * 试用(--sandbox)里打的字配成孩子的声音:孩子端把它当麦克风推给嘴(kid-page.ts 的 TRIAL),走的就是孩子说话那条路
 * (转写、请他说、嘴先答、一直听的 VAD)。只有 sandbox 有这个口子,真的孩子端回 404。
 * 一个固定的童声(7 岁,天真童趣音):转写比大人的声音更像孩子的;配过的字在配音缓存里(.cotutor/tts/),同一句再试不花钱、不用等。
 */
import { synthesize } from '../../media/tts.ts';
import type { Workspace } from '../../schema/index.ts';
import type { RouteResult } from './app.ts';

export const TRIAL_KID_VOICE = 'qwen-audio-3.0-tts-plus-longyaoxuanke';
/** 孩子一次说的话不会更长;再长的多半是贴错了 */
const MAX_CHARS = 200;

export async function trialVoice(ws: Workspace, body: unknown): Promise<RouteResult> {
  if (!ws.sandbox) return { status: 404, json: { error: 'not_found' } };
  const text = body && typeof body === 'object' && typeof (body as { text?: unknown }).text === 'string' ? (body as { text: string }).text.trim() : '';
  if (!text || text.length > MAX_CHARS) return { status: 400, json: { error: 'bad_request', message: `要一句 1–${MAX_CHARS} 个字的话` } };
  const r = await synthesize({ text, voice: TRIAL_KID_VOICE }, { cacheDir: ws.dirs.tts, env: process.env });
  if (!r.file) return { status: 502, json: { error: 'tts_failed', message: r.error } };
  return { status: 200, file: r.file, contentType: 'audio/mpeg' };
}
