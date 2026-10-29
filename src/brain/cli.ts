/**
 * 脑执行的 CLI 实现:按 cotutor.json 的运行时起老师进程(qwen 之类,读输出、关工具、环境都在 src/clis/ 的适配器),
 * stream-json 落 <日期>.<job>.log、stderr 落 .err.log;每行读成统一事件,一行只解析一次,同一批事件给拼正文、工具、会话 id 用。
 * - 预热(./warm.ts):消息走 stdin 的运行时,下一轮的进程提前起好,对得上就接过来
 * - 断流看门狗:stall.ms 没吐一个字节、也没有工具在跑 → 杀掉,resume 同一个会话接着写(最多 stall.retries 次)。
 *   CLI 自己的断流重试可能要等很久(2026-09-21 真跑一轮连断两次,等了 6 分钟)
 * - 回复停在写成正文的工具调用上(这轮没给它那个工具,qwen 照自己的格式写出来):resume 同一个会话告诉它不会有结果、接着回孩子,只一次
 * - 收尾:从 .log 读整轮转录;断流接着跑的,断在半截的那段拼回最后一段前面
 */
import { spawn } from 'node:child_process';
import { closeSync, createWriteStream, openSync, writeSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parserOf, prepareCli, processEnv, toolsOf, unexpectedTools } from '../clis/index.ts';
import { endsWithToolCall } from '../lib/board.ts';
import { planRun, stallPrompt, toolLeakPrompt, type RunPlan } from '../lib/run-plan.ts';
import { parseSections } from '../lib/sections.ts';
import { createPartialReader } from '../lib/stream.ts';
import { parseTranscript, toolCalls, toolSummary } from '../lib/transcript.ts';
import type { CliRuntime, CotutorConfig, Policy } from '../schema/index.ts';
import type { BrainExecutor, BrainHooks, BrainRequest, BrainResult, BrainRun, WarmKey } from './index.ts';
import { WarmPool, type Slot, type Spare } from './warm.ts';

const cliName = (p: RunPlan): string => p.argv[0].slice(p.argv[0].lastIndexOf('/') + 1);

export class CliBrain implements BrainExecutor {
  private readonly spares: WarmPool;
  private readonly workspace: () => { config: CotutorConfig; root: string };
  /** 起子进程用的环境(测试注入);缺省 process.env */
  private readonly env: NodeJS.ProcessEnv | undefined;
  constructor(opts: { workspace: () => { config: CotutorConfig; root: string }; env?: NodeJS.ProcessEnv; warmIdleMs?: number }) {
    this.workspace = opts.workspace;
    this.env = opts.env;
    this.spares = new WarmPool({ idleMs: opts.warmIdleMs });
  }

  plan(req: BrainRequest): RunPlan {
    const { config, root } = this.workspace();
    return planRun(config, { session: req.session }, { agent: req.agent, prompt: req.prompt, agentBody: req.agentBody, systemBody: req.systemBody, boardFile: req.boardFile, runtime: req.runtime, effort: req.effort, tools: req.tools, root, readDirs: req.readDirs });
  }

  prepare(plan: RunPlan): Promise<void> {
    return prepareCli(plan.cli, this.workspace().root).catch(() => {});
  }

  canWarm(runtime: CliRuntime): boolean {
    return Boolean(runtime.stdin);
  }

  warm(tutor: string, slot: Slot, plan: RunPlan, key: WarmKey): void {
    this.spares.warm(tutor, slot, { argv: plan.argv, env: plan.env, ...key }, this.processEnv(plan));
  }

  warmed(tutor: string, slot?: Slot): boolean {
    return this.spares.has(tutor, slot);
  }

  dropWarm(tutor: string, slot?: Slot): void {
    this.spares.drop(tutor, slot);
  }

  close(): void {
    this.spares.dropAll();
  }

  private processEnv(p: RunPlan): NodeJS.ProcessEnv {
    return processEnv(p, { ...(this.env ?? process.env), COTUTOR_WORKSPACE: this.workspace().root });
  }

