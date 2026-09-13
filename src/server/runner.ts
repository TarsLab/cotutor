/**
 * 发消息 = 拼上下文包 → 按运行时 spawn / resume → stream-json 落 conversations/<老师>/<日期>.<job>.log → 索引更新
 * (最终文本 → 板书节 section + 讲稿逐句配音 <日期>.<job>.<n>.mp3 + 家长尾巴 parentText + 解析提醒 warnings)。
 * 流式:stdout 经本进程落盘,同时喂 PartialReader 拼当前回复正文 → parseBoard(partial) → 内存里的 partial section
 * (孩子端 pending 条目带着它,卡随围栏闭合逐张出现);讲稿每定稿一句就开始配音,整轮跑完只等没配完的;
 * 点读段等资产在索引写好之后后台接着配(同一条队列),孩子端点到还没好的段用浏览器的声。
 * 「## 转交」自动起目标老师的一轮(from: system,转交单 = 谁转的、why、refs、孩子的话、voice):目标老师不在 / 关着 / 忙 / 场景作业到了 dailyMax
 * 都不起,原因进这条消息的 warnings;起了记 handoffJob。目标老师用自己的 runtime(cotutor.json tutors.<name>.runtime)。
 * 一老师同时只跑一条(老师还在回上一条就 409),跨天自动新开(索引按本地日期分文件,新文件没 session 就不带 --resume)。
 * 话题(2026-09-11):一天可多个,每个话题自己的会话(index.sessions[thread]);newThread / 系统消息 / 今天第一条开新话题(不 resume、不带旧卡),
 * 指定 thread 接着今天的旧话题(resume 它的会话),缺省接当前话题。
 * 埋点(2026-09-11):每轮记 timing(进程起的时刻、首卡、进程退出、配音收尾,毫秒),家长视图每轮一行;scene-maker 那轮收尾
 * 把课包的费用与时长追加进 artifacts.jsonl(老师自己只记 ready / retired 那行;它忘了记就由应用补一整行),消息的 artifacts 记课包 id。
 * 进程 cwd 是老师目录 agents/<name>/(《agent层设计.md》拍板)。
 */
import { spawn } from 'node:child_process';
import { closeSync, createWriteStream, existsSync, openSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildContextPack } from '../lib/context-pack.ts';
import { addMessage, applyRun, cardId, changedCards, conversationFiles, jobId, localDate, localMinute, sessionFor, threads } from '../lib/conversation.ts';
import { BUNDLE_ID_RE, cardAssets, cardLabel, describeCard } from '../cards/index.ts';
import { parseBoard } from '../lib/board.ts';
import { readyBeats, beatsOf, type BoardSection, type Device } from '../lib/kid-board.ts';
import { deriveKidView, truncateReply } from '../lib/kid-view.ts';
import { createPartialReader } from '../lib/stream.ts';
import { parseSections } from '../lib/sections.ts';
import { mergeArtifacts, mergeObservations, parseArtifactEvents, parseObservations, recentObservations } from '../lib/ledger.ts';
import { isoWeek, parsePlan, planLinesFor } from '../lib/plan.ts';
import { getRuntime, planRun, runtimeUses, type RunPlan } from '../lib/run-plan.ts';
import { currentSlot, parseTimetable, slotLabel } from '../lib/timetable.ts';
import { parseTranscript, toolSummary } from '../lib/transcript.ts';
import { beatTimings, type RunEvent, type RunEventEnvelope, type RunEventInput } from '../lib/events.ts';
import { resolvePolicy, type ArtifactEvent, type ContextPack, type ConversationIndex, type ConversationMessage, type Focus, type Handoff, type MessageFrom, type Policy, type Timing } from '../schema/index.ts';
import { DEFAULT_DEVICE, assemblePost, postEnv, runBeatPost, writePostFile, type PostBeatFile, type PostEnv } from './post.ts';
import { validateBeatPost, type BeatPostOutput } from '../lib/postprocess.ts';
import type { Transcript } from '../lib/transcript.ts';
import { UsageError, type Workspace } from '../cli/workspace.ts';
import { readAgentBody, readCardStates, readIndex, writeIndex, writeRunFile } from './store.ts';
import { DubQueue, LineDubber, dubReply } from './tts.ts';

export class BusyError extends Error {
  constructor(tutor: string, job: string) {
    super(`${tutor} 还在回上一条(${job}),等它说完再发`);
  }
}

