/**
 * src 的依赖方向:扫每个文件的 import、import type、export … from、动态 import() 与 import('…') 类型,
 * 按顶层目录归到模块,对 ALLOW 查。现有的反向依赖按「模块 → 被引的文件」列在 LEGACY,只减不增:引了表外的文件就红,表里的哪条代码里没了也红(把那条删掉)。
 * 不按「文件 → 文件」记:迁移要拆大文件,拆出来的新文件照旧引同一个被引的文件,不算多了一条反向依赖。
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
  // 脑执行;clis 是它现在的 CLI 实现(以后搬进 brain/cli/)
  brain: ['schema', 'lib', 'clis'],
  // 听说:百炼 realtime 的客户端(以后加别家、加 ASR + TTS 组合也在这)
  realtime: ['schema', 'lib'],
  // 家长的 vault 与学习记忆:读取、取材、应用写入与撤回
  memory: ['schema', 'lib'],
  // 每种一家的媒体能力(文生图;以后配音、认图、课包)
  media: ['schema', 'lib'],
  // 具体场景的规则:不引 runtime、不调 media 与厂商实现(要画就由调用方交进来)
  scenes: ['schema', 'lib', 'cards'],
  live: ['schema', 'lib', 'cards', 'realtime'],
  // 旧路径,转发到 scenes/paint 与 media;迁完删
  paint: ['schema', 'lib', 'cards', 'scenes', 'media'],
  talk: ['schema', 'lib', 'cards'],
  dictation: ['schema', 'lib', 'cards'],
  stage: ['schema', 'lib'],
  server: ['schema', 'lib', 'cards', 'brain', 'realtime', 'memory', 'media', 'scenes', 'live', 'paint', 'talk', 'dictation'],
  cli: ['schema', 'lib', 'cards', 'brain', 'realtime', 'memory', 'media', 'scenes', 'live', 'paint', 'talk', 'dictation', 'server'],
};

/** 现有的反向依赖(「模块 → 被引的文件」);只许删,不许加 */
const LEGACY: readonly string[] = [
  // schema → lib:契约反向引实现的类型
  'schema → lib/kid-board.ts',
  // lib → cards:lib 与卡的注册表互引
  'lib → cards/docs.ts',
  'lib → cards/index.ts',
  // lib → cli:技能文档引命令用法
  'lib → cli/usage.ts',
  // lib → clis:纯逻辑认识 CLI 方言;以后收进 brain
  'lib → clis/index.ts',
  'lib → clis/stream-json.ts',
  'lib → clis/types.ts',
  // live → server:实时老师引 runner(BusyError、SendStarted)、store、paper 与 access 的 cookie
  'live → server/access.ts',
  'live → server/paper.ts',
  'live → server/runner.ts',
  'live → server/store.ts',
  // talk → server:场景的页面借孩子端零件,路由借 AppContext
  'talk → server/app.ts',
  'talk → server/kid-log.ts',
  'talk → server/kid-nav.ts',
  'talk → server/page-dom.ts',
  'talk → server/photo-ui.ts',
  'talk → server/tutor-face.ts',
  // dictation → server:同上,另有配音、天字格、首页
  'dictation → server/app.ts',
  'dictation → server/brand.ts',
  'dictation → server/home.ts',
  'dictation → server/inline-lib.ts',
  'dictation → server/kid-log.ts',
  'dictation → server/kid-nav.ts',
  'dictation → server/letters.ts',
  'dictation → server/page-dom.ts',
  'dictation → server/photo-ui.ts',
  'dictation → server/reel-dock.ts',
  'dictation → server/tianzige.ts',
  'dictation → server/tts.ts',
  'dictation → server/tutor-face.ts',
  // dictation → cli:读 activity
  'dictation → cli/activities.ts',
  // server → cli:多数是 cli/workspace.ts 这个大对象
  'server → cli/activities.ts',
  'server → cli/doctor.ts',
  'server → cli/grades.ts',
  'server → cli/migrate.ts',
  'server → cli/serve.ts',
  'server → cli/themes.ts',
  'server → cli/tutors.ts',
  'server → cli/workspace.ts',
  // server → clis:直接认 CLI 适配器(store、raw-view、replay);runner 已经走 brain
  'server → clis/index.ts',
  // cli → clis:同上(doctor、skeleton)
  'cli → clis/index.ts',
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
/** 「模块 → 被引的文件」→ 引它的那几个文件 */
const edges = new Map<string, string[]>();
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
    if (a === b || (ALLOW[a] ?? []).includes(b)) continue;
    const k = `${a} → ${to}`;
    edges.set(k, [...new Set([...(edges.get(k) ?? []), f])]);
  }
}
check('相对导入都能落到 src 里的文件', unresolved.length === 0, unresolved.join('\n'));

// ---- 反向边:只减不增 ----
const legacy = new Set(LEGACY);
const fresh = [...edges.keys()].filter((e) => !legacy.has(e)).sort();
const gone = LEGACY.filter((e) => !edges.has(e));
check('没有 ALLOW 之外的新依赖', fresh.length === 0, `\n${fresh.map((e) => `  '${e}', // ${edges.get(e)!.join('、')}`).join('\n')}\n(改代码去掉这些依赖;确属目录该调整的,改 ALLOW)`);
check('LEGACY 里的每条代码里都还在(没了的删掉)', gone.length === 0, `\n${gone.map((e) => `  '${e}',`).join('\n')}`);
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
