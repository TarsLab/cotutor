/**
 * 全部收录字形的查找入口:小写 + 大写。
 * 排版与骨架生成一律走这里,不直接查 LOWERCASE / UPPERCASE,
 * 免得加了一类字形却漏改某条查找路径。
 */

import type { Glyph } from './types.ts';
import { LOWERCASE } from './letters.ts';
import { UPPERCASE } from './capitals.ts';

export const GLYPHS: ReadonlyMap<string, Glyph> = new Map([...LOWERCASE, ...UPPERCASE]);
