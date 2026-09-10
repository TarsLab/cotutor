/**
 * 舞台包:src/stage/(React + drawtell 播放器 + excalidraw)→ dist/stage/stage.js + stage.css + index.html(esbuild)。
 * 字体不进包:index.html 把 EXCALIDRAW_ASSET_PATH 指到 /stage/,serve 从 node_modules 的 excalidraw 里提供 /stage/fonts/。
 * react / react-dom / excalidraw 强制解析到本包的 node_modules(drawtell 是 link 进来的,不钉住会打进两份 React)。
 * 跑法:pnpm run build:stage(prepublishOnly 也跑);开发时缺了 doctor 点名。
 */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkgDir = (name) => join(root, 'node_modules', name);
const out = join(root, 'dist', 'stage');
await mkdir(out, { recursive: true });
const t0 = Date.now();
const r = await build({
  entryPoints: [join(root, 'src', 'stage', 'main.tsx')],
  bundle: true,
  outdir: out,
  entryNames: 'stage',
  format: 'esm',
  target: ['es2020', 'safari15'],
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.IS_PREACT': '"false"' },
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'dataurl', '.png': 'dataurl' },
  alias: { react: pkgDir('react'), 'react-dom': pkgDir('react-dom'), '@excalidraw/excalidraw': pkgDir('@excalidraw/excalidraw') },
  logLevel: 'warning',
  metafile: true,
});
await writeFile(
  join(out, 'index.html'),
  `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>stage</title>
<script>window.EXCALIDRAW_ASSET_PATH = '/stage/';</script>
<link rel="stylesheet" href="/stage/stage.css">
<div id="root"></div>
<script type="module" src="/stage/stage.js"></script>
</html>
`,
);
const sizes = Object.entries(r.metafile.outputs).map(([f, o]) => `${f.replace(/^.*dist\//, 'dist/')} ${(o.bytes / 1024).toFixed(0)}K`);
console.log(`build:stage ${((Date.now() - t0) / 1000).toFixed(1)}s\n  ${sizes.join('\n  ')}`);
