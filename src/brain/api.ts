/**
 * 脑执行的 API 实现(2026-10-29):不起 CLI,应用在服务进程里直连百炼的 Chat Completions(AI SDK + @ai-sdk/alibaba,cotutor-api-prototype 验过这条路)。
 * - 系统提示 = runner 给的 systemBody(老师正文或 activity + 板书写法);消息 = 上下文包 + 孩子的话,本轮的照片直接附成图,不靠老师自己去读
 * - 同一话题的模型历史应用自己存:<日期>.<话题>.brain.jsonl,一行一轮(会话 id、模型、这轮的用户消息、模型回的全部消息、成没成);
 *   接着话题时把同一会话的那几行拼回去。照片只记相对 workspace 根的路径,发的时候再编码。没回完的一轮只留写出来的正文,下一条消息前头注明
 * - 拼回去的已经结束的轮是瘦过的(slimTurn):思考不带(只在本轮工具来回里回传),工具往返换成一句话;照片只附最近交的那组,更早的换成一句占位。
 *   瘦法只由那一轮自己的记录定,下一轮发出去的开头和上一轮一样,百炼的缓存接得上;原始记录不动
 * - 整段压缩(runner 在上下文过了 32k 的下一轮给 compact):之前的历史不再发,前情(应用照索引拼的)放在这一轮的消息前头,
 *   最近交的照片带过来;这一轮记 compacted,以后从它算起
 * - 工具:这轮带工具(read / on)就给只读的三样(./api-tools.ts),不带就一样没有;一轮最多来回 maxSteps 次
 * - 思考:同 qwen 的档(low 不想、medium 想一点、high 不限;带工具的轮次至少想一点)。qwen3.8 系列和 Qwen Code 一样发 reasoning_effort(effortOf),
 *   别的模型按 thinking_budget 卡;2026-10-31 Ray 上对照过:qwen3.8-max 卡 1024 时有照片的话题每轮想满,首句 18 秒,qwen 运行时 6 秒
 * - .log 落统一事件(一行一条 CliEvent,parseEventLine 认),孩子端的流式板书、家长端看原文、转录、工具清单都走原来那套读法;
 *   用量按每次请求累计,有一次没回 usage 就不记(不当成零);另记命中缓存的输入与最后一次请求的输入(这一轮结束时上下文多大)
 * - 没有断流接着跑:流 stall.ms 没动静就停,这轮记没成(重发会把念过的再念一遍,先不做)
 * 请求体与 key 都不落盘:报错只记状态码(SDK 的异常里带着整个请求,孩子的照片也在里面)。
 */
import { createAlibaba } from '@ai-sdk/alibaba';
import { isStepCount, streamText, type ModelMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative } from 'node:path';
import type { AssistantPart, CliEvent, CliFinal, ToolResult } from './cli/types.ts';
import { getRuntime, type RunPlan } from './cli/run-plan.ts';
import { createPartialReader } from './stream.ts';
import { parseTranscript, toolCalls, toolSummary } from './transcript.ts';
import { compatibleBase, DASHSCOPE_HOST } from '../shared/qianwen.ts';
import { isApiRuntime, type CotutorConfig, type Policy } from '../schema/index.ts';
import { readOnlyTools } from './api-tools.ts';
import type { BrainHooks, BrainRequest, BrainResult, BrainRun, WarmKey } from './index.ts';

/** 计划里记的 cli 名:API 的轮次按它分流 */
export const API_CLI = 'api';
const DEFAULT_STEPS = 6;
/** 想一点:没有思考档的模型思考最多多少 token(有档的发 reasoning_effort,见 effortOf) */
const THINK_LITTLE = 1024;
/** 有思考档的模型:同 Qwen Code 里的 qwen3.8 系列(src/brain/cli/qwen.ts 的 tiers),百炼兼容接口认 reasoning_effort */
const TIERED = /^qwen3\.8-/;
/** 一张照片最大多少字节(百炼按 base64 收,太大的不附,记一条提醒) */
const IMAGE_MAX = 10 * 1024 * 1024;
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
/** 历史里模型消息的编码:AI SDK 7 的 ModelMessage 原样存;换大版本时按它转 */
const CODEC = 'ai-sdk@7';
/** 上一轮没回完:接在下一条消息前头 */
const UNFINISHED = '(应用注:上一轮你没有回完,上面是写出来的那部分;孩子可能听到了一些,也可能没有,别当它已经说完。)';

