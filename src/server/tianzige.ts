/**
 * 田字格卡的笔顺数据:`GET /api/kid/tianzige/<字>` 从 node_modules 的 hanzi-writer-data(makemeatianzige 的衍生,Arphic 许可)现读一个字的 JSON——
 * strokes 是每一笔的 SVG 轮廓、medians 是每一笔的中线,坐标 1024 见方、y 向上(页面用 scale(1,-1) translate(0,-900) 摆正)。
 * 数据是确定性资源,不经模型;iPad 不碰外网。字不在数据里(生僻字)→ null,页面只显示字形不动。
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { HAN } from '../cards/index.ts';

export interface TianzigeData {
  strokes: string[];
  medians: number[][][];
}

let dataDir: string | null | undefined;
/** hanzi-writer-data 的目录;没装 → null(doctor 不点名:它是 dependencies 里的,装 cotutor 就有) */
export function tianzigeDataDir(): string | null {
  if (dataDir !== undefined) return dataDir;
  try {
    dataDir = dirname(createRequire(import.meta.url).resolve('hanzi-writer-data/package.json'));
  } catch {
    dataDir = null;
  }
  return dataDir;
}

const cache = new Map<string, TianzigeData | null>();

/** 一个汉字的笔顺;不是单个汉字、数据里没有、文件坏了都 → null */
export async function tianzigeData(ch: string): Promise<TianzigeData | null> {
  if (!HAN.test(ch)) return null;
  const hit = cache.get(ch);
  if (hit !== undefined) return hit;
  const dir = tianzigeDataDir();
  let out: TianzigeData | null = null;
  if (dir) {
    try {
      const raw = JSON.parse(await readFile(join(dir, `${ch}.json`), 'utf8')) as Partial<TianzigeData>;
      if (Array.isArray(raw.strokes) && Array.isArray(raw.medians) && raw.strokes.length === raw.medians.length && raw.strokes.length > 0) out = { strokes: raw.strokes, medians: raw.medians };
    } catch {
      out = null;
    }
  }
  cache.set(ch, out);
  return out;
}