  start(req: BrainRequest, plan: RunPlan, ctx: { tutor: string; key: WarmKey; files: { log: string; err: string }; stall: Policy['stall'] }, hooks: BrainHooks): BrainRun {
    // 预热的进程:resume 的接那个位置(对得上 = 这个话题从它起来之后没人写过),新开的接 fresh;对不上(或这轮不走 stdin)就杀掉
    const spare = this.spares.claim(ctx.tutor, plan.resume ? 'resume' : 'fresh', { argv: plan.argv, env: plan.env, ...ctx.key });
    // 断流接着跑:carried = 被杀那次已经拼出的正文(接着跑的那次换新读取器,正文 = carried + 新的);
    // open = 断在半截、没进会话的那段(递回给老师,收尾时拼在最后一段前面)
    let reader = createPartialReader();
    let carried = '';
    let open = '';
    const liveText = (): string => { const t = reader.text(); return !carried ? t : !t ? carried : open ? carried + t : `${carried}\n\n${t}`; };
    const resumePlan = (id: string, prompt: string): RunPlan => this.plan({ ...req, runtime: plan.runtime, session: { id, runtime: plan.runtime }, prompt });
    const stall = ctx.stall;
    const files = ctx.files;
    const cwd = ctx.key.cwd;

    const go = async (): Promise<BrainResult> => {
      await mkdir(cwd, { recursive: true });
      const out = createWriteStream(files.log);
      const err = openSync(files.err, 'w');
      hooks.onStart({ cli: cliName(plan), runtime: plan.runtime, resume: plan.resume, ...(spare ? { warmBornAt: spare.bornAt } : {}) });
      // 工具调用回报一条(子代理的标 sub);顺手记哪些顶层工具还没回结果:工具在跑时进程不吐字是正常的,断流看门狗不算这段
      const parse = parserOf(plan.cli);
      let lineBuf = '';
      const toolsRunning = new Set<string>();
      // 消息走 stdin 的运行时:看到收尾就关 stdin,进程自己退(每次 runOnce 换一个)
      let onResult: (() => void) | null = null;
      // 进程起来报的工具表里不该有的(适配器核对;不带工具那轮却有工具 = 关工具的旗标失效了,CLI 升版本最先坏的地方)
      let unexpected: string[] = [];
      let session = plan.session;
      // 新会话要等模型开始回了(开始回复、吐字、在想、整条回复)才在盘上、才 resume 得了
      // (2026-09-22 真跑:init 吐了会话 id 就被杀,resume 报 No conversation found;吐过三个字再杀,盘上有这条用户消息)
      let persisted = plan.resume;
      let stalls = 0;
      // warm:预热好的进程(只给第一次;断流接着跑的那次照旧冷起)
      const runOnce = (p: RunPlan, warm: Spare | null = null): Promise<{ code: number | null; spawnError?: Error; stalled?: boolean }> => new Promise((resolveExit) => {
        // 被杀的那次没收完的半行不要了
        lineBuf = '';
        const child = warm?.child ?? spawn(p.argv[0], p.argv.slice(1), {
          cwd,
          env: this.processEnv(p),
          stdio: [p.stdin ? 'pipe' : 'ignore', 'pipe', err],
        });
        if (warm) {
          // 预热的进程 stderr 是管道(起它时还没有这轮的 err.log):攒下的和之后的都写进来(池子交出来时暂停着,这里 resume)
          const toErr = (c: Buffer): void => { try { writeSync(err, c); } catch { /* err.log 已关 */ } };
          warm.stderr.forEach(toErr);
          child.stderr?.on('data', toErr);
          child.stderr?.resume();
        }
        if (p.stdin) {
          child.stdin?.on('error', () => {});
          child.stdin?.write(p.stdin);
          onResult = () => { onResult = null; child.stdin?.end(); };
        } else onResult = null;
        let stalled = false;
        let idle: NodeJS.Timeout | null = null;
        let lastByte = Date.now();
        const arm = (): void => {
          if (idle) clearTimeout(idle);
          if (!stall.ms) return;
          idle = setTimeout(() => {
            idle = null;
            if (toolsRunning.size) return arm();
            stalled = true;
            child.kill('SIGTERM');
            setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000).unref();
          }, stall.ms);
        };
        arm();
        child.stdout?.on('data', (chunk: Buffer) => {
          lastByte = Date.now();
          arm();
          out.write(chunk);
          lineBuf += chunk.toString('utf8');
          const lines = lineBuf.split('\n');
          lineBuf = lines.pop() ?? '';
          let changed = false;
          for (const line of lines) {
            const events = parse(line);
            for (const e of events) {
              if (e.kind === 'session') { if (!session) session = e.id; }
              else if (e.kind === 'init') unexpected = unexpectedTools(plan.cli, plan.tools, e.tools);
              else if (e.kind === 'result') onResult?.();
              else if (e.kind === 'results') { if (!e.sub) for (const r of e.results) toolsRunning.delete(r.id); }
              else {
                if (e.kind === 'start' || e.kind === 'delta' || e.kind === 'thinking' || e.kind === 'assistant') persisted = true;
                if (e.kind === 'assistant') for (const tool of toolsOf(e.parts)) {
                  if (!e.sub && tool.id) toolsRunning.add(tool.id);
                  hooks.onTool({ name: toolSummary(tool.name, tool.input), sub: e.sub });
                }
              }
            }
            if (reader.apply(events)) changed = true;
          }
          if (changed) hooks.onText();
        });
        const done = (r: { code: number | null; spawnError?: Error }): void => {
          if (idle) clearTimeout(idle);
          resolveExit({ ...r, ...(stalled ? { stalled: true } : {}) });
        };
        child.once('error', (e) => done({ code: null, spawnError: e }));
        child.once('close', (code) => { if (stalled) void appendFile(files.err, `cotutor: ${Date.now() - lastByte}ms 没有输出,当断流杀掉\n`).catch(() => {}); done({ code }); });
        if (warm) {
          // 开口前吐的按顺序补喂,再放开暂停;接手之前就退了的,close 已经错过,直接收尾
          for (const c of warm.stdout) child.stdout?.emit('data', c);
          child.stdout?.resume();
          if (warm.closed()) done({ code: child.exitCode });
        }
      });
      let exit = await runOnce(plan, spare);
      while (exit.stalled) {
        stalls++;
        if (persisted) open += reader.current();
        else { session = plan.session; open = ''; }
        const retry = stalls <= stall.retries ? stalls : 0;
        hooks.onStall({ idleMs: stall.ms, retry, kept: Array.from(open).length });
        if (!retry) break;
        carried = persisted ? liveText() : '';
        reader = createPartialReader();
        toolsRunning.clear();
        // 会话还没落盘(进程起来就卡住、一条整的回复都没有):原样从头再起一次;落了盘就 resume 接着写
        const next = persisted && session ? resumePlan(session, stallPrompt(open)) : plan;
        hooks.onStart({ cli: cliName(next), runtime: next.runtime, resume: next.resume });
        exit = await runOnce(next);
      }
      // 回复停在写成正文的工具调用上(板书解析器已剥掉,孩子没看到):老师在等结果,resume 同一个会话告诉它不会有结果、接着回孩子,只一次。
      // 这次的正文接在前面那段后面
      let leaked = '';
      if (!exit.stalled && exit.code === 0 && session && endsWithToolCall(parseSections(liveText()).body)) {
        leaked = liveText();
        carried = leaked;
        open = '';
        reader = createPartialReader();
        toolsRunning.clear();
        const next = resumePlan(session, toolLeakPrompt());
        hooks.onStart({ cli: cliName(next), runtime: next.runtime, resume: next.resume });
        exit = await runOnce(next);
      }
      hooks.onExit(Date.now());
      await new Promise<void>((r) => out.end(r));
      closeSync(err);
      if (exit.spawnError) await appendFile(files.err, `cotutor: 起不来 ${plan.argv[0]}:${exit.spawnError.message}\n`);
      const logText = await readFile(files.log, 'utf8').catch(() => '');
      const transcript = parseTranscript(logText, parse);
      // 断流接着跑的:断在半截的那段没进会话、也不在最后的 result 里,拼回最后一段前面(老师是从断处接着写的)
      // (result 的正文被 trim 过,断在句末 / 围栏上的补回换行,免得两句粘成一行)
      if (open && transcript.final?.text) transcript.final.text = open + (/[。!！?？;；`\n]\s*$/.test(open) ? '\n' : '') + transcript.final.text;
      if (leaked && transcript.final?.text) transcript.final.text = `${leaked}\n\n${transcript.final.text}`;
      if (exit.stalled && !transcript.final) transcript.final = { text: null, ok: false, reason: `stalled:${stalls} 次断流(每次 ${stall.ms}ms 没输出),接着跑的次数用完了` };
      // 这轮用了哪些工具、读了什么:从 .log 抽出来物化(家长端「看原文」一站、cotutor show)
      const tools = toolCalls(logText, parse).slice(0, 200);
      if (!transcript.final) {
        // 进程退了但没有 result 事件:起不来、被杀、或 CLI 崩了;标 error,原因指向 err.log
        transcript.final = { text: null, ok: false, reason: exit.spawnError ? `spawn:${exit.spawnError.message}` : `exit:${exit.code ?? 'signal'}` };
        transcript.items.push({ kind: 'done', text: `本轮没有收尾(${transcript.final.reason}),看 ${basename(files.err)}` });
      }
      const warnings: string[] = [];
      if (unexpected.length) warnings.push(`${plan.cli} 起来时带着这轮不该有的工具:${unexpected.join('、')}(${plan.tools === 'off' ? '这轮应该一个工具都不带' : '这轮只该带只读的几样'});关工具的旗标可能随 CLI 升级失效了,看 src/clis/${plan.cli}.ts`);
      if (leaked) warnings.push('老师把工具调用写成了正文、停在那里等结果(板上没出、嘴没念),应用 resume 同一个会话叫它直接回孩子');
      if (stalls) warnings.push(`API 流断了 ${stalls} 次(每次 ${stall.ms / 1000} 秒没动静),应用杀掉进程、resume 会话接着写的${exit.stalled ? ';次数用完还断,这轮没收尾' : ''}`);
      return { transcript: { ...transcript, final: transcript.final }, tools, warnings };
    };
    return { warm: Boolean(spare), text: liveText, done: go() };
  }
}
