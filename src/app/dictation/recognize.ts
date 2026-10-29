/**
 * 旧路径与接线:拍照认词的规则在 src/scenes/dictation/recognize.ts,看图的请求在 src/media/vision.ts;recognizePhoto 把两样接起来(路由、测试用)
 */
import type { DictationLang } from '../../board/cards/index.ts';
import { lookAt } from '../../media/vision.ts';
import { recognizeWith, type PhotoProgress, type Recognized } from '../../scenes/dictation/recognize.ts';

export * from '../../scenes/dictation/recognize.ts';

export function recognizePhoto(
  image: { data: Buffer; mime: string },
  onProgress: (p: PhotoProgress) => void = () => {},
  opts: { env?: NodeJS.ProcessEnv; endpoint?: string; model?: string; prompt?: readonly string[]; text?: string; timeoutMs?: number; lang?: DictationLang } = {},
): Promise<Recognized> {
  return recognizeWith(lookAt, image, onProgress, opts);
}
