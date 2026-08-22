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
import type { ChalkScene } from '../player/types.ts';
import { loadWorkspace, redactHome, workspaceReport } from './workspace.ts';

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
  drawtell snap <scene.ts|bundle-id> [--step <n>] [--no-cursor] [--out <dir>] [--bundles <dir>] [--json]
      阶梯层 4:keyframe 截图,给视觉检验用。输入 .ts 会先 check + build。
      产物 <out>/step-<n>.png(0 = 空板配题面)+ index.json(图↔讲稿对照 + 每步新增元素清单 + 画板 viewBox)。
      --step n 只重截一步,index.json 只替换该步;--no-cursor 不画笔尖(检验用 keyframe 建议加)。
      默认输出 snaps/<scene-id>/;需要 playwright 与已构建的播放页(pnpm build)。
  drawtell dub <scene.ts|bundle-id> [--voice <v>] [--instruction <s>] [--model <m>] [--dry-run] [--force] [--voxtell <bin>] [--bundles <dir>] [--json]
      课包配音:manifest 各步讲稿 → voxtell batch(用户级缓存,幂等)→ bundles/<id>/audio/step-<n>.mp3
      + audio/index.json → 回填 manifest.audioSrc。--voice 必填(或工作区根 drawtell.json 的 dub.voice);
      --dry-run 只算账。之后 build 会按 audio/index.json 的讲稿 hash 回填 audioSrc,改了讲稿的步自动失去音频。
  drawtell --help | --version [--json]

  drawtell ls [--json]
      工作区现状:一行一个场景,五态一眼看全——源 / 课包 / 音频 / 截图 / 验收。
      agent 无记忆,进来先跑它。课包在但工作区没有源的标 orphan(多半是工具仓种子)。

工作区:命令在**内容工作区**根目录跑(有 drawtell.json 的那个目录)。cwd 没有就回落到
      ~/.config/drawtell/config.json 的 workspace,再没有就把 cwd 当工作区。每条 --json 都回报
      解析到了哪个工作区(workspace / workspaceSource),家目录脱敏成 $HOME。
      drawtell.json 的 paths 段可以把**派生物**挪出工作区(课包与截图 build/snap 都能重来):
        {"paths": {"bundles": "~/.cache/drawtell/<ws>/bundles", "snaps": "~/.cache/drawtell/<ws>/snaps"},
         "dub": {"voice": "…"}}
      缺省仍是工作区下的 bundles/ 与 snaps/;--out / --bundles 优先级最高。

exit code:0 通过 · 1 场景有问题(findings 里有修复指引)· 2 用法错误 · 3 已规划未实现 · 4 内部错误

示例:
  drawtell check scenes/dengche.ts
  drawtell check scenes/dengche.ts --json   # findings[]:{level, rule, message}
  drawtell build scenes/dengche.ts          # → bundles/dengche/
  drawtell serve --port 5175                # 打开 http://localhost:5175/?scene=dengche&step=2
  drawtell snap scenes/dengche.ts           # → snaps/dengche/step-{0..4}.png + index.json
  drawtell snap dengche --step 3            # 已 build 的课包只截第 3 步(index.json 合并写入)
  drawtell snap scenes/dengche.ts --no-cursor  # 不画笔尖,给 drawtell-verify 的纯净帧
  drawtell dub dengche --voice qwen-audio-3.0-tts-plus-longhongxinxu --dry-run   # 先算账
  drawtell dub dengche --voice qwen-audio-3.0-tts-plus-longhongxinxu             # 配音

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
      case 'tidy':
        await runTidy(args.slice(1), json);
        return;
      case 'ls':
        await runLs(args.slice(1), json);
        return;
      case 'serve':
        await runServe(args.slice(1), json);
        return;
      case 'snap':
        await runSnap(args.slice(1), json);
        return;
      case 'dub':
        await runDub(args.slice(1), json);
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
        serve: { usage: 'drawtell serve [--port <n>] [--bundles <dir>] [--json]', desc: '播放页 + 课包分发' },
        snap: { usage: 'drawtell snap <scene.ts|bundle-id> [--step <n>] [--no-cursor] [--out <dir>] [--bundles <dir>] [--json]', desc: 'keyframe 截图 + index.json' },
        dub: { usage: 'drawtell dub <scene.ts|bundle-id> [--voice <v>] [--instruction <s>] [--dry-run] [--force] [--json]', desc: '课包配音(voxtell 粘合)' },
        ls: { usage: 'drawtell ls [--json]', desc: '工作区现状:源 / 课包 / 音频 / 截图 / 验收' },
        tidy: { usage: 'drawtell tidy <dir> [--older-than <天>] [--delete] [--json]', desc: '清理无引用的旧文件(默认只列不删)' },
      },
      planned: [],
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
    // 路径一律脱敏:--json 会被 agent 带进上下文,不该带出用户名
    const safe = { ...r, bundle: r.bundle && redactHome(r.bundle), files: r.files?.map(redactHome) };
    console.log(JSON.stringify({ ...safe, errors, warnings }, null, 2));
    return;
  }
  const head = r.ok ? `✓ ${r.file} — 通过` : `✗ ${r.file} — ${errors} 错误`;
  console.log(`${head}${warnings ? `,${warnings} 警告` : ''}`);
  for (const f of r.findings) {
    console.log(`  [${f.level}] ${f.rule}: ${f.message}`);
  }
  if (r.bundle) console.log(`  课包 → ${r.bundle}(${(r.files ?? []).map((p) => p.split('/').pop()).join(' + ')})`);
}

