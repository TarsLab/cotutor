/**
 * cotutor doctor:环境 + workspace逐项体检,失败项附修复命令(错误信息即修复指南)。
 * 静默失败摆到明面:配置坏了、老师链断了、账本有坏行、角色指向踩空。
 * exit 约定同 drawtell / voxtell doctor:必需项全过 exit 0,否则 1;--json 带 ok 与整份 checks。
 */
import { execFile } from 'node:child_process';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { boardPreloaded, runtimeUses } from '../lib/run-plan.ts';
import { BOARD_GUIDE_PATH, boardGuideBody, takesTutorRules } from '../lib/tutor-rules.ts';
import { parseAgentFile } from '../lib/agent-file.ts';
import { localDate } from '../lib/conversation.ts';
import { memoryPath, missingEntry, pickNotes } from '../lib/vault-notes.ts';
import { listTutors, resolvePolicy } from '../schema/index.ts';
import { scanVault } from '../server/store.ts';
import { parseArtifactEvents } from '../lib/ledger.ts';
import { parseTimetable } from '../lib/timetable.ts';
import { configGapsOf } from './migrate.ts';
import { httpsFiles } from './serve.ts';
import { DIRS } from './skeleton.ts';
import { tutorStatuses } from './tutors.ts';
import {
  CONFIG_FILE,
  ConfigError,
  USER_CONFIG,
  UsageError,
  type ResolveOptions,
  type RootSource,
  type Workspace,
  assembleWorkspace,
  expandPath,
  parseConfig,
  readJson,
  redactHome,
  resolveRoot,
} from './workspace.ts';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  root: string | null;
  source: RootSource | null;
  checks: DoctorCheck[];
}

const execFileP = promisify(execFile);

async function statOrNull(p: string): Promise<import('node:fs').Stats | null> {
  return stat(p).catch(() => null);
}

async function evictedCount(dir: string): Promise<number> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.icloud')).length;
  } catch {
    return 0;
  }
}

/** 运行时的 CLI 名(run[0] 的 basename):决定链在 .claude 还是 .qwen 下 */
export function runtimeCli(run: readonly string[]): string {
  return basename(run[0] ?? '');
}

/** 已知的环境坑,从 CLI 的输出里认出来给修复命令(错误信息即修复指南) */
export function explainLlmFailure(text: string, runtime: readonly string[]): string {
  const bin = runtimeCli(runtime);
  if (/does not support this model|version [\d.]+ or newer is required/i.test(text)) {
    return `这版 ${bin} 不认全局 settings 里的模型:给 cotutor.json 的 ${bin} 运行时 run / resume 末尾加 "--model", "sonnet"(或 ${bin} update 升级)`;
  }
  if (/nested|CLAUDECODE|already running inside/i.test(text)) return '在 Claude Code 会话里嵌套起 claude 被拒:换个普通终端,或 unset CLAUDECODE 及 CLAUDE_CODE_* 后再跑';
  if (/403|request not allowed/i.test(text)) return `API 拒了(403):多半是老师会话没走代理——运行时模板带 --setting-sources project,${bin} 不再读 ~/.claude/settings.json 的 env,代理要在起 serve 的 shell 里 export HTTPS_PROXY`;
  if (/not logged in|login|authentication|401|unauthorized/i.test(text)) return `${bin} 没登录或 key 失效:先在终端跑一次 ${bin} 登录`;
  if (/ENOENT|command not found/i.test(text)) return `PATH 里没有 ${bin}`;
  if (/budget|max_budget/i.test(text)) return '预算旗太小:调大运行时模板里的 --max-budget-usd';
  return `看上面的原文;不认识的错先在终端手跑一次同样的命令`;
}

/**
 * --live:真起一次老师(运行时的 run 模板,第一位开着的老师,只回一个字),把 API 层的坑(模型不认、没登录)摆到明面。
 * 花一分钱级别的费用,所以缺省不跑。配音同理:老师配了 voice 就合成一句。
 */
