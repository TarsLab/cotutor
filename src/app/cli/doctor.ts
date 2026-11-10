/**
 * cotutor doctor:环境 + workspace逐项体检,失败项附修复命令(错误信息即修复指南)。
 * 静默失败摆到明面:配置坏了、老师链断了、账本有坏行、角色指向踩空。
 * exit 约定同 drawtell / voxtell doctor:必需项全过 exit 0,否则 1;--json 带 ok 与整份 checks。
 */
import { isRealtimeVoice } from '../../realtime/voices.ts';
import { dashscopeAuth } from '../../realtime/bailian.ts';
import { TTS_MODEL, ttsTarget } from '../../media/tts.ts';
import { compatibleLine, isPlanKey, tokenPlanKey } from '../../shared/qianwen.ts';
import { runtimeIssue } from '../../brain/index.ts';
import { homedir } from 'node:os';
import { access, lstat, readFile, readdir, stat } from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { takesTutorRules } from '../../runtime/context/tutor-rules.ts';
import { parseAgentFile } from '../../runtime/agent-file.ts';
import { localDate } from '../../shared/time.ts';
import { MIN_CONTRAST, contrastWithWhite } from '../../ui/shared/tutor-color.ts';
import { memoryPath, missingEntry, pickNotes } from '../../memory/vault-notes.ts';
import { SKILLS_DIR, cardVoice, isApiRuntime, listTutors, mouthVoice, resolvePolicy, tutorFilePath } from '../../schema/index.ts';
import { kindsFor, tutorCardKinds } from '../../board/cards/index.ts';
import { scanVault } from '../../memory/vault.ts';
import { parseArtifactEvents } from '../../runtime/journal/ledger.ts';
import { parseTimetable } from '../../memory/timetable.ts';
import { configGapsOf, legacyLayout } from './migrate.ts';
import { httpsFiles } from './serve.ts';
import { readPin } from '../http/access.ts';
import { BUILD } from '../build.ts';
import { isNewer, upgradeSteps } from '../../shared/upgrade.ts';
import { gradeOfSemester } from '../../memory/grade.ts';
import { DIRS } from './skeleton.ts';
import { tutorStatuses, readManifest } from './tutors.ts';
import { workspaceGradePack, type GradePack } from './grades.ts';
import {
  CONFIG_FILE,
  ConfigError,
  USER_CONFIG,
  UsageError,
  type ResolveOptions,
  type RootSource,
  type Workspace,
  assembleWorkspace,
  defaultVaultOf,
  expandPath,
  homePath,
  isInside,
  parseConfig,
  readJson,
  redactHome,
  resolveRoot,
  vaultSeparate,
} from '../workspace.ts';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
  /** 给人看的修法 */
  fix?: string;
  /** 不过时能直接跑的修复命令:幂等、不碰孩子的数据、不用人输东西(INSTALL.md 让 agent 照跑) */
  cmd?: string;
  /** 不过、又没有 cmd:要人来(填 key、输开机密码、点弹窗、写孩子的情况),agent 别动手。finish 统一补 */
  human?: true;
}

export interface DoctorReport {
  ok: boolean;
  root: string | null;
  source: RootSource | null;
  checks: DoctorCheck[];
}

/** 每条不过的要么能跑(cmd)要么要人来(human),没有第三种:新加的检查项忘了写 cmd,也只是交给人,不会让 agent 瞎猜 */
function finish(report: DoctorReport): DoctorReport {
  for (const c of report.checks) {
    if (c.ok) delete c.cmd;
    else if (!c.cmd) c.human = true;
  }
  return report;
}

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

/**
 * --live:老师用的是 API 运行时,不在这里真起一轮(真跑一轮用 cotutor send);配音照真合成一句(老师配了 voice 的),花一分钱级别,所以缺省不跑。
 */
async function probeLive(ws: Workspace, push: (c: DoctorCheck) => number, env: NodeJS.ProcessEnv): Promise<void> {
  const { listTutors } = await import('../../schema/index.ts');
  const { synthesize } = await import('../../media/tts.ts');
  const { tmpdir } = await import('node:os');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const tutors = listTutors(ws.config).filter((t) => t.enabled);
  const runtimeName = ws.config.runtimes.default;
  const runtime = ws.config.runtimes[runtimeName];
  if (runtime && typeof runtime !== 'string' && isApiRuntime(runtime)) push({ name: `live.${runtimeName}`, ok: true, required: false, detail: `API 运行时(百炼 ${runtime.model}),不起老师;真跑一轮用 cotutor send` });
  const voiced = tutors.find((x) => x.voice);
  if (!voiced) {
    push({ name: 'live.tts', ok: true, required: false, detail: '没有老师配 voice,不探配音(点读、单词卡没有声音)' });
    return;
  }
  // 缓存放临时目录:真合成一次,不拿 workspace 里存着的那份充数
  const dir = await mkdtemp(join(tmpdir(), 'cotutor-doctor-'));
  const r = await synthesize({ text: '你好', voice: voiced.voice as string }, { cacheDir: dir, env });
  const size = r.file ? ((await stat(r.file).catch(() => null))?.size ?? 0) : 0;
  await rm(dir, { recursive: true, force: true });
  push({ name: 'live.tts', ok: Boolean(r.file), required: false, detail: r.file ? `${voiced.display} 的音色 ${voiced.voice} 能合成(${size} 字节)` : `${voiced.display} 的音色 ${voiced.voice} 没合成:${r.error}`, fix: r.file ? undefined : '家长端「首页」里填百炼的 key 与业务空间 id;音色到家长端首页的「样子与声音」重挑' });
}

