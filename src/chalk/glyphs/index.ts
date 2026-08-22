/**
 * drawtell/glyphs —— 拉丁字母的笔顺资源包(a–z 与 A–Z)。
 *
 * 给的是"这个字母怎么一笔一笔写出来":52 个字形的归一化笔顺数据,
 * 加一个把它铺成 freedraw skeleton 的笔。播放交给 drawtell/player,
 * 于是"演示写字"和"讲解动画"是同一条渲染链、同一种逐笔动画。
 *
 * 坐标与四线三格对齐(x 高 = 1、基线 = 0、升部 -2、降部 +1),
 * 因此既能画,也能拿 LOWERCASE 的归一化数据去跟孩子的手写笔迹比对。
 *
 * 本包只收拉丁字母:数字与符号各有各的笔顺流派与消费方,不在此处硬凑。
 */

export type { Glyph, GlyphStroke, Seg, SegLine, SegArc, SegCubic } from './types.ts';
export { LOWERCASE } from './letters.ts';
export { UPPERCASE } from './capitals.ts';
export { GLYPHS } from './registry.ts';
export { GUIDES, ASC, CAP, XT, BASE, DESC } from './metrics.ts';
export { sampleStroke, strokeLength, glyphBBox, SAMPLE_STEP } from './sample.ts';
export type { Pt } from './sample.ts';
export { glyphSkeletons, wordSkeletons, wordAdvance, UnknownGlyphError, SPACE_ADVANCE } from './skeleton.ts';
export type { GlyphPenOptions } from './skeleton.ts';
