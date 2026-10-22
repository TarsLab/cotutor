/**
 * 字幕重放(《实时老师设计.md》拍板 21):一轮里嘴照念的几段声音按先后接成一份,和讲稿每句在这份里从哪开始。纯函数。
 * 嘴出声比放快(一段字 1.9 秒出完、声音要放 11.6 秒),孩子按下时没放的多半已经出完:出了的都算,不管孩子端放没放;
 * 脑写了还没交给嘴、脑还没写的几句没有声音,不在里面。
 * 每句的起点:一段出齐了,按字数比例摊(同 call.ts 的 readRest,孩子端的字幕就是这么亮的);
 * 没出齐就停了(孩子按下时嘴还在出、连接断了),按这段已经出的嘴的字幕字数算一个字多长,只摊到已经出了声的那几句。
 */

/** 一段:交给嘴的那几句、出了多少字节的声音、嘴的字幕出了几个字、出齐没有 */
export interface MouthSeg {
  lines: number[];
  texts: string[];
  bytes: number;
  heard: number;
  done: boolean;
}

export interface MouthStart {
  line: number;
  ms: number;
}

/** 落盘的那份(<日期>.<job>.mouth.json):声音多长、每句的起点(毫秒,升序) */
export interface MouthIndex {
  v: 1;
  ms: number;
  lines: MouthStart[];
}

export function mouthIndex(segs: readonly MouthSeg[], bytesPerMs: number): MouthIndex {
  const lines: MouthStart[] = [];
  const seen = new Set<number>();
  let at = 0;
  for (const s of segs) {
    if (s.bytes <= 0) continue;
    const segMs = s.bytes / bytesPerMs;
    const lens = s.texts.map((x) => Math.max(1, x.length));
    const total = lens.reduce((a, b) => a + b, 0);
    // 没出齐:一个字多长按已经出的字幕算;字幕一个字都没来,只算这段第一句
    const perChar = s.done ? segMs / total : s.heard > 0 ? segMs / s.heard : null;
    let before = 0;
    for (let k = 0; k < s.lines.length; k++) {
      const off = perChar === null ? (k === 0 ? 0 : Infinity) : before * perChar;
      before += lens[k];
      if (k > 0 && off >= segMs) break;
      if (seen.has(s.lines[k])) continue;
      seen.add(s.lines[k]);
      lines.push({ line: s.lines[k], ms: Math.round(at + off) });
    }
    at += segMs;
  }
  return { v: 1, ms: Math.round(at), lines };
}
