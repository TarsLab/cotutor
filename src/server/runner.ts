/**
 * 发消息 = 拼上下文包 → 按预设 spawn / resume → stream-json 落 conversations/<老师>/<日期>.<job>.log → 索引更新。
 * 一老师同时只跑一条(老师还在回上一条就 409),跨天自动新开(索引按本地日期分文件,新文件没 session 就不带 --resume)。
 * 进程 cwd 是老师目录 agents/<name>/(《agent层设计.md》拍板)。
 */
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildContextPack } from '../lib/context-pack.ts';
import { addMessage, applyRun, conversationFiles, jobId, localDate, localMinute } from '../lib/conversation.ts';
import { deriveKidView } from '../lib/kid-view.ts';
import { mergeObservations, parseObservations, recentObservations } from '../lib/ledger.ts';
import { isoWeek, parsePlan, planLinesFor } from '../lib/plan.ts';
import { getPreset, planRun, presetUses, type RunPlan } from '../lib/run-plan.ts';
import { currentSlot, parseTimetable, slotLabel } from '../lib/timetable.ts';
import { parseTranscript } from '../lib/transcript.ts';
import { resolvePolicy, type ContextPack, type ConversationIndex, type Focus, type MessageFrom } from '../schema/index.ts';
import { UsageError, type Workspace } from '../cli/workspace.ts';
import { readAgentBody, readIndex, writeIndex } from './store.ts';
import { dubReply } from './tts.ts';

export class BusyError extends Error {
  constructor(tutor: string, job: string) {
    super(`${tutor} 还在回上一条(${job}),等它说完再发`);
  }
}

export interface SendInput {
  from: MessageFrom;
  text: string;
  focus?: Focus;
  /** 预设名,缺省 cotutor.json 的 agents.default */
  preset?: string;
}

export interface SendStarted {
  tutor: string;
  date: string;
  job: string;
  plan: RunPlan;
  /** 老师说完(进程退出、索引写好)后 resolve */
  done: Promise<ConversationIndex>;
}

interface Active {
  job: string;
  date: string;
  done: Promise<ConversationIndex>;
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
  private readonly getWs: () => Workspace;
  private readonly opts: { now?: () => Date; env?: NodeJS.ProcessEnv };
  constructor(getWs: () => Workspace, opts: { now?: () => Date; env?: NodeJS.ProcessEnv } = {}) {
    this.getWs = getWs;
    this.opts = opts;
  }

  running(tutor: string): { job: string; date: string } | null {
    const a = this.active.get(tutor);
    return a ? { job: a.job, date: a.date } : null;
  }

  async send(tutor: string, input: SendInput): Promise<SendStarted> {
    const ws = this.getWs();
    const t = ws.config.tutors[tutor];
    if (!t) throw new UsageError(`没有叫 ${tutor} 的老师;cotutor.json 的 tutors 里有:${Object.keys(ws.config.tutors).join('、')}`);
    if (!t.enabled) throw new UsageError(`${t.display} 已关闭(cotutor.json tutors.${tutor}.enabled = false),打开再发`);
    const text = input.text.trim();
    if (!text) throw new UsageError('消息是空的');
    const busy = this.active.get(tutor);
    if (busy) throw new BusyError(tutor, busy.job);

    const now = (this.opts.now ?? (() => new Date()))();
    const date = localDate(now);
    const index = await readIndex(ws, tutor, date);
    const job = jobId(now, index.messages.length + 1);
    const { preset } = getPreset(ws.config, input.preset);
    const agentBody = presetUses(preset, '{agentBody}') ? await readAgentBody(ws, tutor) : undefined;
    const pack = await gatherContext(ws, tutor, { from: input.from, at: now, focus: input.focus });
    const policy = resolvePolicy(ws.config, tutor);
    const prompt = buildContextPack(pack, text, policy.contextPack);
    const plan = planRun(ws.config, index, { agent: tutor, prompt, agentBody, preset: input.preset });

    const started = addMessage(index, { job, at: pack.at, from: input.from, text, focus: input.focus, result: 'running', artifacts: [], agent: plan.preset });
    await writeIndex(ws, started);

    const done = this.spawn(ws, tutor, date, job, plan, policy.replyMaxChars).finally(() => this.active.delete(tutor));
    this.active.set(tutor, { job, date, done });
    return { tutor, date, job, plan, done };
  }

  private async spawn(ws: Workspace, tutor: string, date: string, job: string, plan: RunPlan, replyMaxChars: number): Promise<ConversationIndex> {
    const files = conversationFiles(ws.dirs.conversations, tutor, date);
    const cwd = join(ws.dirs.agents, tutor);
    await mkdir(cwd, { recursive: true });
    const out = openSync(files.log(job), 'w');
    const err = openSync(files.err(job), 'w');
    const exit = await new Promise<{ code: number | null; spawnError?: Error }>((resolveExit) => {
      const child = spawn(plan.argv[0], plan.argv.slice(1), {
        cwd,
        env: { ...(this.opts.env ?? process.env), COTUTOR_WORKSPACE: ws.root },
        stdio: ['ignore', out, err],
      });
      child.once('error', (e) => resolveExit({ code: null, spawnError: e }));
      child.once('close', (code) => resolveExit({ code }));
    });
    closeSync(out);
    closeSync(err);
    if (exit.spawnError) {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(files.err(job), `cotutor: 起不来 ${plan.argv[0]}:${exit.spawnError.message}\n`);
    }
    const transcript = parseTranscript(await readFile(files.log(job), 'utf8').catch(() => ''));
    if (!transcript.final) {
      // 进程退了但没有 result 事件:起不来、被杀、或 CLI 崩了;标 error,原因指向 err.log
      transcript.final = { text: null, ok: false, reason: exit.spawnError ? `spawn:${exit.spawnError.message}` : `exit:${exit.code ?? 'signal'}` };
      transcript.items.push({ kind: 'done', text: `本轮没有收尾(${transcript.final.reason}),看 ${date}.${job}.err.log` });
    }
    const kidView = deriveKidView(transcript, { replyMaxChars });
    // 配音:有给孩子的话且老师配了音色才合成;失败不响,孩子端用浏览器的声
    const voice = ws.config.tutors[tutor]?.voice;
    const audio = kidView.kidText && voice ? await dubReply(ws.config.tts, kidView.kidText, voice, { audio: files.audio(job), err: files.err(job) }, this.opts.env) : null;
    // 重新读索引再并入:跑的这段时间里别的字段(比如家长改了别的)不被旧对象盖掉
    const latest = await readIndex(ws, tutor, date);
    const next = applyRun(latest, job, { transcript, kidView, agent: plan.preset, audio });
    await writeIndex(ws, next);
    return next;
  }
}
