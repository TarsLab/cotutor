/**
 * 画图卡 → 交给文生图模型的一段(《wip/你说我画设想.md》§5.3):版式(几格怎么排)+ 家长可改的画风(cotutor.json paint.prompt)+ 角色 + 分幅。
 * 纯函数;版式与角色、分幅由这里接,改 prompt 不会把分幅弄丢。
 */
import type { PaintProps } from '../cards/index.ts';
import { PAINT_PROMPT_DEFAULT } from '../schema/index.ts';

/** 反向提示词(百炼限 500 字符) */
export const PAINT_NEGATIVE = '文字,字母,水印,对话气泡,拟声词,写实照片,恐怖,血腥,武器,畸形的手,多余的肢体,格子数量不对';

const FRAME = '格子之间留白边,每格有细圆角边框。';
const NUMS = ['1', '2', '3', '4'];

/** 几格怎么排:四格 2×2(练习册的样子),两三格横排,一幅就是一张画 */
export function paintLayout(n: number): string {
  if (n >= 4) return `一张四格连环画,四格按 2×2 排,从左上到右下依次是第 1、2、3、4 格,每格左上角一个圆圈数字。${FRAME}`;
  if (n > 1) return `一张${n === 3 ? '三' : '两'}格连环画,${n === 3 ? '三' : '两'}格从左到右横着排,依次是第 ${NUMS.slice(0, n).join('、')} 格,每格左上角一个圆圈数字。${FRAME}`;
  return '一张画。';
}

/** 画多大:四格与一幅照配置(方的);两三格横排,换成宽的 */
export function paintSize(n: number, size: string): string {
  return n === 2 || n === 3 ? '1664*928' : size;
}

export function paintPrompt(p: Pick<PaintProps, 'panels' | 'cast'>, style: readonly string[] = PAINT_PROMPT_DEFAULT): string {
  const n = p.panels.length;
  const parts = [paintLayout(n), style.join('\n')];
  if (p.cast?.length) parts.push([`同一个角色在${n > 1 ? '每一格里' : '画里'}长相、颜色、衣服都照这样画:`, ...p.cast.map((c) => `- ${c.name}:${c.look}`)].join('\n'));
  parts.push(n > 1 ? p.panels.map((t, i) => `第 ${i + 1} 格:${t}`).join('\n') : `画面:${p.panels[0]}`);
  return parts.join('\n\n');
}
