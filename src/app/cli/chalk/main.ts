/**
 * CLI 入口。约定(README「Design principles」):
 * 全命令支持 --json;全局 --workspace <dir> 显式指定工作区(在这里剥离,显式传给各命令,
 * 优先级与解析见 workspace.ts);无交互式提示;错误信息 = 修复指南;
 * exit code:0 通过 · 1 场景有问题 · 2 用法错误 · 3 已规划未实现 · 4 内部错误。
 */

import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { buildBundle, readBundle } from './build.ts';
import { checkScene, type Finding } from './check.ts';
import { typecheckScene } from './typecheck.ts';
import { LoadError, NotFoundError, loadScene, loadSceneFiles, resolveSceneInput } from './load-scene.ts';
import type { ChalkScene } from '../player/types.ts';
import { UsageError, loadWorkspace, redactDeep, redactHome, workspaceReport } from './workspace.ts';

// 版本只有一个真相:package.json(src/cli 与 dist/cli 到仓库根都是两级)
const VERSION: string = createRequire(import.meta.url)('../../package.json').version;
const HOMEPAGE = 'https://github.com/tarslab/drawtell';

const HELP = `drawtell ${VERSION} — draw & tell:把题目变成逐笔画出的黑板讲解动画。

用法:
  drawtell check <scene.ts|scene-dir> [--no-types] [--json]
      校验场景:类型(内嵌 tsc,工作区零配置;--no-types 跳过)→ 模块求值 → schema + 语义 lint → 确定性布局检查。
      视觉真值归 snap(层4)。
  drawtell build <scene.ts|scene-dir> [--out <dir>] [--json]
      场景 → 课包目录(scene.json + manifest.json),先跑 check,有错误即中止。
      场景源两条路:TS 纯数据模块,或双文件目录(scene.excalidraw 画面 + scene.json 信封
      schema 'chalk-scene-src':除 skeletons 外的全部字段——id/title/template/blocks/subscenes…;
      生成器与 excalidraw 编辑器产物走这条,静态点读页用 template 'static')。
      缺省输出 <paths.bundles>/<scene-id>/(drawtell.json 的 paths,缺省工作区 bundles/),幂等,已存在的 audio/ 不动。
  drawtell serve [--port <n>] [--bundles <dir>] [--json]
      本地 web 服务:/ 无参 = 课包清单页(iPad 入口,读 /api/bundles)、?scene=<id> 播放、/bundles/<id>/ 分发。
      默认端口 5175,课包目录 = paths.bundles(--bundles 覆盖);监听 0.0.0.0,iPad 走局域网地址。
      播放页参数:?scene=<id> 载入课包,&step=<n> 定格第 n 步,&bare=1 纯净画面,&cursor=0 不画笔尖。
      GET /api/config 给 {title}(工作区 drawtell.json 的 title,孩子端页面读它)。
      需要先构建播放页:仓库根 pnpm build。
  drawtell snap <scene.ts|bundle-id> [--step <n>] [--no-cursor] [--out <dir>] [--bundles <dir>] [--json]
      阶梯层 4:keyframe 截图,给视觉检验用。输入 .ts 会先 check + build;画面没烤过或变了,顺手 bake。
      产物 <out>/step-<n>.png(0 = 空板配题面)+ index.json(图↔讲稿对照 + 每步新增元素清单 + 画板 viewBox)。
      --step n 只重截一步,index.json 只替换该步;--no-cursor 不画笔尖(检验用 keyframe 建议加)。
      缺省输出 <paths.snaps>/<scene-id>/(drawtell.json 的 paths,缺省工作区 snaps/);需要 playwright 与已构建的播放页(pnpm build)。
  drawtell bake <scene.ts|bundle-id> [--bundles <dir>] [--json]
      课包画面烤成 bundles/<id>/bake.json:excalidraw 在浏览器里静态导出一次,存每条路径、长度、笔尖轨迹与内嵌字体;
      播放(drawtell/render)与服务端出图(drawtell/core renderFrameSvg)不再用 excalidraw 与 SMIL。输入 .ts 会先 check + build。
      画面(skeletons、background)变了要重烤;配音、时长变了不用。需要 playwright 与已构建的播放页(pnpm build)。
  drawtell dub <scene.ts|bundle-id> [--voice <v>] [--instruction <s>] [--model <m>] [--dry-run] [--force] [--voxtell <bin>] [--bundles <dir>] [--json]
      课包配音:manifest 各步讲稿 → voxtell batch(用户级缓存,幂等)→ bundles/<id>/audio/step-<n>.mp3
      + audio/index.json → 回填 manifest.audioSrc。--voice 必填(或工作区根 drawtell.json 的 dub.voice);
      --dry-run 只算账。之后 build 会按 audio/index.json 的讲稿 hash 回填 audioSrc,改了讲稿的步自动失去音频。
  drawtell note <scene.ts|bundle-id> [--json]
      课包档案段 → stdout:标题 + 题面 + 终帧 wikilink + 每步讲稿的一段 markdown(--json 放 markdown 字段);
      终帧截图拷到 <paths.attachments>/<id>-final.png(固定名,重生成覆盖,wikilink 永不断)。
      落进 Obsidian 日记由调用方负责(日记只追加)。需要已 build 的课包与终帧截图
      (先 drawtell build,再 drawtell snap <id> --no-cursor)。
  drawtell init [dir] [--json]
      初始化/修补工作区:幂等补缺,已有文件与目录一律不动,所以它同时就是修复命令。
      建目录骨架(scenes/ + 子产品目录 problems/captures/homework/tools/books/)+ drawtell.json 模板
      + .gitignore;用户配置还没指定 workspace 时把它指过来(已指向别处不改)。dir 缺省 = cwd
      (给了全局 --workspace 就用它,目录可以不存在)。政策文件(drawtell.json)永不自动重建或覆盖:
      写坏了靠 git 回退。新机器闭环:npm i -g drawtell → drawtell init <dir> → drawtell doctor。
  drawtell doctor [--json]
      逐项体检,失败项附修复命令:环境(node;serve/snap/dub 的外部依赖)+ 工作区(解析到哪个根、
      从哪来的,drawtell.json 可解析与形状,骨架目录,paths 各角色指向存在性与 iCloud 驱逐占位,
      reviews.json,用户配置,git)。内容层不归它:单场景看 check,全景盘点看 ls。exit 0/1。
  drawtell --help | --version [--json]

全局选项(所有命令通用,和命令级选项写在哪都行):
  --json               机器可读输出(每条命令都支持)
  --workspace <dir>    显式指定内容工作区根(可用 ~;目录必须存在),优先级最高

  drawtell ls [--json]
      工作区现状:一行一个场景,五态一眼看全——源 / 课包 / 音频 / 截图 / 验收。
      agent 无记忆,进来先跑它。课包在但工作区没有源的标 orphan(多半是工具仓种子)。

工作区:优先级 --workspace <dir> > cwd 有 drawtell.json > ~/.config/drawtell/config.json 的
      workspace > 把 cwd 当工作区。--workspace 决定工作区与 paths 落点(bundles/snaps/attachments…);
      场景位置参数与 --out / --bundles 的相对路径仍按 cwd 解析。每条 --json 都回报
      解析到了哪个工作区(workspace / workspaceSource:flag / cwd / user-config / default)
      与各目录角色,路径一律脱敏成 $HOME。
      drawtell.json 的 paths 段可以把**派生物**挪出工作区(课包与截图 build/snap 都能重来):
        {"paths": {"bundles": "<别处>/bundles", "snaps": "<别处>/snaps"},
         "dub": {"voice": "…"}}
      缺省(也是建议)是工作区下的 bundles/ 与 snaps/,.gitignore 排除即可;--out / --bundles 优先级最高。

exit code:0 通过 · 1 场景有问题(findings 里有修复指引)· 2 用法错误 · 3 已规划未实现(预留,当前无命令返回)· 4 内部错误

示例:
  drawtell init ~/drawtell-workspace       # 新机器:建骨架并把用户配置指过来(幂等,可重跑)
  drawtell doctor                           # 哪里不对一眼看全,失败项附修复命令
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
  const args: string[] = [];
  let cmd: string | undefined;
  try {
    // 全局层剥离:先剥 --json(布尔),再单遍扫描取 --workspace 的值并移除两个 token。
    // parseCmdArgs 的白名单严格且带值 flag 的值不许以 -- 开头,全局 flag 不进各命令。
    let workspace: string | undefined;
    const rest = argv.filter((a) => a !== '--json');
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--workspace') {
        const next = rest[i + 1];
        if (next === undefined || next.startsWith('--')) throw new UsageError('--workspace 需要一个路径值');
        workspace = next;
        i++;
      } else {
        args.push(rest[i]);
      }
    }
    cmd = args[0];
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
        await runCheck(args.slice(1), json, workspace);
        return;
      case 'build':
        await runBuild(args.slice(1), json, workspace);
        return;
      case 'ls':
        await runLs(args.slice(1), json, workspace);
        return;
      case 'serve':
        await runServe(args.slice(1), json, workspace);
        return;
      case 'snap':
        await runSnap(args.slice(1), json, workspace);
        return;
      case 'bake':
        await runBake(args.slice(1), json, workspace);
        return;
      case 'dub':
        await runDub(args.slice(1), json, workspace);
        return;
      case 'note':
        await runNote(args.slice(1), json, workspace);
        return;
      case 'init':
        await runInit(args.slice(1), json, workspace);
        return;
      case 'doctor':
        await runDoctor(args.slice(1), json, workspace);
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
        check: { usage: 'drawtell check <scene.ts|scene-dir> [--json]', desc: '层1-3 校验,exit 0/1' },
        build: { usage: 'drawtell build <scene.ts|scene-dir> [--out <dir>] [--json]', desc: '场景 → 课包目录,先 check' },
        serve: { usage: 'drawtell serve [--port <n>] [--bundles <dir>] [--json]', desc: '播放页 + 课包分发' },
        snap: { usage: 'drawtell snap <scene.ts|bundle-id> [--step <n>] [--no-cursor] [--out <dir>] [--bundles <dir>] [--json]', desc: 'keyframe 截图 + index.json' },
        bake: { usage: 'drawtell bake <scene.ts|bundle-id> [--bundles <dir>] [--json]', desc: '课包画面烤成 bake.json(运行时不用 excalidraw)' },
        dub: { usage: 'drawtell dub <scene.ts|bundle-id> [--voice <v>] [--instruction <s>] [--dry-run] [--force] [--json]', desc: '课包配音(voxtell 粘合)' },
        note: { usage: 'drawtell note <scene.ts|bundle-id> [--json]', desc: '课包档案段 → stdout(标题+题面+终帧 wikilink+每步讲稿),终帧拷到 <paths.attachments>/<id>-final.png;落进日记由调用方决定' },
        ls: { usage: 'drawtell ls [--json]', desc: '工作区现状:源 / 课包 / 音频 / 截图 / 验收' },
        init: { usage: 'drawtell init [dir] [--json]', desc: '初始化/修补工作区骨架(幂等补缺,已有文件一律不动;政策文件永不覆盖)' },
        doctor: { usage: 'drawtell doctor [--json]', desc: '环境 + 工作区逐项体检,失败项附修复命令;exit 0/1' },
      },
      globalOptions: {
        '--json': '机器可读输出(每条命令都支持)',
        '--workspace <dir>': '显式指定内容工作区根(可用 ~;目录必须存在),优先级最高;场景位置参数与 --out / --bundles 的相对路径仍按 cwd 解析',
      },
      workspacePriority: ['--workspace', 'cwd 的 drawtell.json', '~/.config/drawtell/config.json 的 workspace', 'cwd 兜底'],
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
  /** 其余字段(workspaceReport 等)原样进 --json */
  [extra: string]: unknown;
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

async function runCheck(rest: string[], json: boolean, workspace?: string): Promise<void> {
  const { file, flags } = parseCmdArgs(rest, 'drawtell check <scene.ts|scene-dir> [--no-types] [--json]', [], true, ['--no-types']);
  const ws = await loadWorkspace(workspace);
  const input = await resolveSceneInput(file);
  // 层 1 类型:先跑,错了也继续往下——agent 一次拿全所有层的问题;双文件是 JSON,没有类型层
  const types = flags.has('--no-types') || input.kind === 'files' ? { ran: false, findings: [] } : await typecheckScene(file);
  let exportName: string | undefined;
  let structural: Finding[];
  try {
    const loaded = input.kind === 'files' ? await loadSceneFiles(input.dir) : await loadScene(file);
    exportName = loaded.exportName;
    structural = checkScene(loaded.raw).findings;
  } catch (err) {
    // 求值失败(非文件缺失)也要连同类型层的发现一起报,别让 tsc 的结果丢在半路
    if (!(err instanceof LoadError)) throw err;
    structural = [{ level: 'error', rule: 'load', message: err.message }];
  }
  const findings = [...types.findings, ...structural];
  const ok = !findings.some((f) => f.level === 'error');
  report(json, { command: 'check', file, exportName, ok, findings, typesChecked: types.ran, ...workspaceReport(ws) });
  if (!ok) process.exitCode = 1;
}

async function runBuild(rest: string[], json: boolean, workspace?: string): Promise<void> {
  const { file, flags } = parseCmdArgs(rest, 'drawtell build <scene.ts|scene-dir> [--out <dir>] [--json]', ['--out']);
  const input = await resolveSceneInput(file);
  const { raw, exportName } = input.kind === 'files' ? await loadSceneFiles(input.dir) : await loadScene(file);
  const { scene, findings } = checkScene(raw);
  const ok = !findings.some((f) => f.level === 'error');
  if (!ok || !scene) {
    report(json, { command: 'build', file, exportName, ok: false, findings });
    if (!json) console.log('  build 中止:先修复上面的错误,再重跑 drawtell build');
    process.exitCode = 1;
    return;
  }
  const ws = await loadWorkspace(workspace);
  const outDir = flags.get('--out') ?? join(ws.paths.bundles, scene.id);
  const files = await buildBundle(scene, outDir, input.kind === 'files' ? input.dir : dirname(resolve(file)));
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

async function runBake(rest: string[], json: boolean, workspace?: string): Promise<void> {
  const usage = 'drawtell bake <scene.ts|bundle-id> [--bundles <dir>] [--json]';
  const { file, flags } = parseCmdArgs(rest, usage, ['--bundles'], true, []);
  const ws = await loadWorkspace(workspace);
  const bundlesDir = flags.get('--bundles') ?? ws.paths.bundles;
  await requireWebBuild();
  let id = file;
  let findings: Finding[] = [];
  if (file.endsWith('.ts')) {
    const { raw, exportName } = await loadScene(file);
    const r = checkScene(raw);
    findings = r.findings;
    if (!r.scene || findings.some((f) => f.level === 'error')) {
      report(json, { command: 'bake', file, exportName, ok: false, findings });
      process.exitCode = 1;
      return;
    }
    await buildBundle(r.scene, join(bundlesDir, r.scene.id), dirname(resolve(file)));
    id = r.scene.id;
  } else {
    await readBundle(bundlesDir, file);
  }
  const { bakeBundles } = await import('./bake.ts');
  const [r] = await bakeBundles(bundlesDir, [id]);
  if (json) console.log(JSON.stringify(redactDeep({ command: 'bake', file, ok: true, scene: id, bake: r.file, elements: r.elements, bytes: r.bytes, findings, ...workspaceReport(ws) }), null, 2));
  else {
    console.log(`✓ ${file} — ${r.elements} 个元素 → ${r.file}(${Math.round(r.bytes / 1024)} KB)`);
    for (const f of findings) console.log(`  [${f.level}] ${f.rule}: ${f.message}`);
  }
}

async function runSnap(rest: string[], json: boolean, workspace?: string): Promise<void> {
  const usage = 'drawtell snap <scene.ts|bundle-id> [--step <n>] [--no-cursor] [--out <dir>] [--bundles <dir>] [--json]';
  const { file, flags } = parseCmdArgs(rest, usage, ['--step', '--out', '--bundles'], true, ['--no-cursor']);
  const ws = await loadWorkspace(workspace);
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
    await buildBundle(scene, join(bundlesDir, scene.id), dirname(resolve(file)));
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
  // 截图要开浏览器,顺手把画面烤了(bake.json 没有或画面变了):做课包的流程跑到 snap,播放就不用 excalidraw 了
  const { bakeBundles, bakeIsFresh } = await import('./bake.ts');
  const bundleId = file.endsWith('.ts') ? scene.id : file;
  const baked = (await bakeIsFresh(join(bundlesDir, bundleId))) ? null : (await bakeBundles(bundlesDir, [bundleId]))[0];
  const { snapScene } = await import('./snap.ts');
  const cursor = !flags.has('--no-cursor');
  const shots = await snapScene({ scene, bundlesDir, outDir, step, cursor });
  if (json) {
    console.log(JSON.stringify(redactDeep({ command: 'snap', file, ok: true, scene: scene.id, outDir, cursor, findings, shots, ...(baked ? { bake: baked.file } : {}), ...workspaceReport(ws) }), null, 2));
  } else {
    console.log(`✓ ${file} — ${shots.length} 张 keyframe → ${outDir}/(${shots.map((s) => `step-${s.step}.png`).join(' ')} + index.json${step != null ? ',已合并' : ''}${cursor ? '' : ',无笔尖'})${baked ? `;画面烤好了 → ${baked.file}` : ''}`);
    for (const f of findings) console.log(`  [${f.level}] ${f.rule}: ${f.message}`);
  }
}

async function runDub(rest: string[], json: boolean, workspace?: string): Promise<void> {
  const usage = 'drawtell dub <scene.ts|bundle-id> [--voice <v>] [--instruction <s>] [--model <m>] [--dry-run] [--force] [--voxtell <bin>] [--bundles <dir>] [--json]';
  const { file, flags } = parseCmdArgs(rest, usage, ['--voice', '--instruction', '--model', '--voxtell', '--bundles'], true, ['--dry-run', '--force']);
  const ws = await loadWorkspace(workspace);
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
    await buildBundle(scene, join(bundlesDir, scene.id), dirname(resolve(file)));
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
    console.log(JSON.stringify(redactDeep({ command: 'dub', file, scene: scene.id, voice, instruction: instruction ?? null, model: model ?? null, findings, ...result, ...workspaceReport(ws) }), null, 2));
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

async function runNote(rest: string[], json: boolean, workspace?: string): Promise<void> {
  const usage = 'drawtell note <scene.ts|bundle-id> [--json]';
  const { file } = parseCmdArgs(rest, usage, []);
  const ws = await loadWorkspace(workspace);
  const { noteBundle } = await import('./note.ts');
  const r = await noteBundle({ file, bundlesDir: ws.paths.bundles, snapsDir: ws.paths.snaps, attachmentsDir: ws.paths.attachments });
  if (json) {
    console.log(JSON.stringify({ command: 'note', scene: r.scene, image: redactHome(r.image), steps: r.steps, markdown: r.markdown, ok: true, ...workspaceReport(ws) }, null, 2));
  } else {
    // 档案段原样打到 stdout:调用方直接拿去 append 进日记
    console.log(r.markdown);
  }
}

async function runInit(rest: string[], json: boolean, workspace?: string): Promise<void> {
  const usage = 'drawtell init [dir] [--json]';
  const positionals: string[] = [];
  for (const a of rest) {
    if (a.startsWith('--')) throw new UsageError(`未知选项 '${a}'。用法:${usage}`);
    positionals.push(a);
  }
  if (positionals.length > 1) throw new UsageError(`最多一个目录参数。用法:${usage}`);
  // 目录来源:位置参数 > 全局 --workspace(init 是唯一允许它不存在的命令)> cwd
  const dir = positionals[0] ?? workspace ?? process.cwd();
  const { initWorkspace } = await import('./init.ts');
  const r = await initWorkspace(dir);
  if (json) {
    console.log(JSON.stringify(redactDeep({ command: 'init', ok: true, root: r.root, steps: r.steps, suggestions: r.suggestions }), null, 2));
    return;
  }
  console.log(`✓ ${redactHome(r.root)} — 工作区骨架就绪(幂等补缺,已有的没动)`);
  const mark = { created: '+', exists: '=', kept: '=' } as const;
  for (const s of r.steps) {
    console.log(`  ${mark[s.action]} ${s.item.padEnd(14)} ${s.action === 'created' ? '建立' : s.action === 'exists' ? '已有' : '保留'}${s.note ? `(${s.note})` : ''}`);
  }
  for (const s of r.suggestions) console.log(`  → ${s}`);
}

async function runDoctor(rest: string[], json: boolean, workspace?: string): Promise<void> {
  parseCmdArgs(rest, 'drawtell doctor [--json]', [], false);
  const { doctorWorkspace } = await import('./doctor.ts');
  const r = await doctorWorkspace(workspace);
  if (json) {
    console.log(JSON.stringify(redactDeep({ command: 'doctor', ok: r.ok, workspace: r.root, workspaceSource: r.source, checks: r.checks }), null, 2));
  } else {
    for (const c of r.checks) {
      console.log(`${c.ok ? '✓' : c.required ? '✗' : '·'} ${c.name}: ${c.detail}${c.fix && !c.ok ? `\n    → ${c.fix}` : ''}`);
    }
    console.log(r.ok ? '体检通过。' : '有必需项未通过,按 → 提示修复后重跑 drawtell doctor');
  }
  if (!r.ok) process.exitCode = 1;
}

async function runLs(rest: string[], json: boolean, workspace?: string): Promise<void> {
  parseCmdArgs(rest, 'drawtell ls [--json]', [], false);
  const ws = await loadWorkspace(workspace);
  const { listWorkspace, formatRows } = await import('./ls.ts');
  const rows = await listWorkspace(ws);
  if (json) {
    console.log(JSON.stringify({ command: 'ls', scenes: rows, ...workspaceReport(ws) }, null, 2));
  } else {
    console.log(formatRows(rows));
  }
}

async function runServe(rest: string[], json: boolean, workspace?: string): Promise<void> {
  const usage = 'drawtell serve [--port <n>] [--bundles <dir>] [--json]';
  const { flags } = parseCmdArgs(rest, usage, ['--port', '--bundles'], false);
  const port = Number(flags.get('--port') ?? 5175);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new UsageError(`--port 需要 1–65535 的整数,拿到 '${flags.get('--port')}'。用法:${usage}`);
  }
  await requireWebBuild();
  const ws = await loadWorkspace(workspace);
  const { serve } = await import('./serve.ts');
  await serve({ port, bundlesDir: flags.get('--bundles') ?? ws.paths.bundles, json, title: ws.title, report: workspaceReport(ws) });
}
