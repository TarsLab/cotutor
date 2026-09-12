/**
 * 一种卡的服务端定义(《板书卡片设计.md》§1):props 契约、围栏正文怎么解析、哪些字段不下发孩子端;给老师看的写法在包根 cards/<kind>/card.md(src/cards/docs.ts 读它);
 * 有交互的卡再加 state 契约(孩子在卡上做的事,PUT 进来先过它)与 describe(把 props + state 说成给老师看的一句,进上下文包)。
 * 页面那一半(紧凑态怎么画、舞台里怎么交互、标注落在哪些字上)在 kid-page.ts / kid-board.ts;两边靠 kind 名对上。
 */
import type { z } from 'zod';

export interface CardKind<P = Record<string, unknown>, S = unknown> {
  name: string;
  props: z.ZodType<P>;
  /** 围栏正文 + 标签后的修饰词 → props;抛错 = 没解析成(退成文字卡显示原文,家长视图报一行) */
  parse(body: string, mods: readonly string[]): P;
  /** 剥掉不下发孩子端的字段(答案);没有 = 全给 */
  strip?(props: P): P;
  /** 孩子在卡上做的事的形状;没有 = 这种卡没有状态,PUT 一律 400 */
  state?: z.ZodType<S>;
  /** props + state → 给老师看的一句(不含卡的标题,那句由注册表拼);没有 = 状态原样 JSON */
  describe?(props: P, state: S): string;
  /** 这张卡要在后台预生成的配音资产(点读的段):文件名相对这张卡的资产目录 <日期>.<job>.cards/<n>/,text 是要念的字 */
  assets?(props: P): { file: string; text: string }[];
}

/** 围栏正文 → 非空行(各自 trim) */
export function bodyLines(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
