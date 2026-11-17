/**
 * 一种首页卡(老师牌、听写牌)的服务端定义:props 契约、围栏正文怎么解析、哪些字段不下发孩子端;写法在包根 cards/<kind>/card.md(src/board/cards/docs.ts 读它)。
 * 页面那一半(首页上怎么画)在 kid-page.ts;两边靠 kind 名对上。课里的卡 2026-11-17 删了。
 */
import type { z } from 'zod';

export interface CardKind<P = Record<string, unknown>> {
  name: string;
  props: z.ZodType<P>;
  /** 围栏正文 + 标签后的修饰词 → props;抛错 = 没解析成(退成文字卡显示原文,首页检查报要改) */
  parse(body: string, mods: readonly string[]): P;
  /** 解析成了、但正文有一部分没用上:给家长的一句;没有 / null = 不报 */
  note?(body: string, props: P): string | null;
  /** 剥掉不下发孩子端的字段(讲法、答案);没有 = 全给 */
  strip?(props: P): P;
}

/** 课包 / 视频小课堂的 id(bundles/<id>/、lectures/<id>/):首页的小课堂按钮、一节课里的小课堂页共用 */
export const BUNDLE_ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** 围栏正文 → 非空行(各自 trim) */
export function bodyLines(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