async function probeLive(ws: Workspace, push: (c: DoctorCheck) => number, env: NodeJS.ProcessEnv): Promise<void> {
  const { spawn } = await import('node:child_process');
  const { fillRuntime, fillTts, listTutors } = await import('../schema/index.ts');
  const { parseTranscript } = await import('../lib/transcript.ts');
  const { parseAgentFile } = await import('../lib/agent-file.ts');
  const { tmpdir } = await import('node:os');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const tutors = listTutors(ws.config).filter((t) => t.enabled);
  const first = tutors[0];
  if (!first) {
    push({ name: 'live.agent', ok: false, required: false, detail: '没有开着的老师,没法探', fix: 'cotutor.json 里至少开一位' });
    return;
  }
  const runtimeName = ws.config.runtimes.default;
  const runtime = ws.config.runtimes[runtimeName];
  if (!runtime || typeof runtime === 'string') return;
  let agentBody: string | undefined;
  try {
    agentBody = parseAgentFile(await readFile(join(ws.dirs.claudeAgents, `${first.name}.md`), 'utf8')).body;
  } catch {
    /* 上面 tutor.* 已报 */
  }
  let boardBody: string | undefined;
  try {
    boardBody = boardGuideBody(await readFile(join(ws.root, BOARD_GUIDE_PATH), 'utf8'));
  } catch {
    /* skills.* 已报 */
  }
  const systemBody = agentBody !== undefined ? (boardBody && takesTutorRules(first.name) ? `${agentBody}\n\n${boardBody}` : agentBody) : undefined;
  const argv = fillRuntime(runtime.run, { agent: first.name, prompt: '只回一个字:好', agentBody, systemBody, boardFile: join(ws.root, BOARD_GUIDE_PATH) });
  const cwd = join(ws.dirs.agents, first.name);
  const run = await new Promise<{ out: string; err: string; code: number | null; spawnErr?: string }>((resolveRun) => {
    let out = '';
    let err = '';
    const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...env, COTUTOR_WORKSPACE: ws.root }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.once('error', (e) => {
      clearTimeout(timer);
      resolveRun({ out, err, code: null, spawnErr: e.message });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolveRun({ out, err, code });
    });
  });
  const t = parseTranscript(run.out);
  const said = t.items.filter((i) => i.kind === 'text' && !i.sub).map((i) => i.text).join(' ');
  const ok = Boolean(t.final?.ok) && !run.spawnErr;
  const raw = run.spawnErr ?? (t.final ? `${t.final.reason ?? ''} ${said}`.trim() : `没有 result 事件(exit ${run.code}):${run.err.trim().split('\n').slice(-3).join(' / ')}`);
  push({
    name: `live.${runtimeName}`,
    ok,
    required: false,
    detail: ok ? `${first.display} 回了「${(t.final?.text ?? '').slice(0, 20)}」${t.final?.costUsd !== undefined ? ` · $${t.final.costUsd.toFixed(3)}` : ''}` : `起不来或没答上:${raw.slice(0, 300)}`,
    fix: ok ? undefined : explainLlmFailure(raw, runtime.run),
  });

  // 板书后期:给一节固定样本,真起一次快模型,校验能过就算通
  {
    const { resolvePolicy } = await import('../schema/index.ts');
    const { runPost } = await import('../server/post.ts');
    const { parseBoard } = await import('../lib/board.ts');
    const policy = resolvePolicy(ws.config, first.name);
    if (policy.post.mode === 'off') push({ name: 'live.post', ok: true, required: false, detail: '板书后期关着(post.mode = off),不探' });
    else {
      const sample = parseBoard('```text\n# 勾股定理\n直角三角形三条边的关系\n```\n\n先认边。\n\n```text\n# 认边\n两条短边叫直角边,最长的一条叫斜边\n```\n\n两条短边叫直角边,最长的一条叫斜边。\n\n```text formula\n直角边² + 直角边² = 斜边²\n```\n\n记住这个公式。\n\n```choice\n两条直角边是 3 和 4,斜边是多少?\n- [ ] 6\n- [x] 5\n```\n\n斜边是多少?\n').section;
      const r = await runPost(ws, first.name, sample, { policy, env });
      push({ name: 'live.post', ok: r.summary.ok, required: false, detail: r.summary.ok ? `${policy.post.runtime} ${r.summary.ms}ms${r.summary.costUsd !== undefined ? ` · $${r.summary.costUsd.toFixed(4)}` : ''} · 收下 标注 ${r.file.kept?.marks ?? 0} 锚点 ${r.file.kept?.anchors ?? 0} ${r.file.kept?.layout ? '排了行' : '没排行'} 样子 ${r.file.kept?.looks ?? 0}${r.file.dropped.length ? ` · 丢 ${r.file.dropped.length}` : ''}` : `没成:${r.summary.error ?? '?'}`, fix: r.summary.ok ? undefined : `每轮会退素版;查 ${policy.post.runtime} 的模板(${(ws.config.runtimes[policy.post.runtime] as { run?: string[] } | undefined)?.run?.[0] ?? '?'} 在不在 PATH、模型名对不对),或 post.timeoutMs 放宽` });
    }
  }
  const voiced = tutors.find((x) => x.voice);
  if (!voiced) {
    push({ name: 'live.tts', ok: true, required: false, detail: '没有老师配 voice,不探配音(孩子端用浏览器的声)' });
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'cotutor-doctor-'));
  const out = join(dir, 'probe.mp3');
  const argvT = fillTts(ws.config.tts.say, { text: '你好', voice: voiced.voice as string, out });
  const r = await new Promise<{ ok: boolean; msg: string }>((resolveTts) => {
    execFile(argvT[0], argvT.slice(1), { env, timeout: 60_000 }, async (e, _o, se) => {
      if (e) return resolveTts({ ok: false, msg: (e as NodeJS.ErrnoException).code === 'ENOENT' ? `PATH 里没有 ${argvT[0]}` : `${e.message} ${String(se).trim().slice(-200)}` });
      const st = await stat(out).catch(() => null);
      resolveTts(st?.isFile() && st.size > 0 ? { ok: true, msg: `${voiced.display} 的音色 ${voiced.voice} 能合成(${st.size} 字节)` } : { ok: false, msg: '命令跑完但没出文件' });
    });
  });
  await rm(dir, { recursive: true, force: true });
  push({ name: 'live.tts', ok: r.ok, required: false, detail: r.msg, fix: r.ok ? undefined : `改 cotutor.json 的 tts.say(voxtell 不在 PATH 就写完整路径),或查 voxtell doctor` });
}

