/**
 * 舞台包 import 的 .css 由 esbuild 打进 dist/stage/stage.css,TypeScript 只要认得这种 import。
 * TypeScript 6 起 noUncheckedSideEffectImports 缺省开(VS Code 自带的就是 6),没有这句 main.tsx 的两行 css 报找不到模块。
 */
declare module '*.css';
