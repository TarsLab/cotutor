/**
 * 画图卡(kind 名 paint):老师把孩子说清楚的故事分好幅,应用交给百炼画成一张连环画(四格时 2×2,同练习册)。
 * 正文:`题:` 题干、`词:` 词语宝库(出题版才有)、`角色:` 一行一个(每幅都画同一个样子靠它)、`1.` 起一幅一行。
 * 画是这张卡的资产:一轮跑完后台画(src/scenes/paint/),图落在 .cards/<n>/paint.png;下发时由 enrichPaints 补上画好没有。孩子端没有错误:没画成就停在分幅那几句。
 */
import { z } from 'zod';
import { bodyLines, type CardKind } from './kind.ts';

/** 最多几幅:四格(2×2)是练习册的样子 */
export const PAINT_PANELS_MAX = 4;
/** 一幅最多几个字 */
export const PAINT_PANEL_MAX = 80;
/** 最多几个角色(一幅最多画三个,整个故事给四个) */
export const PAINT_CAST_MAX = 4;
/** 词语宝库最多几个词 */
export const PAINT_WORDS_MAX = 8;

export const PaintCastSchema = z.object({
  name: z.string().min(1),
  /** 样子、颜色、衣服;孩子没说就不写(只有名字,画家照名字画,每幅一样就行) */
  look: z.string().min(1).optional(),
});
export type PaintCast = z.infer<typeof PaintCastSchema>;

export const PaintPropsSchema = z.object({
  /** 一幅一句,只写看得见的;一到四幅 */
  panels: z.array(z.string().min(1)).min(1).max(PAINT_PANELS_MAX),
  cast: z.array(PaintCastSchema).max(PAINT_CAST_MAX).optional(),
  /** 题干(出题版) */
  ask: z.string().min(1).optional(),
  /** 词语宝库(出题版) */
  words: z.array(z.string().min(1)).max(PAINT_WORDS_MAX).optional(),
  /** 下发时补的(enrichPaints):画好了是图的路径(相对 workspace 根),还在画 drawing,没画成 none;老师写不出来 */
  pic: z.string().optional(),
  drawn: z.enum(['drawing', 'done', 'none']).optional(),
  /** 家长端才补的:用的模型、画了几秒、没画成的原因 */
  note: z.string().optional(),
});
export type PaintProps = z.infer<typeof PaintPropsSchema>;

/** 「题:」「词:」「角色:」;中英文冒号都认(全角写成 \uFF1A,一眼看得出两种都在;原来少了全角那个,2026-10-12 qwen 写「题：」整张卡退成文字) */
const FIELD = /^(题干?|词语?宝库|词|角色)\s*[:\uFF1A]\s*(.*)$/;
/** 「1.」「1、」「1)」「第1幅:」「第 1 格:」 */
const PANEL = /^(?:第\s*)?([1-9])\s*(?:[.、)\uFF0E\uFF09]|幅\s*[:\uFF1A]?|格\s*[:\uFF1A]?)\s*(.+)$/;
const WORD_SEP = /[、,\uFF0C;\uFF1B\s]+/;

export const paint: CardKind<PaintProps> = {
  name: 'paint',
  props: PaintPropsSchema,
  parse(body) {
    const panels: string[] = [];
    const cast: PaintCast[] = [];
    let ask: string | undefined;
    let words: string[] = [];
    for (const line of bodyLines(body)) {
      const f = FIELD.exec(line);
      if (f) {
        const v = f[2].trim();
        if (!v) continue;
        if (f[1].startsWith('题')) ask = v;
        else if (f[1] === '角色') {
          // 「名字:样子」;孩子没说样子就只写名字(2026-10-12 qwen 照「只写孩子说过的」写了「角色: 小熊」,整张卡退成文字)
          const m = /^([^:\uFF1A]+)[:\uFF1A]\s*(.+)$/.exec(v);
          cast.push(m ? { name: m[1].trim(), look: m[2].trim() } : { name: v });
        } else words = v.split(WORD_SEP).map((w) => w.trim()).filter(Boolean);
        continue;
      }
      const p = PANEL.exec(line);
      if (p) {
        const text = p[2].trim();
        if (Array.from(text).length > PAINT_PANEL_MAX) throw new Error(`第 ${p[1]} 幅超过 ${PAINT_PANEL_MAX} 个字;一幅只画一件事`);
        panels.push(text);
        continue;
      }
      throw new Error(`认不出这一行(要是「题:」「词:」「角色:」或「1.」开头的一幅):${line}`);
    }
    if (!panels.length) throw new Error('一幅都没有:一幅一行,「1.」开头');
    if (panels.length > PAINT_PANELS_MAX) throw new Error(`${panels.length} 幅,最多 ${PAINT_PANELS_MAX} 幅`);
    if (cast.length > PAINT_CAST_MAX) throw new Error(`${cast.length} 个角色,最多 ${PAINT_CAST_MAX} 个`);
    if (words.length > PAINT_WORDS_MAX) throw new Error(`${words.length} 个词,最多 ${PAINT_WORDS_MAX} 个`);
    return { panels, ...(cast.length ? { cast } : {}), ...(ask ? { ask } : {}), ...(words.length ? { words } : {}) };
  },
};
