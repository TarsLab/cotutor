/**
 * 阶梯层 1:类型。`drawtell check` 内嵌 tsc 过一遍场景文件——工作区不需要 tsconfig、不需要自己装 typescript、
 * 不需要知道 drawtell 的类型在哪:场景里的 `import type … from 'drawtell'` 在这里被映射到包内的类型文件
 * (仓库内跑是 src/player/types.ts,npm 安装后是 dist/player/types.d.ts)。
 * 这是"CLI 中心、工作区只剩源"原则在类型层的落法:以前要求工作区放一个 tsconfig 垫片,现在不用了。
 * typescript 是 dependency;万一缺席降级为一条 warning,不拦后面几层。
 */
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Finding } from './check.ts';

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = ['../player/types.ts', '../player/types.d.ts'].map((p) => resolve(here, p)).find(existsSync);

export interface TypecheckResult {
  /** false = 类型层没跑(typescript 缺席等),findings 里有一条 warning 说明原因 */
  ran: boolean;
  findings: Finding[];
}

export async function typecheckScene(file: string): Promise<TypecheckResult> {
  let ts: typeof import('typescript');
  try {
    ts = (await import('typescript')).default;
  } catch {
    return { ran: false, findings: [{ level: 'warning', rule: 'types-unavailable', message: '类型层未跑:找不到 typescript 包(它是 drawtell 的依赖;重新 pnpm install 即可)。后续各层照常。' }] };
  }
  if (!TYPES) {
    return { ran: false, findings: [{ level: 'warning', rule: 'types-unavailable', message: '类型层未跑:找不到 drawtell 的类型文件(player/types)。后续各层照常。' }] };
  }
  const abs = resolve(file);
  const options: import('typescript').CompilerOptions = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    types: [],
    // DOM 是给仓库内种子场景用的:它们从 ../src/player 引类型,会把播放器(用到 SVG/DOM 类型)一起拉进程序
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    jsx: ts.JsxEmit.ReactJSX,
    baseUrl: dirname(abs),
    paths: { drawtell: [TYPES] },
  };
  const program = ts.createProgram([abs], options);
  const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
  const findings: Finding[] = diags.map((d) => {
    let where = '';
    if (d.file && d.start != null) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      where = `${relative(process.cwd(), d.file.fileName)}:${line + 1}:${character + 1} `;
    }
    return { level: 'error', rule: 'types', message: `${where}TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}` };
  });
  return { ran: true, findings };
}
