/** mp3 时长(录像要知道每句念多久):手拼的帧头——voxtell 那种 MPEG-2 单声道、MPEG-1 立体声、带 Info 头的、坏文件。 */
import { mp3DurationMs } from '../src/lib/mp3.ts';
import { check, done } from './_check.ts';

/** n 帧:head 是帧头 4 字节,size 是一帧的字节数;前面可带 ID3v2(syncsafe 长度) */
const frames = (head: number[], size: number, n: number, id3 = 0): Uint8Array => {
  const out = new Uint8Array((id3 ? 10 + id3 : 0) + size * n);
  if (id3) out.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, id3], 0);
  for (let k = 0; k < n; k++) out.set(head, (id3 ? 10 + id3 : 0) + k * size);
  return out;
};

// voxtell 出的:LAME MPEG-2 Layer III、24kHz、160kbps、单声道 → 一帧 72 × 160000 / 24000 = 480 字节、576 个样本 = 24 毫秒
const V2 = [0xff, 0xf3, 0xe4, 0xc0];
check('MPEG-2 24kHz:112 帧 = 2688 毫秒(和 afinfo 对得上),跳过 ID3', mp3DurationMs(frames(V2, 480, 112, 20)) === 2688);
check('没有 ID3 也行', mp3DurationMs(frames(V2, 480, 10)) === 240);
// MPEG-1 44.1kHz 128kbps 立体声 → 一帧 417 字节、1152 个样本
check('MPEG-1 44.1kHz:10 帧 = 261 毫秒', mp3DurationMs(frames([0xff, 0xfb, 0x90, 0x00], 417, 10)) === 261);
{
  // 第一帧里的 Info 头(单声道 MPEG-2:帧头后 9 字节 side info)记了 500 帧 → 按它算,不数
  const b = frames(V2, 480, 3);
  const at = 4 + 9;
  b.set([0x49, 0x6e, 0x66, 0x6f, 0, 0, 0, 1, 0, 0, 0x01, 0xf4], at);
  check('有 Info 头就按它记的帧数', mp3DurationMs(b) === 500 * 24);
}
check('不是 mp3 / 空的 → null,不抛', mp3DurationMs(new TextEncoder().encode('<html>not audio</html>')) === null && mp3DurationMs(new Uint8Array()) === null);
check('头后面有几个字节的垃圾:往后找到第一个像样的帧', mp3DurationMs(new Uint8Array([0, 0, 0, ...frames(V2, 480, 5)])) === 120);

done();
