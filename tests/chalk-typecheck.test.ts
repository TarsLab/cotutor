/**
 * 类型层回归:check 内嵌的 tsc 能认出 `import type … from 'drawtell'`(工作区零配置),
 * 对好场景 0 错,对写错字段的场景给出带行列的 TS 错误。
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { typecheckScene } from '../src/cli/typecheck.ts';

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}: ${detail}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'drawtell-typecheck-'));
try {
  // 工作区写法:裸 'drawtell' 说明符,没有 tsconfig、没有 node_modules
  const good = join(dir, 'good.ts');
  writeFileSync(good, `import type { ChalkScene } from 'drawtell';
export const good: ChalkScene = { id: 'g', title: 't', model: 'm', template: 'paper-strict', problem: 'p', skeletons: [], steps: [] };
`);
  const g = await typecheckScene(good);
  check('good ran', g.ran, JSON.stringify(g.findings));
  check('good has no errors', g.findings.filter((f) => f.level === 'error').length === 0, g.findings.map((f) => f.message).join('\n'));

  const bad = join(dir, 'bad.ts');
  writeFileSync(bad, `import type { ChalkScene } from 'drawtell';
export const bad: ChalkScene = { id: 1, title: 't', model: 'm', template: 'paper-strict', problem: 'p', skeletons: [], steps: [], nope: true };
`);
  const b = await typecheckScene(bad);
  const errs = b.findings.filter((f) => f.level === 'error');
  check('bad has errors', errs.length >= 1, JSON.stringify(b.findings));
  check('bad error names file:line', errs.some((f) => /bad\.ts:\d+:\d+ TS\d+/.test(f.message)), errs.map((f) => f.message).join('\n'));

  // 仓库种子:从 ../src/player 引类型(含 .tsx),也要能过
  const seed = await typecheckScene('scenes/dengche.ts');
  check('seed dengche has no errors', seed.ran && seed.findings.filter((f) => f.level === 'error').length === 0, seed.findings.map((f) => f.message).join('\n'));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`${passed} 通过, ${failed} 失败`);
if (failed) process.exit(1);
