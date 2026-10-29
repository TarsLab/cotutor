/** 本地时间的几种写法(对话按本地日切;家长端的七天日期条按日历算) */
const pad = (n: number): string => String(n).padStart(2, '0');

/** 本地日期 YYYY-MM-DD(对话按本地日切) */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 家长端记录的七天日期条:以今天结尾、一次翻七天,date 落在哪一段就是哪七天(升序)。
 * 日期按日历算(不经时区):YYYY-MM-DD 进,YYYY-MM-DD 出
 */
export function weekOf(date: string, today: string): string[] {
  const day = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86_400_000;
  const back = Math.max(0, Math.floor((day(today) - day(date)) / 7)) * 7;
  return Array.from({ length: 7 }, (_x, i) => {
    const d = new Date((day(today) - back - 6 + i) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });
}

/** 本地时间到分钟 YYYY-MM-DDTHH:MM(上下文包的 at) */
export function localMinute(d: Date): string {
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
