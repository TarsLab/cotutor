/** 无 seed 的元素按 id 派生一个稳定 seed(FNV-1a):手绘抖动不再每次渲染重新随机,
 *  bake 与 snap 可复现(重烤字节不变);作者显式给了 seed 则尊重 */
export function seedFromId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 2147483647) + 1;
}
