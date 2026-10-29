/**
 * src 的依赖方向(docs/wip/src架构设计.md §4):扫每个文件的 import、import type、export … from、动态 import() 与 import('…') 类型,
 * 按顶层目录归到模块,对 ALLOW 查。现有的反向边逐条列在 LEGACY,只减不增:出了表外的新边红,表里的边代码里没了也红(把那条删掉)。
 * 另两条:内联进页面的文件(server/inline-lib.ts 删掉整行 import)运行时只能从别的内联文件拿值;舞台包的传递依赖里没有 Node 内置模块。
 * 搬目录时改 ALLOW 的「目录 → 可以导入的目录」。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { check, done } from './_check.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** 现有目录 → 可以导入的目录(自己总可以)。目标模块出现之前按这张表 */
const ALLOW: Record<string, readonly string[]> = {
  schema: [],
  lib: ['schema'],
  cards: ['schema', 'lib'],
  clis: ['schema', 'lib'],
  live: ['schema', 'lib', 'cards'],
  paint: ['schema', 'lib', 'cards'],
  talk: ['schema', 'lib', 'cards'],
  dictation: ['schema', 'lib', 'cards'],
  stage: ['schema', 'lib'],
  server: ['schema', 'lib', 'cards', 'live', 'paint', 'talk', 'dictation'],
  cli: ['schema', 'lib', 'cards', 'live', 'paint', 'talk', 'dictation', 'server'],
};

/** 现有的反向边(「文件 → 文件」);只许删,不许加 */
const LEGACY: readonly string[] = [
  // schema → lib:契约反向引实现的类型
  'schema/board.ts → lib/kid-board.ts',
  // lib → cards:lib 与卡的注册表互引
  'lib/board.ts → cards/index.ts',
  'lib/home-doc.ts → cards/docs.ts',
  'lib/home-doc.ts → cards/index.ts',
  'lib/home-edit.ts → cards/index.ts',
  'lib/home.ts → cards/index.ts',
  'lib/kid-view.ts → cards/index.ts',
  // lib → cli:技能文档引命令用法
  'lib/analyze-doc.ts → cli/usage.ts',
  'lib/home-doc.ts → cli/usage.ts',
  'lib/tune-doc.ts → cli/usage.ts',
  // lib → clis:纯逻辑认识 CLI 方言;脑执行抽出后收进 brain
  'lib/run-plan.ts → clis/index.ts',
  'lib/run-plan.ts → clis/stream-json.ts',
  'lib/run-plan.ts → clis/types.ts',
  'lib/stream.ts → clis/stream-json.ts',
  'lib/stream.ts → clis/types.ts',
  'lib/transcript.ts → clis/stream-json.ts',
  'lib/transcript.ts → clis/types.ts',
  'lib/tutor-rules.ts → clis/index.ts',
  // live → server:实时老师依赖 HTTP 应用的总装(kidSendInput、AppContext)与 runner、store
  'live/call.ts → server/app.ts',
  'live/call.ts → server/paper.ts',
  'live/call.ts → server/runner.ts',
  'live/call.ts → server/store.ts',
  'live/route.ts → server/access.ts',
  'live/route.ts → server/app.ts',
  // talk → server:场景的页面借孩子端零件,路由借 AppContext
  'talk/page.ts → server/kid-log.ts',
  'talk/page.ts → server/kid-nav.ts',
  'talk/page.ts → server/page-dom.ts',
  'talk/page.ts → server/photo-ui.ts',
  'talk/page.ts → server/tutor-face.ts',
  'talk/route.ts → server/app.ts',
  'talk/route.ts → server/tutor-face.ts',
  // dictation → server:同上
  'dictation/en-box.ts → server/letters.ts',
  'dictation/en-page.ts → server/kid-log.ts',
  'dictation/en-page.ts → server/kid-nav.ts',
  'dictation/en-page.ts → server/photo-ui.ts',
  'dictation/en-page.ts → server/tutor-face.ts',
  'dictation/page.ts → server/kid-log.ts',
  'dictation/page.ts → server/kid-nav.ts',
  'dictation/page.ts → server/photo-ui.ts',
  'dictation/page.ts → server/tutor-face.ts',
  'dictation/parent-page.ts → server/brand.ts',
  'dictation/reel-mode.ts → server/inline-lib.ts',
  'dictation/reel-page.ts → server/page-dom.ts',
  'dictation/reel-page.ts → server/reel-dock.ts',
  'dictation/route.ts → server/app.ts',
  'dictation/route.ts → server/home.ts',
  'dictation/route.ts → server/tianzige.ts',
  'dictation/route.ts → server/tts.ts',
  'dictation/route.ts → server/tutor-face.ts',
  'dictation/ui.ts → server/photo-ui.ts',
  // paint → cli:读 workspace、activity
  'paint/painter.ts → cli/workspace.ts',
  // dictation → cli:同上
  'dictation/route.ts → cli/activities.ts',
  // server → cli:多数是 cli/workspace.ts 这个大对象
  'server/access.ts → cli/workspace.ts',
  'server/activity-eval.ts → cli/activities.ts',
  'server/activity-eval.ts → cli/grades.ts',
  'server/activity-eval.ts → cli/workspace.ts',
  'server/activity-state.ts → cli/activities.ts',
  'server/activity-state.ts → cli/workspace.ts',
  'server/app.ts → cli/doctor.ts',
  'server/app.ts → cli/migrate.ts',
  'server/app.ts → cli/tutors.ts',
  'server/app.ts → cli/workspace.ts',
  'server/dev-activities.ts → cli/activities.ts',
  'server/dev-activities.ts → cli/tutors.ts',
  'server/dev-activities.ts → cli/workspace.ts',
  'server/dev-overview.ts → cli/workspace.ts',
  'server/dev-tutor-files.ts → cli/tutors.ts',
  'server/dev-tutor-files.ts → cli/workspace.ts',
  'server/home.ts → cli/activities.ts',
  'server/home.ts → cli/workspace.ts',
  'server/kid-log.ts → cli/workspace.ts',
  'server/mock.ts → cli/serve.ts',
  'server/mock.ts → cli/themes.ts',
  'server/mock.ts → cli/workspace.ts',
  'server/paper.ts → cli/workspace.ts',
  'server/raw-view.ts → cli/workspace.ts',
  'server/replay.ts → cli/workspace.ts',
  'server/runner.ts → cli/activities.ts',
  'server/runner.ts → cli/workspace.ts',
  'server/store.ts → cli/workspace.ts',
  'server/talk-run.ts → cli/activities.ts',
  'server/talk-run.ts → cli/workspace.ts',
  'server/theme.ts → cli/themes.ts',
  // server → clis:直接认 CLI 适配器;脑执行抽出后经 brain
  'server/raw-view.ts → clis/index.ts',
  'server/replay.ts → clis/index.ts',
  'server/runner.ts → clis/index.ts',
  'server/store.ts → clis/index.ts',
  // cli → clis:同上
  'cli/doctor.ts → clis/index.ts',
  'cli/skeleton.ts → clis/index.ts',
];

