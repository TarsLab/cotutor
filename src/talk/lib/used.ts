/** 口语单上哪些词句在通话里出现过(纯函数;家长回看用) */

export interface ListItem { en: string; zh: string }
export interface TalkList { words: ListItem[]; sentences: ListItem[] }
export interface Line { who: 'tutor' | 'kid'; text: string; at: number; phase: 'read' | 'chat'; item?: number }

const norm = (s: string): string => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** 一条词句在一句话里出现没:词按整词找,句子按去标点后的子串找 */
export function appears(item: string, text: string): boolean {
  const a = norm(item);
  const t = norm(text);
  if (!a || !t) return false;
  if (a.includes(' ')) return (' ' + t + ' ').includes(' ' + a + ' ');
  return (' ' + t + ' ').includes(' ' + a + ' ');
}

export interface Used { words: { en: string; tutor: number; kid: number }[]; sentences: { en: string; tutor: number; kid: number }[] }

/** 聊那段里每条词句老师说了几次、孩子说了几次(跟读段不算:那是照着读的) */
export function usedIn(list: TalkList, lines: Line[]): Used {
  const chat = lines.filter((l) => l.phase === 'chat');
  const count = (en: string, who: 'tutor' | 'kid'): number => chat.filter((l) => l.who === who && appears(en, l.text)).length;
  const tally = (items: ListItem[]): { en: string; tutor: number; kid: number }[] => items.map((it) => ({ en: it.en, tutor: count(it.en, 'tutor'), kid: count(it.en, 'kid') }));
  return { words: tally(list.words), sentences: tally(list.sentences) };
}

/** 跟读的顺序:先词后句 */
export function itemsOf(list: TalkList): ListItem[] {
  return [...list.words, ...list.sentences].filter((it) => it.en.trim());
}
