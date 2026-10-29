/**
 * 按卡裁的段落(《卡片协议.md》「谁拿到哪些卡」):板书写法的手写部分(cards/板书怎么写.md)与守则(cotutor-tutor)里,
 * 只对某几种卡有用的段落用 `{{有 x y}}` … `{{/有}}` 包起来,递给某位老师时按他的卡留或去。纯函数,不读文件。
 * activity 文件的「老师怎么带」也用它,名字还可以是参数(填了才留,src/runtime/activity.ts)。
 */
/** 守卫行;名字是卡的种类(英文小写),或 activity 的参数名(汉字,src/runtime/activity.ts) */
export const GUARD_OPEN = /^\{\{有((?:\s+[^\s{}]+)+)\}\}\s*$/;
export const GUARD_CLOSE = /^\{\{\/有\}\}\s*$/;

/**
 * 按卡裁的段落:`{{有 x y}}` 到 `{{/有}}` 之间的行,x、y 都在 kinds 里才留;守卫行本身不留,能套。
 * 删掉一段留下的连续空行并成一行。守卫不配对就抛(gen:skills 与测试先红)。
 */
export function applyCardGuards(text: string, kinds: readonly string[]): string {
  return applyGuards(text, (name) => kinds.includes(name));
}

/** 同上,「有没有」由 has 定:activity 递给老师时,名字是参数就看填没填,是卡就看这个话题有没有 */
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