/** .log 的一行 → 统一事件(API 轮次的日志就是一行一条统一事件);不是这种行回 [] */
export function parseEventLine(line: string): CliEvent[] {
  if (!line.startsWith('{"kind":')) return [];
  try {
    const e = JSON.parse(line) as CliEvent;
    return typeof e.kind === 'string' ? [e] : [];
  } catch {
    return [];
  }
}

/** 政策 effort → 思考开关与思考量(同 qwen:low 不想,孩子在等;带工具的轮次至少想一点,不然照片题连资料都不查) */
export function thinkingOf(effort: Policy['effort'] | undefined, tools: BrainRequest['tools']): { enableThinking: boolean; thinkingBudget?: number } {
  if (effort === 'high') return { enableThinking: true };
  if (effort === 'medium' || tools !== 'off') return { enableThinking: true, thinkingBudget: THINK_LITTLE };
  return { enableThinking: false };
}

/**
 * 有思考档的模型照 qwen 运行时发 reasoning_effort(src/brain/cli/qwen.ts 的 EFFORT):想一点 = low、不限 = xhigh;不想或没有档 → null,照 thinkingOf 发。
 * low 是它自己看着想:闲聊想一两百 token,认照片题想得多;thinking_budget 是死卡,1024 时有照片的话题每轮都想满(2026-10-31)
 */
export function effortOf(model: string, effort: Policy['effort'] | undefined, tools: BrainRequest['tools']): 'low' | 'xhigh' | null {
  if (!TIERED.test(model)) return null;
  const t = thinkingOf(effort, tools);
  return !t.enableThinking ? null : t.thinkingBudget ? 'low' : 'xhigh';
}

/** AI SDK 的 alibaba 只认 thinking_budget:在 fetch 这一层把请求体里的换成 reasoning_effort(SDK 给的中间件口子) */
export function effortFetch(effort: 'low' | 'xhigh', base: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    if (typeof init?.body !== 'string') return base(input, init);
    const { thinking_budget: _budget, ...body } = JSON.parse(init.body) as Record<string, unknown>;
    return base(input, { ...init, body: JSON.stringify({ ...body, reasoning_effort: effort }) });
  };
}

/**
 * 百炼 Chat Completions 的端点:知道业务空间 id 就走它的域名(原型验过,同 realtime);只有按量 key 就走公网域名(qwen 那边按量的线也走它,2026-10-29 真跑通)
 */
export function bailianBase(workspaceId: string | null): string {
  return workspaceId ? `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` : compatibleBase(DASHSCOPE_HOST);
}

/** 历史文件的一行 = 一轮 */
interface TurnRecord {
  v: 1;
  session: string;
  at: string;
  model: string;
  codec: string;
  /** 这轮的用户消息:上下文包 + 孩子的话;照片相对 workspace 根 */
  user: { text: string; images: string[] };
  /** 模型回的全部消息(含工具往返);没回完的轮次是空的 */
  messages: ModelMessage[];
  /** 没回完的轮次写出来的正文 */
  partial?: string;
  ok: boolean;
  /** 这一轮整段压缩过:user.text 里有前情,之前的轮不再拼回去 */
  compacted?: true;
}

/** 报错只说状态码:SDK 的异常里带着整个请求 */
function failure(err: unknown): string {
  const status = err && typeof err === 'object' && 'statusCode' in err ? (err as { statusCode?: unknown }).statusCode : undefined;
  return typeof status === 'number' ? `api:HTTP ${status}` : 'api:请求或流断了';
}

