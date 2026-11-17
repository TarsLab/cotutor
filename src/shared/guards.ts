/**
 * 裁段:activity 文件的「老师怎么带」里,只在家长填了某个参数时才要的段落用 `{{有 名}}` … `{{/有}}` 包起来(src/runtime/activity.ts)。纯函数,不读文件。
 */
/** 守卫行;名字是 activity 的参数名 */
export const GUARD_OPEN = /^\{\{有((?:\s+[^\s{}]+)+)\}\}\s*$/;
export const GUARD_CLOSE = /^\{\{\/有\}\}\s*$/;

/**
 * `{{有 x y}}` 到 `{{/有}}` 之间的行,x、y 都「有」(has)才留;守卫行本身不留,能套。删掉一段留下的连续空行并成一行。守卫不配对就抛。
 */
export function applyGuards(text: string, has: (name: string) => boolean): string {
  const keep: boolean[] = [];
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const open = GUARD_OPEN.exec(line);
    if (open) {
      keep.push(open[1].trim().split(/\s+/).every(has));
      continue;
    }
    if (GUARD_CLOSE.test(line)) {
      if (!keep.length) throw new Error('{{/有}} 多了一个');
      keep.pop();
      continue;
    }
    if (keep.every(Boolean)) out.push(line);
  }
  if (keep.length) throw new Error('{{有 …}} 没有配对的 {{/有}}');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
