/**
 * 画图卡 → 交给文生图模型的一段(《你说我画设计.md》§5.3):版式(几格怎么排)+ 画风 + 角色 + 分幅。
 * 画风在 activity 文件「画家收到什么」那节(模板里留 {{版式}} {{角色}} {{分幅}} 三个插槽,《activity设计.md》拍板 12);
 * 不在 activity 话题里画,照出厂的画风(PAINT_PROMPT_DEFAULT)夹在版式与角色中间。
 * 纯函数;版式与角色、分幅由这里接,改画风不会把分幅弄丢。
 */
import type { PaintProps } from '../cards/index.ts';
import { fillSlots } from '../lib/activity.ts';
import { PAINT_PROMPT_DEFAULT } from '../schema/index.ts';

/** 反向提示词(百炼限 500 字符) */
export const PAINT_NEGATIVE = '文字,字母,水印,对话气泡,拟声词,写实照片,恐怖,血腥,武器,畸形的手,多余的肢体,格子数量不对';

const FRAME = '格子之间留白边,每格有细圆角边框。除了这几个圆圈数字,画面里没有别的字。';
const NUMS = ['1', '2', '3', '4'];

/** 几格怎么排:四格 2×2(练习册的样子),两三格横排,一幅就是一张画(不提编号:提了模型就往一幅的图上点圆圈数字) */
export function paintLayout(n: number): string {
  if (n >= 4) return `一张四格连环画,四格按 2×2 排,从左上到右下依次是第 1、2、3、4 格,每格左上角一个圆圈数字。${FRAME}`;
  if (n > 1) return `一张${n === 3 ? '三' : '两'}格连环画,${n === 3 ? '三' : '两'}格从左到右横着排,依次是第 ${NUMS.slice(0, n).join('、')} 格,每格左上角一个圆圈数字。${FRAME}`;
  return '一张画。';
}

/** 画多大:四格与一幅照配置(方的);两三格横排,换成宽的 */
export function paintSize(n: number, size: string): string {
  return n === 2 || n === 3 ? '1664*928' : size;
}

/** 画家那节的三个插槽:版式、角色(没有就空)、分幅 */
export function paintSlots(p: Pick<PaintProps, 'panels' | 'cast'>): { 版式: string; 角色: string; 分幅: string } {
  const n = p.panels.length;
  return {
    版式: paintLayout(n),
    角色: p.cast?.length ? [`同一个角色在${n > 1 ? '每一格里' : '画里'}长相、颜色、衣服都照这样画:`, ...p.cast.map((c) => (c.look ? `- ${c.name}:${c.look}` : `- ${c.name}`))].join('\n') : '',
    分幅: n > 1 ? p.panels.map((t, i) => `第 ${i + 1} 格:${t}`).join('\n') : `画面:${p.panels[0]}`,
  };
}

/** 不在 activity 话题里:版式、出厂的画风、角色、分幅,空一行隔开 */
export function paintPrompt(p: Pick<PaintProps, 'panels' | 'cast'>): string {
  const s = paintSlots(p);
  return [s.版式, PAINT_PROMPT_DEFAULT.join('\n'), s.角色, s.分幅].filter(Boolean).join('\n\n');
}

/** activity 文件「画家收到什么」的模板填好插槽 */
export function paintPromptFrom(template: string, p: Pick<PaintProps, 'panels' | 'cast'>): string {
  return fillSlots(template, paintSlots(p));
}
