/**
 * 板书解析器:老师的回复正文(已剥掉「待裁量」「转交」段)→ 一节 BoardSection。
 * 三条规则(《板书卡片设计.md》§2):围栏 = 卡(标签第一个词是 kind),普通行 = 讲稿一句,第一个 H2 起是给家长的尾巴。
 * 讲稿句里 [词] 是标注(落到第一张含这个词的卡,整节找,卡在前在后都行),[[名 参数]] 是对上一张卡的动作(cue)。
 * partial 模式给流式用:没闭合的围栏和没换行结束的最后一行压着不算,下次整段重解析自然补上。
 * 永不抛错:围栏没闭合当到文末,卡解析不出退成文字卡并记一句 warning。
 */
import { parseCard } from '../cards/index.ts';
import { anchorMarks, isQuestion, phrasesIn, plainLine, type BoardCard, type BoardCue, type BoardLine, type BoardSection } from './kid-board.ts';

export interface ParseBoardOptions {
  /** 文本还在长(流式):压住没闭合的围栏与没换行结束的最后一行 */
  partial?: boolean;
}

export interface ParsedBoard {
  section: BoardSection;
  /** 没解析成的卡等,家长视图转录里显示;孩子端不报 */
  warnings: string[];
  /** 第一个 H2 起的尾巴(「## 家长」等,原文含标题行);没有 = 空串 */
  tail: string;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const H2 = /^##\s+\S/;
const CUE = /\[\[([^\[\]]+)\]\]/g;

function fenceClose(line: string, fence: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(m && m[1][0] === fence[0] && m[1].length >= fence.length);
}

/** 讲稿一行的清洗:去掉老师不该写但常写的标题号、列表号、引用号、粗体号;整行的 HTML 注释不算话 */
export function cleanSpeech(line: string): string {
  const t = line.trim();
  if (/^<!--.*-->$/.test(t)) return '';
  return t
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/\*\*/g, '')
    .trim();
}

interface RawLine {
  text: string;
  anchor: number | null;
  cues: BoardCue[];
}

function rawLine(line: string, cards: readonly BoardCard[]): RawLine {
  const anchor = cards.length ? cards.length - 1 : null;
  const cues: BoardCue[] = [];
  const text = line
    .replace(CUE, (_, inner: string) => {
      const [name, ...rest] = inner.trim().split(/\s+/);
      if (name && anchor !== null) cues.push({ card: anchor, name: name.toLowerCase(), ...(rest.length ? { arg: rest.join(' ') } : {}) });
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text, anchor, cues };
}

export function parseBoard(text: string, opts: ParseBoardOptions = {}): ParsedBoard {
  const partial = opts.partial === true;
  const all = text.split('\n');
  const lines = partial && !text.endsWith('\n') ? all.slice(0, -1) : all;
  const cards: BoardCard[] = [];
  const raws: RawLine[] = [];
  const warnings: string[] = [];
  let tail: string[] | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (tail) {
      tail.push(line);
      i++;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const fence = open[1];
      const tag = open[2].trim();
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        if (fenceClose(lines[j], fence)) {
          closed = true;
          break;
        }
        body.push(lines[j]);
      }
      if (!closed && partial) break;
      if (!closed) warnings.push(`围栏没闭合(${tag || '无标签'}),当到文末`);
      const r = parseCard(tag, body.join('\n'));
      cards.push(r.card);
      if (r.warning) warnings.push(r.warning);
      i = closed ? j + 1 : j;
      continue;
    }
    if (H2.test(line)) {
      tail = [line];
      i++;
      continue;
    }
    const speech = cleanSpeech(line);
    if (speech) raws.push(rawLine(speech, cards));
    i++;
  }
  // 标注整节找(老师把卡写在句子后面也认),所以卡收齐了再落
  const out: BoardLine[] = raws
    .filter((r) => r.text)
    .map((r) => {
      const marks = anchorMarks(cards, phrasesIn(r.text));
      const plain = plainLine(r.text);
      return { text: plain, audio: null, marks, ask: isQuestion(plain), anchor: r.anchor, cues: r.cues };
    });
  return {
    section: { cards, lines: out, ...(partial ? { partial: true } : {}) },
    warnings,
    tail: tail ? tail.join('\n').trim() : '',
  };
}
