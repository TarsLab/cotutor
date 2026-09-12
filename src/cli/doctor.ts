/**
 * cotutor doctor:环境 + workspace逐项体检,失败项附修复命令(错误信息即修复指南)。
 * 静默失败摆到明面:配置坏了、老师链断了、账本有坏行、角色指向踩空。
 * exit 约定同 drawtell / voxtell doctor:必需项全过 exit 0,否则 1;--json 带 ok 与整份 checks。
 */
import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { parseAgentFile } from '../lib/agent-file.ts';
import { parseArtifactEvents, parseObservations } from '../lib/ledger.ts';
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
  const argv = fillRuntime(runtime.run, { agent: first.name, prompt: '只回一个字:好', agentBody });
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
      const sample = parseBoard('```text cover\n勾股定理\n直角三角形三条边的关系\n```\n\n先认边。\n\n```text\n# 认边\n两条短边叫直角边,最长的一条叫斜边\n```\n\n两条短边叫直角边,最长的一条叫斜边。\n\n```text formula\n直角边² + 直角边² = 斜边²\n```\n\n记住这个公式。\n\n```choice\n两条直角边是 3 和 4,斜边是多少?\n- [ ] 6\n- [x] 5\n```\n\n斜边是多少?\n').section;
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
  opts: ResolveOptions & { probeEnv?: boolean; live?: boolean } = {},
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
  const rulesMissing = (await Promise.all(['CLAUDE.md', 'QWEN.md'].map(async (f) => ((await statOrNull(join(root, f))) ? null : f)))).filter(Boolean);
  push({
    name: 'rules',
    ok: rulesMissing.length === 0,
    required: false,
    detail: rulesMissing.length ? `缺家规 ${rulesMissing.join(' ')}(老师少了常驻指令)` : '家规 CLAUDE.md QWEN.md 在',
    fix: rulesMissing.length ? 'cotutor init 补上(已有的不动)' : undefined,
  });

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
          ok: st.state !== 'upgradable' && !st.legacyLink,
          required: false,
          detail: st.legacyLink ? '还是指向包的旧链(改它会改到包里)' : label[st.state],
          fix: st.legacyLink ? 'cotutor init 换成拷贝' : st.state === 'upgradable' ? 'cotutor upgrade 换新版' : undefined,
        });
      }
      const home = join(ws.dirs.agents, name);
      const there = (await statOrNull(home))?.isDirectory() ?? false;
      push({ name: `tutor.${name}.home`, ok: there, required: true, detail: there ? `agents/${name}/ 在(会话 cwd)` : `agents/${name}/ 不在`, fix: there ? undefined : 'cotutor init 补建' });
    }

    // ---- 板书语法表:老师讲解前读它;机器文件,init / upgrade 刷新 ----
    {
      const { SYNTAX_FILE } = await import('./skeleton.ts');
      const there = (await statOrNull(join(root, SYNTAX_FILE)))?.isFile() ?? false;
      push({ name: 'board.syntax', ok: there, required: true, detail: there ? `${SYNTAX_FILE} 在(老师讲解前读的语法表)` : `${SYNTAX_FILE} 不在,老师不知道卡怎么写`, fix: there ? undefined : 'cotutor init 或 cotutor upgrade 生成' });
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
        const label: Record<string, string> = { latest: '出厂件,最新', upgradable: `出厂件,基于 ${sk.basedOn},包已更新`, custom: `自定义(基于 ${sk.basedOn})`, untracked: '自定义(没有出厂记录)', missing: '缺', unavailable: 'drawtell-skills 没装,没法拷' };
        push({ name: `skill.${sk.name}`, ok: sk.state !== 'missing' && sk.state !== 'unavailable' && sk.state !== 'upgradable', required: false, detail: `.claude/skills/${sk.name}/:${label[sk.state]}`, fix: sk.state === 'missing' ? 'cotutor init 补拷' : sk.state === 'upgradable' ? 'cotutor upgrade 换新版' : sk.state === 'unavailable' ? '仓库根 pnpm install' : undefined });
      }
      // ---- 主题:孩子端板书的样子,themes/<kid.theme>/;清单要过契约、css 要在;坏了服务退回出厂 default,孩子端不会没样子 ----
      {
        const { readTheme, themeDir, themeStatuses } = await import('./themes.ts');
        const name = ws.config.kid.theme;
        const dir = themeDir(root, name);
        try {
          const t = await readTheme(dir);
          push({ name: 'theme.manifest', ok: true, required: false, detail: `themes/${name}/:${Object.keys(t.manifest.tints).length} 个底色槽、${Object.keys(t.manifest.looks).length} 个字形槽、${Object.keys(t.manifest.pens).length} 支笔,default = ${t.manifest.default}` });
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
    for (const [name, file, parse] of [
      ['observations', ws.files.observations, parseObservations],
      ['artifacts', ws.files.artifacts, parseArtifactEvents],
    ] as const) {
      try {
        const text = await readFile(file, 'utf8');
        const { rows, errors } = parse(text);
        push({ name: `ledger.${name}`, ok: errors.length === 0, required: true, detail: errors.length ? errors.slice(0, 3).join(';') : `${rows.length} 行`, fix: errors.length ? '修那几行,或 git checkout 回退;账本不可再生,不要删了重来' : undefined });
      } catch {
        push({ name: `ledger.${name}`, ok: true, required: false, detail: '没有(还没记过);cotutor init 会建空文件' });
      }
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
