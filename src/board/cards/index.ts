/**
 * 卡的注册表:卡只剩首页的两种——老师牌(tutor)、听写牌(dictation)(2026-11-17《多模态教学harness-开发计划》阶段 5:课里没有卡了,
 * 老师对页做什么是讲稿里的动作,src/board/acts.ts)。首页文件的解析(src/board/parse.ts 的 parseHomeBody)、语法表、孩子端剥秘密都从这里走。
 * 页面那一半在 kid-page.ts(首页画牌);协议文档与结构样式在包根 cards/<kind>/(src/board/cards/docs.ts)。
 */
import { z } from 'zod';
import type { BoardCard } from '../presentation.ts';
import type { CardKind } from './kind.ts';
import { tutor } from './tutor.ts';
import { dictation } from './dictation.ts';

export { BUNDLE_ID_RE, type CardKind } from './kind.ts';
export { tutor, BUTTON_LABEL_MAX, TUTOR_BUTTONS_MAX, TutorButtonSchema, type TutorButton, type TutorProps } from './tutor.ts';
export { dictation, dictationEmoji, dictationWordLang, DictationPropsSchema, DICTATION_EN_MAX, DICTATION_SAY_MAX, DICTATION_WORD_MAX, DICTATION_WORDS_MAX, EN_WORD_RE, type DictationLang, type DictationProps, type DictationWord } from './dictation.ts';

/** 全部种类(首页的,注册表顺序即首页语法表里的顺序) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CARD_KINDS: readonly CardKind<any>[] = [tutor, dictation];

export function cardKind(name: string): CardKind | undefined {
  return CARD_KINDS.find((k) => k.name === name) as CardKind | undefined;
}

export interface ParsedCard {
  card: BoardCard;
  /** 没解析成时的一句(家长视图转录里显示);孩子端什么也不报 */
  warning?: string;
  /** 没照标签解析成(退成了文字卡 / 代码卡);首页检查据此判「要改」 */
  fallback?: boolean;
}

/**
 * 首页的围栏 → 卡。标签第一个词是 kind;不认识的标签、正文解析不出 → 文字卡显示原文 + warning(首页检查据此报「要改」)。永不抛错。
 */
export function parseCard(tag: string, body: string): ParsedCard {
  const [name, ...mods] = tag.trim().split(/\s+/).filter(Boolean);
  const asText = (why: string): ParsedCard => ({ card: { kind: 'text', props: { text: body.trim() || name || '…' } }, warning: why, fallback: true });
  if (!name) return asText('围栏没写种类');
  const kind = cardKind(name.toLowerCase());
  if (!kind) return asText(`首页只放老师卡(tutor)和听写卡(dictation),${name} 卡放不了`);
  try {
    const props = kind.props.parse(kind.parse(body, mods)) as Record<string, unknown>;
    const note = kind.note?.(body, props) ?? null;
    return { card: { kind: kind.name, props }, ...(note ? { warning: note } : {}) };
  } catch (err) {
    const why = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}:${i.message}`).join(';') : err instanceof Error ? err.message : String(err);
    return asText(`卡片没解析成:${name} — ${why}`);
  }
}

/** 首页的一张卡下发孩子端:过本种卡的 strip(听写卡的字不下发);不认识的 kind 原样 */
export function stripCard(c: BoardCard): BoardCard {
  const k = cardKind(c.kind);
  return k?.strip ? { ...c, props: k.strip(c.props) } : c;
}

/** 一张卡的标题(首页检查、首页的一句话里用):听写卡的词表、其余第一段有字的 */
export function cardLabel(card: BoardCard): string {
  const p = card.props;
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const first = s(p.title) || s(p.question) || s(p.show) || s(p.text) || s(p.caption) || s(p.prompt) || (Array.isArray(p.segments) ? s(p.segments[0]) : '') || s(p.chars) || s(p.word) || (Array.isArray(p.words) ? p.words.map((w) => s((w as { chars?: unknown })?.chars)).filter(Boolean).join('、') : '');
  const cps = Array.from(first.replace(/\s+/g, ' '));
  return cps.length > 40 ? `${cps.slice(0, 40).join('')}…` : cps.join('');
}
