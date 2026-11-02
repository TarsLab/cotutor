#!/usr/bin/env node
/**
 * 薄壳:仓库内直跑 src/app/cli/main.ts(Node ≥22.18 原生 type stripping,零构建迭代);
 * npm 包不含 src,回退到 dist/app/cli/main.js(tsc 产物,prepublishOnly 保证已构建)。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 版本不够先说清楚:不然源码直跑报「Unknown file extension .ts」,npm 装的报「没有 stripTypeScriptTypes」,都带一串栈(Windows 自带的常是 Node 18)
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`cotutor: 要 Node ≥ 22.18,这台是 ${process.versions.node}。到 https://nodejs.org 装新的 LTS 版,装好重开终端再跑。`);
  process.exit(2);
}

const src = new URL('../src/app/cli/main.ts', import.meta.url);
const entry = existsSync(fileURLToPath(src)) ? src : new URL('../dist/app/cli/main.js', import.meta.url);
try {
  const { main } = await import(entry.href);
  await main(process.argv.slice(2));
} catch (err) {
  console.error(`cotutor: 内部错误:${err?.stack ?? err}`);
  process.exitCode = 4;
}