export async function doctorWorkspace(
  override?: string,
  opts: ResolveOptions & { probeEnv?: boolean; live?: boolean; /** 测试钉时间用:首页「几天前发布的」按它算 */ now?: Date } = {},
): Promise<DoctorReport> {
  const probeEnv = opts.probeEnv ?? true;
  const env = opts.env ?? process.env;
  const checks: DoctorCheck[] = [];
  const push = (c: DoctorCheck): number => checks.push(c);

  const [maj, min] = process.versions.node.split('.').map(Number);
  const nodeOk = maj > 22 || (maj === 22 && min >= 18);
  push({ name: 'node', ok: nodeOk, required: true, detail: `node ${process.versions.node}`, fix: nodeOk ? undefined : '需要 Node ≥ 22.18' });
  if (env.CLAUDECODE) {
    push({ name: 'env.nested', ok: false, required: false, detail: '现在在 Claude Code 会话里(CLAUDECODE 已设),从这里起的 claude 老师会被当嵌套拒掉', fix: '换个普通终端跑 cotutor serve;或 unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION_ID CLAUDE_CODE_CHILD_SESSION CLAUDE_PID CLAUDE_EFFORT' });
  }

  let root: string | null = null;
  let source: RootSource | null = null;
  try {
    ({ root, source } = resolveRoot(override, opts));
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    push({
      name: err instanceof ConfigError ? 'user-config' : 'workspace',
      ok: false,
      required: true,
      detail: err.message,
      fix: err instanceof ConfigError ? `修复 ${redactHome(err.file)} 的 JSON,或删掉它` : 'cotutor init <slug>,或用 --workspace / COTUTOR_WORKSPACE 指定',
    });
    return { ok: false, root: null, source: null, checks };
  }
  push({ name: 'workspace', ok: true, required: true, detail: `${redactHome(root)}(来源:${source})` });

  // ---- cotutor.json ----
  let ws: Workspace | null = null;
  const configFile = join(root, CONFIG_FILE);
  try {
    const raw = readJson(configFile);
    if (raw === null) {
      push({ name: CONFIG_FILE, ok: false, required: true, detail: '不存在', fix: `cotutor init <slug> --dir ${redactHome(root)}(已有文件不动)` });
    } else {
      const config = parseConfig(raw, configFile);
      ws = assembleWorkspace(root, source, config);
      push({
        name: CONFIG_FILE,
        ok: true,
        required: true,
        detail: `kid ${config.kid.slug}、${Object.keys(config.tutors).length} 位老师、运行时 ${config.runtimes.default}、端口 ${config.server.port}`,
      });
    }
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    push({ name: CONFIG_FILE, ok: false, required: true, detail: err.message, fix: '按上面逐条修;政策文件机器不重建,改坏了靠 git 回退' });
  }

  // ---- 配置迁移:包更新带来的新出厂件(老师 / 运行时 / 命令模板旗标)不会自己进政策文件,缺了是静默的 ----
  {
    const gaps = await configGapsOf(root);
    push({
      name: 'config.migrate',
      ok: gaps.length === 0,
      required: false,
      detail: gaps.length ? `${gaps.length} 项可补:${gaps.map((g) => g.detail).join(';')}` : 'cotutor.json 有出厂模板里的全部老师、运行时与旗标',
      fix: gaps.length ? 'cotutor upgrade --config --dry-run 先看,再 cotutor upgrade --config 补(只加缺的,你改过的值不动)' : undefined,
    });
  }

  // ---- 老师会话的隔离(2026-09-15):claude 模板带 --setting-sources project,只读 workspace 的 .claude/,~/.claude 的技能 / hooks / 额外目录都不进老师;
  // 代价是 ~/.claude/settings.json 的 env(代理)也不进,得在起 serve 的 shell 里 export,不然老师 403 ----
  if (ws) {
    const isolated = Object.values(ws.config.runtimes).some((r) => typeof r !== 'string' && r.run.includes('--setting-sources'));
    let userEnv: Record<string, string> = {};
    try {
      userEnv = (JSON.parse(await readFile(join(env.HOME ?? '', '.claude', 'settings.json'), 'utf8')) as { env?: Record<string, string> }).env ?? {};
    } catch {
      /* 没有用户级 settings 就没有这条 */
    }
    const lost = Object.keys(userEnv).filter((k) => !(k in env));
    if (isolated && lost.length) {
      push({ name: 'env.userSettings', ok: false, required: false, detail: `~/.claude/settings.json 的 env 有 ${lost.join(' ')},这个 shell 里没有;老师会话带 --setting-sources project 读不到它们(代理没了就 403)`, fix: `起 serve 前 export ${lost.map((k) => `${k}=…`).join(' ')}` });
    }
  }

  // ---- 骨架 ----
  const missing: string[] = [];
  for (const d of DIRS) if (!(await statOrNull(join(root, d)))?.isDirectory()) missing.push(`${d}/`);
  push({
    name: 'skeleton',
    ok: missing.length === 0,
    required: true,
    detail: missing.length ? `缺 ${missing.join(' ')}` : [...DIRS].map((d) => `${d}/`).join(' '),
    fix: missing.length ? `cotutor init <slug> --dir ${redactHome(root)}(幂等补缺)` : undefined,
  });
  // 家规(根的 CLAUDE.md / QWEN.md)2026-09-15 起不出厂:有就是家长自建的共同规矩,提一句;没有不缺
  const rulesThere = (await Promise.all(['CLAUDE.md', 'QWEN.md'].map(async (f) => ((await statOrNull(join(root, f))) ? f : null)))).filter(Boolean);
  push({ name: 'rules', ok: true, required: false, detail: rulesThere.length ? `家长自建的家规 ${rulesThere.join(' ')} 在,所有老师每轮都读(板书后期的快模型也会读到)` : '没有根目录的 CLAUDE.md / QWEN.md(不需要:老师要知道的都在老师文件与技能里)' });

  if (ws) {
    // ---- 老师:定义文件(拷贝)+ 名字一致 + 出厂 / 自定义状态 + 老师目录 ----
    const defaultCli = runtimeCli(ws.config.runtimes[ws.config.runtimes.default]?.run ?? []);
    const statuses = new Map((await tutorStatuses(root)).map((s) => [s.name, s]));
    for (const name of Object.keys(ws.config.tutors)) {
      const shipped = statuses.has(name);
      for (const [cli, dir] of [
        ['claude', ws.dirs.claudeAgents],
        ['qwen', ws.dirs.qwenAgents],
      ] as const) {
        const file = join(dir, `${name}.md`);
        const required = cli === defaultCli;
        let detail: string;
        let ok = false;
        try {
          const { frontmatter } = parseAgentFile(await readFile(file, 'utf8'));
          ok = frontmatter.name === name;
          detail = ok ? `${redactHome(file)} name 一致` : `${redactHome(file)} 的 frontmatter name 是 "${frontmatter.name ?? ''}",与老师键 ${name} 不一致`;
        } catch {
          detail = `${redactHome(file)} 读不到(链断了或没建)`;
        }
        push({
          name: `tutor.${name}.${cli}`,
          ok,
          required,
          detail,
          fix: ok
            ? undefined
            : shipped
              ? `cotutor init 补拷(拷自本包 agents/${name}.md),或把老师键改成文件里的 name`
              : cli === 'qwen'
                ? 'cotutor init 补链(.qwen/agents/ 指向 .claude/agents/)'
                : `这是自家加的老师:写 .claude/agents/${name}.md(frontmatter name: ${name}),cotutor add ${name} --display <显示名> 可出模板;或把 cotutor.json 里这条删掉`,
        });
      }
      const st = statuses.get(name);
      if (!st) push({ name: `tutor.${name}.origin`, ok: true, required: false, detail: '自家加的老师(不是出厂件,upgrade 不碰)' });
      if (st) {
        const label: Record<string, string> = { latest: '出厂件,最新', upgradable: `出厂件,基于 ${st.basedOn},包已更新`, custom: `自定义(基于 ${st.basedOn})`, untracked: '自定义(没有出厂记录)', missing: '缺', broken: '读不到' };
        push({
          name: `tutor.${name}.origin`,
          ok: st.state !== 'upgradable',
          required: false,
          detail: label[st.state],
          fix: st.state === 'upgradable' ? 'cotutor upgrade 换新版' : undefined,
        });
      }
      const home = join(ws.dirs.agents, name);
      const there = (await statOrNull(home))?.isDirectory() ?? false;
      push({ name: `tutor.${name}.home`, ok: there, required: true, detail: there ? `agents/${name}/ 在(会话 cwd)` : `agents/${name}/ 不在`, fix: there ? undefined : 'cotutor init 补建' });
      // 音色:一老师一音色走 API 是正路(《工作流程.md》§四);没配的孩子端只剩浏览器合成声(只该在测试里);hidden 的老师(scene-maker)不对孩子说话,不用音色
      const tc = ws.config.tutors[name];
      if (tc.enabled && !tc.hidden && !tc.voice) push({ name: `tutor.${name}.voice`, ok: false, required: false, detail: `${tc.display} 没配音色(cotutor.json tutors.${name}.voice),孩子端用浏览器合成声——只适合测试`, fix: '家长端「音色」页能听着挑(挑中直接写进去);终端里 voxtell voices --grep <关键词> 挑一个、voxtell preview <voice> 试听,填进 voice' });
      // 头像是图片路径时(figshot 写的 avatars/<name>.png)查文件在不在、在不在根以内;emoji 不查
      if (tc.avatar && /\.(png|jpe?g|webp|gif|svg)$/i.test(tc.avatar)) {
        const file = resolve(root, tc.avatar);
        const inside = !tc.avatar.startsWith('/') && file.startsWith(root + sep);
        const there = inside && ((await statOrNull(file))?.isFile() ?? false);
        push({ name: `tutor.${name}.avatar`, ok: there, required: false, detail: there ? `头像 ${tc.avatar}` : inside ? `头像 ${tc.avatar} 不在,孩子端退回显示首字` : `头像 ${tc.avatar} 在 workspace 根之外,页面不给`, fix: there ? undefined : `figshot pick --workspace ${redactHome(root)} 存一张,或把 cotutor.json 的 tutors.${name}.avatar 改回 emoji` });
      }
    }

    {
      // 板书后期:policy post.runtime 指的运行时要在;不在 = 每轮都素版(不报错,静默)
      {
        const { resolvePolicy } = await import('../schema/index.ts');
        const seen = new Set<string>();
        for (const name of Object.keys(ws.config.tutors)) {
          const p = resolvePolicy(ws.config, name);
          if (p.post.mode === 'off' || seen.has(p.post.runtime)) continue;
          seen.add(p.post.runtime);
          const rt = ws.config.runtimes[p.post.runtime];
          const okRt = Boolean(rt) && typeof rt !== 'string';
          push({ name: `post.runtime.${p.post.runtime}`, ok: okRt, required: false, detail: okRt ? `板书后期用 ${p.post.runtime}(${(rt as { run: string[] }).run.slice(0, 4).join(' ')} …),等 ${p.post.timeoutMs}ms` : `板书后期的运行时 ${p.post.runtime} 不在 runtimes 里,每轮都是素版(没有划重点与排版)`, fix: okRt ? undefined : 'cotutor upgrade --config 补出厂的 claude-fast,或把 policyDefaults.post.runtime 改成有的运行时(post.mode = off 关掉)' });
        }
      }
      // 舞台包与 drawtell:场景卡 / 画板卡要它们;没有只是重卡打不开,轻卡与对话照常
      const { stageBuilt } = await import('../server/stage.ts');
      const built = stageBuilt();
      push({ name: 'stage.bundle', ok: built, required: false, detail: built ? 'dist/stage/ 在(舞台包:场景卡与画板卡的播放器)' : 'dist/stage/ 不在,场景卡与画板卡的舞台打不开(轻卡照常)', fix: built ? undefined : '仓库根 pnpm run build:stage(npm 装的包自带)' });
      const { TOOL_SHIM, drawtellBin, skillStatuses } = await import('./skills.ts');
      const dt = drawtellBin();
      const shim = (await statOrNull(join(root, TOOL_SHIM)))?.isFile() ?? false;
      push({ name: 'drawtell', ok: dt !== null && shim, required: false, detail: !dt ? 'node_modules 里没有 drawtell,场景作业跑不了' : shim ? `${TOOL_SHIM} 在,指向本包的 drawtell(scene-maker 用它 check / build / dub / snap)` : `${TOOL_SHIM} 不在,scene-maker 找不到 drawtell`, fix: !dt ? '仓库根 pnpm install' : shim ? undefined : 'cotutor init 或 cotutor upgrade 生成' });
      for (const sk of await skillStatuses(root)) {
        const label: Record<string, string> = { latest: sk.machine ? '机器件,最新' : '出厂件,最新', upgradable: sk.machine ? '机器件,和包里不一样(改过或包已更新)' : `出厂件,基于 ${sk.basedOn},包已更新`, custom: `自定义(基于 ${sk.basedOn})`, untracked: '自定义(没有出厂记录)', missing: sk.machine ? '缺(机器件,老师或家长的技能靠它)' : '缺', unavailable: `${sk.source} 没装,没法拷` };
        const qwenOk = (await statOrNull(join(root, '.qwen', 'skills', sk.name)))?.isDirectory() ?? false;
        push({ name: `skill.${sk.name}`, ok: sk.state !== 'missing' && sk.state !== 'unavailable' && sk.state !== 'upgradable', required: Boolean(sk.machine), detail: `.claude/skills/${sk.name}/:${label[sk.state]}${qwenOk ? '' : ';.qwen/skills/ 链不通'}`, fix: sk.state === 'missing' ? 'cotutor init 补拷' : sk.state === 'upgradable' ? 'cotutor upgrade 换新版' : sk.state === 'unavailable' ? '仓库根 pnpm install' : qwenOk ? undefined : 'cotutor init 补链' });
      }
      // ---- 主题:孩子端板书的样子,themes/<kid.theme>/;清单要过契约、css 要在;坏了服务退回出厂 default,孩子端不会没样子 ----
      {
        const { readTheme, themeDir, themeStatuses } = await import('./themes.ts');
        const name = ws.config.kid.theme;
        const dir = themeDir(root, name);
        try {
          const t = await readTheme(dir);
          push({ name: 'theme.manifest', ok: true, required: false, detail: `themes/${name}/:${Object.keys(t.manifest.tints).length} 个底色槽、${Object.keys(t.manifest.looks).length} 个字形槽、${Object.keys(t.manifest.pens).length} 支笔,default = ${t.manifest.default}` });
          const { missingSlots } = await import('../lib/postprocess.ts');
          if (t.post === null) push({ name: 'theme.post', ok: true, required: false, detail: `themes/${name}/post.md 不在,后期提示词用包里出厂的骨架`, fix: 'cotutor upgrade 会把出厂的 post.md 拷进来;想改口味就改它' });
          else if (missingSlots(t.post).length) push({ name: 'theme.post', ok: false, required: false, detail: `themes/${name}/post.md 缺必需占位符 ${missingSlots(t.post).map((s) => `{${s}}`).join(' ')},后期退出厂骨架`, fix: '把缺的占位符加回去(cards / lines / rules / output 是代码生成的部分,不能少)' });
          else push({ name: 'theme.post', ok: true, required: false, detail: `themes/${name}/post.md:后期提示词骨架 ${t.post.length} 字` });
        } catch (err) {
          push({ name: 'theme.manifest', ok: false, required: false, detail: `themes/${name}/ 用不了(服务退回出厂 default):${err instanceof Error ? err.message : String(err)}`, fix: name === 'default' ? 'cotutor init 补拷(已有的不动)或 cotutor upgrade' : `修 themes/${name}/theme.json 与 kid.css,或把 cotutor.json 的 kid.theme 改回 default` });
        }
        for (const th of await themeStatuses(root)) {
          if (!th.shipped) {
            push({ name: `theme.${th.name}.origin`, ok: true, required: false, detail: `themes/${th.name}/:自家的主题(不是出厂件,upgrade 不碰)` });
            continue;
          }
          const label: Record<string, string> = { latest: '出厂件,最新', upgradable: `出厂件,基于 ${th.basedOn},包已更新`, custom: `自定义(基于 ${th.basedOn})`, untracked: '自定义(没有出厂记录)', missing: '缺' };
          push({ name: `theme.${th.name}.origin`, ok: th.state !== 'missing' && th.state !== 'upgradable', required: false, detail: `themes/${th.name}/:${label[th.state]}`, fix: th.state === 'missing' ? 'cotutor init 补拷' : th.state === 'upgradable' ? 'cotutor upgrade 换新版' : undefined });
        }
      }
    }

    // ---- 首页(《首页设计.md》):没发布 = 缺省首页;坏了孩子端退回缺省;超过 3 天提醒;引用坏了的按钮孩子端不出现 ----
    {
      const { daysSince, publishedIssues, readPublished } = await import('../server/home.ts');
      const now = opts.now ?? new Date();
      const { home, error } = await readPublished(ws);
      if (error) push({ name: 'home.published', ok: false, required: false, detail: `${error};孩子端退回缺省首页`, fix: '用 cotutor-home 技能排一份再 cotutor home publish,或删掉 home/published.json' });
      else if (!home) push({ name: 'home.published', ok: true, required: false, detail: '没发布过首页:孩子端是缺省首页(每位老师一张只有「新话题」的卡)' });
      else {
        const days = daysSince(home, now);
        push({ name: 'home.published', ok: days <= 3, required: false, detail: `已发布 ${home.id}(${days === 0 ? '今天' : `${days} 天前`})· ${home.cards.length} 张卡`, fix: days > 3 ? '首页是好几天前的:孩子学完后在 workspace 根开 Claude Code,用 cotutor-home 技能排一份新的' : undefined });
        const broken = await publishedIssues(ws, home, now);
        push({ name: 'home.refs', ok: !broken.length, required: false, detail: broken.length ? broken.map((i) => i.text).join(';') : '已发布那份里的老师与话题都在', fix: broken.length ? '坏了的按钮孩子端不出现;要补就改草稿重发(cotutor home check 看细节)' : undefined });
      }
    }

    // ---- paths 角色指向:配了就该在 ----
    for (const [role, value] of Object.entries(ws.config.paths)) {
      const target = ws.paths[role] ?? expandPath(value, ws.root);
      const st = await statOrNull(target);
      if (!st) {
        push({ name: `paths.${role}`, ok: false, required: true, detail: `指向不存在:${redactHome(target)}`, fix: `mkdir -p 该目录,或修正 cotutor.json 的 paths.${role};指向 Obsidian vault 时确认 vault 已建、iCloud 已同步` });
        continue;
      }
      const evicted = target.includes('Mobile Documents') && st.isDirectory() ? await evictedCount(target) : 0;
      push({ name: `paths.${role}`, ok: evicted === 0, required: false, detail: `${redactHome(target)}${evicted ? `——有 ${evicted} 个 .icloud 占位` : ''}`, fix: evicted ? '关掉 iCloud「优化 Mac 储存空间」,或把该目录下载到本地' : undefined });
    }

    // ---- 账本:坏行必须响(不可再生,别删)----
    try {
      const { rows, errors } = parseArtifactEvents(await readFile(ws.files.artifacts, 'utf8'));
      push({ name: 'ledger.artifacts', ok: errors.length === 0, required: true, detail: errors.length ? errors.slice(0, 3).join(';') : `${rows.length} 行`, fix: errors.length ? '修那几行,或 git checkout 回退;账本不可再生,不要删了重来' : undefined });
    } catch {
      push({ name: 'ledger.artifacts', ok: true, required: false, detail: '没有(还没记过);cotutor init 会建空文件' });
    }

    // ---- 作业照片(R5):paths.captures 要在 workspace 根以内(页面经 /api/kid/image 取图只认根以内)、能写;还没拍过就不存在,第一张时建 ----
    {
      const cap = ws.paths.captures;
      const inside = cap === ws.root || cap.startsWith(ws.root + sep);
      let dir = cap;
      while (!(await stat(dir).catch(() => null))?.isDirectory() && dirname(dir) !== dir) dir = dirname(dir);
      const writable = await access(dir, fsConstants.W_OK).then(() => true, () => false);
      const there = dir === cap;
      const n = there ? (await readdir(cap).catch(() => [] as string[])).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).length : 0;
      push({ name: 'captures', ok: inside && writable, required: false, detail: !inside ? `${redactHome(cap)} 在 workspace 根以外,页面看不到照片(/api/kid/image 只给根以内的)` : !writable ? `${redactHome(cap)} 写不了(最近的已有目录 ${redactHome(dir)} 没有写权限)` : there ? `${redactHome(cap)}:${n} 天的作业照片` : `${redactHome(cap)} 还没有(第一张照片时建)`, fix: !inside ? '把 cotutor.json 的 paths.captures 改回根以内(缺省 captures)' : !writable ? '改目录权限,或换 paths.captures' : undefined });
    }

    // ---- vault(《obsidian仓库设计.md》2026-09-17):档案与每位老师的入口文件按 frontmatter 找,原文整篇进上下文包 ----
    {
      const { notes, files } = await scanVault(ws);
      const today = localDate(new Date());
      const base = pickNotes(notes, files, { date: today });
      const limit = resolvePolicy(ws.config, '').contextPack.entryChars;
      push({
        name: 'vault.profile',
        ok: !!base.profile && !!base.semester && !base.extraProfiles.length,
        required: false,
        detail: !base.profile ? `${redactHome(ws.paths.vault)} 里没有 cotutor: profile 的档案;老师不知道孩子是谁、几年级` : `${base.profile.path} · 学期 ${base.semester ?? '算不出'}${base.extraProfiles.length ? ` · 另有 ${base.extraProfiles.join('、')} 也是 profile,没用` : ''}`,
        fix: !base.profile ? '建一篇(文件名随意),frontmatter 写 cotutor: profile、nickname、birthday、school_start: 2025-09(读一年级的年月),正文写孩子的情况;或 cotutor init 补一篇' : !base.semester ? `在 ${base.profile.path} 的 frontmatter 加 school_start: YYYY-MM(读一年级的年月);特殊情况直接写 semester: 二年级上` : base.extraProfiles.length ? '只留一篇 cotutor: profile' : undefined,
      });
      for (const t of listTutors(ws.config).filter((x) => x.enabled)) {
        const m = pickNotes(notes, files, { date: today, agent: t.name });
        const big = !!m.memory && m.memory.text.length > limit;
        push({
          name: `vault.memory.${t.name}`,
          ok: !big && !m.extraMemories.length,
          required: false,
          detail: m.memory ? `${m.memory.path}(${m.memory.text.length} 字${big ? `,超过 ${limit},会截断` : ''})${m.extraMemories.length ? ` · 另有 ${m.extraMemories.join('、')} 没用` : ''}` : `还没有;${t.display}第一次记东西时建 ${memoryPath(t.display)}`,
          fix: big ? '在 Obsidian 里把记忆文件理一理:合并重复的、删过时的;或调 policy.contextPack.entryChars' : m.extraMemories.length ? `agent: ${t.name} 的记忆文件只留一篇` : undefined,
        });
      }
      for (const t of listTutors(ws.config).filter((x) => x.enabled && x.name.endsWith('-tutor'))) {
        const p = pickNotes(notes, files, { date: today, subject: t.subject });
        const big = p.entry && p.entry.text.length > limit;
        const where = t.subject && p.semester ? `课程/${p.semester}/${t.subject}.md` : null;
        push({
          name: `vault.entry.${t.name}`,
          ok: !!p.entry && !big && !p.extraEntries.length,
          required: false,
          detail: p.entry ? `${p.entry.path}(${p.entry.text.length} 字${big ? `,超过 ${limit},会截断` : ''})${p.refs.length ? ` · 参考 ${p.refs.length} 篇` : ''}${p.extraEntries.length ? ` · 另有 ${p.extraEntries.join('、')} 没用` : ''}` : missingEntry(t.subject, p),
          fix: !t.subject ? `在 cotutor.json 的 tutors.${t.name} 里配 subject` : !p.semester ? '先让档案算得出学期(见 vault.profile)' : !p.entry && where ? `建 ${where}(路径随意),frontmatter 写 cotutor: subject、subject: ${t.subject}、semester: ${p.semester};正文写这学期这科的情况,${t.display}每个话题开头整篇读到` : big ? '长的内容挪到别的笔记,入口文件里 [[链过去]](老师只拿到路径,要用时自己读);或调 policy.contextPack.entryChars' : p.extraEntries.length ? '同一科同一学期只留一篇' : undefined,
        });
      }
    }
    try {
      const dn = JSON.parse(await readFile(join(ws.paths.vault, '.obsidian', 'daily-notes.json'), 'utf8')) as { folder?: string; format?: string };
      const want = relative(ws.paths.vault, ws.paths.diary).replaceAll('\\', '/');
      const folderOk = (dn.folder ?? '').replace(/\/+$/, '') === want;
      const formatOk = !dn.format || dn.format === 'YYYY-MM-DD';
      push({ name: 'vault.diary', ok: folderOk && formatOk, required: false, detail: `Obsidian daily notes:folder=${dn.folder ?? '(未设)'} format=${dn.format ?? 'YYYY-MM-DD'};记账写 ${want}/<YYYY-MM-DD>.md`, fix: folderOk && formatOk ? undefined : `在 Obsidian 设置 → 日记 里把目录设成 ${want}、格式 YYYY-MM-DD(或改 cotutor.json 的 paths.diary),否则「今天」按钮开的不是机器追加的那篇` });
    } catch {
      /* 不是 Obsidian vault 或没设 daily notes:不查 */
    }

    // ---- 课程表:有就要能解析(孩子端首页与上下文包的 slot 靠它;没有不算错)----
    try {
      const tt = parseTimetable(await readFile(ws.paths.timetable, 'utf8'));
      push({
        name: 'timetable',
        ok: tt.found && tt.errors.length === 0,
        required: false,
        detail: tt.found ? (tt.errors.length ? tt.errors.slice(0, 3).join(';') : `${tt.entries.length} 个时段`) : tt.errors[0],
        fix: tt.found && !tt.errors.length ? undefined : `改 ${redactHome(ws.paths.timetable)}:表头 星期/时间/学科(孩子列可选),时间形如 19:00–19:40`,
      });
    } catch {
      push({ name: 'timetable', ok: true, required: false, detail: `没有课程表(${redactHome(ws.paths.timetable)});孩子端「今天」只画老师,不画时段` });
    }

    // ---- HTTPS:iPad 上录音要;没有只提醒 ----
    const tls = httpsFiles(ws);
    push({ name: 'https', ok: tls !== null, required: false, detail: tls ? `${redactHome(tls.cert)}` : '没有证书,serve 走 HTTP(iPad / iPhone 上按住说话不可用)', fix: tls ? undefined : 'cotutor cert(需要 mkcert:brew install mkcert && mkcert -install)' });

    // ---- 板书写法怎么递给老师(《agent层设计.md》拍板 11):有脸的老师用到的运行时逐个说清,run / resume 不一致点名 ----
    {
      const used = new Set<string>();
      for (const [name, t] of Object.entries(ws.config.tutors)) if (takesTutorRules(name) && t.enabled !== false) used.add(t.runtime ?? ws.config.runtimes.default);
      for (const name of used) {
        const rt = ws.config.runtimes[name];
        if (!rt || typeof rt === 'string') continue;
        const inRun = boardPreloaded({ run: rt.run, resume: rt.run });
        const inResume = boardPreloaded({ run: rt.resume, resume: rt.resume });
        const how = runtimeUses(rt, '{boardFile}') ? '{boardFile} 追加进系统提示' : runtimeUses(rt, '{systemBody}') ? '{systemBody} 连老师正文一起进系统提示' : '模板里写死的 SKILL.md 路径';
        if (inRun !== inResume) push({ name: `runtime.${name}.board`, ok: false, required: false, detail: `板书写法的预载只在 ${inRun ? 'run' : 'resume'} 模板里,两边不一致(压缩后系统提示按 resume 的旗标重建)`, fix: 'cotutor upgrade --config 补旗标,或手改 cotutor.json 让两条模板一致' });
        else push({ name: `runtime.${name}.board`, ok: true, required: false, detail: inRun ? `板书写法预载进系统提示(${how}),各话题共享缓存` : '板书写法由应用放进每个话题第一条(<cotutor-board>);这个 CLI 能从文件或参数收系统提示的话,模板里用 {boardFile} / {systemBody} 更省' });
      }
    }

    // ---- 运行时的 CLI 在不在 ----
    if (probeEnv) {
      const ttsBin = runtimeCli(ws.config.tts.say);
      try {
        await execFileP(ttsBin, ['--version'], { timeout: 8000 });
        push({ name: 'tts', ok: true, required: false, detail: `${ttsBin} 在;老师配了 voice 的回复会配音` });
      } catch {
        push({ name: 'tts', ok: false, required: false, detail: `PATH 里没有 ${ttsBin},回复不配音(孩子端用浏览器的声)`, fix: `装 ${ttsBin},或改 cotutor.json 的 tts.say` });
      }
      for (const [runtime, p] of Object.entries(ws.config.runtimes)) {
        if (runtime === 'default' || typeof p === 'string') continue;
        const bin = runtimeCli(p.run);
        const required = runtime === ws.config.runtimes.default;
        try {
          const { stdout } = await execFileP(bin, ['--version'], { timeout: 8000 });
          push({ name: `runtime.${runtime}`, ok: true, required, detail: `${bin} ${stdout.trim().split('\n')[0]}` });
        } catch {
          push({ name: `runtime.${runtime}`, ok: false, required, detail: `PATH 里没有 ${bin}`, fix: required ? `装 ${bin},或把 runtimes.default 改成装了的那个运行时` : undefined });
        }
      }
    }
  }

  if (ws && opts.live) await probeLive(ws, push, env);

  // ---- 用户配置 ----
  try {
    const text = await readFile(USER_CONFIG, 'utf8');
    try {
      const u = JSON.parse(text) as { workspace?: string };
      push({ name: 'user-config', ok: true, required: false, detail: u.workspace ? `workspace → ${redactHome(expandPath(u.workspace, root))}` : '有,但未设 workspace' });
    } catch {
      push({ name: 'user-config', ok: false, required: false, detail: `${redactHome(USER_CONFIG)} 解析失败`, fix: '修复 JSON 或删掉它' });
    }
  } catch {
    push({ name: 'user-config', ok: true, required: false, detail: `未配置(可选):{"workspace": "…"} 写进 ${redactHome(USER_CONFIG)};cotutor init 会代劳` });
  }

  const gitThere = (await statOrNull(join(root, '.git'))) !== null;
  push({ name: 'git', ok: gitThere, required: false, detail: gitThere ? 'workspace是 git 仓' : 'workspace不在 git 里', fix: gitThere ? undefined : '建议 git init:老师记忆、账本、政策都是不可再生状态' });

  return { ok: checks.filter((c) => c.required).every((c) => c.ok), root, source, checks };
}
