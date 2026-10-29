/**
 * 长话题的前情(API 运行时整段压缩的那一轮用,src/runtime/runner.ts):照索引按先后拼——
 * 孩子的原话(交卡、拍照、交画、看小课堂各写成一句)、老师说的讲稿、出过的卡(种类与标签);最后一轮的卡给全,孩子可能正在答。
 * 不交给模型去摘:不花钱、不用等、不会编出孩子没说过的话(你说我画那种要一句句攒孩子故事的,原话一个字不能动)。
 */
import { cardLabel } from '../../board/cards/index.ts';
import type { ConversationMessage } from '../../schema/index.ts';

export const DIGEST_HEAD = '(应用注:这个话题前面聊得长了,之前的对话不再原样给你。下面是前面的经过,按先后:孩子的原话、你说过的话、出过的卡。接着往下教,讲过的、做过的别再重复。)';

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** messages:这个话题里这一轮之前的消息,按先后 */
export function threadDigest(messages: readonly ConversationMessage[]): string {
  const out = [DIGEST_HEAD];
  messages.forEach((m, i) => {
    const last = i === messages.length - 1;
    if (m.bookkeep) out.push('应用:(记账)');
    else {
      const did = [
        m.text.trim(),
        m.photos?.length ? `(拍了 ${m.photos.length} 张照片)` : '',
        m.drawing ? '(交了一张画)' : '',
        m.lecture ? `(看完小课堂「${m.lecture.title}」)` : '',
        ...(m.cards ?? []).map((c) => `(卡 ${c.card}:${c.text})`),
      ].filter(Boolean);
      out.push(`${m.from === 'kid' ? '孩子' : '应用'}:${clip(did.join(' '), m.from === 'kid' ? 2000 : 200)}`);
    }
    if (m.result === 'error') {
      out.push('老师:(这一轮没回完)');
      return;
    }
    const said = (m.section?.lines ?? []).map((l) => l.text).join(' ') || m.kidText || '';
    const cards = (m.section?.cards ?? []).map((c) => (last ? `${c.kind}:${clip(JSON.stringify(c.props), 600)}` : `${c.kind}「${cardLabel(c)}」`));
    out.push(`老师:${said}${cards.length ? ` [卡:${cards.join(';')}]` : ''}`);
  });
  return out.join('\n');
}