const outputText = (o: unknown): string => (o && typeof o === 'object' && typeof (o as { text?: unknown }).text === 'string' ? (o as { text: string }).text : JSON.stringify(o) ?? '');
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function imagePart(file: string): Promise<{ type: 'file'; data: string; mediaType: string } | string> {
  const mediaType = MIME[extname(file).toLowerCase()];
  if (!mediaType) return '格式附不了';
  const size = await stat(file).then((s) => s.size, () => -1);
  if (size < 0) return '不在了';
  if (size > IMAGE_MAX) return `太大(${Math.round(size / 1024 / 1024)}MB),没附`;
  const data = await readFile(file);
  return { type: 'file', data: `data:${mediaType};base64,${data.toString('base64')}`, mediaType };
}

/** 一条用户消息:文字 + 照片(相对 root 的或绝对的);附不了的照片在文字后面说一句,也进 warnings */
async function userMessage(text: string, images: readonly string[], root: string, warnings?: string[]): Promise<ModelMessage> {
  if (!images.length) return { role: 'user', content: text };
  const parts: ({ type: 'text'; text: string } | { type: 'file'; data: string; mediaType: string })[] = [{ type: 'text', text }];
  for (const p of images) {
    const r = await imagePart(isAbsolute(p) ? p : join(root, p));
    if (typeof r === 'string') {
      parts.push({ type: 'text', text: `(照片 ${p} ${r})` });
      warnings?.push(`照片 ${p} ${r}`);
    } else parts.push(r);
  }
  return { role: 'user', content: parts };
}

/** 工具结果多少字;报错的给报错那句 */
function resultOf(output: unknown): { chars: number; error: string | null } {
  const o = (output ?? {}) as { type?: string; value?: unknown };
  const text = typeof o.value === 'string' ? o.value : JSON.stringify(o.value ?? '');
  return o.type === 'error-text' || o.type === 'error-json' ? { chars: 0, error: text.slice(0, 80) } : { chars: text.length, error: null };
}

/**
 * 已经结束的一轮,拼回历史时的老师那条:正文照原样,思考不带,工具往返换成一句「(用了 …,回了 N 字;结果这里不再带,要看再查)」。
 * 只剩一条纯文字的回复,历史里永远没有配不上对的工具消息
 */
export function slimTurn(messages: readonly ModelMessage[]): string {
  const results = new Map<string, { chars: number; error: string | null }>();
  for (const m of messages) if (m.role === 'tool') for (const p of m.content) if (p.type === 'tool-result') results.set(p.toolCallId, resultOf(p.output));
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    if (typeof m.content === 'string') {
      if (m.content.trim()) out.push(m.content.trim());
      continue;
    }
    for (const p of m.content) {
      if (p.type === 'text' && p.text.trim()) out.push(p.text.trim());
      else if (p.type === 'tool-call') {
        const what = toolSummary(p.toolName, (p.input && typeof p.input === 'object' ? p.input : {}) as Record<string, unknown>);
        const r = results.get(p.toolCallId);
        out.push(r?.error ? `(用了 ${what},没成:${r.error})` : `(用了 ${what}${r ? `,回了 ${r.chars} 字` : ''};结果这里不再带,要看再查)`);
      }
    }
  }
  return out.join('\n\n') || '(这一轮没有说话)';
}

/**
 * 同一会话的前几轮拼回模型消息;note = 最后一轮没回完时,接在这条消息前头的那句。
 * 照片只附最近交的那组(这一轮自己带了照片就一张都不附),更早的换成一句占位:看图说话那种一张图聊十几轮的,图一直在。
 * 从最近一次整段压缩的那一轮算起;这一轮要压缩(current.compact)就不拼,只回 note 与最近交的那组照片(带进压缩这一轮)
 */