export interface SendInput {
  from: MessageFrom;
  /** 带 action 时可以是空的:继续 → 「继续」;交给老师 → 「(交了答案,没说话)」 */
  text: string;
  focus?: Focus;
  /** 孩子端的动作:继续(不计每日上限)/ 交给老师(把改过的卡交出去) */
  action?: 'continue' | 'submit';
  /** 运行时名,缺省 cotutor.json 的 runtimes.default */
  runtime?: string;
  /** 开新话题:不 resume、不带旧话题卡上的状态;话题 id = 这条的 job */
  newThread?: boolean;
  /** 接着今天的某个话题聊(话题 id);缺省 = 当前(末条所在的)话题。from: system 的永远开新话题 */
  thread?: string;
  /** 孩子端是什么端(板书后期按它排版);缺省当平板横屏 */
  device?: Device;
}

export interface SendStarted {
  tutor: string;
  date: string;
  job: string;
  /** 这条消息所在的话题 */
  thread: string;
  plan: RunPlan;
  /** 老师说完(进程退出、索引写好)后 resolve */
  done: Promise<ConversationIndex>;
}

interface Active {
  job: string;
  date: string;
  done: Promise<ConversationIndex>;
  /** 还在说的时候已经解析出来的板书(卡只增不改;讲稿句已按 replyMaxChars 截) */
  partial: BoardSection | null;
}

/** 上下文包的取材:课程表命中的时段 + 本周计划里本老师的行 + 本学科最近观察 */
export async function gatherContext(ws: Workspace, tutor: string, input: { from: MessageFrom; at: Date; focus?: Focus }): Promise<ContextPack> {
  const t = ws.config.tutors[tutor];
  const policy = resolvePolicy(ws.config, tutor);
  const pack: ContextPack = { from: input.from, at: localMinute(input.at), focus: input.focus, plan: [], recent: [] };
  try {
    const slot = currentSlot(parseTimetable(await readFile(ws.paths.timetable, 'utf8')).entries, input.at);
    if (slot) pack.slot = slotLabel(slot);
  } catch {
    /* 没有课程表:不带 slot */
  }
  try {
    const { plan } = parsePlan(await readFile(join(ws.paths.plans, `${isoWeek(input.at)}.md`), 'utf8'));
    if (plan && t) pack.plan = planLinesFor(plan, t.display, policy.contextPack.planLines);
  } catch {
    /* 没有本周计划,或读不到:上下文包不带 plan */
  }
  try {
    const { rows } = parseObservations(await readFile(ws.files.observations, 'utf8'));
    pack.recent = recentObservations(mergeObservations(rows), { subject: t?.subject, n: policy.contextPack.recent });
  } catch {
    /* 账本还没有 */
  }
  return pack;
}

export class Runner {
  private readonly active = new Map<string, Active>();
  /** 还在后台跑的资产生成(测试与关服前 flush) */
  private readonly background = new Set<Promise<void>>();
  private readonly getWs: () => Workspace;
  private readonly opts: { now?: () => Date; env?: NodeJS.ProcessEnv };
  private readonly listeners = new Set<(e: RunEventEnvelope) => void>();
  /** 起子进程用的环境(测试注入;repost 用同一份) */
  get env(): NodeJS.ProcessEnv | undefined {
    return this.opts.env;
  }
  constructor(getWs: () => Workspace, opts: { now?: () => Date; env?: NodeJS.ProcessEnv } = {}) {
    this.getWs = getWs;
    this.opts = opts;
  }

  running(tutor: string): { job: string; date: string } | null {
    const a = this.active.get(tutor);
    return a ? { job: a.job, date: a.date } : null;
  }

  /** 等所有后台资产生成完(测试用) */
  async flush(): Promise<void> {
    while (this.background.size) await Promise.all([...this.background]);
  }

