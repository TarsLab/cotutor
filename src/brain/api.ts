/**
 * 脑执行的 API 实现(2026-10-29):不起 CLI,应用在服务进程里直连百炼的 Chat Completions(AI SDK + @ai-sdk/alibaba,cotutor-api-prototype 验过这条路)。
 * - 系统提示 = runner 给的 systemBody(老师正文或 activity + 板书写法);消息 = 上下文包 + 孩子的话,本轮的照片直接附成图,不靠老师自己去读
 * - 同一话题的模型历史应用自己存:<日期>.<话题>.brain.jsonl,一行一轮(会话 id、模型、这轮的用户消息、模型回的全部消息、成没成);
 *   接着话题时把同一会话的那几行拼回去。照片只记相对 workspace 根的路径,发的时候再编码。没回完的一轮只留写出来的正文,下一条消息前头注明
 * - 工具:这轮带工具(read / on)就给只读的三样(./api-tools.ts),不带就一样没有;一轮最多来回 maxSteps 次
 * - 思考:同 qwen 的档(low 不想、medium 想一点、high 不限;带工具的轮次至少想一点),还没和 CLI 那边真跑对照过
 * - .log 落统一事件(一行一条 CliEvent,parseEventLine 认),孩子端的流式板书、家长端看原文、转录、工具清单都走原来那套读法;
 *   用量按每次请求累计,有一次没回 usage 就不记(不当成零)
 * - 没有断流接着跑:流 stall.ms 没动静就停,这轮记没成(重发会把念过的再念一遍,先不做)
 * 请求体与 key 都不落盘:报错只记状态码(SDK 的异常里带着整个请求,孩子的照片也在里面)。
 */
import { createAlibaba } from '@ai-sdk/alibaba';
import { isStepCount, streamText, type ModelMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative } from 'node:path';
import type { AssistantPart, CliEvent, CliFinal, ToolResult } from '../clis/types.ts';
import { getRuntime, type RunPlan } from '../lib/run-plan.ts';
import { createPartialReader } from '../lib/stream.ts';
import { parseTranscript, toolCalls, toolSummary } from '../lib/transcript.ts';
import { isApiRuntime, type CotutorConfig, type Policy } from '../schema/index.ts';
import { readOnlyTools } from './api-tools.ts';
import type { BrainHooks, BrainRequest, BrainResult, BrainRun, WarmKey } from './index.ts';

/** 计划里记的 cli 名:API 的轮次按它分流 */
export const API_CLI = 'api';
const DEFAULT_STEPS = 6;
/** 想一点:思考最多多少 token */
const THINK_LITTLE = 1024;
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

/** 百炼 Chat Completions 的端点:业务空间 id 的域名(同 realtime;公网域名的按量 key 用不了业务空间) */
export const bailianBase = (workspaceId: string): string => `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`;

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

/** 同一会话的前几轮拼回模型消息;note = 最后一轮没回完时,接在这条消息前头的那句 */
async function pastOf(file: string, session: string, root: string): Promise<{ messages: ModelMessage[]; note: string | null }> {
  const raw = await readFile(file, 'utf8').catch(() => '');
  const messages: ModelMessage[] = [];
  let note: string | null = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let r: TurnRecord;
    try {
      r = JSON.parse(line) as TurnRecord;
    } catch {
      continue; // 写到一半的末行
    }
    if (r.v !== 1 || r.session !== session) continue;
    messages.push(await userMessage(note ? `${note}\n\n${r.user.text}` : r.user.text, r.user.images, root));
    note = null;
    if (r.ok) messages.push(...r.messages);
    else {
      // 没回完的:工具往返不进历史(配不上对),只留写出来的正文
      if (r.partial) messages.push({ role: 'assistant', content: r.partial });
      note = UNFINISHED;
    }
  }
  return { messages, note };
}

export class ApiBrain {
  private readonly workspace: () => { config: CotutorConfig; root: string };
  private readonly auth: () => { key: string; workspaceId: string } | null;
  /** 测试与探针:…/compatible-mode/v1(假百炼);不给按业务空间 id 拼 */
  private readonly endpoint: string | undefined;
  constructor(opts: { workspace: () => { config: CotutorConfig; root: string }; auth: () => { key: string; workspaceId: string } | null; endpoint?: string }) {
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
        final = { ok: false, text: null, reason: 'auth:没有百炼按量 key 或业务空间 id' };
        warnings.push('百炼还没配好(按量 key 与业务空间 id):家长端「首页」里填,这位老师的运行时是 API 的,没有它说不了话');
      } else {
        const { messages: past, note } = plan.resume ? await pastOf(files.history, session, root) : { messages: [], note: null };
        const user = await userMessage(note ? `${note}\n\n${req.prompt}` : req.prompt, stored, root, warnings);
        const alibaba = createAlibaba({ apiKey: auth?.key ?? 'sk-endpoint', baseURL: this.endpoint ?? bailianBase(auth!.workspaceId), includeUsage: true });
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
        const usage = steps > 0 && withUsage === steps ? { inTokens, outTokens } : {};
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