async function pastOf(file: string, session: string, root: string, current: { images: boolean; compact: boolean }): Promise<{ messages: ModelMessage[]; note: string | null; photos: string[] }> {
  const raw = await readFile(file, 'utf8').catch(() => '');
  const records: TurnRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as TurnRecord;
      if (r.v === 1 && r.session === session) records.push(r);
    } catch {
      /* 写到一半的末行 */
    }
  }
  records.splice(0, Math.max(0, records.map((r) => r.compacted === true).lastIndexOf(true)));
  const withPhotos = records.map((r) => r.user.images.length > 0).lastIndexOf(true);
  const photos = withPhotos >= 0 ? records[withPhotos].user.images : [];
  if (current.compact) return { messages: [], note: records.at(-1)?.ok === false ? UNFINISHED : null, photos };
  const lastPhotos = current.images ? -1 : withPhotos;
  const messages: ModelMessage[] = [];
  let note: string | null = null;
  for (const [i, r] of records.entries()) {
    const text = note ? `${note}\n\n${r.user.text}` : r.user.text;
    const shown = i === lastPhotos ? r.user.images : [];
    const gone = r.user.images.filter((p) => !shown.includes(p)).map((p) => `(照片 ${p}:前面交过,这里不再附图)`);
    messages.push(await userMessage(gone.length ? `${text}\n\n${gone.join('\n')}` : text, shown, root));
    note = null;
    if (r.ok) messages.push({ role: 'assistant', content: slimTurn(r.messages) });
    else {
      // 没回完的:工具往返不进历史(配不上对),只留写出来的正文
      if (r.partial) messages.push({ role: 'assistant', content: r.partial });
      note = UNFINISHED;
    }
  }
  return { messages, note, photos };
}

export class ApiBrain {
  private readonly workspace: () => { config: CotutorConfig; root: string };
  private readonly auth: () => { key: string; workspaceId: string | null } | null;
  /** 测试与探针:…/compatible-mode/v1(假百炼);不给按业务空间 id 拼 */
  private readonly endpoint: string | undefined;
  constructor(opts: { workspace: () => { config: CotutorConfig; root: string }; auth: () => { key: string; workspaceId: string | null } | null; endpoint?: string }) {
    this.workspace = opts.workspace;
    this.auth = opts.auth;
    this.endpoint = opts.endpoint;
  }

  plan(req: BrainRequest): RunPlan {
    const { name } = getRuntime(this.workspace().config, req.runtime);
    const session = req.session && req.session.runtime === name ? req.session.id : null;
    return { runtime: name, cli: API_CLI, tools: req.tools, argv: [], resume: session !== null, session, env: {} };
  }

