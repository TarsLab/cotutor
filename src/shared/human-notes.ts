/**
 * 独占一行(或几行)的 `<!-- … -->` 是给人看的(谁读、为什么,《写提示词.md》§二、§四),递给模型前剥掉;
 * 连同它前面那个换行一起去掉,规矩下面紧跟的注释剥完不留空行。行内的注释不动。
 */
export function stripHumanNotes(body: string): string {
  return body.replace(/(^|\n)[ \t]*<!--[\s\S]*?-->[ \t]*(?=\n|$)/g, '').trim();
}
