/**
 * 流式:老师还在说的时候,从 CLI 的输出事件里拼出「当前这条顶层回复的正文」,给板书的 partial 解析用。
 * 有增量的 CLI(claude 加 `--include-partial-messages`、qwen 0.25 同)每个字来一条 delta,每条新回复前有 start;没有增量开关的只有整条 assistant——两种都认:
 * delta 往当前文本上追加,start 时当前段带围栏或 H2 就留下(与 kid-view 的 kidSource 同一条规则:老师板书完再用工具,卡不丢)、否则丢掉,
 * 新段从空开始;顶层 assistant 的正文直接当作当前段(与拼出来的一样)。text() = 留下的段 + 当前段。
 * 子代理的一律跳过。读哪家的输出由 CLI 适配器定(src/clis/),这里只认统一事件。
 */

import { parseStreamJson } from '../clis/stream-json.ts';
import { textsOf, type CliEvent } from '../clis/types.ts';

export interface PartialReader {
  /** 喂一块 stdout(原始字节,行没收完的先攒着);返回文本有没有变 */
  feed(chunk: string): boolean;
  /** 喂已经读好的事件(runner 自己切行、解析一次,同一批事件还要给工具与会话用);返回文本有没有变 */
  apply(events: readonly CliEvent[]): boolean;
  /** 当前这条顶层回复的正文(还在长) */
  text(): string;
  /** 只要当前这段(还没收到整条 assistant 的那段;断流时它没进会话,要递回给老师) */
  current(): string;
}

const KEEP = /^\s*(?:```|~~~|## )/m;

/** parse:一行输出 → 统一事件(CLI 适配器的 parse);缺省按 stream-json 读 */
export function createPartialReader(parse: (line: string) => CliEvent[] = parseStreamJson): PartialReader {
  let rest = '';
  let text = '';
  // 当前段收到过整条 assistant 了(已进会话,不算「断在半截」)
  let sealed = false;
  const kept: string[] = [];
  const one = (e: CliEvent): boolean => {
    if ('sub' in e && e.sub) return false;
    if (e.kind === 'start') {
      if (!text) return false;
      if (KEEP.test(text)) kept.push(text.trim());
      text = '';
      sealed = false;
      return true;
    }
    if (e.kind === 'delta') {
      text += e.text;
      sealed = false;
      return true;
    }
    if (e.kind === 'assistant') {
      const t = textsOf(e.parts).join('');
      if (t) sealed = true;
      if (t && t !== text) {
        text = t;
        return true;
      }
    }
    return false;
  };
  const apply = (events: readonly CliEvent[]): boolean => {
    let changed = false;
    for (const e of events) if (one(e)) changed = true;
    return changed;
  };
  return {
    feed(chunk) {
      rest += chunk;
      let changed = false;
      let at: number;
      while ((at = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, at);
        rest = rest.slice(at + 1);
        if (apply(parse(line))) changed = true;
      }
      return changed;
    },
    apply,
    text: () => [...kept, text].filter(Boolean).join('\n\n'),
    current: () => (sealed ? '' : text),
  };
}