function parseCmdArgs(
  rest: string[],
  cmdUsage: string,
  allowedFlags: string[],
  fileArg = true,
  boolFlags: string[] = [],
): { file: string; flags: Map<string, string> } {
  const flags = new Map<string, string>();
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      if (boolFlags.includes(a)) {
        flags.set(a, '1');
        continue;
      }
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
  const ws = await loadWorkspace();
  const outDir = flags.get('--out') ?? join(ws.paths.bundles, scene.id);
  const files = await buildBundle(scene, outDir);
  report(json, { command: 'build', file, exportName, ok: true, findings, bundle: outDir, files, ...workspaceReport(ws) });
}

async function requireWebBuild(): Promise<void> {
  const { WEB_ROOT } = await import('./serve.ts');
  try {
    await stat(join(WEB_ROOT, 'index.html'));
  } catch {
    throw new UsageError(
      `播放页构建产物不存在(${WEB_ROOT})。仓库内:根目录运行 pnpm build;` +
        `npm 安装的包不含播放页(体积),serve/snap 请在仓库里跑:git clone ${HOMEPAGE} && pnpm i && pnpm build`,
    );
  }
}

async function runSnap(rest: string[], json: boolean): Promise<void> {
  const usage = 'drawtell snap <scene.ts|bundle-id> [--step <n>] [--no-cursor] [--out <dir>] [--bundles <dir>] [--json]';
  const { file, flags } = parseCmdArgs(rest, usage, ['--step', '--out', '--bundles'], true, ['--no-cursor']);
  const ws = await loadWorkspace();
  const bundlesDir = flags.get('--bundles') ?? ws.paths.bundles;
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

  const outDir = flags.get('--out') ?? join(ws.paths.snaps, scene.id);
  const { snapScene } = await import('./snap.ts');
  const cursor = !flags.has('--no-cursor');
  const shots = await snapScene({ scene, bundlesDir, outDir, step, cursor });
  if (json) {
    console.log(JSON.stringify({ command: 'snap', file, ok: true, scene: scene.id, outDir: redactHome(outDir), cursor, findings, shots, ...workspaceReport(ws) }, null, 2));
  } else {
    console.log(`✓ ${file} — ${shots.length} 张 keyframe → ${outDir}/(${shots.map((s) => `step-${s.step}.png`).join(' ')} + index.json${step != null ? ',已合并' : ''}${cursor ? '' : ',无笔尖'})`);
    for (const f of findings) console.log(`  [${f.level}] ${f.rule}: ${f.message}`);
  }
}

