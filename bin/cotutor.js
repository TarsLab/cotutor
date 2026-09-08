#!/usr/bin/env node
/**
 * 薄壳:仓库内直跑 src/cli/main.ts(Node ≥22.18 原生 type stripping,零构建迭代);
 * npm 包不含 src,回退到 dist/cli/main.js(tsc 产物,prepublishOnly 保证已构建)。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = new URL('../src/cli/main.ts', import.meta.url);
const entry = existsSync(fileURLToPath(src)) ? src : new URL('../dist/cli/main.js', import.meta.url);
try {
  const { main } = await import(entry.href);
  await main(process.argv.slice(2));
} catch (err) {
  console.error(`cotutor: 内部错误:${err?.stack ?? err}`);
  process.exitCode = 4;
}
