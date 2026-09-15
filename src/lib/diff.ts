/**
 * 行级 diff(最长公共子序列),给「回放前后」并排看:上下文包哪几行变了、讲稿哪几句变了、读的文件多了少了。
 * 行数是几十到几百,O(n·m) 够用;两边乘积超过四百万就退化成逐行对齐,免得表爆。
 */
export interface DiffRow {
  s: '+' | '-' | '·';
  text: string;
}

export function diffLines(a: readonly string[], b: readonly string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  if (a.length * b.length > 4_000_000) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] === b[i]) rows.push({ s: '·', text: a[i] });
      else {
        if (a[i] !== undefined) rows.push({ s: '-', text: a[i] });
        if (b[i] !== undefined) rows.push({ s: '+', text: b[i] });
      }
    }
    return rows;
  }
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ s: '·', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ s: '-', text: a[i] }); i++; }
    else { rows.push({ s: '+', text: b[j] }); j++; }
  }
  while (i < n) rows.push({ s: '-', text: a[i++] });
  while (j < m) rows.push({ s: '+', text: b[j++] });
  return rows;
}

/** 只留变了的行和前后各 ctx 行(像 diff -U);跳过的地方给一行「… 略 N 行」;全一样就全留 */
export function compactDiff(rows: DiffRow[], ctx = 2): DiffRow[] {
  if (rows.every((r) => r.s === '·')) return rows;
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((r, k) => { if (r.s !== '·') for (let d = -ctx; d <= ctx; d++) if (rows[k + d]) keep[k + d] = true; });
  const out: DiffRow[] = [];
  let skipped = 0;
  rows.forEach((r, k) => {
    if (keep[k]) { if (skipped) { out.push({ s: '·', text: `… 略 ${skipped} 行` }); skipped = 0; } out.push(r); }
    else skipped++;
  });
  if (skipped) out.push({ s: '·', text: `… 略 ${skipped} 行` });
  return out;
}
