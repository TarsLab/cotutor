/**
 * 课本每一页叫什么(页名)、是什么页(src/schema/zones.ts 的 PAGE_KINDS):分块文件照页名起文件名、块的 id 照页名起头。
 * 规则出分块、cotutor textbook prep 给编程助手的 book.md 都用这一份;编程助手觉得不对的在报告里说,不改。
 *   印了页码的:页名就是页码(「4」)。
 *   没印页码、目录上有一项从这一页起的(科学的单元页「第1单元 空气和水 / 1」):照目录推(inferred)。
 *   没印页码、前后两页的页码正好隔一(中间一页漏印):照前后推(inferred)。
 *   别的没页码的:第一页「封面」;最后一页「封底」;一个字都没有的「空白」;目录页「目录-1」;
 *   印着 CIP、ISBN、责任编辑这些的「版权」;正文前面的「扉页」;正文后面开头是「后记」的「后记」;剩下的「无页码-<这本书第几张没页码的页>」。
 *   同一种第二页起加「-2」。
 *   页码重了(第二次出现的叫「12之2」)、往回走、跳了号:记进 warnings,不挡用。
 * 种类:目录上有一项单元从这一页起、紧跟着一课从下一页起的是「单元页」;目录上附录那种项(识字表)里的是「附录」;别的印了页码的是「正文」。
 * 2026-11-26 照人教统编语文二上(前 5 页、最后 3 页没页码)、人教数学二上、广东版科学二上(单元页没印页码)核过。
 */
import type { BookIndex, PageKind } from '../schema/index.ts';

export interface PageName { n: number; name: string; kind: PageKind; inferred?: true }

const COPYRIGHT = /CIP|ISBN|版权所有|责任编辑|定价|印次|印\s*刷/;
const UNIT = /^第.{1,3}单元/;

export function bookPageNames(index: Pick<BookIndex, 'pages' | 'toc' | 'lessons'>): { pages: PageName[]; warnings: string[] } {
  const warnings: string[] = [];
  const num = new Map<number, { v: number; inferred?: true }>();
  for (const p of index.pages) if (p.printed !== null) num.set(p.n, { v: p.printed });
  // 目录上的一项从没印页码的这一页起:照目录的页码
  for (const l of index.lessons) if (!num.has(l.pages[0]) && l.from >= 1 && !index.toc.includes(l.pages[0])) num.set(l.pages[0], { v: l.from, inferred: true });
  // 前后两页隔一:中间这页漏印了
  for (const p of index.pages) {
    if (num.has(p.n)) continue;
    const a = num.get(p.n - 1), b = num.get(p.n + 1);
    if (a && b && b.v - a.v === 2) num.set(p.n, { v: a.v + 1, inferred: true });
  }
  const numbered = index.pages.filter((p) => num.has(p.n)).map((p) => p.n);
  const first = numbered[0] ?? Infinity, last = numbered[numbered.length - 1] ?? -Infinity;
  const lastN = index.pages[index.pages.length - 1]?.n;
  const seen = new Map<string, number>();
  const bump = (base: string): number => { const k = (seen.get(base) ?? 0) + 1; seen.set(base, k); return k; };
  // 目录从「目录-1」起数;别的第一页不带号,第二页起「-2」
  const unique = (base: string): string => { const k = bump(base); return base === '目录' ? `目录-${k}` : k === 1 ? base : `${base}-${k}`; };
  // 单元那一项:课名就是单元名(「第1单元 空气和水」,或目录把单元名拆成 unit 和课名)
  const units = index.lessons.filter((l) => UNIT.test(l.title) || (l.unit !== null && UNIT.test(l.unit) && l.unit.endsWith(l.title)));
  const appendix = index.lessons.filter((l) => l.kind === 'other');
  let loose = 0, prev: number | null = null;
  const used = new Map<number, number>();
  const pages: PageName[] = index.pages.map((p) => {
    const hit = num.get(p.n);
    if (hit) {
      const v = hit.v;
      if (prev !== null && v <= prev) warnings.push(`PDF 第 ${p.n} 页印的页码 ${v} 没比前面的 ${prev} 大`);
      else if (prev !== null && v > prev + 1) warnings.push(`PDF 第 ${p.n} 页印的页码 ${v},前面一页是 ${prev}:跳了 ${v - prev - 1} 页`);
      prev = v;
      const times = (used.get(v) ?? 0) + 1;
      used.set(v, times);
      if (times > 1) warnings.push(`印的页码 ${v} 出现了 ${times} 次:PDF 第 ${p.n} 页叫「${v}之${times}」`);
      const name = times > 1 ? `${v}之${times}` : String(v);
      const unitPage = units.some((u) => u.pages[0] === p.n && index.lessons.some((l) => l !== u && l.pages[0] === p.n + 1));
      const kind: PageKind = unitPage ? '单元页' : appendix.some((l) => p.n >= l.pages[0] && p.n <= l.pages[1]) ? '附录' : '正文';
      return { n: p.n, name, kind, ...(hit.inferred ? { inferred: true as const } : {}) };
    }
    loose++;
    const text = p.lines.map((l) => l.text).join('');
    const kind: PageKind = index.toc.includes(p.n) ? '目录'
      : p.n === 1 ? '封面'
      : /^后\s*记/.test(text) && p.n > last ? '后记'
      : p.n === lastN && p.n > last ? '封底'
      : !text.trim() ? '空白'
      : COPYRIGHT.test(text) ? '版权'
      : p.n < first ? '扉页'
      : '正文';
    if (kind === '正文') return { n: p.n, name: `无页码-${loose}`, kind };
    return { n: p.n, name: unique(kind), kind };
  });
  return { pages, warnings };
}
