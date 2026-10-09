/**
 * 老师进程的转录(.log,一行一个 JSON)→ 家长视图条目 + 最终文本。起初抄自 growth-apps 的 gen-transcript(2026-08-26,claude 2.1.220),
 * 现在按 CLI 适配器读成统一事件再拼(src/clis/,缺省 stream-json,claude / qwen 同族):子代理的条目标 sub,
 * 收尾的最终正文单独取出作 final——各家 CLI 都有的稳定锚点,孩子视图只看它。
 */
import { parseStreamJson } from '../clis/stream-json.ts';
import type { CliEvent, CliFinal } from '../clis/types.ts';

/** 一行输出 → 统一事件(CLI 适配器的 parse) */
export type LineParser = (line: string) => CliEvent[];

export interface TranscriptItem {
  /** text 说话 / tool 用工具 / tool-error 工具报错 / done 收尾 */
  kind: 'text' | 'tool' | 'tool-error' | 'done';
  text: string;
  /** 来自子代理(parent_tool_use_id 非空) */
  sub?: boolean;
}

export type TranscriptRow = TranscriptItem | { kind: 'fold'; tools: TranscriptItem[] };

/** 收尾:result 的最终正文、成没成、费用或 token(见 src/clis/types.ts 的 CliFinal) */
export type TranscriptFinal = CliFinal;

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

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
/** 路径截头留尾:要紧的是文件名(作业照片的绝对路径在 workspace 深的机器上会超长) */
const clipPath = (s: string, n: number): string => (s.length > n ? `…${s.slice(-n)}` : s);

export function toolSummary(name: string, input: Record<string, unknown> | undefined): string {
  for (const k of ['description', 'command', 'file_path', 'skill', 'pattern', 'prompt', 'url']) {
    const v = input?.[k];
    if (typeof v === 'string' && v.trim()) return `${name} · ${k === 'file_path' ? clipPath(v.trim(), 120) : clip(v.trim(), 120)}`;
  }
  return name;
}

/**
 * 一轮里模型用了哪些工具、读了什么(2026-09-15,记录层):从 .log 的 stream-json 把 tool_use 与 tool_result 按 id 配对,
 * 一条 = 工具名、最要紧的那个参数(路径 / 命令 / 模式)、成没成、结果多少字。events.jsonl 的工具事件只有一个 120 字的显示串;
 * 这份物化进索引消息的 tools,回答「老师为什么没看见档案那一行」「这轮读了几个文件」。
 */
export interface ToolCall {
  name: string;
  /** 最要紧的参数:Read / Edit / Write 的 file_path、Bash 的 command、Grep 的 pattern in path、Skill 的 skill;没有就空串 */
  arg: string;
  /** true 成功 / false 报错 / null 没等到结果(被杀、还在跑、或 CLI 没回) */
  ok: boolean | null;
  /** 结果文本的字数 */
  chars: number;
  sub?: boolean;
}

const ARG_KEYS = ['file_path', 'command', 'pattern', 'path', 'skill', 'url', 'query', 'description', 'prompt'] as const;

export function toolArg(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  if (typeof input.pattern === 'string' && typeof input.path === 'string') return clip(`${input.pattern} in ${input.path}`, 300);
  for (const k of ARG_KEYS) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return clip(v.trim(), 300);
  }
  return '';
}

export function toolCalls(text: string, parse: LineParser = parseStreamJson): ToolCall[] {
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  for (const line of text.split('\n')) {
    for (const e of parse(line)) {
      if (e.kind === 'assistant') {
        for (const p of e.parts) {
          if (p.type !== 'tool') continue;
          const c: ToolCall = { name: p.tool.name, arg: toolArg(p.tool.input), ok: null, chars: 0, ...(e.sub ? { sub: true } : {}) };
          calls.push(c);
          if (p.tool.id) byId.set(p.tool.id, c);
        }
      } else if (e.kind === 'results') {
        for (const r of e.results) {
          const c = byId.get(r.id);
          if (!c) continue;
          c.ok = r.ok;
          c.chars = r.text.length;
        }
      }
    }
  }
  return calls;
}

export function parseTranscript(text: string, parse: LineParser = parseStreamJson): Transcript {
  let sessionId: string | null = null;
  const items: TranscriptItem[] = [];
  let final: TranscriptFinal | null = null;
  for (const line of text.split('\n')) {
    for (const e of parse(line)) {
      if (e.kind === 'session') {
        if (!sessionId) sessionId = e.id;
      } else if (e.kind === 'assistant') {
        const sub = e.sub ? true : undefined;
        for (const p of e.parts) {
          if (p.type === 'text' && p.text.trim()) items.push({ kind: 'text', text: p.text.trim(), sub });
          else if (p.type === 'tool') items.push({ kind: 'tool', text: toolSummary(p.tool.name, p.tool.input), sub });
        }
      } else if (e.kind === 'results') {
        const sub = e.sub ? true : undefined;
        for (const r of e.results) if (!r.ok) items.push({ kind: 'tool-error', text: clip(r.text.trim(), 300), sub });
      } else if (e.kind === 'result') {
        const f = e.final;
        if (f.text && !items.some((i) => i.kind === 'text' && !i.sub)) items.push({ kind: 'text', text: f.text });
        const cost = f.costUsd !== undefined ? ` · $${f.costUsd.toFixed(2)}` : '';
        const turns = f.numTurns !== undefined ? ` · ${f.numTurns} 轮` : '';
        items.push({ kind: 'done', text: f.ok ? `本轮结束${turns}${cost}` : `本轮出错(${f.reason})${turns}${cost}` });
        final = f;
      }
    }
  }
  return { sessionId, items, final };
}
