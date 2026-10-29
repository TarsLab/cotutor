/**
 * 旧路径与接线:口语单的规则在 src/scenes/talk/list.ts,看图的请求在 src/media/vision.ts;readList 把两样接起来(路由、测试用)
 */
import { lookAt } from '../media/vision.ts';
import { readListWith, type ListResult } from '../scenes/talk/list.ts';

export * from '../scenes/talk/list.ts';

export function readList(photo: { data: Buffer; mime: string }, opts: { env?: NodeJS.ProcessEnv; endpoint?: string; model?: string; timeoutMs?: number } = {}): Promise<ListResult> {
  return readListWith(lookAt, photo, opts);
}
