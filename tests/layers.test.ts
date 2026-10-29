/**
 * src 的依赖方向:扫每个文件的 import、import type、export … from、动态 import() 与 import('…') 类型,
 * 按顶层目录归到模块,对 ALLOW 查。现有的反向依赖按「模块 → 被引的文件」列在 LEGACY,只减不增:引了表外的文件就红,表里的哪条代码里没了也红(把那条删掉)。
 * 不按「文件 → 文件」记:迁移要拆大文件,拆出来的新文件照旧引同一个被引的文件,不算多了一条反向依赖。
 * 另两条:内联进页面的文件(ui/shared/inline-lib.ts 删掉整行 import)运行时只能从别的内联文件拿值;舞台包的传递依赖里没有 Node 内置模块。
 * 模块就是 src 下的顶层目录;加模块时改 ALLOW。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { check, done } from './_check.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * 模块 → 可以导入的模块(自己总可以),照 docs/wip/src架构设计.md §4(2026-10-29 目录归位):
 * 能力模块(brain、realtime、board、memory、media)只引 schema、shared,不互相调;场景只多引 board 的公开协议;
 * 运行层可以调各模块;页面只认 schema、shared、board 的纯协议(内联的纯文件经 URL 读,不是 import);应用那层(路由、命令、组装)谁都能引
 */
const CORE = ['shared', 'schema'];
const ALLOW: Record<string, readonly string[]> = {
  shared: [],
  schema: ['shared'],
  brain: CORE,
  realtime: CORE,
  board: CORE,
  memory: CORE,
  media: CORE,
  scenes: [...CORE, 'board'],
  runtime: [...CORE, 'brain', 'realtime', 'board', 'memory', 'media', 'scenes'],
  // 页面画板书与场景的记录(听写的录像照听写的事件画)
  ui: [...CORE, 'board', 'scenes'],
  app: [...CORE, 'brain', 'realtime', 'board', 'memory', 'media', 'scenes', 'runtime', 'ui'],
  // npm 包的 ./lib 出口:只是把几样纯函数转出去
  lib: ['shared', 'schema', 'brain', 'realtime', 'board', 'memory', 'media', 'scenes', 'runtime', 'ui', 'app'],
};

/** 现有的反向依赖(「模块 → 被引的文件」);只许删,不许加 */
const LEGACY: readonly string[] = [];

/** 舞台包的入口(scripts/build-stage.mjs) */
const STAGE_ENTRY = 'ui/stage/main.tsx';

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

/** 内联进页面的文件:调 inlineScript 的文件里 new URL('….ts', import.meta.url) 指的那些(kid-page 的 INLINE 表、听写录像、单词卡) */
function inlineFilesOf(files: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const text = readFileSync(join(SRC, f), 'utf8');
    if (!/inlineScript\(/.test(text) || f.endsWith('inline-lib.ts')) continue;
    for (const m of text.matchAll(/new URL\('(\.[^']+\.ts)', import\.meta\.url\)/g)) {
      const r = resolveIn(f, m[1]);
      if (r) out.add(r);
    }
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
// LAYERS_DUMP=1:列出白名单里每条现在是谁在引(清白名单时看)
if (process.env.LAYERS_DUMP) for (const e of LEGACY) console.log(`${e.padEnd(40)} ${(edges.get(e) ?? []).join(' ')}`);

// ---- 内联文件:运行时只从别的内联文件拿值 ----
const inline = inlineFilesOf(files);
check('认出了内联文件(板书、孩子端的声音、听写录像都在)', ['board/presentation.ts', 'runtime/delivery/player.ts', 'ui/dictation/reel.ts'].every((f) => inline.has(f)), [...inline].join(' '));
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
