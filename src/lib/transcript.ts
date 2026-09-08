/**
 * stream-json NDJSON 转录 → 家长视图条目 + 最终文本。抄自 growth-apps 的 gen-transcript(2026-08-26 实测形状,
 * claude 2.1.220;qwen code 同族),加两样:parent_tool_use_id 非空的事件标 sub(子代理),
 * result.result 单独取出作 final——它是两个 CLI 都有的稳定锚点,孩子视图只看它。
 */

export interface TranscriptItem {
  /** text 说话 / tool 用工具 / tool-error 工具报错 / done 收尾 */
  kind: 'text' | 'tool' | 'tool-error' | 'done';
  text: string;
  /** 来自子代理(parent_tool_use_id 非空) */
  sub?: boolean;
}

export type TranscriptRow = TranscriptItem | { kind: 'fold'; tools: TranscriptItem[] };

export interface TranscriptFinal {
  /** result.result;没有就是 null */
  text: string | null;
  ok: boolean;
  /** 不 ok 时的原因(subtype 或 terminal_reason) */
  reason: string | null;
  costUsd?: number;
  numTurns?: number;
}

export interface Transcript {
  sessionId: string | null;
  items: TranscriptItem[];
  /** 收尾;还在跑就是 null */
  final: TranscriptFinal | null;
}

const FOLD_AT = 3;

/**
 * 展示前折叠:连续 ≥3 条工具行收成一组;报错行永不折;末尾还在长的段留最后 2 条直播。
 */
export function foldRuns(items: TranscriptItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let i = 0;
  while (i < items.length) {
    if (items[i].kind !== 'tool') {
      rows.push(items[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < items.length && items[j].kind === 'tool') j++;
    const run = items.slice(i, j);
    const keep = j === items.length ? Math.min(2, run.length) : 0;
    const folded = run.slice(0, run.length - keep);
    if (folded.length >= FOLD_AT) {
      rows.push({ kind: 'fold', tools: folded });
      rows.push(...run.slice(run.length - keep));
    } else rows.push(...run);
    i = j;
  }
  return rows;
}

interface Block {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  is_error?: boolean;
}

interface Event {
  type?: string;
  subtype?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  message?: { content?: unknown };
  is_error?: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  terminal_reason?: string;
  result?: unknown;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const blocks = (c: unknown): Block[] => (Array.isArray(c) ? (c as Block[]) : []);
const blockText = (c: unknown): string => (typeof c === 'string' ? c : blocks(c).map((b) => b.text ?? '').join(''));

function toolSummary(name: string, input: Record<string, unknown> | undefined): string {
  for (const k of ['description', 'command', 'file_path', 'skill', 'pattern', 'prompt', 'url']) {
    const v = input?.[k];
    if (typeof v === 'string' && v.trim()) return `${name} · ${clip(v.trim(), 120)}`;
  }
  return name;
}

export function parseTranscript(text: string): Transcript {
  let sessionId: string | null = null;
  const items: TranscriptItem[] = [];
  let final: TranscriptFinal | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e: Event;
    try {
      e = JSON.parse(line) as Event;
    } catch {
      continue;
    }
    if (!sessionId && typeof e.session_id === 'string') sessionId = e.session_id;
    const sub = typeof e.parent_tool_use_id === 'string' && e.parent_tool_use_id.length > 0 ? true : undefined;
    if (e.type === 'assistant') {
      for (const b of blocks(e.message?.content)) {
        if (b.type === 'text' && b.text?.trim()) items.push({ kind: 'text', text: b.text.trim(), sub });
        else if (b.type === 'tool_use' && b.name) items.push({ kind: 'tool', text: toolSummary(b.name, b.input), sub });
      }
    } else if (e.type === 'user') {
      for (const b of blocks(e.message?.content))
        if (b.type === 'tool_result' && b.is_error) items.push({ kind: 'tool-error', text: clip(blockText(b.content).trim(), 300), sub });
    } else if (e.type === 'result') {
      const failed = Boolean(e.is_error) || Boolean(e.subtype && e.subtype !== 'success');
      const resultText = typeof e.result === 'string' && e.result.trim() ? e.result.trim() : null;
      if (resultText && !items.some((i) => i.kind === 'text' && !i.sub)) items.push({ kind: 'text', text: resultText });
      const cost = typeof e.total_cost_usd === 'number' ? ` · $${e.total_cost_usd.toFixed(2)}` : '';
      const turns = typeof e.num_turns === 'number' ? ` · ${e.num_turns} 轮` : '';
      const reason = e.subtype && e.subtype !== 'success' ? e.subtype : (e.terminal_reason ?? '未知');
      items.push({ kind: 'done', text: failed ? `本轮出错(${reason})${turns}${cost}` : `本轮结束${turns}${cost}` });
      final = {
        text: resultText,
        ok: !failed,
        reason: failed ? reason : null,
        costUsd: typeof e.total_cost_usd === 'number' ? e.total_cost_usd : undefined,
        numTurns: typeof e.num_turns === 'number' ? e.num_turns : undefined,
      };
    }
  }
  return { sessionId, items, final };
}
