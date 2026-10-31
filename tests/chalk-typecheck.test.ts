/**
 * 类型层回归:check 内嵌的 tsc 能认出 `import type … from 'cotutor/chalk'`(工作区零配置;并进来之前写的 'drawtell' 照认),
 * 对好场景 0 错,对写错字段的场景给出带行列的 TS 错误。
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { typecheckScene } from '../src/app/cli/chalk/typecheck.ts';
import { check, done } from './_check.ts';

const dir = mkdtempSync(join(tmpdir(), 'chalk-typecheck-'));
try {
  // 工作区写法:裸 'cotutor/chalk' 说明符,没有 tsconfig、没有 node_modules
  const good = join(dir, 'good.ts');
  writeFileSync(good, `import type { ChalkScene } from 'cotutor/chalk';
export const good: ChalkScene = { id: 'g', title: 't', model: 'm', template: 'paper-strict', problem: 'p', skeletons: [], steps: [] };
`);
  const g = await typecheckScene(good);
  check('good ran', g.ran, JSON.stringify(g.findings));
  check('good has no errors', g.findings.filter((f) => f.level === 'error').length === 0, g.findings.map((f) => f.message).join('\n'));

  const bad = join(dir, 'bad.ts');
  writeFileSync(bad, `import type { ChalkScene } from 'cotutor/chalk';
export const bad: ChalkScene = { id: 1, title: 't', model: 'm', template: 'paper-strict', problem: 'p', skeletons: [], steps: [], nope: true };
`);
  const b = await typecheckScene(bad);
  const errs = b.findings.filter((f) => f.level === 'error');
  check('bad has errors', errs.length >= 1, JSON.stringify(b.findings));
  check('bad error names file:line', errs.some((f) => /bad\.ts:\d+:\d+ TS\d+/.test(f.message)), errs.map((f) => f.message).join('\n'));

  // 并进来之前写的场景:'drawtell' 说明符照认
  const old = join(dir, 'old.ts');
  writeFileSync(old, `import type { ChalkScene } from 'drawtell';
export const old: ChalkScene = { id: 'o', title: 't', model: 'm', template: 'paper-strict', problem: 'p', skeletons: [], steps: [] };
`);
  const o = await typecheckScene(old);
  check('old drawtell specifier still resolves', o.ran && o.findings.filter((f) => f.level === 'error').length === 0, o.findings.map((f) => f.message).join('\n'));

  // 年级包里的例子(平均分)
  const example = await typecheckScene(fileURLToPath(new URL('../grades/grade-2/examples/2026-10-27-pingjunfen.ts', import.meta.url)));
  check('grade example has no errors', example.ran && example.findings.filter((f) => f.level === 'error').length === 0, example.findings.map((f) => f.message).join('\n'));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

done();
