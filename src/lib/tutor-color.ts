/**
 * 老师的颜色(学科色):头像的环、牌的边、新话题气泡(白字压在上面)、听写页的按钮与气泡。
 * 定法:cotutor.json 里这位老师写了 color 用它;三门主科(含别名,canonicalSubject)固定;其余按 cotutor.json 里老师的先后,
 * 从 TUTOR_PALETTE 里挑还没人用的,同一家里不撞色。都是白字压得住的深色(对比度 ≥ 4.5)。
 * 服务端算好随老师一起下发(color 字段),页面不自己算。
 */
import { canonicalSubject } from '../schema/config.ts';

/** 三门主科(2026-10-12  调深过) */
export const SUBJECT_COLORS: Readonly<Record<string, string>> = { 语文: '#c43c74', 数学: '#2f6fd6', 英语: '#1f8a4c' };
/** 别的老师自动分的八种:橙、赭、青、紫、靛、橄榄、砖红、石板灰,白字对比度 4.9–6.6 */
export const TUTOR_PALETTE = ['#c2410c', '#8a6a10', '#0f7a8a', '#8a44b0', '#5b55c9', '#4f7a1f', '#a33a2a', '#4a6278'] as const;
/** 不归哪位老师的(家长清单上口语课、听写那几行的块) */
export const NEUTRAL_COLOR = '#6b6458';
/** 白字压在上面,对比度起码这么多(WCAG AA 正文) */
export const MIN_CONTRAST = 4.5;

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** 白字压在这个颜色上的对比度(1–21) */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

/** 每位老师的颜色(cotutor.json tutors 的键 → #rrggbb);按 tutors 的先后分 */
export function tutorColors(tutors: Readonly<Record<string, { subject?: string; color?: string }>>): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const entries = Object.entries(tutors);
  for (const [name, t] of entries) {
    const fixed = t.color ?? SUBJECT_COLORS[canonicalSubject(t.subject) ?? ''];
    if (fixed) {
      out[name] = fixed.toLowerCase();
      used.add(out[name]);
    }
  }
  let k = 0;
  for (const [name] of entries) {
    if (out[name]) continue;
    const free = TUTOR_PALETTE.find((c) => !used.has(c));
    // 八种都用完了(老师很多)就从头轮
    const c = free ?? TUTOR_PALETTE[k++ % TUTOR_PALETTE.length];
    out[name] = c;
    used.add(c);
  }
  return out;
}