/** 舞台包的入口(scripts/build-stage.mjs) */
const STAGE_ENTRY = 'stage/main.tsx';

const rel = (abs: string) => relative(SRC, abs).split(sep).join('/');
const moduleOf = (file: string) => (file.includes('/') ? file.slice(0, file.indexOf('/')) : '');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e) && !e.endsWith('.d.ts')) out.push(rel(p));
  }
  return out;
}

interface Spec { spec: string; value: boolean }

/** 一个文件引了什么;value = 运行时还在(剥类型后留下的) */
function specsOf(file: string): Spec[] {
  const text = readFileSync(join(SRC, file), 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Spec[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const b = c?.namedBindings;
      const value = !c || (!c.isTypeOnly && (!!c.name || !b || ts.isNamespaceImport(b) || b.elements.length === 0 || b.elements.some((e) => !e.isTypeOnly)));
      out.push({ spec: n.moduleSpecifier.text, value });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.exportClause;
      const value = !n.isTypeOnly && !(c && ts.isNamedExports(c) && c.elements.length > 0 && c.elements.every((e) => e.isTypeOnly));
      out.push({ spec: n.moduleSpecifier.text, value });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
      out.push({ spec: n.arguments[0].text, value: true });
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      out.push({ spec: n.argument.literal.text, value: false });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** 相对路径 → src 里的文件;出了 src(package.json 之类)给 null */
function resolveIn(from: string, spec: string): string | null {
  const abs = resolve(dirname(join(SRC, from)), spec);
  const r = rel(abs);
  return r.startsWith('..') ? null : r;
}

const isBuiltin = (spec: string) => spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0]);

/** 内联进页面的文件:inlineScript(new URL('…')) 的字面路径,加 kid-page 里 libSource 的那几个名字 */
function inlineFilesOf(files: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const text = readFileSync(join(SRC, f), 'utf8');
    if (!text.includes('inlineScript(')) continue;
    for (const m of text.matchAll(/inlineScript\(new URL\('([^']+\.ts)'/g)) {
      const r = resolveIn(f, m[1]);
      if (r) out.add(r);
    }
    const union = /function libSource\(name: ([^)]+)\)/.exec(text);
    if (union) for (const m of union[1].matchAll(/'([a-z-]+)'/g)) out.add(`lib/${m[1]}.ts`);
  }
  return out;
}

