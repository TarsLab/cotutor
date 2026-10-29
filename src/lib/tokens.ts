/**
 * 一轮用了多少 token:输入(含缓存读)与输出。老师的运行时(qwen)只报 token 不报钱数,记账、显示都按它(2026-10-28 起;之前 claude 报美元)。
 * 没报 token 的轮(老数据、出错没收尾)不算进合计。
 */
export interface Tokens {
  in: number;
  out: number;
  /** 输入里命中缓存的(API 运行时报) */
  cached?: number;
  /** 最后一次请求的输入:这一轮结束时上下文多大(API 运行时报) */
  context?: number;
}

/** 几轮合起来;一轮都没报就是 null */
export function sumTokens(rows: readonly { tokens?: Tokens | null }[]): Tokens | null {
  const has = rows.flatMap((r) => (r.tokens ? [r.tokens] : []));
  return has.length ? { in: has.reduce((s, t) => s + t.in, 0), out: has.reduce((s, t) => s + t.out, 0) } : null;
}

/** 「2500 入 / 120 出 token」,API 的轮次多「(缓存 1800)· 上下文 2400」;没有就是 '' */
export function tokenText(t: Tokens | null | undefined): string {
  if (!t) return '';
  return `${t.in} 入${t.cached !== undefined ? `(缓存 ${t.cached})` : ''} / ${t.out} 出 token${t.context !== undefined ? ` · 上下文 ${t.context}` : ''}`;
}
