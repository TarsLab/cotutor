/**
 * Claude Code 的 stream-json(`--output-format stream-json`,一行一个 JSON)读成统一事件。claude 与 qwen code 同族,共用这一份;
 * 各家的出入写在各自的适配器里。形状是 claude 2.1.220 起实测的(growth-apps 的 gen-transcript),qwen code 0.25 对过:
 * - `{"type":"system","subtype":"init","session_id","tools":[…]}`(qwen 的 json 模式叫 session_start)
 * - `{"type":"stream_event","event":{…}}`:`--include-partial-messages` 才有;message_start 开新的一条,content_block_delta 的 text_delta 是正文、thinking_delta 是在想
 * - `{"type":"assistant","message":{"content":[text / tool_use 块]}}`:一条整的回复
 * - `{"type":"user","message":{"content":[tool_result 块]}}`:工具结果
 * - `{"type":"result","subtype","is_error","result","total_cost_usd","num_turns","usage","modelUsage"}`:收尾
 * parent_tool_use_id 非空的是子代理的。
 */
import type { AssistantPart, CliEvent, CliFinal, ToolResult } from './types.ts';

interface Block {
  type?: string;
  id?: string;
  tool_use_id?: string;
  text?: unknown;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  is_error?: boolean;
}

interface Line {
  type?: string;
  subtype?: string;
  session_id?: unknown;
  parent_tool_use_id?: unknown;
  tools?: unknown;
  event?: { type?: string; delta?: { type?: string; text?: unknown } };
  message?: { content?: unknown };
  is_error?: boolean;
  num_turns?: unknown;
  total_cost_usd?: unknown;
  modelUsage?: Record<string, { outputTokens?: unknown }>;
  usage?: { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown; cache_creation_input_tokens?: unknown };
  terminal_reason?: string;
  result?: unknown;
}

const blocks = (c: unknown): Block[] => (Array.isArray(c) ? (c as Block[]) : []);
/** 结果块的文字:字符串原样,块数组拼各块的 text */
export const blockText = (c: unknown): string => (typeof c === 'string' ? c : blocks(c).map((b) => (typeof b.text === 'string' ? b.text : '')).join(''));
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

function finalOf(e: Line): CliFinal {
  const failed = Boolean(e.is_error) || Boolean(e.subtype && e.subtype !== 'success');
  const text = typeof e.result === 'string' && e.result.trim() ? e.result.trim() : null;
  const u = e.usage;
  const inTokens = u ? [u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens].reduce<number | undefined>((s, v) => (typeof v === 'number' ? (s ?? 0) + v : s), undefined) : undefined;
  return {
    ok: !failed,
    text,
    reason: failed ? (e.subtype && e.subtype !== 'success' ? e.subtype : (e.terminal_reason ?? '未知')) : null,
    costUsd: num(e.total_cost_usd),
    numTurns: num(e.num_turns),
    ...(e.modelUsage && typeof e.modelUsage === 'object' ? { modelOut: Object.values(e.modelUsage).reduce((s, m) => s + (typeof m?.outputTokens === 'number' ? m.outputTokens : 0), 0) } : {}),
    ...(num(u?.output_tokens) !== undefined ? { lastOut: num(u?.output_tokens), outTokens: num(u?.output_tokens) } : {}),
    ...(inTokens !== undefined ? { inTokens } : {}),
  };
}

export function parseStreamJson(line: string): CliEvent[] {
  if (!line.trim()) return [];
  let e: Line;
  try {
    e = JSON.parse(line) as Line;
  } catch {
    return [];
  }
  if (!e || typeof e !== 'object') return [];
  const out: CliEvent[] = [];
  if (typeof e.session_id === 'string' && e.session_id) out.push({ kind: 'session', id: e.session_id });
  const sub = typeof e.parent_tool_use_id === 'string' && e.parent_tool_use_id.length > 0;
  switch (e.type) {
    case 'system':
      if (Array.isArray(e.tools)) out.push({ kind: 'init', tools: e.tools.filter((t): t is string => typeof t === 'string') });
      break;
    case 'stream_event': {
      const ev = e.event;
      if (ev?.type === 'message_start') out.push({ kind: 'start', sub });
      else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string' && ev.delta.text) out.push({ kind: 'delta', text: ev.delta.text, sub });
      else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') out.push({ kind: 'thinking', sub });
      break;
    }
    case 'assistant': {
      if (!Array.isArray(e.message?.content)) break;
      const parts: AssistantPart[] = [];
      for (const b of blocks(e.message.content)) {
        if (b.type === 'text' && typeof b.text === 'string') parts.push({ type: 'text', text: b.text });
        else if (b.type === 'tool_use' && b.name) parts.push({ type: 'tool', tool: { ...(b.id ? { id: b.id } : {}), name: b.name, ...(b.input ? { input: b.input } : {}) } });
      }
      out.push({ kind: 'assistant', parts, sub });
      break;
    }
    case 'user': {
      const results: ToolResult[] = [];
      for (const b of blocks(e.message?.content)) if (b.type === 'tool_result' && b.tool_use_id) results.push({ id: b.tool_use_id, ok: !b.is_error, text: blockText(b.content) });
      if (results.length) out.push({ kind: 'results', results, sub });
      break;
    }
    case 'result':
      out.push({ kind: 'result', final: finalOf(e) });
      break;
  }
  return out;
}

/** stream-json 输入的一条用户消息(`--input-format stream-json` 一行一条) */
export function streamJsonUserMessage(prompt: string): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } })}\n`;
}
