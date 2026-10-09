/** 浏览器录音的 MIME 子类型 → 落盘扩展名(Safari 录 mp4/aac,Chrome 录 webm/opus);omni 听写也按这个扩展名报格式 */
const RECORD_EXT: Record<string, string> = { webm: 'webm', mp4: 'm4a', 'x-m4a': 'm4a', aac: 'm4a', ogg: 'ogg', wav: 'wav', 'x-wav': 'wav' };
/** 一条录音的 base64 最多这么长(60 秒 opus 约 0.5 MB,aac 约 1 MB;留足余量) */
const RECORD_MAX_B64 = 4_000_000;

/** 孩子端发来的录音 data:audio/…;base64,… → 字节与扩展名;不是声音、认不得的格式、太大 → undefined */
export function audioData(dataUrl: unknown): { data: Buffer; ext: string } | undefined {
  if (typeof dataUrl !== 'string') return undefined;
  const m = /^data:audio\/([a-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  const ext = m ? RECORD_EXT[m[1]] : undefined;
  if (!m || !ext || m[2].length > RECORD_MAX_B64) return undefined;
  return { data: Buffer.from(m[2], 'base64'), ext };
}
