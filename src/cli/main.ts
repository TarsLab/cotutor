/**
 * cotutor CLI 入口。命令:init / doctor / serve;全局 --workspace <dir>、--json。
 * exit:0 通过 / 1 体检不过 / 2 用法错误 / 4 内部错误。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { doctorWorkspace } from './doctor.ts';
import { initWorkspace } from './init.ts';
import { makeCert } from './cert.ts';
import { addTutorFile, upgradeTutors } from './tutors.ts';
import { configGapsOf, upgradeConfig } from './migrate.ts';
import { portBusy } from './rename.ts';
import { upgradeSkills, writeToolShim } from './skills.ts';
import { addTheme, upgradeThemes } from './themes.ts';
import { patchConfig } from '../server/store.ts';
import { resolveRoot } from './workspace.ts';
import { serveWorkspace } from './serve.ts';
import { serveMock, type MockScenario } from '../server/mock.ts';
import { UsageError, loadWorkspace, redactDeep, redactHome, workspaceReport } from './workspace.ts';
import { USAGE } from './usage.ts';
import { createContext } from '../server/app.ts';
import { MESSAGE_FROM, type MessageFrom } from '../schema/index.ts';
import { formatEvent, laneFilter, parseEvents } from '../lib/events.ts';
import { localDate } from '../lib/conversation.ts';
import { rateThread } from '../server/store.ts';


function version(): string {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string };
  return pkg.version;
}

interface Parsed {
  cmd: string | undefined;
  positionals: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[], valued: string[]): Parsed {
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];
  let cmd: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (valued.includes(key)) {
        const next = argv[i + 1];
        // --force 的值可省:upgrade --force <老师>,home publish --force
        if ((next === undefined || next.startsWith('--')) && key === 'force') {
          flags[key] = true;
          continue;
        }
        if (next === undefined || next.startsWith('--')) throw new UsageError(`选项 --${key} 需要一个值。\n${USAGE}`);
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else if (cmd === undefined) cmd = a;
    else positionals.push(a);
  }
  return { cmd, positionals, flags };
}

/** 扫码页那一行(地址独占行尾:后面紧跟全角括号的话,终端不把它认成链接);--open-qr 顺手用默认浏览器打开(各系统各自的打开命令,失败不吭声) */
async function printQr(page: string, open: boolean): Promise<void> {
  process.stdout.write(`  扫码页 ${page}\n         在这台电脑上打开,iPad / iPhone 用相机扫;--open-qr 顺手打开\n`);
  if (!open) return;
  const { spawn } = await import('node:child_process');
  const [cmd, args] = process.platform === 'darwin' ? ['open', [page]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', page]] : ['xdg-open', [page]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

export async function main(argv: string[]): Promise<void> {
  let json = false;
  try {
    const { cmd, positionals, flags } = parseArgs(argv, ['workspace', 'dir', 'name', 'port', 'from', 'runtime', 'force', 'display', 'subject', 'avatar', 'description', 'scenario', 'delay', 'lane', 'job', 'date', 'thread', 'at']);
    json = flags.json === true;
    const workspace = typeof flags.workspace === 'string' ? flags.workspace : undefined;
    // --version / --help 是旗标不是命令,parseArgs 把它们收进 flags,cmd 拿不到,所以在 switch 前处理
    if (flags.version === true || cmd === '-v') {
      process.stdout.write(`${version()}\n`);
      return;
    }
    if (flags.help === true || cmd === undefined || cmd === '-h') {
      process.stdout.write(USAGE);
      return;
    }
    switch (cmd) {
      case 'init': {
        const slug = positionals[0];
        if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new UsageError(`init 需要一个 slug(小写字母数字连字符,是短名不是真名),如 cotutor init ming。\n${USAGE}`);
        const port = typeof flags.port === 'string' ? Number(flags.port) : undefined;
        if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new UsageError('--port 要是 1–65535 的整数');
        const r = await initWorkspace({ slug, dir: typeof flags.dir === 'string' ? flags.dir : undefined, name: typeof flags.name === 'string' ? flags.name : undefined, port });
        if (json) process.stdout.write(`${JSON.stringify(redactDeep(r), null, 2)}\n`);
        else {
          process.stdout.write(`cotutor init → ${redactHome(r.root)}\n`);
          for (const s of r.steps) process.stdout.write(`  ${s.action.padEnd(7)} ${s.item}${s.note ? `  (${s.note})` : ''}\n`);
          process.stdout.write('下一步:\n');
          for (const s of r.suggestions) process.stdout.write(`  - ${s}\n`);
        }
        return;
      }
      case 'doctor': {
        const r = await doctorWorkspace(workspace, { live: flags.live === true });
        if (json) process.stdout.write(`${JSON.stringify(redactDeep(r), null, 2)}\n`);
        else {
          for (const c of r.checks) {
            process.stdout.write(`${c.ok ? '✓' : c.required ? '✗' : '!'} ${c.name.padEnd(28)} ${c.detail}\n`);
            if (!c.ok && c.fix) process.stdout.write(`    修复:${c.fix}\n`);
          }
          process.stdout.write(r.ok ? '体检通过\n' : '体检不过(✗ 是必需项)\n');
        }
        if (!r.ok) process.exitCode = 1;
        return;
      }
      case 'serve': {
        const port = typeof flags.port === 'string' ? Number(flags.port) : undefined;
        const r = await serveWorkspace({ workspace, port, http: flags.http === true });
        if (flags.trace === true) {
          const keep = laneFilter(typeof flags.lane === 'string' ? flags.lane : undefined);
          r.ctx.runner.onEvent((e) => { if (keep(e.event)) process.stdout.write(`${e.tutor} ${e.job} ${formatEvent(e.event)}\n`); });
        }
        process.stdout.write(`cotutor serve ${JSON.stringify(workspaceReport(r.ws))}\n`);
        for (const w of r.warnings) process.stdout.write(`  ! ${w}\n`);
        if (!r.https) process.stdout.write('  ! HTTP:iPad / iPhone 上按住说话要 HTTPS;cotutor cert 建证书后重启即走 HTTPS\n');
        for (const u of r.urls) process.stdout.write(`  ${u}\n`);
        process.stdout.write(`  孩子端 /,家长端 /parent,工作台 /dev(设置、老师团、看原文)\n`);
        await printQr(r.qrPage, flags['open-qr'] === true);
        return;
      }
      case 'mock': {
        const port = typeof flags.port === 'string' ? Number(flags.port) : undefined;
        if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new UsageError('--port 要是 1–65535 的整数');
        const scenario = typeof flags.scenario === 'string' ? flags.scenario : 'normal';
        if (!['normal', 'limit', 'offline', 'nopost'].includes(scenario)) throw new UsageError('--scenario 只能是 normal / limit / offline / nopost');
        const delayMs = typeof flags.delay === 'string' ? Number(flags.delay) : undefined;
        if (delayMs !== undefined && !(Number.isInteger(delayMs) && delayMs >= 0)) throw new UsageError('--delay 要是非负整数(毫秒)');
        const r = await serveMock({ port, scenario: scenario as MockScenario, delayMs, http: flags.http === true });
        process.stdout.write(`cotutor mock 场景 ${scenario}(不经真实老师与配音;配音退回浏览器合成声)\n`);
        if (!r.https) process.stdout.write('  ! HTTP:iPad / iPhone 上按住说话要 HTTPS;cotutor cert 建证书后重启即走 HTTPS\n');
        for (const u of r.urls) process.stdout.write(`  ${u}\n`);
        process.stdout.write('  孩子端 /,家长端 /parent;直接开某位老师并停在某句:/?tutor=chinese-tutor&step=0.3\n');
        await printQr(r.qrPage, flags['open-qr'] === true);
        return;
      }
      case 'add': {
        const name = positionals[0];
        const display = typeof flags.display === 'string' ? flags.display : undefined;
        if (!name || !display) throw new UsageError(`add 需要老师名和 --display 显示名,如 cotutor add science-tutor --display 科学老师 --subject 科学 --avatar 🔬。\n${USAGE}`);
        const ws = loadWorkspace(workspace);
        if (ws.config.tutors[name]) throw new UsageError(`cotutor.json 里已经有 ${name} 了;要改人设去老师团页或直接改文件`);
        const subject = typeof flags.subject === 'string' ? flags.subject : undefined;
        const r = await addTutorFile(ws.root, { name, display, subject, description: typeof flags.description === 'string' ? flags.description : undefined });
        await patchConfig(ws, { tutors: { [name]: { display, ...(subject ? { subject } : {}), ...(typeof flags.avatar === 'string' ? { avatar: flags.avatar } : {}), enabled: true, ...(flags.hidden === true ? { hidden: true } : {}) } } });
        if (json) process.stdout.write(`${JSON.stringify(redactDeep(r), null, 2)}\n`);
        else {
          process.stdout.write(`加了 ${display}(${name}):\n  ${redactHome(r.file)}  ← 老师文件,打开把括号里那句换成这位老师的性子\n  cotutor.json tutors.${name}  ← 人设与政策(老师团页也能改)\n  ${redactHome(r.home)}/  ← 它的家\n`);
          process.stdout.write('服务不用重启;孩子端和家长端刷新就有。\n');
        }
        return;
      }
      case 'add-theme': {
        const name = positionals[0];
        if (!name) throw new UsageError(`add-theme 需要主题名,如 cotutor add-theme dark。\n${USAGE}`);
        const { root } = resolveRoot(workspace);
        const r = await addTheme(root, name, typeof flags.from === 'string' ? flags.from : 'default');
        if (json) process.stdout.write(`${JSON.stringify(redactDeep(r), null, 2)}\n`);
        else process.stdout.write(`加了主题 ${name}(拷自 ${r.from}):\n  ${redactHome(r.dir)}/theme.json  ← 槽的清单(名字 + 给什么用)\n  ${redactHome(r.dir)}/kid.css     ← 样式,改了刷新就有\n把 cotutor.json 的 kid.theme 改成 "${name}" 就换过去了(服务不用重启)。\n`);
        return;
      }
      case 'upgrade': {
        const { root } = resolveRoot(workspace);
        // --config 是另一件事:政策文件补缺(老师文件与 skill 不碰)
        if (flags.config === true) {
          const dryRun = flags['dry-run'] === true;
          // 改名要挪会话目录与对话:服务在跑就不动(它还认着旧名,当天的会话也在旧 cwd 里)
          if (!dryRun && (await configGapsOf(root)).some((g) => g.kind === 'rename')) {
            const port = loadWorkspace(root).config.server.port;
            if (await portBusy(port)) throw new UsageError(`有老师改了名,要挪会话目录与对话,可服务还在跑(端口 ${port}):先停了 cotutor serve 再跑 cotutor upgrade --config`);
          }
          const r = await upgradeConfig(root, { dryRun });
          if (json) process.stdout.write(`${JSON.stringify(redactDeep(r), null, 2)}\n`);
          else if (!r.gaps.length) process.stdout.write(`cotutor.json 不缺什么:出厂模板里的老师、运行时、命令模板旗标都有。\n`);
          else {
            for (const g of r.gaps) process.stdout.write(`${dryRun ? '·' : '✓'} ${g.path.padEnd(24)} ${g.detail}\n`);
            for (const m of r.moved) process.stdout.write(`  ${dryRun ? '·' : '✓'} ${m.item.padEnd(22)} ${m.note}\n`);
            for (const st of r.installed) process.stdout.write(`✓ ${st.item.padEnd(24)} ${st.note ?? '建好了'}\n`);
            process.stdout.write(
              dryRun
                ? `\n${r.gaps.length} 项可补,还没动文件:cotutor upgrade --config 真补(只加上面这些,你改过的值不动)\n`
                : `\n补了 ${r.gaps.length} 项到 ${redactHome(r.file)};${r.moved.length ? '有老师改了名,起 cotutor serve 就是新名字。' : '服务在跑的话不用重启(按 mtime 热重载)。'}\n`,
            );
          }
          return;
        }
        const force = typeof flags.force === 'string' ? [flags.force, ...positionals] : positionals;
        const steps = await upgradeTutors(root, { force });
        const skillSteps = await upgradeSkills(root);
        const themeSteps = await upgradeThemes(root);
        await writeToolShim(root);
        // 老师文件换新了,政策文件却不会自动多出新老师与新运行时(cotutor.json 是家长的),提一句
        const gaps = await configGapsOf(root);
        if (json) process.stdout.write(`${JSON.stringify(redactDeep({ root, steps, skills: skillSteps, themes: themeSteps, configGaps: gaps }), null, 2)}\n`);
        else {
          const word: Record<string, string> = { upgraded: '已换新', latest: '已是最新', 'kept-custom': '自定义,保留', forced: '已覆盖(原文 .bak)', installed: '补上了', unavailable: '来源的包没装,没法换' };
          for (const s of skillSteps) process.stdout.write(`${s.action === 'kept-custom' || s.action === 'unavailable' ? '!' : '✓'} skill ${s.name.padEnd(18)} ${word[s.action]}${s.basedOn && s.action !== 'latest' ? `(基于 ${s.basedOn})` : ''}${s.machine ? '(机器件)' : ''}\n`);
          for (const s of themeSteps) process.stdout.write(`${s.action === 'kept-custom' ? '!' : '✓'} theme ${s.name.padEnd(18)} ${word[s.action]}${s.basedOn && s.action !== 'latest' ? `(基于 ${s.basedOn})` : ''}${s.action === 'kept-custom' ? '(themes/ 里改过的主题不动)' : ''}\n`);
          for (const s of steps) {
            process.stdout.write(`${s.action === 'kept-custom' ? '!' : '✓'} ${s.name.padEnd(18)} ${word[s.action]}${s.basedOn && s.action !== 'latest' ? `(基于 ${s.basedOn})` : ''}\n`);
            if (s.diff?.length) {
              process.stdout.write(`    你的 vs 新版(- 你的 / + 新版),想用新版:cotutor upgrade --force ${s.name}\n`);
              for (const l of s.diff.slice(0, 40)) process.stdout.write(`    ${l}\n`);
              if (s.diff.length > 40) process.stdout.write(`    …还有 ${s.diff.length - 40} 行\n`);
            }
          }
          if (gaps.length) process.stdout.write(`! 配置有 ${gaps.length} 项可补(新出厂老师 / 运行时 / 命令模板旗标):cotutor upgrade --config --dry-run 先看\n`);
        }
        return;
      }
      case 'cert': {
        const r = await makeCert(positionals.concat(typeof flags.host === 'string' ? [flags.host] : []));
        if (json) process.stdout.write(`${JSON.stringify(redactDeep(r), null, 2)}\n`);
        else {
          process.stdout.write(`证书:${redactHome(r.cert)}\n私钥:${redactHome(r.key)}\n主机:${r.hosts.join(' ')}\n`);
          process.stdout.write(`iPad / iPhone 要先信任这台机器的根证书:把 ${redactHome(r.caRoot)}/rootCA.pem 隔空投送过去 → 设置里安装描述文件 → 通用 › 关于本机 › 证书信任设置里**把开关打开**(装了不等于信任,每台设备各做一次);然后重启 cotutor serve,在这台电脑上打开它打印的扫码页,用相机扫(个别设备扫完一直转圈,就改手输打印的 https://<局域网 IP>:<端口>/)。详见 docs/iPad与iPhone.md\n`);
        }
        return;
      }
      case 'pack': {
        const [tutor, ...rest] = positionals;
        if (!tutor) throw new UsageError(`pack 需要老师名,如 cotutor pack math-tutor "讲讲退位"。\n${USAGE}`);
        const ws = loadWorkspace(workspace);
        const { packDryRun } = await import('../server/runner.ts');
        const from = typeof flags.from === 'string' ? flags.from : 'kid';
        if (from !== 'kid' && from !== 'parent' && from !== 'system') throw new UsageError('--from 只能是 kid / parent / system');
        const at = typeof flags.at === 'string' ? new Date(flags.at) : new Date();
        if (Number.isNaN(at.getTime())) throw new UsageError(`--at 不是时间:${flags.at as string}`);
        const r = await packDryRun(ws, tutor, { from, at, text: rest.join(' ') || '(干跑)' });
        if (json) { process.stdout.write(`${JSON.stringify(redactDeep(r), null, 2)}\n`); return; }
        const rel = (f: string): string => redactHome(f.startsWith(ws.root) ? f.slice(ws.root.length + 1) : f);
        const rp = r.report;
        const out: string[] = [];
        out.push(`发给 ${tutor} 的上下文包(干跑,${r.prompt.length} 字):`);
        out.push(...r.prompt.split('\n').map((l) => `  │ ${l}`));
        out.push('来源:');
        out.push(`  slot     ${rel(rp.timetable.file)} · ${rp.timetable.found ? (rp.timetable.slot ? `命中「${rp.timetable.slot}」` : '现在不在任何时段') : '课程表读不到'}`);
        const v = rp.vault;
        const chars = (n: number, tail = false): string => (n > v.limit ? `${n} 字,${tail ? `只带最近 ${v.limit}` : `截到 ${v.limit}`}` : `${n} 字`);
        out.push(`  vault    ${redactHome(v.root)} · 学期 ${v.semester ?? '算不出'}`);
        out.push(`  profile  ${v.profile ? `${v.profile}(${chars(v.chars.profile)})` : '没有 cotutor: profile 的笔记'}${v.extraProfiles.length ? ` · 另有 ${v.extraProfiles.join('、')} 没用` : ''}`);
        out.push(`  entry    ${v.entry ? `${v.entry}(${chars(v.chars.entry)})` : v.subject ? `没有 subject: ${v.subject}、semester: ${v.semester ?? '?'} 的入口文件` : '这位老师没配 subject'}${v.extraEntries.length ? ` · 另有 ${v.extraEntries.join('、')} 没用` : ''}`);
        out.push(`  memory   ${v.memory ? `${v.memory}(${chars(v.chars.memory, true)})` : '还没有(第一次写「## 记忆」时建)'}${v.extraMemories.length ? ` · 另有 ${v.extraMemories.join('、')} 没用` : ''}`);
        if (v.refs.length) out.push(`  refs     ${v.refs.join('、')}(只给路径)`);
        out.push(`  plan     ${rel(rp.plan.file)} · ${rp.plan.found ? `这位老师 ${rp.plan.total} 行,带了 ${rp.plan.kept}(上限 ${rp.plan.limit})` : '本周计划不在'}`);
        out.push(`  recent   ${rel(rp.recent.dir)}/ 最近 ${rp.recent.days} 天 · 有 ${rp.recent.filesFound.length} 天的日记${rp.recent.filesFound.length ? `(${rp.recent.filesFound[0]} … ${rp.recent.filesFound[rp.recent.filesFound.length - 1]})` : ''} · ${rp.recent.subject ? `学科「${rp.recent.subject}」` : '不按学科过滤'}的观察行共 ${rp.recent.total},带了 ${rp.recent.kept}(上限 ${rp.recent.limit},取最新的)`);
        const cut = [v.chars.profile > v.limit ? '档案原文截了' : '', v.chars.entry > v.limit ? '入口文件原文截了' : '', v.chars.memory > v.limit ? '记忆原文截了' : '', rp.plan.total > rp.plan.kept ? `计划截掉 ${rp.plan.total - rp.plan.kept} 行` : '', rp.recent.total > rp.recent.kept ? `观察截掉 ${rp.recent.total - rp.recent.kept} 条` : ''].filter(Boolean);
        out.push(cut.length ? `截掉的:${cut.join(';')}(改 cotutor.json policyDefaults.contextPack 的 entryChars / planLines / recent)` : '没截掉什么。');
        out.push('这份不进任何文件;老师真跑时还会多 cards:(孩子在卡上做的)与 photos: 两段;同一话题续聊时没改过的笔记只写「未变」。');
        process.stdout.write(`${out.join('\n')}\n`);
        return;
      }
      case 'show': {
        const [tutor, jobArg, dateArg] = positionals;
        if (!tutor || !jobArg) throw new UsageError(`show 需要老师名和 job,如 cotutor show math-tutor 1620-1 2026-09-12(日期缺省今天)。\n${USAGE}`);
        const ws = loadWorkspace(workspace);
        const { rawView } = await import('../server/raw-view.ts');
        const { localDate } = await import('../lib/conversation.ts');
        const date = dateArg ?? localDate(new Date());
        const { evalWorkspace } = await import('../server/replay.ts');
        const v = await rawView(flags.evals === true ? evalWorkspace(ws) : ws, tutor, date, jobArg);
        if (!v) throw new UsageError(`${tutor} ${date} 没有 ${jobArg} 这一轮(cotutor show 的日期缺省今天;job 与日期对不对?回放那轮要加 --evals)`);
        if (json) { process.stdout.write(`${JSON.stringify(redactDeep(v), null, 2)}\n`); return; }
        const secs = (ms?: number): string => (ms === undefined ? '?' : `${(ms / 1000).toFixed(1)}s`);
        const out: string[] = [];
        out.push(`${v.tutor} ${v.date} ${v.job} · ${v.from} 问 · ${v.result}${v.error ? ` · 出错 ${v.error}` : ''}${v.costUsd !== null ? ` · $${v.costUsd.toFixed(3)}` : ''}${v.timing ? ` · 首拍就绪 ${secs(v.timing.firstReadyMs)} 老师写完 ${secs(v.timing.doneMs)}` : ''}`);
        out.push(`问:${v.text}`);
        const src = v.pack?.sources;
        out.push(`上下文包:${v.pack ? `${v.pack.prompt.length} 字 · ${v.pack.resume ? 'resume' : '新开'} · ${v.pack.runtime}` : '没落(老轮次)'}${src ? ` · 老师文件 ${src.agent ? `${src.agent.file} ${src.agent.hash.slice(7)}` : '读不到'} · 技能 ${Object.entries(src.skills).map(([k, h]) => `${k} ${h.slice(7, 13)}`).join(' / ') || '无'}` : ''}`);
        if (v.pack) out.push(...v.pack.prompt.split('\n').map((l) => `  │ ${l}`));
        out.push(`读了什么:${v.tools.length ? '' : '没用工具'}`);
        for (const t of v.tools) out.push(`  ${t.ok === false ? '✗' : t.ok === null ? '?' : '·'} ${t.name}${t.sub ? '(子代理)' : ''} ${t.arg}${t.chars ? ` → ${t.chars} 字` : ''}`);
        out.push(`卡 ${v.kid.cards.length}:${v.kid.cards.map((c) => `${v.job}/${c.n} ${c.kind} ${c.label}`.trim()).join(' | ')}`);
        out.push(`讲稿 ${v.kid.lines.length}:`);
        for (const l of v.kid.lines) out.push(`  ${l.text}${l.cut ? `〔截:${l.cut}〕` : ''}`);
        if (v.stored.parentText) out.push(`给家长的尾巴:\n${v.stored.parentText.split('\n').map((l) => `  ${l}`).join('\n')}`);
        if (v.stored.warnings.length) out.push(`提醒:${v.stored.warnings.join(';')}`);
        if (v.postSummary) out.push(`后期:${v.postSummary.ok ? `${v.postSummary.beats ?? '?'} 拍 · ${secs(v.postSummary.ms)}${v.postSummary.costUsd !== undefined ? ` · $${v.postSummary.costUsd.toFixed(4)}` : ''} · 丢 ${v.postSummary.dropped}` : `没成 ${v.postSummary.error ?? ''}`}`);
        out.push(`文件:conversations/${tutor}/${v.files.log}${v.files.run ? ` · ${v.files.run}` : ''}`);
        process.stdout.write(`${out.join('\n')}\n`);
        return;
      }
      case 'replay': {
        const [tutor, jobArg, dateArg] = positionals;
        if (!tutor || !jobArg) throw new UsageError(`replay 需要老师名和 job,如 cotutor replay math-tutor 1620-1 2026-09-12(日期缺省今天)。\n${USAGE}`);
        const ws = loadWorkspace(workspace);
        const { childEnv, compareReplay, formatCompare, startReplay } = await import('../server/replay.ts');
        const { localDate } = await import('../lib/conversation.ts');
        const date = dateArg ?? localDate(new Date());
        const r = await startReplay(ws, tutor, date, jobArg, { runtime: typeof flags.runtime === 'string' ? flags.runtime : undefined, post: flags.post === true, env: childEnv(process.env) });
        if (!json) process.stdout.write(`回放起了:evals/${tutor}/${date}.${r.evalJob}.*(原轮 ${jobArg}),等老师说完……\n`);
        await r.done;
        const c = await compareReplay(ws, tutor, date, r.evalJob);
        if (!c) throw new UsageError(`回放跑完了但读不到结果:evals/${tutor}/${date}.json`);
        if (json) process.stdout.write(`${JSON.stringify(redactDeep(c), null, 2)}\n`);
        else process.stdout.write(formatCompare(c));
        return;
      }
      case 'compare': {
        const [tutor, evalJobArg, dateArg] = positionals;
        if (!tutor) throw new UsageError(`compare 需要老师名,如 cotutor compare math-tutor 1712-1 2026-09-12。\n${USAGE}`);
        const ws = loadWorkspace(workspace);
        const { compareReplay, formatCompare, listReplays } = await import('../server/replay.ts');
        const { localDate } = await import('../lib/conversation.ts');
        const date = dateArg ?? localDate(new Date());
        if (!evalJobArg) {
          const rows = await listReplays(ws, tutor, date);
          if (json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
          else if (!rows.length) process.stdout.write(`${tutor} ${date} 没有回放过(cotutor replay ${tutor} <job> ${date})\n`);
          else for (const r of rows) process.stdout.write(`${r.evalJob}  ← ${r.replayOf}  ${r.at.slice(11)}  ${r.result}${r.costUsd !== null ? `  $${r.costUsd.toFixed(3)}` : ''}${r.runtime ? `  ${r.runtime}` : ''}\n`);
          return;
        }
        const c = await compareReplay(ws, tutor, date, evalJobArg);
        if (!c) throw new UsageError(`${tutor} ${date} 没有回放 ${evalJobArg}(cotutor compare ${tutor} ${date} 列这天的)`);
        if (json) process.stdout.write(`${JSON.stringify(redactDeep(c), null, 2)}\n`);
        else process.stdout.write(formatCompare(c));
        return;
      }
      case 'trace': {
        const [tutor, jobArg, dateArg] = positionals;
        if (!tutor || !jobArg) throw new UsageError(`trace 需要老师名和 job,如 cotutor trace math-tutor 1620-1 2026-09-12(日期缺省今天)。\n${USAGE}`);
        const ws = loadWorkspace(workspace);
        const { conversationFiles, localDate } = await import('../lib/conversation.ts');
        const date = dateArg ?? localDate(new Date());
        const file = conversationFiles(ws.dirs.conversations, tutor, date).events(jobArg);
        let text: string;
        try {
          text = readFileSync(file, 'utf8');
        } catch {
          throw new UsageError(`没有这轮的事件文件:${redactHome(file)}(2026-09-13 之前的轮次没有事件;job 与日期对不对?)`);
        }
        const events = parseEvents(text).filter(laneFilter(typeof flags.lane === 'string' ? flags.lane : undefined));
        if (json) process.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
        else for (const e of events) process.stdout.write(`${formatEvent(e)}\n`);
        return;
      }
      case 'repost': {
        const [tutor, dateArg] = positionals;
        if (!tutor) throw new UsageError(`repost 需要老师名,如 cotutor repost math-tutor 2026-09-12 --job 1620-1。\n${USAGE}`);
        const ws = loadWorkspace(workspace);
        const { repost } = await import('../server/post.ts');
        const { readIndex } = await import('../server/store.ts');
        const { localDate } = await import('../lib/conversation.ts');
        const date = dateArg ?? localDate(new Date());
        const index = await readIndex(ws, tutor, date);
        const jobs = typeof flags.job === 'string' ? [flags.job] : index.messages.filter((m) => m.result === 'ok' && m.section?.cards.length).map((m) => m.job);
        if (!jobs.length) throw new UsageError(`${tutor} ${date} 没有带卡的轮次`);
        const results = [];
        for (const job of jobs) {
          const r = await repost(ws, tutor, date, job);
          results.push({ job, ...r });
          if (!json) process.stdout.write(`${r.ok ? '✓' : '!'} ${job}  ${r.message?.post ? `${r.message.post.ms}ms${r.message.post.costUsd !== undefined ? ` $${r.message.post.costUsd.toFixed(4)}` : ''} · 丢 ${r.message.post.dropped}${r.message.post.error ? ` · ${r.message.post.error}` : ''}` : r.error ?? ''}\n`);
        }
        if (json) process.stdout.write(`${JSON.stringify(redactDeep(results.map((r) => ({ job: r.job, ok: r.ok, post: r.message?.post ?? null, error: r.error ?? null }))), null, 2)}\n`);
        else process.stdout.write(`索引已改写;孩子端刷新就是新的排版。细节在工作台 /dev「看原文」第七站,或 conversations/${tutor}/${date}.<job>.post.json\n`);
        return;
      }
      case 'rate': {
        const [tutor, thread, score] = positionals;
        const n = Number(score);
        if (!tutor || !thread || !(n >= 1 && n <= 5 && Number.isInteger(n))) throw new UsageError(`rate 需要老师名、话题 id 和 1–5 的星,如 cotutor rate math-tutor 1620-1 4。\n${USAGE}`);
        const ws = loadWorkspace(workspace);
        const date = typeof flags.date === 'string' ? flags.date : localDate(new Date());
        const index = await rateThread(ws, tutor, date, thread, n);
        if (json) process.stdout.write(`${JSON.stringify({ tutor, date, thread, rating: index.ratings[thread] })}\n`);
        else process.stdout.write(`${tutor} ${date} 话题 ${thread}:${'★'.repeat(n)}${n >= ws.config.vault.keepScore ? '(记账时摘要进日记)' : `(不到 ${ws.config.vault.keepScore} 星,记账只记孩子问的话与观察)`}\n`);
        return;
      }
      case 'bookkeep': {
        const [tutor] = positionals;
        if (!tutor) throw new UsageError(`bookkeep 需要老师名,如 cotutor bookkeep math-tutor。\n${USAGE}`);
        const ctx = createContext(loadWorkspace(workspace));
        const date = typeof flags.date === 'string' ? flags.date : localDate(new Date());
        const only = typeof flags.thread === 'string' ? [flags.thread] : undefined;
        if (!json && flags.quiet !== true) ctx.runner.onEvent((e) => { if (e.tutor === tutor && (e.event.lane === 'ledger' || e.event.lane === 'main' || e.event.lane === 'index')) process.stdout.write(`${formatEvent(e.event)}\n`); });
        const r = await ctx.runner.bookkeep(tutor, date, only);
        if (!json) {
          for (const sk of r.skipped) process.stdout.write(`话题 ${sk.thread} 跳过:${sk.why}\n`);
          if (!r.queued.length) process.stdout.write('没有要记的话题\n');
          else process.stdout.write(`记账 ${r.queued.length} 个话题:${r.queued.join('、')}…\n`);
        }
        await ctx.runner.flush();
        const { readIndex } = await import('../server/store.ts');
        const index = await readIndex(ctx.ws, tutor, date);
        if (json) process.stdout.write(`${JSON.stringify({ tutor, date, queued: r.queued, skipped: r.skipped, booked: index.booked }, null, 2)}\n`);
        else for (const th of r.queued) {
          const m = index.messages.find((x) => x.bookkeep?.thread === th && x.result !== 'running');
          process.stdout.write(`话题 ${th}:${index.booked[th] ? '记进日记了' : `没记成${m?.warnings?.length ? ' — ' + m.warnings.join(';') : m?.error ? ' — ' + m.error : ''}`}\n`);
        }
        return;
      }
      case 'home': {
        const sub = positionals[0];
        if (sub !== 'check' && sub !== 'publish' && sub !== 'show') throw new UsageError(`home 后面跟 check / publish / show,如 cotutor home check。\n${USAGE}`);
        const ws = loadWorkspace(workspace);
        const now = new Date();
        const home = await import('../server/home.ts');
        if (sub === 'show') {
          const s = await home.homeStats(ws, now);
          process.stdout.write(json ? `${JSON.stringify(s, null, 2)}\n` : `${home.formatStats(ws, s)}\n`);
          return;
        }
        if (sub === 'check') {
          const published = flags.published === true;
          let md: string | null;
          if (published) {
            const { home: pub, error } = await home.readPublished(ws);
            if (!pub) throw new UsageError(error ?? '还没发布过首页');
            md = await home.publishedSource(ws, pub);
            if (md === null) throw new UsageError(`已发布那份的原文 ${pub.source} 不在了`);
          } else {
            md = await home.readDraft(ws);
            if (md === null) throw new UsageError('还没有草稿 home/draft.md(用 cotutor-home 技能写一份)');
          }
          const check = await home.checkHome(ws, md, now);
          const kid = await home.kidHomeView(ws, now, { source: published ? 'published' : 'draft' });
          if (json) process.stdout.write(`${JSON.stringify({ ok: check.fixes === 0, for: check.doc.for ?? null, issues: check.issues, cards: check.doc.cards, kid: kid.cards, note: check.doc.note }, null, 2)}\n`);
          else process.stdout.write(`${home.formatCheck(ws, check, published ? '已发布的那份' : '草稿 home/draft.md', kid)}\n`);
          if (check.fixes) process.exitCode = 1;
          return;
        }
        const r = await home.publishHome(ws, { force: flags.force === true, from: typeof flags.from === 'string' ? flags.from : undefined, now });
        if (json) process.stdout.write(`${JSON.stringify({ ok: r.ok, id: r.home?.id ?? null, source: r.source, issues: r.check.issues, dropped: r.dropped }, null, 2)}\n`);
        else if (!r.ok) {
          const kid = await home.kidHomeView(ws, now, { source: 'draft' });
          process.stdout.write(`${home.formatCheck(ws, r.check, r.source, kid)}\n没发布:有 ${r.check.fixes} 条要改;改好再发,或 --force 丢掉那几张照发\n`);
        } else {
          const h = r.home!;
          process.stdout.write(`发布了 ${h.id}(${r.source} → ${h.source},home/published.json)· ${h.cards.length} 张卡${h.for ? ` · for ${h.for}` : ''}\n`);
          for (const d of r.dropped) process.stdout.write(`  丢掉:${d}\n`);
          for (const w of h.warnings) process.stdout.write(`  提醒:${w}\n`);
          process.stdout.write('孩子端刷新就是新首页(不用重起服务)\n');
        }
        if (!r.ok) process.exitCode = 1;
        return;
      }
      case 'send': {
        const [tutor, ...words] = positionals;
        const text = words.join(' ');
        if (!tutor || !text) throw new UsageError(`send 需要老师名和消息,如 cotutor send math-tutor "这一步为什么要借位"。\n${USAGE}`);
        const from = typeof flags.from === 'string' ? flags.from : 'parent';
        if (!(MESSAGE_FROM as readonly string[]).includes(from)) throw new UsageError(`--from 只能是 ${MESSAGE_FROM.join(' / ')}`);
        const ctx = createContext(loadWorkspace(workspace));
        // 现场打印每道工序的事件(--quiet / --json 不打);事件同时落在 events.jsonl,事后 cotutor trace 能回放
        if (!json && flags.quiet !== true) {
          const keep = laneFilter(typeof flags.lane === 'string' ? flags.lane : undefined);
          ctx.runner.onEvent((e) => { if (e.tutor === tutor && keep(e.event)) process.stdout.write(`${formatEvent(e.event)}\n`); });
        }
        const started = await ctx.runner.send(tutor, { from: from as MessageFrom, text, runtime: typeof flags.runtime === 'string' ? flags.runtime : undefined, newThread: flags.new === true });
        if (!json) process.stdout.write(`→ ${tutor} ${started.date} ${started.job} 话题 ${started.thread}(${started.plan.runtime}${started.plan.resume ? ',resume ' + started.plan.session : ',新会话'})…\n`);
        const index = await started.done;
        const m = index.messages.find((x) => x.job === started.job);
        if (json) process.stdout.write(`${JSON.stringify({ tutor, date: started.date, job: started.job, runtime: started.plan.runtime, resume: started.plan.resume, message: m, session: index.session, costUsd: index.costUsd }, null, 2)}\n`);
        else if (!m || m.result !== 'ok') {
          process.stdout.write(`本轮出错:${m?.error ?? '未知'};看 conversations/${tutor}/${started.date}.${started.job}.err.log\n`);
          process.exitCode = 1;
        } else {
          process.stdout.write(`孩子看到:${m.kidText ?? '(没有给孩子的话)'}\n`);
          for (const s of m.scenes ?? []) process.stdout.write(`画图作业:课包 ${s.bundle} ${s.job ? `起了 scene-maker ${s.job}` : '没起(见提醒)'}\n`);
          const secs = (ms: number): string => (ms < 120000 ? `${Math.round(ms / 100) / 10}s` : `${Math.round(ms / 6000) / 10}min`);
          const timing = [m.timing?.firstReadyMs !== undefined ? `首拍就绪 ${secs(m.timing.firstReadyMs)}` : null, m.timing?.firstCardMs !== undefined ? `首卡 ${secs(m.timing.firstCardMs)}` : null, m.timing?.doneMs !== undefined ? `整轮 ${secs(m.timing.doneMs)}` : null, m.timing?.dubbedMs !== undefined ? `配音 ${secs(m.timing.dubbedMs)}` : null].filter(Boolean);
          if (m.artifacts.length) process.stdout.write(`课包:${m.artifacts.join(', ')}\n`);
          process.stdout.write(`会话 ${index.session?.id ?? '?'}${timing.length ? ' · ' + timing.join(' · ') : ''} · 本轮 $${(m.costUsd ?? 0).toFixed(2)} · 今日 $${index.costUsd.toFixed(2)}\n`);
        }
        return;
      }
      default:
        throw new UsageError(`未知命令 '${cmd}'。\n${USAGE}`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: 'usage', message: err.message })}\n`);
      else process.stderr.write(`cotutor: ${err.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}