  start(req: BrainRequest, plan: RunPlan, ctx: { tutor: string; key: WarmKey; files: { log: string; err: string; history: string }; stall: Policy['stall'] }, hooks: BrainHooks): BrainRun {
    const reader = createPartialReader(parseEventLine);
    const go = async (): Promise<BrainResult> => {
      const { config, root } = this.workspace();
      const { runtime } = getRuntime(config, plan.runtime);
      if (!isApiRuntime(runtime)) throw new Error(`运行时 ${plan.runtime} 不是 API 运行时`);
      const { files, stall } = ctx;
      await mkdir(dirname(files.log), { recursive: true });
      const out = createWriteStream(files.log);
      await writeFile(files.err, '');
      const warnings: string[] = [];
      const event = (e: CliEvent): void => {
        out.write(`${JSON.stringify(e)}\n`);
        if (reader.apply([e])) hooks.onText();
      };
      hooks.onStart({ cli: API_CLI, runtime: plan.runtime, resume: plan.resume });
      const session = plan.session ?? `api-${randomUUID()}`;
      event({ kind: 'session', id: session });
      const images = req.images ?? [];
      const stored = images.map((p) => { const rel = relative(root, p); return rel.startsWith('..') || isAbsolute(rel) ? p : rel; });
      const record: TurnRecord = { v: 1, session, at: new Date().toISOString(), model: runtime.model, codec: CODEC, user: { text: req.prompt, images: stored }, messages: [], ok: false };
      let final: CliFinal;
      const auth = this.auth();
      if (!auth && !this.endpoint) {
        final = { ok: false, text: null, reason: 'auth:没有百炼按量 key' };
        warnings.push('百炼还没配好(按量 key):家长端「首页」里填,这位老师的运行时是 API 的,没有它说不了话');
      } else {
        const { messages: past, note, photos } = plan.resume ? await pastOf(files.history, session, root, { images: stored.length > 0, compact: Boolean(req.compact) }) : { messages: [], note: null, photos: [] };
        const head = [note, req.compact?.digest].filter((x): x is string => Boolean(x)).join('\n\n');
        const text = head ? `${head}\n\n${req.prompt}` : req.prompt;
        // 压缩这一轮:前情与没回完的那句都在消息里了,最近交的照片带过来;记下来,以后从这一轮算起
        const attach = req.compact && !stored.length ? photos : stored;
        if (req.compact) {
          record.compacted = true;
          record.user = { text, images: attach };
        }
        const user = await userMessage(text, attach, root, warnings);
        const tier = effortOf(runtime.model, req.effort, req.tools);
        const alibaba = createAlibaba({ apiKey: auth?.key ?? 'sk-endpoint', baseURL: this.endpoint ?? bailianBase(auth!.workspaceId), includeUsage: true, ...(tier ? { fetch: effortFetch(tier) } : {}) });
        // 断流看门狗:stall.ms 没有一块流到就停(工具在本进程里跑,几毫秒的事,不另算)
        const abort = new AbortController();
        let stalled = false;
        let idle: NodeJS.Timeout | null = null;
        const arm = (): void => {
          if (idle) clearTimeout(idle);
          if (stall.ms) idle = setTimeout(() => { stalled = true; abort.abort(); }, stall.ms);
        };
        let streamError: unknown;
        let finishReason: string | undefined;
        let steps = 0;
        let withUsage = 0;
        let inTokens = 0;
        let outTokens = 0;
        let cachedTokens = 0;
        let contextTokens = 0;
        // 这一步的正文、工具调用与结果:步收尾时按 CLI 的先后发(整条回复,再是工具结果)
        let stepText = '';
        let lastText = '';
        let thought = false;
        let calls: { id: string; name: string; input: Record<string, unknown> }[] = [];
        let results: ToolResult[] = [];
        arm();
        try {
          const result = streamText({
            model: alibaba(runtime.model),
            ...(req.systemBody ?? req.agentBody ? { system: req.systemBody ?? req.agentBody } : {}),
            messages: [...past, user],
            ...(req.tools !== 'off' ? { tools: readOnlyTools(req.readDirs, { images }) } : {}),
            stopWhen: isStepCount(runtime.maxSteps ?? DEFAULT_STEPS),
            maxRetries: 0,
            abortSignal: abort.signal,
            // 换掉 SDK 缺省的 console.error(它连请求体一起打)
            onError: ({ error }) => { streamError = error; },
            providerOptions: { alibaba: { ...thinkingOf(req.effort, req.tools), preserveThinking: true, parallelToolCalls: false } },
          });
          for await (const part of result.fullStream) {
            arm();
            if (part.type === 'start-step') {
              stepText = '';
              thought = false;
              calls = [];
              results = [];
              event({ kind: 'start', sub: false });
            } else if (part.type === 'reasoning-delta') {
              if (!thought) event({ kind: 'thinking', sub: false });
              thought = true;
            } else if (part.type === 'text-delta') {
              stepText += part.text;
              event({ kind: 'delta', text: part.text, sub: false });
            } else if (part.type === 'tool-call') {
              const input = (part.input && typeof part.input === 'object' ? part.input : {}) as Record<string, unknown>;
              calls.push({ id: part.toolCallId, name: part.toolName, input });
              hooks.onTool({ name: toolSummary(part.toolName, input), sub: false });
            } else if (part.type === 'tool-result') {
              results.push({ id: part.toolCallId, ok: true, text: outputText(part.output) });
            } else if (part.type === 'tool-error') {
              results.push({ id: part.toolCallId, ok: false, text: errorText(part.error) });
            } else if (part.type === 'finish-step') {
              steps++;
              if (part.usage.inputTokens !== undefined && part.usage.outputTokens !== undefined) {
                withUsage++;
                inTokens += part.usage.inputTokens;
                cachedTokens += part.usage.inputTokenDetails?.cacheReadTokens ?? 0;
                contextTokens = part.usage.inputTokens;
                outTokens += part.usage.outputTokens;
              }
              const parts: AssistantPart[] = [...(stepText ? [{ type: 'text' as const, text: stepText }] : []), ...calls.map((c) => ({ type: 'tool' as const, tool: c }))];
              event({ kind: 'assistant', parts, sub: false });
              if (results.length) event({ kind: 'results', results, sub: false });
              lastText = stepText;
            } else if (part.type === 'finish') finishReason = part.finishReason;
            else if (part.type === 'error') streamError = part.error;
          }
          if (!stalled && !streamError && finishReason && finishReason !== 'error' && finishReason !== 'tool-calls') record.messages = await result.responseMessages;
        } catch (err) {
          if (!stalled) streamError ??= err;
        } finally {
          if (idle) clearTimeout(idle);
        }
        const usage = steps > 0 && withUsage === steps ? { inTokens, outTokens, cachedTokens, contextTokens } : {};
        if (steps > 0 && withUsage < steps) warnings.push(`用量没回全(${steps} 次请求里 ${steps - withUsage} 次没回 usage),这轮不记 token`);
        if (stalled) {
          final = { ok: false, text: null, reason: `stalled:${stall.ms}ms 没有动静`, numTurns: steps, ...usage };
          warnings.push(`API 流 ${stall.ms / 1000} 秒没动静,停了;这轮没收尾(不重发:念过的会再念一遍)`);
        } else if (streamError || !finishReason || finishReason === 'error') {
          final = { ok: false, text: null, reason: streamError ? failure(streamError) : 'api:没有收尾', numTurns: steps, ...usage };
        } else if (finishReason === 'tool-calls') {
          final = { ok: false, text: null, reason: `steps:来回 ${steps} 次还在用工具,到了上限`, numTurns: steps, ...usage };
          warnings.push(`老师一轮里用工具来回到了上限(${steps} 次),这轮没收尾;要多给几次改 cotutor.json 的 runtimes.${plan.runtime}.maxSteps`);
        } else {
          final = { ok: true, text: lastText.trim() || null, reason: null, numTurns: steps, ...usage };
          if (finishReason === 'length') warnings.push('回复到了模型的输出上限,后面截掉了');
          if (finishReason === 'content-filter') warnings.push('回复被模型的内容审核截住了');
        }
        record.ok = final.ok;
        if (!final.ok) {
          const partial = reader.text().trim();
          if (partial) record.partial = partial;
          await appendFile(files.err, `cotutor: ${final.reason}\n`).catch(() => {});
        }
      }
      event({ kind: 'result', final });
      hooks.onExit(Date.now());
      await new Promise<void>((r) => out.end(r));
      // 没配凭证的那轮连请求都没发:不进历史
      if (auth || this.endpoint) await appendFile(files.history, `${JSON.stringify(record)}\n`).catch(() => {});
      const logText = await readFile(files.log, 'utf8').catch(() => '');
      const transcript = parseTranscript(logText, parseEventLine);
      const tools = toolCalls(logText, parseEventLine).slice(0, 200);
      return { transcript: { ...transcript, final: transcript.final ?? final }, tools, warnings };
    };
    return { warm: false, text: () => reader.text(), done: go() };
  }
}
