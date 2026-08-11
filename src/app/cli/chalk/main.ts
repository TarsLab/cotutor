/**
 * CLI 入口。约定(agent-friendly.md):
 * 全命令支持 --json;无交互式提示;错误信息 = 修复指南;
 * exit code:0 通过 · 1 场景有问题 · 2 用法错误 · 3 已规划未实现 · 4 内部错误。
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildBundle } from './build.ts';
import { checkScene, type Finding } from './check.ts';
import { LoadError, NotFoundError, loadScene } from './load-scene.ts';

const VERSION = '0.1.0';
const HOMEPAGE = 'https://github.com/tarslab/drawtell';

class UsageError extends Error {}

const HELP = `drawtell ${VERSION} — draw & tell:把题目变成逐笔画出的黑板讲解动画。

用法:
  drawtell check <scene.ts> [--json]
      校验场景:模块求值(层1)→ schema + 语义 lint(层2)→ 确定性布局检查(层3)。
      类型层面的把关另跑 tsc(仓库内 pnpm typecheck);视觉真值归 snap(层4,规划中)。
  drawtell build <scene.ts> [--out <dir>] [--json]
      场景 → 课包目录(scene.json + manifest.json),先跑 check,有错误即中止。
      默认输出 bundles/<scene-id>/,幂等,已存在的 audio/ 不动。
  drawtell serve [--port <n>] [--bundles <dir>] [--json]
      本地 web 服务:播放器页 + 课包分发(/bundles/<id>/)+ 清单(/api/bundles)。
      默认端口 5175,课包目录 ./bundles;监听 0.0.0.0,iPad 走局域网地址。
      播放页参数:?scene=<id> 载入课包,&step=<n> 定格第 n 步,&bare=1 纯净画面。
      需要先构建播放页:仓库根 pnpm build。
  drawtell --help | --version [--json]

规划中(调用返回 exit 3):snap(keyframe 截图)· ls

exit code:0 通过 · 1 场景有问题(findings 里有修复指引)· 2 用法错误 · 3 已规划未实现 · 4 内部错误

示例:
  drawtell check scenes/dengche.ts
  drawtell check scenes/dengche.ts --json   # findings[]:{level, rule, message}
  drawtell build scenes/dengche.ts          # → bundles/dengche/
  drawtell serve --port 5175                # 打开 http://localhost:5175/?scene=dengche&step=2

${HOMEPAGE}`;

export async function main(argv: string[]): Promise<void> {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const cmd = args[0];
  try {
    switch (cmd) {
      case undefined:
      case '--help':
      case '-h':
        console.log(json ? jsonHelp() : HELP);
        return;
      case '--version':
      case '-v':
        console.log(json ? JSON.stringify({ name: 'drawtell', version: VERSION }) : VERSION);
        return;
      case 'check':
        await runCheck(args.slice(1), json);
        return;
      case 'build':
        await runBuild(args.slice(1), json);
        return;
      case 'serve':
        await runServe(args.slice(1), json);
        return;
      case 'snap':
      case 'ls':
        fail(json, 3, 'not_implemented', `'drawtell ${cmd}' 已规划、尚未实现(当前 ${VERSION})。进度见 ${HOMEPAGE}`);
        return;
      default:
        fail(json, 2, 'unknown_command', `未知命令 '${cmd}'。运行 drawtell --help 查看用法。`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      fail(json, 2, 'usage', err.message);
    } else if (err instanceof NotFoundError) {
      fail(json, 2, 'file_not_found', err.message);
    } else if (err instanceof LoadError) {
      report(json, { command: cmd ?? '', file: args[1] ?? '', ok: false, findings: [{ level: 'error', rule: 'load', message: err.message }] });
      process.exitCode = 1;
    } else {
      console.error(json ? JSON.stringify({ error: 'internal', message: String(err instanceof Error ? (err.stack ?? err.message) : err) }) : `drawtell: 内部错误:${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      process.exitCode = 4;
    }
  }
}

function jsonHelp(): string {
  return JSON.stringify(
    {
      name: 'drawtell',
      version: VERSION,
      commands: {
        check: { usage: 'drawtell check <scene.ts> [--json]', desc: '层1-3 校验,exit 0/1' },
        build: { usage: 'drawtell build <scene.ts> [--out <dir>] [--json]', desc: '场景 → 课包目录,先 check' },
      },
      planned: ['snap', 'serve', 'ls'],
      exitCodes: { 0: '通过', 1: '场景有问题', 2: '用法错误', 3: '已规划未实现', 4: '内部错误' },
      homepage: HOMEPAGE,
    },
    null,
    2,
  );
}

function fail(json: boolean, code: number, error: string, message: string): void {
  console.error(json ? JSON.stringify({ error, message }, null, 2) : `drawtell: ${message}`);
  process.exitCode = code;
}

interface Report {
  command: string;
  file: string;
  exportName?: string;
  ok: boolean;
  findings: Finding[];
  bundle?: string;
  files?: string[];
}

function report(json: boolean, r: Report): void {
  const errors = r.findings.filter((f) => f.level === 'error').length;
  const warnings = r.findings.filter((f) => f.level === 'warning').length;
  if (json) {
    console.log(JSON.stringify({ ...r, errors, warnings }, null, 2));
    return;
  }
  const head = r.ok ? `✓ ${r.file} — 通过` : `✗ ${r.file} — ${errors} 错误`;
  console.log(`${head}${warnings ? `,${warnings} 警告` : ''}`);
  for (const f of r.findings) {
    console.log(`  [${f.level}] ${f.rule}: ${f.message}`);
  }
  if (r.bundle) console.log(`  课包 → ${r.bundle}(${(r.files ?? []).map((p) => p.split('/').pop()).join(' + ')})`);
}

function parseCmdArgs(rest: string[], cmdUsage: string, allowedFlags: string[], fileArg = true): { file: string; flags: Map<string, string> } {
  const flags = new Map<string, string>();
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      if (!allowedFlags.includes(a)) throw new UsageError(`未知选项 '${a}'。用法:${cmdUsage}`);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`选项 '${a}' 需要一个值。用法:${cmdUsage}`);
      flags.set(a, next);
      i++;
    } else {
      positionals.push(a);
    }
  }
  if (fileArg && positionals.length !== 1) throw new UsageError(`需要且只要一个场景文件参数。用法:${cmdUsage}`);
  if (!fileArg && positionals.length > 0) throw new UsageError(`多余的参数 '${positionals[0]}'。用法:${cmdUsage}`);
  return { file: positionals[0] ?? '', flags };
}

async function runCheck(rest: string[], json: boolean): Promise<void> {
  const { file } = parseCmdArgs(rest, 'drawtell check <scene.ts> [--json]', []);
  const { raw, exportName } = await loadScene(file);
  const { findings } = checkScene(raw);
  const ok = !findings.some((f) => f.level === 'error');
  report(json, { command: 'check', file, exportName, ok, findings });
  if (!ok) process.exitCode = 1;
}

async function runBuild(rest: string[], json: boolean): Promise<void> {
  const { file, flags } = parseCmdArgs(rest, 'drawtell build <scene.ts> [--out <dir>] [--json]', ['--out']);
  const { raw, exportName } = await loadScene(file);
  const { scene, findings } = checkScene(raw);
  const ok = !findings.some((f) => f.level === 'error');
  if (!ok || !scene) {
    report(json, { command: 'build', file, exportName, ok: false, findings });
    if (!json) console.log('  build 中止:先修复上面的错误,再重跑 drawtell build');
    process.exitCode = 1;
    return;
  }
  const outDir = flags.get('--out') ?? join('bundles', scene.id);
  const files = await buildBundle(scene, outDir);
  report(json, { command: 'build', file, exportName, ok: true, findings, bundle: outDir, files });
}

async function runServe(rest: string[], json: boolean): Promise<void> {
  const usage = 'drawtell serve [--port <n>] [--bundles <dir>] [--json]';
  const { flags } = parseCmdArgs(rest, usage, ['--port', '--bundles'], false);
  const port = Number(flags.get('--port') ?? 5175);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new UsageError(`--port 需要 1–65535 的整数,拿到 '${flags.get('--port')}'。用法:${usage}`);
  }
  const { serve, WEB_ROOT } = await import('./serve.ts');
  try {
    await stat(join(WEB_ROOT, 'index.html'));
  } catch {
    throw new UsageError(`播放页构建产物不存在(${WEB_ROOT});先在 drawtell 仓库根运行 pnpm build,再 drawtell serve`);
  }
  await serve({ port, bundlesDir: flags.get('--bundles') ?? 'bundles', json });
}
