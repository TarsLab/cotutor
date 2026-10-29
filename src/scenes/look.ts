/**
 * 场景要的「看一张图」:一张图 + 提示词 + 模型 → 回的字(src/media/vision.ts 的 lookAt 就是这个样子;场景不认 media,由路由那层交进来)。
 * 给 onDelta 就一块一块交出去(拍照认词边认边出);不给就整段收完再回。
 */
export type Seen = { ok: true; text: string; ms: number } | { ok: false; error: string; ms: number };

export type Look = (o: {
  image: { data: Buffer; mime: string };
  prompt: string;
  model: string;
  params?: Record<string, unknown>;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  endpoint?: string;
  onDelta?: (text: string) => void;
}) => Promise<Seen>;