const files = walk(SRC).sort();
const fileSet = new Set(files);
const specs = new Map(files.map((f) => [f, specsOf(f)]));

// ---- 目录归属 ----
const unknownDirs = [...new Set(files.map(moduleOf))].filter((m) => !(m in ALLOW));
check('src 下每个文件都在 ALLOW 里登记过的目录', unknownDirs.length === 0, `没登记的:${unknownDirs.map((m) => m || '(src 根)').join('、')}`);

const unresolved: string[] = [];
const edges = new Set<string>();
for (const [f, list] of specs) {
  for (const { spec } of list) {
    if (!spec.startsWith('.')) continue;
    const to = resolveIn(f, spec);
    if (!to) continue;
    if (!fileSet.has(to)) {
      // 舞台引的 stage.css 这类非 TS 文件不算依赖
      if (!/\.tsx?$/.test(to) && existsSync(join(SRC, to))) continue;
      unresolved.push(`${f} → ${spec}`);
      continue;
    }
    const a = moduleOf(f);
    const b = moduleOf(to);
    if (a !== b && !(ALLOW[a] ?? []).includes(b)) edges.add(`${f} → ${to}`);
  }
}
check('相对导入都能落到 src 里的文件', unresolved.length === 0, unresolved.join('\n'));

// ---- 反向边:只减不增 ----
const legacy = new Set(LEGACY);
const fresh = [...edges].filter((e) => !legacy.has(e)).sort();
const gone = LEGACY.filter((e) => !edges.has(e));
check('没有 ALLOW 之外的新依赖', fresh.length === 0, `\n${fresh.map((e) => `  '${e}',`).join('\n')}\n(改代码去掉这些边;确属目录该调整的,改 ALLOW)`);
check('LEGACY 里的边代码里都还在(没了的删掉)', gone.length === 0, `\n${gone.map((e) => `  '${e}',`).join('\n')}`);
check('LEGACY 没有重复', legacy.size === LEGACY.length);

// ---- 内联文件:运行时只从别的内联文件拿值 ----
const inline = inlineFilesOf(files);
check('认出了内联文件(kid-board、live-board、听写录像都在)', ['lib/kid-board.ts', 'lib/live-board.ts', 'dictation/lib/reel.ts'].every((f) => inline.has(f)), [...inline].join(' '));
const missingInline = [...inline].filter((f) => !fileSet.has(f));
check('内联清单里的文件都在', missingInline.length === 0, missingInline.join(' '));
const badInline: string[] = [];
for (const f of inline) {
  for (const { spec, value } of specs.get(f) ?? []) {
    if (!value) continue;
    const to = spec.startsWith('.') ? resolveIn(f, spec) : null;
    if (!to || !inline.has(to)) badInline.push(`${f} → ${spec}`);
  }
}
check(`${inline.size} 个内联文件运行时只从内联文件拿值(import 行内联时整行删掉)`, badInline.length === 0, badInline.join('\n'));

// ---- 舞台包:传递依赖里没有 Node 内置模块 ----
const seen = new Map<string, string | null>([[STAGE_ENTRY, null]]);
const queue = [STAGE_ENTRY];
const nodeInStage: string[] = [];
const chain = (f: string): string => {
  const parts: string[] = [];
  for (let at: string | null = f; at; at = seen.get(at) ?? null) parts.unshift(at);
  return parts.join(' → ');
};
check('舞台入口在', fileSet.has(STAGE_ENTRY));
while (queue.length) {
  const f = queue.shift()!;
  for (const { spec, value } of specs.get(f) ?? []) {
    if (!value) continue;
    if (isBuiltin(spec)) { nodeInStage.push(`${chain(f)} → ${spec}`); continue; }
    if (!spec.startsWith('.')) continue;
    const to = resolveIn(f, spec);
    if (!to || seen.has(to) || !fileSet.has(to)) continue;
    seen.set(to, f);
    queue.push(to);
  }
}
check(`舞台包的 ${seen.size} 个 src 文件里没有 Node 内置模块`, nodeInStage.length === 0, nodeInStage.join('\n'));

done();
