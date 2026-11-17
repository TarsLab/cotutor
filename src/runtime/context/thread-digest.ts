/**
 * 长话题的前情(API 运行时整段压缩的那一轮用,src/runtime/runner.ts):照索引按先后拼——
 * 孩子的原话(「给老师看」、拍照、看小课堂各写成一句)、老师说的讲稿。
 * 不交给模型去摘:不花钱、不用等、不会编出孩子没说过的话(要一句句攒孩子原话的话题,原话一个字不能动)。
 * 铺着页的一节课最后加一段「讲到哪了」(lessonProgress):照讲稿里落到页上的动作数,翻过哪几页、看过哪几处、现在在哪,不让模型自己总结。
 */
import type { ConversationMessage } from '../../schema/index.ts';

export const DIGEST_HEAD = '(应用注:这个话题前面聊得长了,之前的对话不再原样给你。下面是前面的经过,按先后:孩子的原话、你说过的话。接着往下教,讲过的、做过的别再重复。)';

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** messages:这个话题里这一轮之前的消息,按先后 */
export function threadDigest(messages: readonly ConversationMessage[]): string {
  const out = [DIGEST_HEAD];
  messages.forEach((m) => {
    if (m.bookkeep) out.push('应用:(记账)');
    else {
      const did = [
        m.text.trim(),
        m.photos?.length ? `(拍了 ${m.photos.length} 张照片)` : '',
        m.lecture ? `(看完小课堂「${m.lecture.title}」)` : '',
      ].filter(Boolean);
      out.push(`${m.from === 'kid' ? '孩子' : '应用'}:${clip(did.join(' '), m.from === 'kid' ? 2000 : 200)}`);
    }
    if (m.result === 'error') {
      out.push('老师:(这一轮没回完)');
      return;
    }
    const said = (m.section?.lines ?? []).map((l) => l.text).join(' ') || m.kidText || '';
    out.push(`老师:${said}`);
  });
  const at = lessonProgress(messages);
  if (at) out.push(at);
  return out.join('\n');
}

/** 一节课讲到哪了:翻过的页、看过的几处(照先后,同一处只记一次)、最后看的那一处;没落过动作的话题回 null */
export function lessonProgress(messages: readonly ConversationMessage[]): string | null {
  const turned: string[] = [], looked: string[] = [];
  let now: string | null = null;
  for (const m of messages) {
    const sec = m.section;
    if (!sec) continue;
    for (const a of [...(sec.acts ?? []), ...sec.lines.flatMap((l) => l.acts ?? [])]) {
      if (a.do?.k === '翻') { if (!turned.includes(a.do.page.title)) turned.push(a.do.page.title); now = null; }
      if (a.do?.k === '看') { if (!looked.includes(a.do.label)) looked.push(a.do.label); now = a.do.label; }
    }
  }
  if (!turned.length && !looked.length) return null;
  return `讲到哪了(应用照你落到页上的动作数的):${[turned.length ? `翻过 ${turned.join('、')}` : '', looked.length ? `看过 ${looked.join('、')}` : '', now ? `最后在看 ${now}` : ''].filter(Boolean).join(';')}。页上印的字这一轮重给了。`;
}
