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
import { patchConfig } from '../server/store.ts';
import { resolveRoot } from './workspace.ts';
import { serveWorkspace } from './serve.ts';
import { UsageError, loadWorkspace, redactDeep, redactHome, workspaceReport } from './workspace.ts';
import { createContext } from '../server/app.ts';
import { MESSAGE_FROM, type MessageFrom } from '../schema/index.ts';

const USAGE = `用法:
  cotutor init <slug> [--dir <path>] [--name <孩子名>] [--port <n>]   建 ~/cotutor/<slug>/ 骨架(幂等补缺)
  cotutor doctor [--workspace <dir>] [--json] [--live]                 逐项体检;--live 真起一次老师与配音(花一分钱)把 API 层的坑摆出来
  cotutor upgrade [--workspace <dir>] [--force <老师>]...                老师文件换新版:没改过的直接换,改过的只报 diff(--force 才覆盖,原文留 .bak)
  cotutor add <老师名> --display <显示名> [--subject <学科>] [--avatar <emoji>] [--hidden]   加一位自家的老师:出模板文件、进 cotutor.json、建目录
  cotutor serve [--workspace <dir>] [--port <n>] [--http]               起服务(一 workspace 一进程;certs/ 里有证书就走 HTTPS)
  cotutor cert [--workspace <dir>] [--host <名或IP>]...                  用 mkcert 建自签证书到 certs/(iPad 上录音要 HTTPS)
  cotutor send <老师> <消息> [--from parent|kid|system] [--runtime <名>]   终端里发一条,等老师说完打印结果(与页面同一条路)
  cotutor --version | --help
workspace解析:--workspace > COTUTOR_WORKSPACE > cwd 或祖先有 cotutor.json > ~/.config/cotutor/config.json > ~/cotutor/ 下唯一的孩子目录
`;

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
        if (next === undefined || next.startsWith('--')) throw new UsageError(`选项 --${key} 需要一个值。\n${USAGE}`);
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else if (cmd === undefined) cmd = a;
    else positionals.push(a);
  }
  return { cmd, positionals, flags };
}

export async function main(argv: string[]): Promise<void> {
  let json = false;
  try {
    const { cmd, positionals, flags } = parseArgs(argv, ['workspace', 'dir', 'name', 'port', 'from', 'runtime', 'force', 'display', 'subject', 'avatar', 'description']);
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
        process.stdout.write(`cotutor serve ${JSON.stringify(workspaceReport(r.ws))}\n`);
        for (const w of r.warnings) process.stdout.write(`  ! ${w}\n`);
        if (!r.https) process.stdout.write('  ! HTTP:iPad Safari 上按住说话要 HTTPS;cotutor cert 建证书后重启即走 HTTPS\n');
        for (const u of r.urls) process.stdout.write(`  ${u}\n`);
        process.stdout.write(`  孩子端 /,家长端 /parent\n`);
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
      case 'upgrade': {
        const { root } = resolveRoot(workspace);
        const force = typeof flags.force === 'string' ? [flags.force, ...positionals] : positionals;
        const steps = await upgradeTutors(root, { force });
        if (json) process.stdout.write(`${JSON.stringify(redactDeep({ root, steps }), null, 2)}\n`);
        else {
          const word: Record<string, string> = { upgraded: '已换新', latest: '已是最新', 'kept-custom': '自定义,保留', forced: '已覆盖(原文 .bak)', installed: '补上了' };
          for (const s of steps) {
            process.stdout.write(`${s.action === 'kept-custom' ? '!' : '✓'} ${s.name.padEnd(18)} ${word[s.action]}${s.basedOn && s.action !== 'latest' ? `(基于 ${s.basedOn})` : ''}\n`);
            if (s.diff?.length) {
              process.stdout.write(`    你的 vs 新版(- 你的 / + 新版),想用新版:cotutor upgrade --force ${s.name}\n`);
              for (const l of s.diff.slice(0, 40)) process.stdout.write(`    ${l}\n`);
              if (s.diff.length > 40) process.stdout.write(`    …还有 ${s.diff.length - 40} 行\n`);
            }
          }
        }
        return;
      }
      case 'cert': {
        const r = await makeCert(workspace, positionals.concat(typeof flags.host === 'string' ? [flags.host] : []));
        if (json) process.stdout.write(`${JSON.stringify(redactDeep(r), null, 2)}\n`);
        else {
          process.stdout.write(`证书:${redactHome(r.cert)}\n私钥:${redactHome(r.key)}\n主机:${r.hosts.join(' ')}\n`);
          process.stdout.write(`iPad 要先信任这台机器的根证书:把 ${redactHome(r.caRoot)}/rootCA.pem 隔空投送到 iPad → 设置里安装描述文件 → 通用 › 关于本机 › 证书信任设置里打开;然后重启 cotutor serve,用 https 打开。\n`);
        }
        return;
      }
      case 'send': {
        const [tutor, ...words] = positionals;
        const text = words.join(' ');
        if (!tutor || !text) throw new UsageError(`send 需要老师名和消息,如 cotutor send math-tutor "这一步为什么要借位"。\n${USAGE}`);
        const from = typeof flags.from === 'string' ? flags.from : 'parent';
        if (!(MESSAGE_FROM as readonly string[]).includes(from)) throw new UsageError(`--from 只能是 ${MESSAGE_FROM.join(' / ')}`);
        const ctx = createContext(loadWorkspace(workspace));
        const started = await ctx.runner.send(tutor, { from: from as MessageFrom, text, runtime: typeof flags.runtime === 'string' ? flags.runtime : undefined });
        if (!json) process.stdout.write(`→ ${tutor} ${started.date} ${started.job}(${started.plan.runtime}${started.plan.resume ? ',resume ' + started.plan.session : ',新会话'})…\n`);
        const index = await started.done;
        const m = index.messages.find((x) => x.job === started.job);
        if (json) process.stdout.write(`${JSON.stringify({ tutor, date: started.date, job: started.job, runtime: started.plan.runtime, resume: started.plan.resume, message: m, session: index.session, costUsd: index.costUsd }, null, 2)}\n`);
        else if (!m || m.result !== 'ok') {
          process.stdout.write(`本轮出错:${m?.error ?? '未知'};看 conversations/${tutor}/${started.date}.${started.job}.err.log\n`);
          process.exitCode = 1;
        } else {
          process.stdout.write(`孩子看到:${m.kidText ?? '(没有给孩子的话)'}\n`);
          if (m.holdup) process.stdout.write(`待裁量:${m.holdup.question}${m.holdup.options.length ? ' → ' + m.holdup.options.map((o) => o.label).join(' / ') : ''}\n`);
          if (m.handoff) process.stdout.write(`转交:${m.handoff.to}${m.handoff.why ? ' — ' + m.handoff.why : ''}\n`);
          process.stdout.write(`会话 ${index.session?.id ?? '?'} · 本轮 $${(m.costUsd ?? 0).toFixed(2)} · 今日 $${index.costUsd.toFixed(2)}\n`);
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