export async function doctorWorkspace(
  override?: string,
  opts: ResolveOptions & {
    probeEnv?: boolean;
    live?: boolean;
    /** 测试钉时间用:首页「几天前发布的」按它算 */
    now?: Date;
    /** Windows 上查防火墙放没放行(起一次 PowerShell,一秒多):缺省跟 probeEnv;serve 起来时要查 */
    firewall?: boolean;
    /** 防火墙按哪个端口查:缺省 cotutor.json 的 server.port,serve --port 换了就传进来 */
    port?: number;
  } = {},
): Promise<DoctorReport> {
  const probeEnv = opts.probeEnv ?? true;
  const env = opts.env ?? process.env;
  const checks: DoctorCheck[] = [];
  const push = (c: DoctorCheck): number => checks.push(c);

  const [maj, min] = process.versions.node.split('.').map(Number);
  const nodeOk = maj > 22 || (maj === 22 && min >= 18);
  push({ name: 'node', ok: nodeOk, required: true, detail: `node ${process.versions.node}`, fix: nodeOk ? undefined : '需要 Node ≥ 22.18' });
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
    return finish({ ok: false, root: null, source: null, checks });
  }
  push({ name: 'workspace', ok: true, required: true, detail: `${redactHome(root)}(来源:${source})` });
  // cmd 要能照原样跑:体检时用 --workspace 指的,修的时候也得指
  // 路径写 $HOME/…,和别的字段一样:用户名不传给 agent 的厂商;redactDeep 只换开头,管不到命令中间的路径;sh 与 PowerShell 都展开
  const quoted = `"${redactHome(root)}"`;
  const flag = source === 'flag' ? ` --workspace ${quoted}` : '';
  const refresh = `cotutor refresh${flag}`;

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

  let teachingPack: GradePack | null = null;
  // 补缺的 init:slug 从配置来;年级照已装的写(init 不切换年级);建在缺省位置的不用写 --dir
  const initCmd = (): string | undefined => {
    if (!ws) return undefined;
    const slug = ws.config.kid.slug;
    const grade = teachingPack ? ` --grade ${teachingPack.grade}` : '';
    return `cotutor init ${slug}${grade}${root === join(homedir(), 'cotutor', slug) ? '' : ` --dir ${quoted}`}`;
  };
  try {
    const manifest = await readManifest(root);
    teachingPack = await workspaceGradePack(root);
    push({ name: 'teachingPack', ok: true, required: true, detail: `${teachingPack.grade} 年级教学包 · ${redactHome(teachingPack.dir)}` });
    if (!manifest.teachingPack) push({ name: 'teachingPack.origin', ok: false, required: false, detail: '旧版出厂内容按二年级来源读取,尚未补记;孩子档案不变', fix: 'cotutor refresh 补记来源,保留自定义文件与原 hash', cmd: refresh });
  } catch (err) {
    push({ name: 'teachingPack', ok: false, required: true, detail: (err as Error).message, fix: '检查 .cotutor/shipped.json 的 teachingPack 与本包 grades/;恢复原来源记录或安装包含该年级的版本,不要改成其他年级绕过' });
  }

  // ---- 配置迁移:包更新带来的新出厂件(老师 / 运行时 / 命令模板旗标)不会自己进政策文件,缺了是静默的 ----
  {
    const gaps = await configGapsOf(root);
    push({
      name: 'config.migrate',
      ok: gaps.length === 0,
      required: false,
      detail: gaps.length ? `${gaps.length} 项要改:${gaps.map((g) => g.detail).join(';')}` : 'cotutor.json 有出厂模板里的全部老师、运行时与旗标,也没有不再用的段',
      fix: gaps.length ? 'cotutor refresh --config --dry-run 先看,再 cotutor refresh --config 改(只加缺的、删不再用的出厂段,你改过的值不动)' : undefined,
      cmd: gaps.length ? `cotutor refresh --config${flag}` : undefined,
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
    cmd: missing.length ? initCmd() : undefined,
  });
  // 老布局(2026-10-30 之前):老师文件在 .claude/agents/、技能在 .claude/skills/,现在都读不到了
  const legacy = await legacyLayout(root);
  if (legacy.length) push({ name: 'layout', ok: false, required: true, detail: `${legacy.join(' ')} 是老位置:老师文件现在在 agents/<老师>.md,技能在 ${SKILLS_DIR}/`, fix: 'cotutor refresh(原样挪过去,不改内容;新位置已有同名的不挪、会点名)', cmd: refresh });
  // 家规(根的 QWEN.md)2026-09-15 起不出厂:有就是家长自建的共同规矩,提一句;没有不缺
  const rulesThere = (await Promise.all(['QWEN.md'].map(async (f) => ((await statOrNull(join(root, f))) ? f : null)))).filter(Boolean);
  push({ name: 'rules', ok: true, required: false, detail: rulesThere.length ? `家长自建的家规 ${rulesThere.join(' ')} 在,所有老师每轮都读` : '没有根目录的 QWEN.md(不需要:老师要知道的都在老师文件与技能里)' });

  if (ws) {
    // ---- 老师:定义文件(拷贝)+ 名字一致 + 出厂 / 自定义状态 + 老师目录 ----
    // 老师文件只有 agents/<name>.md 这一份:应用读正文递进系统提示
    const statuses = new Map((teachingPack ? await tutorStatuses(root) : []).map((s) => [s.name, s]));
    for (const name of Object.keys(ws.config.tutors)) {
      const shipped = statuses.has(name);
      const file = tutorFilePath(ws.dirs.agents, name);
      let detail: string;
      let ok = false;
      try {
        const { frontmatter } = parseAgentFile(await readFile(file, 'utf8'));
        ok = frontmatter.name === name;
        detail = ok ? `${redactHome(file)} name 一致` : `${redactHome(file)} 的 frontmatter name 是 "${frontmatter.name ?? ''}",与老师键 ${name} 不一致`;
      } catch {
        detail = `${redactHome(file)} 读不到`;
      }
      push({
        name: `tutor.${name}.file`,
        ok,
        required: true,
        detail,
        fix: ok
          ? undefined
          : shipped
            ? `cotutor init 补拷(拷自本包 agents/${name}.md),或把老师键改成文件里的 name`
            : `这是自家加的老师:写 agents/${name}.md(frontmatter name: ${name}),cotutor add ${name} --display <显示名> 可出模板;或把 cotutor.json 里这条删掉`,
        cmd: !ok && shipped ? initCmd() : undefined,
      });
      const st = statuses.get(name);
      if (!st) push({ name: `tutor.${name}.origin`, ok: true, required: false, detail: teachingPack ? '自家加的老师(不是出厂件,refresh 不碰)' : '出厂来源无法确认,先修复 teachingPack 检查项' });
      if (st) {
        const label: Record<string, string> = { latest: '出厂件,最新', upgradable: `出厂件,基于 ${st.basedOn},包已更新`, custom: `自定义(基于 ${st.basedOn})`, untracked: '自定义(没有出厂记录)', missing: '缺', broken: '读不到' };
        push({
          name: `tutor.${name}.origin`,
          ok: st.state !== 'upgradable',
          required: false,
          detail: label[st.state],
          fix: st.state === 'upgradable' ? 'cotutor refresh 换新版' : undefined,
          cmd: st.state === 'upgradable' ? refresh : undefined,
        });
      }
      const home = join(ws.dirs.agents, name);
      const there = (await statOrNull(home))?.isDirectory() ?? false;
      push({ name: `tutor.${name}.home`, ok: there, required: true, detail: there ? `agents/${name}/ 在(会话 cwd)` : `agents/${name}/ 不在`, fix: there ? undefined : 'cotutor init 补建', cmd: there ? undefined : initCmd() });
      // 音色:一老师一音色走 API 是正路;没配的孩子端只剩浏览器合成声(只该在测试里);hidden 的老师不对孩子说话,不用音色
      const tc = ws.config.tutors[name];
      if (tc.enabled && !tc.hidden && !cardVoice(ws.config.tutors, name)) push({ name: `tutor.${name}.voice`, ok: false, required: false, detail: `${tc.display} 没配音色(cotutor.json tutors.${name}.voice),卡上的声音(点读卡、单词卡)配不了——只适合测试`, fix: '家长端「首页」点这位老师的「样子与声音」挑一个' });
      // 卡的清单(《卡片协议.md》「谁拿到哪些卡」):有脸的老师才递板书写法;只是报一声讲哪几种
      if (takesTutorRules(name)) {
        const kinds = tutorCardKinds(tc.cards);
        push({ name: `tutor.${name}.cards`, ok: true, required: false, detail: kinds ? `板书写法讲 ${kinds.join(' ')}` : `没写 cards,板书写法讲全部 ${kindsFor('board').length} 种` });
      }
      // 头像是图片路径时(figshot 写的 avatars/<name>.png)查文件在不在、在不在根以内;emoji 不查
      if (tc.avatar && /\.(png|jpe?g|webp|gif|svg)$/i.test(tc.avatar)) {
        const file = resolve(root, tc.avatar);
        const inside = !tc.avatar.startsWith('/') && file.startsWith(root + sep);
        const there = inside && ((await statOrNull(file))?.isFile() ?? false);
        push({ name: `tutor.${name}.avatar`, ok: there, required: false, detail: there ? `头像 ${tc.avatar}` : inside ? `头像 ${tc.avatar} 不在,孩子端退回显示首字` : `头像 ${tc.avatar} 在 workspace 根之外,页面不给`, fix: there ? undefined : `figshot pick --workspace ${redactHome(root)} 存一张,或把 cotutor.json 的 tutors.${name}.avatar 改回 emoji` });
      }
    }

    if (process.platform === 'win32' && (opts.firewall ?? probeEnv)) {
      // 平板连不连得进来:Windows 只在第一次监听时问一次「允许访问」,点了取消就再也连不上(firewall.ts)
      const { judgeFirewall, probeFirewall } = await import('./firewall.ts');
      const port = opts.port ?? ws.config.server.port;
      const state = await probeFirewall(port);
      if (state) {
        const v = judgeFirewall(state, port, process.execPath);
        push({ name: 'firewall', ok: v.ok, required: false, detail: v.detail, fix: v.fix });
      }
    }

    if (probeEnv) {
      // 端口起不起得来:被别的程序占了,后台服务只在日志里写一句就不起了(serve 自己要绑,它起来时不查这项)
      const { probeHealth, realHost } = await import('./service.ts');
      const { portHolder, portState } = await import('./port.ts');
      const port = opts.port ?? ws.config.server.port;
      const fix = '腾出这个端口;或改 cotutor.json 的 server.port,平板要重新扫码、重加主屏幕图标';
      const running = await probeHealth(port);
      if (running) {
        push({ name: 'server.port', ok: true, required: false, detail: `端口 ${port} 上 cotutor 在答应` });
        // 配好了不等于用得了:欠费、key 失效是跑起来才知道的,问在跑的那个服务
        if (running.bailianTrouble) push({ name: 'bailian.runtime', ok: false, required: false, detail: `${running.bailianTrouble.message}(${running.bailianTrouble.why ?? ''})`, fix: running.bailianTrouble.fix });
      } else {
        const state = await portState(port);
        if (state === 'free') push({ name: 'server.port', ok: true, required: false, detail: `端口 ${port} 空着,起得来` });
        else if (state === 'denied') push({ name: 'server.port', ok: false, required: false, detail: `系统不让这个用户监听端口 ${port},服务起不来`, fix });
        else {
          const p = await portHolder(realHost(), port);
          push({ name: 'server.port', ok: false, required: false, detail: `端口 ${port} 被占着${p ? `:${p.name}(pid ${p.pid})在用` : ''},服务起不来`, fix });
        }
      }
    }

    {
      // 舞台包:小课堂 / 画板卡要它;没有只是重卡打不开,轻卡与对话照常。做课包(cotutor chalk bake / snap)与服务端烤画面也开它,在本机的 Chrome 里
      const { stageBuilt } = await import('../http/stage.ts');
      const built = stageBuilt();
      push({ name: 'stage.bundle', ok: built, required: false, detail: built ? 'dist/stage/ 在(舞台包:小课堂与画板卡的舞台)' : 'dist/stage/ 不在,小课堂与画板卡的舞台打不开(轻卡照常)', fix: built ? undefined : '仓库根 pnpm run build:stage(npm 装的包自带)' });
      const { chromePath } = await import('./chalk/browser.ts');
      const chrome = chromePath(env);
      push({ name: 'chalk.chrome', ok: chrome !== null, required: false, detail: chrome ? `本机的浏览器在(${redactHome(chrome)}):做课包截图、烤画面用它` : '找不到 Chrome:cotutor chalk bake / snap 做不了,没烤过的课包孩子端在浏览器里现画(慢、iPad 上可能不顺)', fix: chrome ? undefined : '装 Google Chrome,或环境变量 CHROME 指到 Chrome / Chromium / Edge 的可执行文件' });
      const { CLAUDE_SKILLS_LINK, skillStatuses } = await import('./skills.ts');
      for (const sk of teachingPack ? await skillStatuses(root) : []) {
        const label: Record<string, string> = { latest: sk.machine ? '机器件,最新' : '出厂件,最新', upgradable: sk.machine ? '机器件,和包里不一样(改过或包已更新)' : `出厂件,基于 ${sk.basedOn},包已更新`, custom: `自定义(基于 ${sk.basedOn})`, untracked: '自定义(没有出厂记录)', missing: sk.machine ? '缺(机器件,老师或家长的技能靠它)' : '缺' };
        push({ name: `skill.${sk.name}`, ok: sk.state !== 'missing' && sk.state !== 'upgradable', required: Boolean(sk.machine), detail: `${SKILLS_DIR}/${sk.name}/:${label[sk.state]}`, fix: sk.state === 'missing' ? 'cotutor init 补拷' : sk.state === 'upgradable' ? 'cotutor refresh 换新版' : undefined, cmd: sk.state === 'missing' ? initCmd() : sk.state === 'upgradable' ? refresh : undefined });
      }
      // Claude Code 只认 .claude/skills:那里该是指向 .agents/skills 的链;老师用不到,家长在 workspace 里用 Claude Code 才要
      const linked = (await lstat(join(root, CLAUDE_SKILLS_LINK)).catch(() => null))?.isSymbolicLink() ?? false;
      push({ name: 'skills.claude', ok: linked, required: false, detail: linked ? `${CLAUDE_SKILLS_LINK} 链到 ${SKILLS_DIR}(Claude Code 读的是同一份)` : `${CLAUDE_SKILLS_LINK} 不是链,在 workspace 里用 Claude Code 看不到 ${SKILLS_DIR}/ 的技能`, fix: linked ? undefined : 'cotutor refresh 建链(是实体目录的话先把里面的挪进 .agents/skills/ 再删掉)', cmd: linked ? undefined : refresh });
      // ---- activity:老师的家里 agents/<老师>/activities/<名>.md;出厂的看新旧,每份都过一遍 activity check ----
      {
        const { activityStatuses, checkActivities } = await import('./activities.ts');
        const states = new Map((teachingPack ? await activityStatuses(root) : []).map((s) => [s.key, s]));
        const label: Record<string, string> = { latest: '出厂件,最新', upgradable: '出厂件,包已更新', custom: '自定义', untracked: '自定义(没有出厂记录)', missing: '缺', broken: '读不到' };
        for (const s of states.values()) if (s.state === 'missing') push({ name: `activity.${s.key}`, ok: false, required: false, detail: `agents/${s.key.replace('/', '/activities/')}.md 不在`, fix: 'cotutor init 补拷', cmd: initCmd() });
        // 学科色:手改 cotutor.json 写的颜色,新话题气泡的白字要压得住
        for (const [name, t] of Object.entries(ws.config.tutors)) {
          if (!t.color) continue;
          const cr = contrastWithWhite(t.color);
          if (cr < MIN_CONTRAST) push({ name: `tutors.${name}.color`, ok: false, required: false, detail: `${t.display}的学科色 ${t.color} 太浅:白字对比度 ${cr.toFixed(2)},要 ${MIN_CONTRAST} 以上,新话题气泡上的字看不清`, fix: `在工作台「老师团」里点一个色块,或删掉 cotutor.json 的 tutors.${name}.color 用自动的` });
        }
        for (const r of await checkActivities(root, ws.config.tutors)) {
          const key = `${r.tutor}/${r.name}`;
          // 老 workspace 改过老师文件:refresh 只报 diff,里面同名那节还在,两处说法会打架
          const agentText = await readFile(tutorFilePath(ws.dirs.agents, r.tutor), 'utf8').catch(() => '');
          if (new RegExp(`^#{2,4}\\s*${r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(agentText)) push({ name: `activity.${key}.dup`, ok: false, required: false, detail: `agents/${r.tutor}.md 里还有一节「${r.name}」,和 activity 文件两处说法会打架`, fix: `删掉老师文件里那一节(做法以 agents/${r.tutor}/activities/${r.name}.md 为准)` });
          const st = states.get(key);
          const fixes = r.issues.filter((i) => i.level === 'fix');
          const origin = st ? label[st.state] + (st.basedOn && st.state !== 'latest' ? `(基于 ${st.basedOn})` : '') : teachingPack ? '自家写的' : '出厂来源无法确认';
          push({
            name: `activity.${key}`,
            ok: !fixes.length && st?.state !== 'upgradable',
            required: false,
            detail: fixes.length ? `${origin};${fixes.length} 条要改,第一条:${fixes[0].line ? `第 ${fixes[0].line} 行 ` : ''}${fixes[0].text}` : origin,
            fix: fixes.length ? `cotutor activity check ${r.tutor} ${r.name} 看全` : st?.state === 'upgradable' ? 'cotutor refresh 换新版' : undefined,
            cmd: !fixes.length && st?.state === 'upgradable' ? refresh : undefined,
          });
        }
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
          push({ name: 'theme.manifest', ok: false, required: false, detail: `themes/${name}/ 用不了(服务退回出厂 default):${err instanceof Error ? err.message : String(err)}`, fix: name === 'default' ? 'cotutor init 补拷(已有的不动)或 cotutor refresh' : `修 themes/${name}/theme.json 与 kid.css,或把 cotutor.json 的 kid.theme 改回 default`, cmd: name === 'default' ? initCmd() : undefined });
        }
        for (const th of teachingPack ? await themeStatuses(root) : []) {
          if (!th.shipped) {
            push({ name: `theme.${th.name}.origin`, ok: true, required: false, detail: `themes/${th.name}/:自家的主题(不是出厂件,refresh 不碰)` });
            continue;
          }
          const label: Record<string, string> = { latest: '出厂件,最新', upgradable: `出厂件,基于 ${th.basedOn},包已更新`, custom: `自定义(基于 ${th.basedOn})`, untracked: '自定义(没有出厂记录)', missing: '缺' };
          push({ name: `theme.${th.name}.origin`, ok: th.state !== 'missing' && th.state !== 'upgradable', required: false, detail: `themes/${th.name}/:${label[th.state]}`, fix: th.state === 'missing' ? 'cotutor init 补拷' : th.state === 'upgradable' ? 'cotutor refresh 换新版' : undefined, cmd: th.state === 'missing' ? initCmd() : th.state === 'upgradable' ? refresh : undefined });
        }
      }
    }

    // ---- 首页:没发布 = 缺省首页;坏了孩子端退回缺省;超过 3 天提醒;引用坏了的按钮孩子端不出现 ----
    {
      const { daysSince, publishedIssues, readPublished } = await import('../../runtime/home/store.ts');
      const now = opts.now ?? new Date();
      const { home, error } = await readPublished(ws);
      if (error) push({ name: 'home.published', ok: false, required: false, detail: `${error};孩子端退回缺省首页`, fix: '用 cotutor-home 技能排一份再 cotutor home publish,或删掉 home/published.json' });
      else if (!home) push({ name: 'home.published', ok: true, required: false, detail: '没发布过首页:孩子端是缺省首页(每位老师一张只有「新话题」的卡)' });
      else {
        const days = daysSince(home, now);
        push({ name: 'home.published', ok: days <= 3, required: false, detail: `已发布 ${home.id}(${days === 0 ? '今天' : `${days} 天前`})· ${home.cards.length} 张卡`, fix: days > 3 ? '首页是好几天前的:孩子学完后在 workspace 根开编程助手,用 cotutor-home 技能排一份新的' : undefined });
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

    // ---- vault 与 workspace 分开(2026-11-09):旧版 init 不写 paths.vault,vault 就是 workspace 根;照旧能用,这里说怎么分。sandbox 的 vault 本来就拷在里面,不查 ----
    if (!ws.sandbox) {
      const vault = ws.paths.vault;
      const separate = vaultSeparate(ws.root, vault);
      const rootInVault = !separate && !isInside(vault, ws.root);
      push({
        name: 'vault.separate',
        ok: separate,
        required: false,
        detail: separate ? `笔记文件夹(vault)在 ${redactHome(vault)},和 cotutor 文件夹分开` : rootInVault ? `孩子的 cotutor 文件夹在笔记文件夹(${redactHome(vault)})里面` : vault === ws.root ? '笔记文件夹(vault)就是孩子的 cotutor 文件夹(旧版 init 的布局):照旧能用,但用 Obsidian 打开满是程序的文件,恢复备份会连家长的笔记一起换掉' : `笔记文件夹(vault)在孩子的 cotutor 文件夹里(${redactHome(vault)})`,
        fix: separate ? undefined : rootInVault
          ? '把孩子的 cotutor 文件夹挪到笔记文件夹外面(挪了要再 cotutor service install),或者笔记文件夹换一个地方'
          : `想分开:cotutor service stop,建笔记文件夹 ${homePath(defaultVaultOf(ws.root))},把档案、日记/、记忆/、计划/、教材/、参考/ 和你自己的笔记挪过去,cotutor.json 的 paths.vault 写成它,再 cotutor service start`,
      });
    }

    // ---- vault(《obsidian仓库设计.md》2026-09-17):档案与每位老师的入口文件按 frontmatter 找,原文整篇进上下文包 ----
    {
      const { notes, files } = await scanVault(ws);
      const today = localDate(opts.now ?? new Date());
      const base = pickNotes(notes, files, { date: today });
      const currentGrade = gradeOfSemester(base.semester);
      if (teachingPack && base.semester) push({
        name: 'teachingPack.grade', ok: currentGrade === teachingPack.grade, required: false,
        detail: `档案学期 ${base.semester};已安装 ${teachingPack.grade} 年级教学包`,
        fix: currentGrade === teachingPack.grade ? undefined : '核对档案学期与教学内容;升年级不会自动换文件。用 cotutor grades 查看可用年级,可自行调整教学文件或贡献相应年级包',
      });
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
        // 入口文件是可选的(2026-10-30):配置都对、只是没写,算过,detail 里说一句可以怎么写;没配 subject、算不出学期才不过
        const optional = !p.entry && !!t.subject && !!p.semester && !!where;
        push({
          name: `vault.entry.${t.name}`,
          ok: optional || (!!p.entry && !big && !p.extraEntries.length),
          required: false,
          detail: p.entry ? `${p.entry.path}(${p.entry.text.length} 字${big ? `,超过 ${limit},会截断` : ''})${p.refs.length ? ` · 参考 ${p.refs.length} 篇` : ''}${p.extraEntries.length ? ` · 另有 ${p.extraEntries.join('、')} 没用` : ''}` : optional ? `没有(可选):想写这学期${t.subject}的情况,建 ${where},frontmatter 写 cotutor: subject、subject: ${t.subject}、semester: ${p.semester}` : missingEntry(t.subject, p),
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

    // ---- 家长端与工作台的锁(src/app/http/access.ts):机器级 PIN;没设不算错,提一句 ----
    const pin = await readPin();
    push({ name: 'server.access', ok: pin !== null, required: false, detail: pin ? '已设 PIN' : '家长端、工作台没上锁', fix: pin ? undefined : 'cotutor pin' });

    // ---- HTTPS:iPad 上录音要;没有只提醒 ----
    const tls = httpsFiles(ws);
    const { mkcertHint, mkcertReady } = await import('./cert.ts');
    // 根证书建过了,签证书就不用人了;这台电脑信任根证书(trustCommand)要人输密码或点弹窗,不在这里
    const canSign = !tls && probeEnv && await mkcertReady();
    push({ name: 'https', ok: tls !== null, required: false, detail: tls ? `${redactHome(tls.cert)}` : '没有证书,serve 走 HTTP(平板、手机上按住说话不可用)', fix: tls ? undefined : `cotutor cert(需要 mkcert:${mkcertHint()}),签完 cotutor service restart`, cmd: canSign ? 'cotutor cert' : undefined });

    // ---- 百炼:老师靠实时模型开口,没配孩子端打不开;--live 真试连一次(握手就挂,不花钱) ----
    // key 只认 ~/.config/cotutor/(2026-11-02 起);shell 里还 export 着旧的,说一句免得以为配了
    const bl = dashscopeAuth(env);
    const oldEnv = env.DASHSCOPE_API_KEY ? '(环境变量 DASHSCOPE_API_KEY 已经不读了)' : '';
    push({ name: 'bailian', ok: Boolean(bl), required: true, detail: bl ? `百炼按量 key …${bl.key.slice(-4)}、业务空间 ${bl.workspaceId}` : `没有百炼按量的 key 或业务空间 id:孩子端打不开(只出「老师们还没到」)${oldEnv}`, fix: bl ? undefined : '家长端「首页」里配(在这台电脑上开,或者先 cotutor pin 设家长密码),存在 ~/.config/cotutor/bailian.json' });
    // Token Plan 只有开发机有,没有就不提
    const plan = tokenPlanKey(env.HOME || homedir());
    if (plan) push({ name: 'token-plan', ok: isPlanKey(plan), required: false, detail: isPlanKey(plan) ? `Token Plan key …${plan.slice(-4)}:Token Plan 有的模型先走它` : 'token-plan.json 里的 key 不是 sk-sp- 开头,不认', fix: isPlanKey(plan) ? undefined : '换成千问 Token Plan 的 key,或删掉 ~/.config/cotutor/token-plan.json' });
    else if (env.QWENCLOUD_TOKEN_PLAN_API_KEY) push({ name: 'token-plan', ok: false, required: false, detail: '环境变量 QWENCLOUD_TOKEN_PLAN_API_KEY 已经不读了,全走百炼按量', fix: '写进 ~/.config/cotutor/token-plan.json:{"apiKey": "sk-sp-…"}' });
    if (bl && opts.live) {
      const { probeRealtime } = await import('../../realtime/preview.ts');
      const { probeMessage } = await import('../machine/bailian.ts');
      const why = await probeRealtime({ env, model: ws.config.live.model });
      push({ name: 'live.bailian', ok: why === null, required: true, detail: why === null ? '试连百炼实时模型:通' : probeMessage(why), fix: why === null ? undefined : '家长端「首页」里换一把 key,或查百炼控制台的余额与业务空间' });
    }
    // 卡的配音(点读段、单词、听写念的词):应用直连百炼合成,看 key 与业务空间齐不齐;--live 真合成一句(live.tts)
    const tt = ttsTarget(TTS_MODEL, env);
    push({ name: 'tts', ok: !('error' in tt), required: false, detail: 'error' in tt ? `卡不配音(点读、单词卡没有声音):${tt.error}` : `卡的配音走${tt.plan ? ' Token Plan' : '百炼按量'};老师配了 voice 的,点读段、单词会配音`, fix: 'error' in tt ? '家长端「首页」里填百炼' : undefined });

    // ---- 实时老师的嘴:音色写错了连接照样连得上,第一次开口才报错,孩子那边嘴一直不出声 ----
    const lv = ws.config.live;
    {
      const bad = Object.entries(lv.voices).filter(([, v]) => !isRealtimeVoice(v));
      const who = listTutors(ws.config, { kidOnly: true }).map((t) => `${t.name} 用 ${mouthVoice(lv, t.name)}`).join('、') || '没有有脸的老师';
      push({ name: 'live.voices', ok: !bad.length, required: false, detail: bad.length ? `${bad.map(([t, v]) => `${t} 的「${v}」`).join('、')}:这个模型不认,嘴会一直不出声` : `嘴的音色:${who}`, fix: bad.length ? '家长端首页的「样子与声音」里换一个说话的声音,或改 cotutor.json 的 live.voices' : undefined });
    }

    // 旧配置里的命令行运行时(Qwen Code 等)读得进来,用不了:用到它的老师发不出去
    const usedRuntimes = new Set([ws.config.runtimes.default, ...Object.values(ws.config.tutors).filter((t) => t.enabled).map((t) => t.runtime ?? ws.config.runtimes.default)]);
    for (const [name, rt] of Object.entries(ws.config.runtimes)) {
      if (typeof rt === 'string' || isApiRuntime(rt)) continue;
      const issue = runtimeIssue(rt);
      if (issue) push({ name: `runtime.${name}`, ok: false, required: usedRuntimes.has(name), detail: issue, fix: '按 README.md 的「旧 workspace 换运行时」说明改' });
    }

    // ---- 运行时:API 的走哪条线 ----
    if (probeEnv) {
      for (const [runtime, p] of Object.entries(ws.config.runtimes)) {
        if (runtime === 'default' || typeof p === 'string' || !isApiRuntime(p)) continue;
        const via = compatibleLine(p.model, env)?.plan ? '走 Token Plan' : '走百炼按量';
        push({ name: `runtime.${runtime}`, ok: true, required: usedRuntimes.has(runtime), detail: `API 运行时(${p.model},${via});凭证看 bailian 那条` });
      }
    }
  }

  if (ws && opts.live) await probeLive(ws, push, env);

  // ---- 后台服务(cotutor service):装了没有、写死的 node 与 bin 还在不在;接着电源会不会闲置睡眠(睡着时平板连不上) ----
  if (probeEnv && root && (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32')) {
    const { findService, realHost } = await import('./service.ts');
    const s = await findService({ ...realHost(), env }, root).catch(() => null);
    if (s) {
      // 菜单栏 / 任务栏图标:家长不开终端看状态靠它;家长自己关掉的不提
      const { trayStatus, traySupported } = await import('./tray.ts');
      if (traySupported(process.platform)) {
        const t = await trayStatus({ ...realHost(), env }).catch(() => null);
        if (t && !t.off) push({ name: 'tray', ok: t.installed, required: false, detail: t.installed ? `托盘图标装了${t.running ? ',在跑' : ',现在没在跑(点过退出,下次登录回来)'}` : '没装托盘图标:看状态只能开终端', fix: t.installed ? undefined : 'cotutor tray on', cmd: t.installed ? undefined : 'cotutor tray on' });
      }
    }
    if (!s) push({ name: 'service', ok: false, required: false, detail: '没装后台服务:在终端里跑的 cotutor serve,关了终端就停', fix: 'cotutor service install(登录后自己起来、崩了自己再起)', cmd: `cotutor service install --no-open${flag}` });
    else {
      const { stableNode } = await import('./service.ts');
      const gone = s.args.slice(0, 2).filter((f) => !existsSync(f));
      // 还没坏,但 brew upgrade 以后就坏了,而且坏的时候图标也起不来,没人报警
      if (!gone.length && stableNode(s.args[0]) !== s.args[0]) push({ name: 'service.node', ok: false, required: false, detail: `后台服务写死了带版本号的 node(${redactHome(s.args[0])}),brew upgrade 以后服务和图标都起不来`, fix: 'cotutor service install(换成不带版本号的路径)', cmd: `cotutor service install --no-open${flag}` });
      push({ name: 'service', ok: !gone.length, required: false, detail: gone.length ? `后台服务 ${s.label} 指的 ${gone.map((f) => redactHome(f)).join('、')} 不在了(换了 node 版本、包挪了地方)` : `后台服务 ${s.label}(cotutor service status 看在不在跑)`, fix: gone.length ? 'cotutor service install(照现在的 node 与包重写一遍)' : undefined, cmd: gone.length ? `cotutor service install${flag}` : undefined });
    }
  }
  if (probeEnv && process.platform === 'darwin') {
    const { acSleepMinutes } = await import('./service.ts');
    const { execFile } = await import('node:child_process');
    const text = await new Promise<string>((resolve) => execFile('/usr/bin/pmset', ['-g', 'custom'], { timeout: 5000, encoding: 'utf8' }, (_e, out) => resolve(String(out ?? ''))));
    const min = acSleepMinutes(text);
    if (min !== null) push({ name: 'mac.sleep', ok: min === 0, required: false, detail: min === 0 ? '接着电源时不闲置睡眠' : `接着电源 ${min} 分钟没人碰就睡,睡着时平板连不上(有通话时 cotutor 拦着它睡,别的时候拦不了)`, fix: min === 0 ? undefined : '系统设置 › 电池 › 选项,打开「显示器关闭时,防止接通电源的 Mac 自动进入睡眠」(台式 Mac 在 系统设置 › 节能);合盖照样睡' });
  }
  if (probeEnv && process.platform === 'win32') {
    const { winAcSleepSeconds } = await import('./service-windows.ts');
    const { execFile } = await import('node:child_process');
    const text = await new Promise<string>((resolve) => execFile('powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE'], { timeout: 5000, encoding: 'latin1', windowsHide: true }, (_e, out) => resolve(String(out ?? ''))));
    const sec = winAcSleepSeconds(text);
    if (sec !== null) push({ name: 'windows.sleep', ok: sec === 0, required: false, detail: sec === 0 ? '接着电源时不闲置睡眠' : `接着电源 ${Math.round(sec / 60)} 分钟没人碰就睡,睡着时平板连不上(有通话时 cotutor 拦着它睡,别的时候拦不了)`, fix: sec === 0 ? undefined : '设置 › 系统 › 电源和电池 › 屏幕、睡眠和休眠超时,「插入电源时,使设备在以下时间后进入睡眠状态」选「从不」;合盖看「电源按钮和盖子」那一项' });
  }

  // ---- 备份:服务开着时每天一份;好几天没有说明服务没在跑、或者备份一直失败(磁盘满、读不了) ----
  if (probeEnv && ws && !ws.sandbox) {
    const { backupsOf, listBackups } = await import('./backup.ts');
    const list = await listBackups(root).catch(() => []);
    const last = list[0];
    const ageMs = last ? (opts.now ?? new Date()).getTime() - Date.parse(last.at) : Number.POSITIVE_INFINITY;
    push({ name: 'backup', ok: ageMs < 3 * 24 * 3600_000, required: false, detail: last ? `最近一份 ${last.at.slice(0, 10)},共 ${list.length} 份(${redactHome(backupsOf(root))})` : '还没有备份', fix: 'cotutor backup 备一份;服务开着时每天自己备', cmd: `cotutor backup${flag}` });
  }

  // ---- 有没有新版本:只看服务问来存下的那份,体检不上网;什么时候升级家长定(要重起服务,孩子可能在上课),所以没有 cmd ----
  {
    const { readUpdateRecord } = await import('../machine/update.ts');
    const u = await readUpdateRecord();
    if (!u.off && isNewer(u.latest, BUILD.version)) push({ name: 'update', ok: false, required: false, detail: `有新版本 ${u.latest}(现在是 ${BUILD.version})`, fix: `挑孩子不用的时候,运行:${upgradeSteps().join(' ; ')}` });
  }

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

  // sandbox(--sandbox 分出来的试用 workspace)随时能重新分,不要 git;说一句它是从哪分出来的
  if (ws?.sandbox) push({ name: 'sandbox', ok: true, required: false, detail: `试用 workspace:${ws.sandbox.forkedAt.slice(0, 10)} 从 ${redactHome(ws.sandbox.from)} 分出来;--sandbox --fresh 重新分` });
  else {
    const gitThere = (await statOrNull(join(root, '.git'))) !== null;
    push({ name: 'git', ok: gitThere, required: false, detail: gitThere ? 'workspace是 git 仓' : 'workspace不在 git 里', fix: gitThere ? undefined : '建议 git init:老师记忆、账本、政策都是不可再生状态', cmd: gitThere ? undefined : `git init ${quoted}` });
  }

  return finish({ ok: checks.filter((c) => c.required).every((c) => c.ok), root, source, checks });
}
