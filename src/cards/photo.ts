/**
 * 拍给我看卡(《卡片协议.md》「拍给我看卡」):老师要孩子拍一张照片发来——看图说话的那幅图、写好的那一页。
 * 卡上是相机与要拍什么;它在最后一节时下沿是答案栏「等你拍…」带「拍照」「相册」,点了走老师页那套发照片屏(裁、圈、配一句话),
 * 发出去那条消息的照片(与配的话)落回这张卡的答案栏(kid-board.ts 的 askCard / kidSaid)。照片随消息交给老师,卡自己不存状态。
 * 起因:看图说话老师说「把那幅图拍下来,好吗?」,末句是问句,解析器补了提问卡,孩子端写的是「等你说…」。
 */
import { z } from 'zod';
import { bodyLines, type CardKind } from './kind.ts';

/** 要拍什么,最多几个字:一行说清,卡上一眼读完 */
export const PHOTO_TEXT_MAX = 30;

export const PhotoPropsSchema = z.object({
  /** 要拍什么(「看图说话的那幅图」「写好的那一页」) */
  text: z.string().min(1),
});
export type PhotoProps = z.infer<typeof PhotoPropsSchema>;

export const photo: CardKind<PhotoProps> = {
  name: 'photo',
  props: PhotoPropsSchema,
  parse(body) {
    const lines = bodyLines(body);
    if (!lines.length) throw new Error('写一行:要孩子拍什么');
    if (lines.length > 1) throw new Error('一张卡一行:要拍什么');
    const n = Array.from(lines[0]).length;
    if (n > PHOTO_TEXT_MAX) throw new Error(`${n} 个字,最多 ${PHOTO_TEXT_MAX} 个;说清要拍什么就够`);
    return { text: lines[0] };
  },
};
