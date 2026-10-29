/**
 * 把一个纯函数文件内联进页面的脚本:仓库里是 .ts(剥类型),npm 包里是 dist 的 .js;去掉 export 与 import 行。
 * kid-page 的板书(board/presentation.ts)、声音(runtime/delivery/player.ts)、photo-edit、reel,听写页的录像都走这里。
 */
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

export function inlineScript(ts: URL): string {
  let src: string;
  try {
    const text = readFileSync(ts, 'utf8');
    // stripTypeScriptTypes 会发一条 ExperimentalWarning;这里只剥自己的文件,警告对用户没有信息量,压掉
    const warn = process.emitWarning;
    process.emitWarning = () => {};
    try {
      src = stripTypeScriptTypes(text);
    } finally {
      process.emitWarning = warn;
    }
  } catch {
    src = readFileSync(new URL(ts.href.replace(/\.ts$/, '.js')), 'utf8');
  }
  return src
    .replace(/^export (?=(?:async )?(?:function|const|let|class) )/gm, '')
    .replace(/^export \{[^}]*\};?[ \t]*$/gm, '')
    .replace(/^import [^\n]*$/gm, '');
}
