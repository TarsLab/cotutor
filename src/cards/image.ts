/**
 * 图片卡:第一行是图(workspace 里的相对路径——产物、孩子拍的照片;或 http(s) 地址),后面几行是图注。
 * 路径由 /api/kid/image?p= 供图,只认 workspace 根以内的图片文件;舞台里双指缩放。
 */
import { z } from 'zod';
import { bodyLines, type CardKind } from './kind.ts';

export const ImagePropsSchema = z.object({
  /** 相对 workspace 根的路径,或 http(s):// 地址 */
  src: z.string().min(1),
  caption: z.string().optional(),
});
export type ImageProps = z.infer<typeof ImagePropsSchema>;

export const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;

export const image: CardKind<ImageProps> = {
  name: 'image',
  props: ImagePropsSchema,
  parse(body) {
    const [src, ...rest] = bodyLines(body);
    if (!src) throw new Error('第一行要是图片路径或地址');
    if (!/^https?:\/\//.test(src) && !IMAGE_EXT.test(src)) throw new Error('要是 png / jpg / webp / gif / svg 图片');
    const caption = rest.join('\n');
    return { src, ...(caption ? { caption } : {}) };
  },
  doc: `### image — 图片

第一行是图:workspace 里的相对路径(产物、孩子拍的照片,如 \`vault/照片/2026-09-10-作业.jpg\`)或 http(s) 地址;后面几行是图注。孩子点开能放大。

\`\`\`\`
\`\`\`image
vault/照片/2026-09-10-作业.jpg
你昨天写的这道题,看第二行。
\`\`\`
\`\`\`\``,
};
