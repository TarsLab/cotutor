/**
 * cotutor CLI 入口。命令:init / doctor / serve;全局 --workspace <dir>、--json。
 * exit:0 通过 / 1 体检不过 / 2 用法错误 / 4 内部错误。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { doctorWorkspace } from './doctor.ts';
import { initWorkspace } from './init.ts';
import { serveWorkspace } from './serve.ts';
import { UsageError, redactDeep, redactHome, workspaceReport } from './workspace.ts';

const USAGE = `用法:
  cotutor init <slug> [--dir <path>] [--name <孩子名>] [--port <n>]   建 ~/cotutor/<slug>/ 骨架(幂等补缺)
  cotutor doctor [--workspace <dir>] [--json]                          逐项体检
  cotutor serve [--workspace <dir>] [--port <n>]                        起服务(一 workspace 一进程)
  cotutor --version | --help
工作区解析:--workspace > COTUTOR_WORKSPACE > cwd 或祖先有 cotutor.json > ~/.config/cotutor/config.json > ~/cotutor/ 下唯一的孩子目录
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
    const { cmd, positionals, flags } = parseArgs(argv, ['workspace', 'dir', 'name', 'port']);
    json = flags.json === true;
    const workspace = typeof flags.workspace === 'string' ? flags.workspace : undefined;
    switch (cmd) {
      case undefined:
      case '--help':
      case '-h':
        process.stdout.write(USAGE);
        return;
      case '--version':
      case '-v':
        process.stdout.write(`${version()}\n`);
        return;
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
        const r = await doctorWorkspace(workspace);
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
        const r = await serveWorkspace({ workspace, port });
        process.stdout.write(`cotutor serve ${JSON.stringify(workspaceReport(r.ws))}\n`);
        for (const w of r.warnings) process.stdout.write(`  ! ${w}\n`);
        process.stdout.write(`  ${r.url}\n`);
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
