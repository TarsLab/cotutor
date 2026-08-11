/**
 * CLI 入口。约定(agent-friendly.md):
 * 全命令支持 --json;无交互式提示;错误信息 = 修复指南;
 * exit code:0 通过 · 1 场景有问题 · 2 用法错误 · 3 已规划未实现 · 4 内部错误。
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildBundle, readBundle } from './build.ts';
import { checkScene, type Finding } from './check.ts';
import { LoadError, NotFoundError, loadScene } from './load-scene.ts';
import type { ChalkScene } from '../player/types';

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
  drawtell snap <scene.ts|bundle-id> [--step <n>] [--out <dir>] [--bundles <dir>] [--json]
      阶梯层 4:keyframe 截图,给视觉检验用。输入 .ts 会先 check + build。
      产物 <out>/step-<n>.png(0 = 空板配题面)+ index.json(图↔讲稿对照)。
      默认输出 snaps/<scene-id>/;需要 playwright 与已构建的播放页(pnpm build)。
  drawtell --help | --version [--json]

规划中(调用返回 exit 3):ls

exit code:0 通过 · 1 场景有问题(findings 里有修复指引)· 2 用法错误 · 3 已规划未实现 · 4 内部错误

示例:
  drawtell check scenes/dengche.ts
  drawtell check scenes/dengche.ts --json   # findings[]:{level, rule, message}
  drawtell build scenes/dengche.ts          # → bundles/dengche/
  drawtell serve --port 5175                # 打开 http://localhost:5175/?scene=dengche&step=2
  drawtell snap scenes/dengche.ts           # → snaps/dengche/step-{0..4}.png + index.json
  drawtell snap dengche --step 3            # 已 build 的课包只截第 3 步

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
        await runSnap(args.slice(1), json);
        return;
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

async function requireWebBuild(): Promise<void> {
  const { WEB_ROOT } = await import('./serve.ts');
  try {
    await stat(join(WEB_ROOT, 'index.html'));
  } catch {
    throw new UsageError(`播放页构建产物不存在(${WEB_ROOT});先在 drawtell 仓库根运行 pnpm build`);
  }
}

async function runSnap(rest: string[], json: boolean): Promise<void> {
  const usage = 'drawtell snap <scene.ts|bundle-id> [--step <n>] [--out <dir>] [--bundles <dir>] [--json]';
  const { file, flags } = parseCmdArgs(rest, usage, ['--step', '--out', '--bundles']);
  const bundlesDir = flags.get('--bundles') ?? 'bundles';
  await requireWebBuild();

  let scene: ChalkScene;
  let findings: Finding[] = [];
  if (file.endsWith('.ts')) {
    // 源文件入口:先走完整 check + build,课包与源保持一致
    const { raw, exportName } = await loadScene(file);
    const r = checkScene(raw);
    findings = r.findings;
    if (!r.scene || findings.some((f) => f.level === 'error')) {
      report(json, { command: 'snap', file, exportName, ok: false, findings });
      process.exitCode = 1;
      return;
    }
    scene = r.scene;
    await buildBundle(scene, join(bundlesDir, scene.id));
  } else {
    scene = await readBundle(bundlesDir, file);
  }

  const stepFlag = flags.get('--step');
  let step: number | undefined;
  if (stepFlag !== undefined) {
    step = Number(stepFlag);
    if (!Number.isInteger(step) || step < 0 || step > scene.steps.length) {
      throw new UsageError(`--step 需要 0–${scene.steps.length} 的整数(0 = 空板),拿到 '${stepFlag}'`);
    }
  }

  const outDir = flags.get('--out') ?? join('snaps', scene.id);
  const { snapScene } = await import('./snap.ts');
  const shots = await snapScene({ scene, bundlesDir, outDir, step });
  if (json) {
    console.log(JSON.stringify({ command: 'snap', file, ok: true, scene: scene.id, outDir, findings, shots }, null, 2));
  } else {
    console.log(`✓ ${file} — ${shots.length} 张 keyframe → ${outDir}/(${shots.map((s) => `step-${s.step}.png`).join(' ')} + index.json)`);
    for (const f of findings) console.log(`  [${f.level}] ${f.rule}: ${f.message}`);
  }
}

async function runServe(rest: string[], json: boolean): Promise<void> {
  const usage = 'drawtell serve [--port <n>] [--bundles <dir>] [--json]';
  const { flags } = parseCmdArgs(rest, usage, ['--port', '--bundles'], false);
  const port = Number(flags.get('--port') ?? 5175);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new UsageError(`--port 需要 1–65535 的整数,拿到 '${flags.get('--port')}'。用法:${usage}`);
  }
  await requireWebBuild();
  const { serve } = await import('./serve.ts');
  await serve({ port, bundlesDir: flags.get('--bundles') ?? 'bundles', json });
}