  /** 订阅每一轮的事件(lib/events.ts;cotutor send 现场打印、serve --trace);返回退订函数。事件同时追加到 <日期>.<job>.events.jsonl */
  onEvent(fn: (e: RunEventEnvelope) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** 正在回的那条已经出来的板书(流式);没在跑或还没出卡 → null */
  partial(tutor: string): BoardSection | null {
    return this.active.get(tutor)?.partial ?? null;
  }

  async send(tutor: string, input: SendInput): Promise<SendStarted> {
    const ws = this.getWs();
    const t = ws.config.tutors[tutor];
    if (!t) throw new UsageError(`没有叫 ${tutor} 的老师;cotutor.json 的 tutors 里有:${Object.keys(ws.config.tutors).join('、')}`);
    if (!t.enabled) throw new UsageError(`${t.display} 已关闭(cotutor.json tutors.${tutor}.enabled = false),打开再发`);
    const text = input.text.trim() || (input.action === 'continue' ? '继续' : input.action === 'submit' ? '(交了答案,没说话)' : '');
    if (!text) throw new UsageError('消息是空的');
    const busy = this.active.get(tutor);
    if (busy) throw new BusyError(tutor, busy.job);

    const now = (this.opts.now ?? (() => new Date()))();
    const date = localDate(now);
    const index = await readIndex(ws, tutor, date);
    const job = jobId(now, index.messages.length + 1);
    // 话题:新开(newThread / 系统消息 / 今天第一条)= 自己的 job;指定的要在今天的索引里;缺省接当前话题。会话按话题 resume
    const known = threads(index.messages);
    let thread: string;
    if (input.newThread || input.from === 'system' || !known.length) thread = job;
    else if (input.thread) {
      if (!known.includes(input.thread)) throw new UsageError(`今天没有话题 ${input.thread};有:${[...new Set(known)].join('、')}`);
      thread = input.thread;
    } else thread = known[known.length - 1];
    const fresh = thread === job;
    const session = fresh ? null : sessionFor(index, thread);
    const { runtime } = getRuntime(ws.config, input.runtime ?? t.runtime);
    const agentBody = runtimeUses(runtime, '{agentBody}') ? await readAgentBody(ws, tutor) : undefined;
    const pack = await gatherContext(ws, tutor, { from: input.from, at: now, focus: input.focus });
    const policy = resolvePolicy(ws.config, tutor);
    if (policy.board === 'off') pack.board = 'off';
    // 这个话题里上一轮之后孩子在卡上做的事:逐张 describe 进上下文包,也记进这条消息(家长视图「孩子在板书上做的」);新话题不带
    const cards = fresh ? [] : changedCards(index, await readCardStates(ws, tutor, date), thread).map((c) => {
      const card = index.messages.find((m) => m.job === c.job)?.section?.cards[c.n];
      const id = cardId(c.job, c.n);
      return { card: id, text: card ? describeCard(card, c.file.state) : JSON.stringify(c.file.state) };
    });
    if (cards.length) pack.cards = cards.map((c) => `${c.card} ${c.text}`);
    const prompt = buildContextPack(pack, text, policy.contextPack);
    const plan = planRun(ws.config, { session }, { agent: tutor, prompt, agentBody, runtime: input.runtime ?? t.runtime });

    const started = addMessage(index, { job, thread, at: pack.at, from: input.from, text, focus: input.focus, ...(input.action ? { action: input.action } : {}), ...(cards.length ? { cards } : {}), ...(input.device ? { device: input.device } : {}), result: 'running', artifacts: [], runtime: plan.runtime });
    await writeIndex(ws, started);
    await writeRunFile(ws, tutor, date, job, { at: pack.at, prompt, plan, agentBody: agentBody !== undefined });

    const active: Active = { job, date, partial: null, done: Promise.resolve(started) };
    active.done = this.spawn(ws, tutor, date, job, plan, policy, input.device ?? DEFAULT_DEVICE, active).finally(() => this.active.delete(tutor));
    this.active.set(tutor, active);
    return { tutor, date, job, thread, plan, done: active.done };
  }

  /**
   * 给 scene-maker 的转交,课包 id 要在卡、refs、作业三处一致:refs[0] 不是合法 id 就取这节里场景卡的 bundle;
   * scenes/<id>.ts 或 bundles/<id>/ 已经有了(老师起名撞了,真跑见过:孩子卡上放了旧课包)就改成 <id>-2、-3…,卡上的 bundle 一起改。
   */
  settleBundleId(ws: Workspace, h: Handoff, section: BoardSection | null): { handoff: Handoff; section: BoardSection | null; warnings: string[] } {
    const warnings: string[] = [];
    const fromCard = section?.cards.find((c) => c.kind === 'scene' && typeof c.props.bundle === 'string')?.props.bundle as string | undefined;
    let id = h.refs.find((r) => BUNDLE_ID_RE.test(r)) ?? fromCard;
    if (!id) return { handoff: h, section, warnings: ['转交 scene-maker 没给课包 id(refs 里放 id,或正文里放 scene 卡),画图老师会自己起名,孩子端的卡对不上'] };
    const taken = (x: string): boolean => existsSync(join(ws.dirs.scenes, `${x}.ts`)) || existsSync(join(ws.dirs.scenes, `${x}.md`)) || existsSync(join(ws.dirs.bundles, x));
    if (taken(id)) {
      let n = 2;
      while (taken(`${id}-${n}`)) n++;
      const fresh = `${id}-${n}`;
      warnings.push(`课包 id ${id} 已占用,改成 ${fresh}(卡与转交单一起改)`);
      id = fresh;
    }
    const refs = [id, ...h.refs.filter((r) => r !== h.refs.find((x) => BUNDLE_ID_RE.test(x)) && r !== fromCard)];
    const cards = section?.cards.map((c) => (c.kind === 'scene' && c.props.bundle === fromCard ? { ...c, props: { ...c.props, bundle: id } } : c));
    return { handoff: { ...h, refs }, section: section && cards ? { ...section, cards } : section, warnings };
  }

  /** 转交单:目标老师看到的那条消息(from: system) */
  static handoffText(ws: Workspace, from: string, job: string, h: Handoff, kidText: string): string {
    const t = ws.config.tutors[from];
    const lines = [`转交自 ${t?.display ?? from}(${from},job ${job}):`, `why: ${h.why ?? ''}`];
    if (h.refs.length) lines.push(`refs: ${h.refs.join(', ')}`);
    if (kidText.trim()) lines.push(`孩子刚才说的:${kidText.trim()}`);
    if (t?.voice) lines.push(`voice: ${t.voice}`);
    return lines.join('\n');
  }

  private async handoff(ws: Workspace, from: string, job: string, h: Handoff, kidText: string): Promise<{ started: { tutor: string; job: string } | null; warning?: string }> {
    const target = ws.config.tutors[h.to];
    if (!target || !target.enabled) return { started: null, warning: `转交没起:${h.to} ${target ? '关着' : '不在 cotutor.json 里'}` };
    if (h.to === from) return { started: null, warning: '转交没起:转给了自己' };
    if (h.to === 'scene-maker') {
      const policy = resolvePolicy(ws.config, h.to);
      const today = await readIndex(ws, h.to, localDate((this.opts.now ?? (() => new Date()))()));
      if (today.messages.length >= policy.scenes.dailyMax) return { started: null, warning: `转交没起:场景作业今天已到上限 ${policy.scenes.dailyMax}(policy scenes.dailyMax)` };
    }
    try {
      const r = await this.send(h.to, { from: 'system', text: Runner.handoffText(ws, from, job, h, kidText) });
      return { started: { tutor: h.to, job: r.job } };
    } catch (err) {
      return { started: null, warning: `转交没起:${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** 转交单里的课包 id(refs 第一个合法 id);没有就从收尾那句「课包 x 做好了 / 没做成」取 */
  static sceneJobId(handoffText: string, finalText: string | null): string | null {
    const refs = /^refs:\s*(.+)$/m.exec(handoffText)?.[1]?.split(/[,,]\s*/) ?? [];
    return refs.find((r) => BUNDLE_ID_RE.test(r.trim()))?.trim() ?? /课包\s+(\S+?)\s*(?:做好了|没做成)/.exec(finalText ?? '')?.[1] ?? null;
  }

  /**
   * scene-maker 那轮收尾:往 artifacts.jsonl 追加这个课包的 costUsd / durationMs(一行,同 id 后者为准,老师文件那行不用改)。
   * 老师忘了记账(账本里没这个 id)就由应用补一整行:bundles/<id>/manifest.json 在 → ready,不在 → retired。
   */
  private async settleSceneLedger(ws: Workspace, tutor: string, date: string, job: string, handoffText: string, transcript: Transcript, timing: Timing): Promise<{ id: string | null; warnings: string[] }> {
    const id = Runner.sceneJobId(handoffText, transcript.final?.text ?? null);
    if (!id) return { id: null, warnings: ['转交单没有课包 id,收尾那句也没写「课包 x 做好了」,这轮的费用没记进账本'] };
    const warnings: string[] = [];
    const known = mergeArtifacts(parseArtifactEvents(await readFile(ws.files.artifacts, 'utf8').catch(() => '')).rows).artifacts.some((a) => a.id === id);
    const row: ArtifactEvent = { id, at: new Date().toISOString(), source: { conversation: `${tutor}/${date}`, job }, ...(transcript.final?.costUsd !== undefined ? { costUsd: transcript.final.costUsd } : {}), ...(timing.doneMs !== undefined ? { durationMs: timing.doneMs } : {}) };
    if (!known) {
      const ready = existsSync(join(ws.dirs.bundles, id, 'manifest.json'));
      Object.assign(row, { kind: '课包', by: tutor, status: ready ? 'ready' : 'retired', ...(ready ? { path: `bundles/${id}` } : {}) });
      warnings.push(`画图老师没往账本记 ${id},应用补了一行(${ready ? 'ready' : 'retired:bundles/' + id + '/manifest.json 不在'})`);
    }
    try {
      await mkdir(ws.dirs.ledger, { recursive: true });
      await appendFile(ws.files.artifacts, `${JSON.stringify(row)}\n`);
    } catch (err) {
      warnings.push(`账本写不进:${err instanceof Error ? err.message : String(err)}`);
    }
    return { id, warnings };
  }

  private async spawn(ws: Workspace, tutor: string, date: string, job: string, plan: RunPlan, policy: Policy, device: Device, active: Active): Promise<ConversationIndex> {
    const replyMaxChars = policy.replyMaxChars;
    const files = conversationFiles(ws.dirs.conversations, tutor, date);
    const cwd = join(ws.dirs.agents, tutor);
    await mkdir(cwd, { recursive: true });
    const out = createWriteStream(files.log(job));
    const err = openSync(files.err(job), 'w');
    // 埋点:从进程起来那一刻算,首卡 = partial 板书第一次有卡(孩子端第一次看到东西),done = 进程退出,dubbed = 配音收尾
    const t0 = Date.now();
    const timing: Timing = { startedAt: new Date(t0).toISOString() };
    const since = (): number => Date.now() - t0;
    // 事件:每道工序的关键点发一条,追加到 events.jsonl(按序),同时给内存里的订阅者;写盘失败不影响这一轮
    let eventsChain: Promise<void> = Promise.resolve();
    const events: RunEvent[] = [];
    const emit = (e: RunEventInput): void => {
      const event = { t: since(), ...e } as RunEvent;
      events.push(event);
      eventsChain = eventsChain.then(() => appendFile(files.events(job), `${JSON.stringify(event)}\n`)).catch(() => {});
      for (const fn of this.listeners) {
        try {
          fn({ tutor, date, job, event });
        } catch {
          /* 订阅者的错不影响这一轮 */
        }
      }
    };
    emit({ lane: 'main', kind: 'start', cli: plan.argv[0].slice(plan.argv[0].lastIndexOf('/') + 1), runtime: plan.runtime, resume: plan.resume });
    const voice = ws.config.tutors[tutor]?.voice;
    const queue = voice ? new DubQueue(ws.config.tts, voice, files.err(job), this.opts.env) : null;
    if (queue) queue.report = (e) => emit(e.kind === 'queued' ? { lane: 'tts', kind: 'queued', label: e.label } : e.kind === 'done' ? { lane: 'tts', kind: 'done', label: e.label, ms: e.ms, file: e.file ?? '' } : { lane: 'tts', kind: 'failed', label: e.label, ms: e.ms, error: e.error ?? '?' });
    const dubber = queue ? new LineDubber(queue, (n) => files.lineAudio(job, n)) : null;
    // 工具调用:stdout 的 assistant 事件里有 tool_use 就发一条(子代理的标 sub);只对含 tool_use 的行 JSON.parse
    let toolBuf = '';
    const scanTools = (chunk: string): void => {
      toolBuf += chunk;
      const parts = toolBuf.split('\n');
      toolBuf = parts.pop() ?? '';
      for (const line of parts) {
        if (!line.includes('"tool_use"')) continue;
        try {
          const e = JSON.parse(line) as { type?: string; parent_tool_use_id?: string | null; message?: { content?: { type?: string; name?: string; input?: Record<string, unknown> }[] } };
          if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
          for (const b of e.message.content) if (b.type === 'tool_use' && b.name) emit({ lane: 'main', kind: 'tool', name: toolSummary(b.name, b.input), sub: Boolean(e.parent_tool_use_id) });
        } catch {
          /* 不是一行完整 JSON:跳过 */
        }
      }
    };
    let cardsSeen = 0;
    let linesSeen = 0;
    // 板书后期按拍(2026-09-13):拍关了(后面有下一张卡)就起一次快模型;提案校验后记进 decisions,partial 每次重建都重新套一遍;
    // 回了 / 失败了都算 settled(失败 = 这拍素版),就绪要等它;老师写完后没起过的拍再补起,全部按卡的顺序套到定稿的节上
    const postOn = policy.post.mode !== 'off';
    let envP: Promise<PostEnv> | null = null;
    const getEnv = (): Promise<PostEnv> => (envP ??= postEnv(ws, tutor, { device, policy }));
    const beatPosts = new Map<number, Promise<PostBeatFile>>();
    const decisions = new Map<number, BeatPostOutput>();
    const settledCards = new Set<number>();
    let postT0: number | null = null;
    const applyDecisions = (section: BoardSection, env: PostEnv | null): BoardSection => {
      if (!env || !decisions.size) return section;
      let cur = section;
      for (const b of beatsOf(cur)) {
        const out = b.card === null ? undefined : decisions.get(b.card);
        if (out) cur = validateBeatPost(cur, b, env.theme, env.device, out).section;
      }
      return cur;
    };
    let envNow: PostEnv | null = null;
    const startBeatPost = (section: BoardSection, beat: { card: number | null; lines: number[] }, k: number): void => {
      if (beat.card === null || beatPosts.has(beat.card)) return;
      const card = beat.card;
      postT0 ??= Date.now();
      emit({ lane: 'post', kind: 'start', beat: k, card, context: Math.min(card, 5) });
      const p = getEnv().then((env) => { envNow = env; return runBeatPost(ws, tutor, section, beat, env, { device, policy, env: this.opts.env, cwd }); }).then((r) => {
        if (r.file.ok && r.file.output) decisions.set(card, r.file.output);
        settledCards.add(card);
        if (r.file.ok && r.file.kept) emit({ lane: 'post', kind: 'done', beat: k, ms: r.file.ms, kept: r.file.kept, dropped: r.file.dropped.length, ...(r.file.costUsd !== undefined ? { costUsd: r.file.costUsd } : {}) });
        else emit({ lane: 'post', kind: 'failed', beat: k, ms: r.file.ms, error: r.file.error ?? '?' });
        if (active.partial) { active.partial = { ...applyDecisions(active.partial, envNow), partial: true, ready: active.partial.ready }; settleReady(); }
        return r.file;
      });
      beatPosts.set(card, p);
    };
    // 拍的就绪(流式):每句配音落盘就填进 partial 的 audio,重算前几拍就绪(后期开着的还要等这拍的后期回);涨了发 ready:beat,第一拍记 firstReadyMs
    const lineAudio = new Map<number, string>();
    let readySeen = 0;
    const settleReady = (): void => {
      if (!active.partial) return;
      const n = readyBeats(active.partial, { voiced: Boolean(voice), done: false, settled: (_k, b) => b.card === null || !postOn || settledCards.has(b.card) });
      if (n <= readySeen) return;
      const beats = beatsOf(active.partial);
      for (; readySeen < n; readySeen++) {
        if (timing.firstReadyMs === undefined) timing.firstReadyMs = since();
        emit({ lane: 'ready', kind: 'beat', beat: readySeen, card: beats[readySeen]?.card ?? null, first: readySeen === 0 });
      }
      active.partial = { ...active.partial, ready: n };
    };
    // 流式:stdout 的每一块先落盘再喂读取器;正文变了就(节流 150ms)重解析成 partial 板书,定稿的句子交去配音
    const reader = createPartialReader();
    let dirty = false;
    let timer: NodeJS.Timeout | null = null;
    const reparse = (): void => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      // 先剥「## 待裁量」「## 转交」再解析,和定稿的 deriveKidView 同一条路;不剥的话老师先写转交单那轮流式时一张卡都出不来(2026-09-13 控制台里看见的)
      const { section } = parseBoard(parseSections(reader.text()).body, { partial: true });
      const lines = section.lines.map((l, i) => ({ ...l, text: truncateReply(l.text, replyMaxChars).text, audio: lineAudio.get(i) ?? null }));
      active.partial = section.cards.length || lines.length ? { ...applyDecisions({ cards: section.cards, lines }, envNow), partial: true, ready: readySeen } : null;
      if (postOn && active.partial) { const bs = beatsOf(active.partial); bs.forEach((b, k) => { if (k < bs.length - 1) startBeatPost(active.partial!, b, k); }); }
      if (section.cards.length && timing.firstCardMs === undefined) timing.firstCardMs = since();
      for (; cardsSeen < section.cards.length; cardsSeen++) emit({ lane: 'main', kind: 'card', card: cardsSeen, label: `${section.cards[cardsSeen].kind} ${cardLabel(section.cards[cardsSeen])}`.trim() });
      for (; linesSeen < lines.length; linesSeen++) emit({ lane: 'main', kind: 'line', line: linesSeen, text: lines[linesSeen].text });
      if (dubber) lines.forEach((l, i) => { const p = dubber.add(i, l.text); if (p) void p.then((name) => { if (name && active.partial && active.partial.lines[i]) { lineAudio.set(i, name); active.partial.lines[i].audio = name; settleReady(); } }, () => {}); });
      settleReady();
    };
    const exit = await new Promise<{ code: number | null; spawnError?: Error }>((resolveExit) => {
      const child = spawn(plan.argv[0], plan.argv.slice(1), {
        cwd,
        env: { ...(this.opts.env ?? process.env), COTUTOR_WORKSPACE: ws.root },
        stdio: ['ignore', 'pipe', err],
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        out.write(chunk);
        const s = chunk.toString('utf8');
        scanTools(s);
        if (reader.feed(s)) {
          dirty = true;
          if (!timer) timer = setTimeout(reparse, 150);
        }
      });
      child.once('error', (e) => resolveExit({ code: null, spawnError: e }));
      child.once('close', (code) => resolveExit({ code }));
    });
    timing.doneMs = since();
    if (timer) clearTimeout(timer);
    await new Promise<void>((r) => out.end(r));
    closeSync(err);
    if (exit.spawnError) await appendFile(files.err(job), `cotutor: 起不来 ${plan.argv[0]}:${exit.spawnError.message}\n`);
    const transcript = parseTranscript(await readFile(files.log(job), 'utf8').catch(() => ''));
    if (!transcript.final) {
      // 进程退了但没有 result 事件:起不来、被杀、或 CLI 崩了;标 error,原因指向 err.log
      transcript.final = { text: null, ok: false, reason: exit.spawnError ? `spawn:${exit.spawnError.message}` : `exit:${exit.code ?? 'signal'}` };
      transcript.items.push({ kind: 'done', text: `本轮没有收尾(${transcript.final.reason}),看 ${date}.${job}.err.log` });
    }
    emit({ lane: 'main', kind: 'exit', ok: transcript.final.ok, ...(transcript.final.reason ? { reason: transcript.final.reason } : {}), ...(transcript.final.costUsd !== undefined ? { costUsd: transcript.final.costUsd } : {}), ...(transcript.final.numTurns !== undefined ? { turns: transcript.final.numTurns } : {}) });
    const kidView = deriveKidView(transcript, { replyMaxChars });
    // 整块出的(没走流式):卡与句这时才第一次见到,也发一遍
    if (kidView.section) {
      for (; cardsSeen < kidView.section.cards.length; cardsSeen++) emit({ lane: 'main', kind: 'card', card: cardsSeen, label: `${kidView.section.cards[cardsSeen].kind} ${cardLabel(kidView.section.cards[cardsSeen])}`.trim() });
      for (; linesSeen < kidView.section.lines.length; linesSeen++) emit({ lane: 'main', kind: 'line', line: linesSeen, text: kidView.section.lines[linesSeen].text });
    }
    // 板书后期收尾:流式时起过的拍等它回;没起过的(最后一拍、整块出的)现在并行起;全部按卡的顺序套到定稿的节上
    let postP: Promise<{ files: PostBeatFile[]; env: PostEnv; t0: number }> | null = null;
    if (postOn && kidView.section?.cards.length) {
      const finalSection = kidView.section;
      postP = (async () => {
        const env = await getEnv();
        envNow = env;
        const bs = beatsOf(finalSection);
        bs.forEach((b, k) => startBeatPost(finalSection, b, k));
        const files = await Promise.all(bs.filter((b) => b.card !== null).map((b) => beatPosts.get(b.card as number)!));
        return { files, env, t0: postT0 ?? Date.now() };
      })();
    }
    // 配音:老师配了音色才合成;失败不响,孩子端用浏览器的声。
    // 有板书讲稿就逐句配(流式时大多已在路上,这里只等没配完的);没有讲稿只有一段话(老形状)才整段配。
    let audio: string | null = null;
    if (dubber && voice && kidView.section?.lines.length) {
      const names = await dubber.finish(kidView.section.lines);
      kidView.section.lines.forEach((l, i) => { l.audio = names[i]; });
      timing.dubbedMs = since();
      if (timing.firstReadyMs === undefined) timing.firstReadyMs = since();
    } else if (voice && kidView.kidText) {
      audio = await dubReply(ws.config.tts, kidView.kidText, voice, { audio: files.audio(job), err: files.err(job) }, this.opts.env);
      timing.dubbedMs = since();
    }
    if (timing.firstReadyMs === undefined && (kidView.section?.lines.length || kidView.kidText)) timing.firstReadyMs = since();
    let post: ConversationMessage['post'] | undefined;
    if (postP && kidView.section) {
      try {
        const r = await postP;
        // 按拍的顺序套到定稿的节上(行顺着长);每拍的 dropped / kept 以套到定稿节上的为准
        let cur: BoardSection = kidView.section;
        const files: PostBeatFile[] = [];
        for (const f of r.files) {
          const b = beatsOf(cur).find((x) => x.card === f.card);
          if (f.ok && f.output && b) { const v = validateBeatPost(cur, b, r.env.theme, r.env.device, f.output); cur = v.section; files.push({ ...f, dropped: v.dropped, kept: v.kept }); } else files.push(f);
        }
        const a = assemblePost(files, r.env, timing.startedAt, Date.now() - r.t0);
        if (files.some((f) => f.ok)) kidView.section = { ...cur, lines: cur.lines.map((l, i) => ({ ...l, audio: kidView.section?.lines[i]?.audio ?? null })) };
        post = a.summary;
        timing.postMs = since();
        await writePostFile(ws, tutor, date, job, a.file);
      } catch (err) {
        post = { ok: false, ms: since(), dropped: 0, error: err instanceof Error ? err.message : String(err) };
        emit({ lane: 'post', kind: 'failed', beat: -1, ms: post.ms, error: post.error ?? '?' });
      }
    }
    if (kidView.section) emit({ lane: 'ready', kind: 'all', cards: kidView.section.cards.length, lines: kidView.section.lines.length });
    if (kidView.section) timing.beats = beatTimings(events, beatsOf(kidView.section));
    // 重新读索引再并入:跑的这段时间里别的字段(比如家长改了别的)不被旧对象盖掉
    const latest = await readIndex(ws, tutor, date);
    let next = applyRun(latest, job, { transcript, kidView, runtime: plan.runtime, audio, timing, post });
    // 场景作业收尾:课包的费用与时长进账本,消息的 artifacts 记课包 id
    if (tutor === 'scene-maker') {
      const r = await this.settleSceneLedger(ws, tutor, date, job, latest.messages.find((m) => m.job === job)?.text ?? '', transcript, timing);
      if (r.id) emit({ lane: 'ledger', kind: 'artifact', id: r.id, status: r.warnings.length ? '补了一行' : '记了账' });
      if (r.id || r.warnings.length) next = { ...next, messages: next.messages.map((m) => (m.job === job ? { ...m, ...(r.id ? { artifacts: [r.id] } : {}), ...(r.warnings.length ? { warnings: [...(m.warnings ?? []), ...r.warnings] } : {}) } : m)) };
    }
    // 转交:自动起目标老师的一轮;起不了的原因记进 warnings。给 scene-maker 的先把课包 id 理顺(refs 没写对就取卡上的;已占用就改成 -2,卡与 refs 一起改)
    if (kidView.handoff) {
      const fixed = kidView.handoff.to === 'scene-maker' ? this.settleBundleId(ws, kidView.handoff, kidView.section) : { handoff: kidView.handoff, section: kidView.section, warnings: [] as string[] };
      const r = await this.handoff(ws, tutor, job, fixed.handoff, latest.messages.find((m) => m.job === job)?.text ?? '');
      if (r.started) emit({ lane: 'handoff', kind: 'started', to: r.started.tutor, job: r.started.job });
      else emit({ lane: 'handoff', kind: 'skipped', to: fixed.handoff.to, why: r.warning ?? '?' });
      const warns = [...fixed.warnings, ...(r.warning ? [r.warning] : [])];
      next = { ...next, messages: next.messages.map((m) => (m.job === job ? { ...m, handoff: fixed.handoff, section: fixed.section, handoffJob: r.started, ...(warns.length ? { warnings: [...(m.warnings ?? []), ...warns] } : {}) } : m)) };
    }
    await writeIndex(ws, next);
    emit({ lane: 'index', kind: 'written', warnings: next.messages.find((m) => m.job === job)?.warnings?.length ?? 0 });
    await eventsChain;
    // 资产:点读段逐段配音到 .cards/<n>/<k>.mp3,后台跑,不拦着这一轮收尾;孩子端每次拉 today 都会看到新生成好的
    if (queue && kidView.section) {
      const jobs: Promise<unknown>[] = [];
      kidView.section.cards.forEach((card, n) => {
        const list = cardAssets(card);
        if (!list.length) return;
        jobs.push(mkdir(files.cardAssetsDir(job, n), { recursive: true }).then(() => Promise.all(list.map((a) => queue.add(files.cardAsset(job, n, a.file), a.text, `第 ${n + 1} 张卡的 ${a.file} `)))));
      });
      if (jobs.length) {
        const bg = Promise.all(jobs).then(() => undefined, () => undefined);
        this.background.add(bg);
        void bg.finally(() => this.background.delete(bg));
      }
    }
    return next;
  }
}
