/**
 * 单词卡的笔顺数据:`GET /api/kid/letters/<词>` 用 drawtell/glyphs(52 个拉丁字母的印刷体笔顺,四线三格归一化)把词里每个字母采成点序列——
 * 坐标以 x 高为 1:基线 y = 0、x 高顶 -1、升部顶 / 大写顶 -2、降部底 +1,y 向下;每个字母左边界 x = 0,advance 是它的宽。
 * 连字符、撇号字形包里没有,这里补两笔。数据是确定性资源,不经模型;词里有写不出的字 → null,页面退成字体的字。
 */
import { GLYPHS, SPACE_ADVANCE, sampleStroke } from 'drawtell/glyphs';
import { WORD_MAX, WORD_RE } from '../cards/index.ts';

export interface LetterGlyph {
  advance: number;
  /** 一笔一条点序列,数组顺序即笔顺 */
  strokes: [number, number][][];
}

export interface LettersData {
  glyphs: Record<string, LetterGlyph>;
  /** 字间距、空格宽(x 高为 1);空格宽用 drawtell 的,字间距比它松(GAP) */
  gap: number;
  space: number;
}

const EXTRA: Record<string, LetterGlyph> = {
  '-': { advance: 0.5, strokes: [[[0.05, -0.5], [0.45, -0.5]]] },
  "'": { advance: 0.15, strokes: [[[0.08, -2], [0.08, -1.55]]] },
};

/** 字间距(x 高为 1):drawtell 缺省 0.22,笔画粗 0.2,两个圈挨着的字母(a p)几乎碰上;孩子认字要松一点 */
const GAP = 0.35;

const round = (v: number): number => Math.round(v * 1000) / 1000;
const cache = new Map<string, LetterGlyph>();

function glyphOf(ch: string): LetterGlyph | null {
  const hit = cache.get(ch);
  if (hit) return hit;
  const g = GLYPHS.get(ch);
  const out = g ? { advance: g.advance, strokes: g.strokes.map((st) => sampleStroke(st).map(([x, y]) => [round(x), round(y)] as [number, number])) } : EXTRA[ch] ?? null;
  if (out) cache.set(ch, out);
  return out;
}

/** 一个词里用到的字形;不是单词卡写得出的词 → null */
export function lettersData(word: string): LettersData | null {
  if (!WORD_RE.test(word) || word.length > WORD_MAX) return null;
  const glyphs: Record<string, LetterGlyph> = {};
  for (const ch of new Set(word.replace(/ /g, ''))) {
    const g = glyphOf(ch);
    if (!g) return null;
    glyphs[ch] = g;
  }
  return { glyphs, gap: GAP, space: SPACE_ADVANCE };
}
