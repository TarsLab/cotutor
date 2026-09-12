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
import { BUNDLE_ID_RE, cardAssets, describeCard } from '../cards/index.ts';
import { parseBoard } from '../lib/board.ts';
import type { BoardSection, Device } from '../lib/kid-board.ts';
import { deriveKidView, truncateReply } from '../lib/kid-view.ts';
import { createPartialReader } from '../lib/stream.ts';
import { mergeArtifacts, mergeObservations, parseArtifactEvents, parseObservations, recentObservations } from '../lib/ledger.ts';
import { isoWeek, parsePlan, planLinesFor } from '../lib/plan.ts';
import { getRuntime, planRun, runtimeUses, type RunPlan } from '../lib/run-plan.ts';
import { currentSlot, parseTimetable, slotLabel } from '../lib/timetable.ts';
import { parseTranscript } from '../lib/transcript.ts';
import { resolvePolicy, type ArtifactEvent, type ContextPack, type ConversationIndex, type Focus, type Handoff, type MessageFrom, type Policy, type Timing } from '../schema/index.ts';
import { DEFAULT_DEVICE, runPost, writePostFile, type PostResult } from './post.ts';
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
    const voice = ws.config.tutors[tutor]?.voice;
    const queue = voice ? new DubQueue(ws.config.tts, voice, files.err(job), this.opts.env) : null;
    const dubber = queue ? new LineDubber(queue, (n) => files.lineAudio(job, n)) : null;
    // 埋点:从进程起来那一刻算,首卡 = partial 板书第一次有卡(孩子端第一次看到东西),done = 进程退出,dubbed = 配音收尾
    const t0 = Date.now();
    const timing: Timing = { startedAt: new Date(t0).toISOString() };
    const since = (): number => Date.now() - t0;
    // 流式:stdout 的每一块先落盘再喂读取器;正文变了就(节流 150ms)重解析成 partial 板书,定稿的句子交去配音
    const reader = createPartialReader();
    let dirty = false;
    let timer: NodeJS.Timeout | null = null;
    const reparse = (): void => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      const { section } = parseBoard(reader.text(), { partial: true });
      const lines = section.lines.map((l) => ({ ...l, text: truncateReply(l.text, replyMaxChars).text }));
      active.partial = section.cards.length || lines.length ? { cards: section.cards, lines, partial: true } : null;
      if (section.cards.length && timing.firstCardMs === undefined) timing.firstCardMs = since();
      if (dubber) lines.forEach((l, i) => dubber.add(i, l.text));
    };
    const exit = await new Promise<{ code: number | null; spawnError?: Error }>((resolveExit) => {
      const child = spawn(plan.argv[0], plan.argv.slice(1), {
        cwd,
        env: { ...(this.opts.env ?? process.env), COTUTOR_WORKSPACE: ws.root },
        stdio: ['ignore', 'pipe', err],
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        out.write(chunk);
        if (reader.feed(chunk.toString('utf8'))) {
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
    const kidView = deriveKidView(transcript, { replyMaxChars });
    // 板书后期(有卡就起,与配音收尾并行;等到 policy.post.timeoutMs,超时先出素版):标注 / 排版 / 样子回来套在这节上
    const postP: Promise<PostResult> | null = policy.post.mode !== 'off' && kidView.section?.cards.length ? runPost(ws, tutor, kidView.section, { device, policy, env: this.opts.env, cwd }) : null;
    // 配音:老师配了音色才合成;失败不响,孩子端用浏览器的声。
    // 有板书讲稿就逐句配(流式时大多已在路上,这里只等没配完的);没有讲稿只有一段话(老形状)才整段配。
    let audio: string | null = null;
    if (dubber && voice && kidView.section?.lines.length) {
      const names = await dubber.finish(kidView.section.lines);
      kidView.section.lines.forEach((l, i) => { l.audio = names[i]; });
      timing.dubbedMs = since();
    } else if (voice && kidView.kidText) {
      audio = await dubReply(ws.config.tts, kidView.kidText, voice, { audio: files.audio(job), err: files.err(job) }, this.opts.env);
      timing.dubbedMs = since();
    }
    let post: PostResult['summary'] | undefined;
    if (postP) {
      try {
        const r = await postP;
        if (kidView.section) kidView.section = { ...r.section, lines: r.section.lines.map((l, i) => ({ ...l, audio: kidView.section?.lines[i]?.audio ?? null })) };
        post = r.summary;
        timing.postMs = since();
        await writePostFile(ws, tutor, date, job, r.file);
      } catch (err) {
        post = { ok: false, ms: since(), dropped: 0, error: err instanceof Error ? err.message : String(err) };
      }
    }
    // 重新读索引再并入:跑的这段时间里别的字段(比如家长改了别的)不被旧对象盖掉
    const latest = await readIndex(ws, tutor, date);
    let next = applyRun(latest, job, { transcript, kidView, runtime: plan.runtime, audio, timing, post });
    // 场景作业收尾:课包的费用与时长进账本,消息的 artifacts 记课包 id
    if (tutor === 'scene-maker') {
      const r = await this.settleSceneLedger(ws, tutor, date, job, latest.messages.find((m) => m.job === job)?.text ?? '', transcript, timing);
      if (r.id || r.warnings.length) next = { ...next, messages: next.messages.map((m) => (m.job === job ? { ...m, ...(r.id ? { artifacts: [r.id] } : {}), ...(r.warnings.length ? { warnings: [...(m.warnings ?? []), ...r.warnings] } : {}) } : m)) };
    }
    // 转交:自动起目标老师的一轮;起不了的原因记进 warnings。给 scene-maker 的先把课包 id 理顺(refs 没写对就取卡上的;已占用就改成 -2,卡与 refs 一起改)
    if (kidView.handoff) {
      const fixed = kidView.handoff.to === 'scene-maker' ? this.settleBundleId(ws, kidView.handoff, kidView.section) : { handoff: kidView.handoff, section: kidView.section, warnings: [] as string[] };
      const r = await this.handoff(ws, tutor, job, fixed.handoff, latest.messages.find((m) => m.job === job)?.text ?? '');
      const warns = [...fixed.warnings, ...(r.warning ? [r.warning] : [])];
      next = { ...next, messages: next.messages.map((m) => (m.job === job ? { ...m, handoff: fixed.handoff, section: fixed.section, handoffJob: r.started, ...(warns.length ? { warnings: [...(m.warnings ?? []), ...warns] } : {}) } : m)) };
    }
    await writeIndex(ws, next);
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
