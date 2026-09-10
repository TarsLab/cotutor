/**
 * 流式:老师还在说的时候,从 stream-json 的增量事件里拼出「当前这条顶层回复的正文」,给板书的 partial 解析用。
 * claude 2.1.220 加 `--include-partial-messages` 后每个字来一条 `stream_event`(content_block_delta / text_delta),
 * 每条新消息前有 message_start;qwen 0.21.13 没有增量开关,只有整条 `assistant` 事件——两种都认:
 * delta 往当前文本上追加,message_start 时当前段带围栏或 H2 就留下(与 kid-view 的 kidSource 同一条规则:老师板书完再用工具,卡不丢)、否则丢掉,
 * 新段从空开始;顶层 assistant 的 text 块直接当作当前段(与拼出来的一样)。text() = 留下的段 + 当前段。
 * parent_tool_use_id 非空的(子代理)一律跳过;喂进来的是原始字节块,行没收完的先攒着。
 */

interface StreamEvent {
  type?: string;
  parent_tool_use_id?: string | null;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  message?: { content?: unknown };
}

export interface PartialReader {
  /** 喂一块 stdout;返回文本有没有变 */
  feed(chunk: string): boolean;
  /** 当前这条顶层回复的正文(还在长) */
  text(): string;
}

const KEEP = /^\s*(?:```|~~~|## )/m;

export function createPartialReader(): PartialReader {
  let rest = '';
  let text = '';
  const kept: string[] = [];
  const apply = (line: string): boolean => {
    if (!line.trim()) return false;
    let e: StreamEvent;
    try {
      e = JSON.parse(line) as StreamEvent;
    } catch {
      return false;
    }
    if (typeof e.parent_tool_use_id === 'string' && e.parent_tool_use_id) return false;
    if (e.type === 'stream_event') {
      const ev = e.event;
      if (ev?.type === 'message_start') {
        if (!text) return false;
        if (KEEP.test(text)) kept.push(text.trim());
        text = '';
        return true;
      }
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string' && ev.delta.text) {
        text += ev.delta.text;
        return true;
      }
      return false;
    }
    if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      const t = (e.message.content as { type?: string; text?: string }[])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('');
      if (t && t !== text) {
        text = t;
        return true;
      }
    }
    return false;
  };
  return {
    feed(chunk) {
      rest += chunk;
      let changed = false;
      let at: number;
      while ((at = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, at);
        rest = rest.slice(at + 1);
        if (apply(line)) changed = true;
      }
      return changed;
    },
    text: () => [...kept, text].filter(Boolean).join('\n\n'),
  };
}
