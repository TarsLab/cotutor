/**
 * 发布前的出厂检查:体检的是**要发的那份**(dist + agents/),不是仓库里直跑的 src。
 * bin 在仓库内优先走 src,所以 dist 的坏掉在本地跑不出来;prepublishOnly 在 build 之后跑这个。
 * 跑法:pnpm build && node --experimental-strip-types scripts/smoke.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  bin: Record<string, string>;
  exports: Record<string, { types?: string; default?: string } | string>;
};
const problems: string[] = [];
const need = (ok: unknown, what: string): void => void (ok || problems.push(what));

// 1. exports 与 bin 指到的文件都在(打错一个字,消费者 import 才炸)
for (const [sub, target] of Object.entries(pkg.exports)) {
  for (const f of typeof target === 'string' ? [target] : [target.types, target.default]) {
    if (f) need(existsSync(join(root, f)), `exports "${sub}" 指向的 ${f} 不在`);
  }
}
for (const [name, f] of Object.entries(pkg.bin)) need(existsSync(join(root, f)), `bin "${name}" 指向的 ${f} 不在`);

// 2. dist 的入口真能跑,--version 报的是版本号(旗标解析回归过一次)
const { main } = await import(new URL('../dist/cli/main.js', import.meta.url).href) as { main: (argv: string[]) => Promise<void> };
const write = process.stdout.write;
let out = '';
process.stdout.write = ((c: string) => ((out += c), true)) as typeof process.stdout.write;
try {
  await main(['--version']);
} finally {
  process.stdout.write = write;
}
need(out.trim() === pkg.version, `dist 的 --version 报 ${JSON.stringify(out)},应是 ${pkg.version}`);

// 3. 老师定义从 dist 出发要能找到,且随包发出去(init 靠它建链)
const { PACKAGE_AGENTS_DIR } = await import(new URL('../dist/cli/skeleton.js', import.meta.url).href) as { PACKAGE_AGENTS_DIR: string };
need(PACKAGE_AGENTS_DIR === join(root, 'agents/'), `dist 算出的 agents 目录是 ${PACKAGE_AGENTS_DIR}`);
const shipped = existsSync(PACKAGE_AGENTS_DIR) ? readdirSync(PACKAGE_AGENTS_DIR).filter((f) => f.endsWith('.md')) : [];
need(shipped.length >= 5, `agents/ 里只有 ${shipped.length} 份老师定义`);

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error('出厂检查不过,别发');
  process.exit(1);
}
console.log(`出厂检查通过:cotutor ${pkg.version},${shipped.length} 位老师,${Object.keys(pkg.exports).length} 个 export`);