async function runDub(rest: string[], json: boolean): Promise<void> {
  const usage = 'drawtell dub <scene.ts|bundle-id> [--voice <v>] [--instruction <s>] [--model <m>] [--dry-run] [--force] [--voxtell <bin>] [--bundles <dir>] [--json]';
  const { file, flags } = parseCmdArgs(rest, usage, ['--voice', '--instruction', '--model', '--voxtell', '--bundles'], true, ['--dry-run', '--force']);
  const ws = await loadWorkspace();
  const bundlesDir = flags.get('--bundles') ?? ws.paths.bundles;
  const { dubBundle } = await import('./dub.ts');
  const policy = ws.dub;
  const voice = flags.get('--voice') ?? policy.voice;
  if (!voice) {
    throw new UsageError(
      '未指定音色:--voice <v>,或在工作区根 drawtell.json 写 {"dub": {"voice": "...", "instruction": "..."}}。' +
        '音色是应用政策(家长确认),不带默认值;候选看 voxtell voices --grep <关键词>,试听 voxtell preview <voice>',
    );
  }
  const instruction = flags.get('--instruction') ?? policy.instruction;
  const model = flags.get('--model') ?? policy.model;

  let scene: ChalkScene;
  let findings: Finding[] = [];
  if (file.endsWith('.ts')) {
    const { raw, exportName } = await loadScene(file);
    const r = checkScene(raw);
    findings = r.findings;
    if (!r.scene || findings.some((f) => f.level === 'error')) {
      report(json, { command: 'dub', file, exportName, ok: false, findings });
      process.exitCode = 1;
      return;
    }
    scene = r.scene;
    await buildBundle(scene, join(bundlesDir, scene.id));
  } else {
    scene = await readBundle(bundlesDir, file);
  }
  const bundleDir = join(bundlesDir, scene.id);
  const result = await dubBundle({
    scene,
    bundleDir,
    voice,
    instruction,
    model,
    dryRun: flags.has('--dry-run'),
    force: flags.has('--force'),
    voxtellBin: flags.get('--voxtell'),
  });
  if (json) {
    console.log(JSON.stringify({ command: 'dub', file, scene: scene.id, voice, instruction: instruction ?? null, model: model ?? null, findings, ...result, ...workspaceReport(ws) }, null, 2));
  } else {
    const s = result.summary;
    const head = result.dryRun ? '算账(未合成)' : result.ok ? '配音完成' : `配音有 ${s.failed} 步失败`;
    console.log(`${result.ok ? '✓' : '✗'} ${scene.id} — ${head}:${s.jobs} 步 / ${s.characters} 字符;缓存命中 ${s.hits},需合成 ${s.misses}(计费 ${s.billedCharacters} 字符${s.estimatedCost != null ? `,约 ${s.estimatedCost} 元` : ''})`);
    for (const st of result.steps) {
      const pc = result.pacing.find((p) => p.step === st.step);
      const pace = pc && pc.audioMs ? `  音 ${(pc.audioMs / 1000).toFixed(1)}s / 画 ${(pc.drawMs / 1000).toFixed(1)}s${pc.factor > 1 ? ` → 拉伸 ×${pc.factor.toFixed(1)}` : ''}${pc.audioMs / pc.drawMs > 5 ? '  ⚠ 超过封顶 5 倍:讲稿太长或这步画得太少' : ''}` : '';
      console.log(`  ${st.error ? '✗' : st.cached ? '=' : result.dryRun ? '+' : '↑'} step-${st.step}  ${st.characters} 字${pace}${st.error ? `  ${st.error}` : ''}`);
    }
    if (result.manifestUpdated) console.log(`  manifest.json 已回填 audioSrc;预览:drawtell serve → /?scene=${scene.id}`);
    if (result.dryRun && s.misses) console.log('  去掉 --dry-run 即合成');
    for (const f of findings) console.log(`  [${f.level}] ${f.rule}: ${f.message}`);
  }
  if (!result.ok) process.exitCode = 1;
}

async function runTidy(rest: string[], json: boolean): Promise<void> {
  const usage = 'drawtell tidy <dir> [--older-than <天>] [--delete] [--json]';
  const { file: dir, flags } = parseCmdArgs(rest, usage, ['--older-than'], true, ['--delete']);
  const olderThanDays = Number(flags.get('--older-than') ?? 90);
  if (!Number.isInteger(olderThanDays) || olderThanDays < 0) {
    throw new UsageError(`--older-than 需要非负整数天数,拿到 '${flags.get('--older-than')}'。用法:${usage}`);
  }
  const ws = await loadWorkspace();
  const { tidy } = await import('./tidy.ts');
  const r = await tidy(ws, dir, { olderThanDays, del: flags.has('--delete') });
  if (json) {
    console.log(JSON.stringify({ command: 'tidy', ...r, olderThanDays, deleted: r.deleted, ...workspaceReport(ws) }, null, 2));
    return;
  }
  const mb = (n: number) => `${(n / 1048576).toFixed(1)}M`;
  console.log(`${r.dir}:扫描 ${r.scanned} 个文件,${r.referenced} 个被笔记引用(永不清理)`);
  if (!r.candidates.length) {
    console.log(`  没有符合条件的:无引用 且 超过 ${olderThanDays} 天未改动。`);
    return;
  }
  const total = r.candidates.reduce((a, c) => a + c.bytes, 0);
  console.log(`  ${r.candidates.length} 个候选(${mb(total)}),无引用且超过 ${olderThanDays} 天:`);
  for (const c of r.candidates.slice(0, 20)) console.log(`    ${c.path}  ${c.ageDays} 天  ${mb(c.bytes)}`);
  if (r.candidates.length > 20) console.log(`    …还有 ${r.candidates.length - 20} 个(--json 看全量)`);
  if (r.deleted.length) {
    console.log(`  已删除 ${r.deleted.length} 个,清单追加到 ${r.logFile}`);
  } else {
    console.log('  以上只是清单,没有删任何东西。确认无误后加 --delete。');
    console.log('  想留下某张图:在任何笔记里引用它(![[文件名]]),它就永远不会再进这个清单。');
  }
}

async function runLs(rest: string[], json: boolean): Promise<void> {
  parseCmdArgs(rest, 'drawtell ls [--json]', [], false);
  const ws = await loadWorkspace();
  const { listWorkspace, formatRows } = await import('./ls.ts');
  const rows = await listWorkspace(ws);
  if (json) {
    console.log(JSON.stringify({ command: 'ls', scenes: rows, ...workspaceReport(ws) }, null, 2));
  } else {
    console.log(formatRows(rows));
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
  const ws = await loadWorkspace();
  const { serve } = await import('./serve.ts');
  await serve({ port, bundlesDir: flags.get('--bundles') ?? ws.paths.bundles, json, title: ws.title });
}
