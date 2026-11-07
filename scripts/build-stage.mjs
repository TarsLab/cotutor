/**
 * 舞台包:src/ui/stage/(React + 课包的画面 src/ui/stage/chalk/ + excalidraw)→ dist/stage/stage.js + chunk-*.js + stage.css + index.html(esbuild)。
 * 字体进包(2026-11-07 起):excalidraw 的字体拷到 dist/stage/fonts/,index.html 把 EXCALIDRAW_ASSET_PATH 指到 /stage/。
 * 这样运行时不要 excalidraw、react、react-dom 这几个包(它们只在打包时用,在 devDependencies):装 cotutor 从 275 个包变 15 个、346 MB 变 123 MB,
 * Windows 上第一次装从 3 分钟变 1 分钟;画板、小课堂、做课包在两种装法下逐项一样(实测过,见 docs/wip/长期运行方案.md)。
 * react / react-dom / excalidraw 强制解析到本包的 node_modules(不钉住的话,link 进来的包会打进两份 React)。
 * src/chalk 的模块没有副作用(package.json 的 sideEffects 只认 css):舞台只用 assembleBundle,zod 与场景契约整个摇掉,首屏不带。
 *
 * **splitting: true**(2026-09-11):整包 8 MB,但其中 mermaid / cytoscape / katex 这些是 excalidraw
 * 自己用 `import()` 懒加载的,不拆就被 esbuild 全部内联进一个文件,开个场景卡也得先下 8 MB。
 * 拆开之后打开舞台只要 stage.js + 它静态依赖的那几个 chunk(约 1.3 MB),其余按需取;
 * 画板卡的编辑器再由 main.tsx 的 lazy import 单独成块。chunk 是 stage.js 的相对 import,
 * 服务端 `/stage/<文件>` 本来就整目录给(src/app/http/stage.ts),不用另配路由。
 *
 * 跑法:pnpm run build:stage(prepublishOnly 也跑);开发时缺了 doctor 点名。
 */
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkgDir = (name) => join(root, 'node_modules', name);
const out = join(root, 'dist', 'stage');
await mkdir(out, { recursive: true });
const t0 = Date.now();
const r = await build({
  entryPoints: [join(root, 'src', 'ui', 'stage', 'main.tsx')],
  bundle: true,
  outdir: out,
  entryNames: 'stage',
  chunkNames: 'chunk-[hash]',
  splitting: true,
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
<link rel="stylesheet" href="/kid/theme.css">
<link rel="stylesheet" href="/stage/stage.css">
<div id="root"></div>
<script type="module" src="/stage/stage.js"></script>
</html>
`,
);
// 字体:运行时从这里给(src/app/http/stage.ts 的 fontsDir),不再找 node_modules 里的 excalidraw
await rm(join(out, 'fonts'), { recursive: true, force: true });
await cp(join(pkgDir('@excalidraw/excalidraw'), 'dist', 'prod', 'fonts'), join(out, 'fonts'), { recursive: true });
// 打开舞台立刻要下的 = 入口 + 它的静态 import 链(其余 chunk 由 excalidraw / 画板的 import() 按需取)
const outs = r.metafile.outputs;
const entry = Object.keys(outs).find((f) => outs[f].entryPoint?.endsWith('main.tsx'));
const eager = new Set();
const walk = (f) => {
  if (!f || eager.has(f) || !outs[f]) return;
  eager.add(f);
  for (const im of outs[f].imports ?? []) if (im.kind === 'import-statement') walk(im.path);
};
walk(entry);
for (const f of Object.keys(outs)) if (f.endsWith('.css')) eager.add(f);
const kb = (b) => `${(b / 1024).toFixed(0)}K`;
const sum = (files) => files.reduce((n, f) => n + outs[f].bytes, 0);
const js = Object.keys(outs).filter((f) => f.endsWith('.js'));
console.log(
  `build:stage ${((Date.now() - t0) / 1000).toFixed(1)}s\n` +
    `  入口与首屏:${[...eager].map((f) => `${f.replace(/^.*dist\//, 'dist/')} ${kb(outs[f].bytes)}`).join(' + ')}\n` +
    `  = 打开舞台先下 ${kb(sum([...eager]))};按需 chunk ${js.length - [...eager].filter((f) => f.endsWith('.js')).length} 个,合计 ${kb(sum(js) - sum([...eager].filter((f) => f.endsWith('.js'))))}`,
);
