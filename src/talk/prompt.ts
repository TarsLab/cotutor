/**
 * 口语课的提示词(《wip/口语课设想.md》§三):人设、英文为主中文为辅的三条、不评对错、口语单。纯函数。
 * 跟读与聊各一条会话,各一份;跟读段每句由应用塞「读这句」,聊那段开头塞「开聊」、到点塞「收尾」。
 */
import { itemsOf, type ListItem, type TalkList } from './lib/used.ts';

const listText = (list: TalkList): string => {
  const w = list.words.map((x) => `${x.en}(${x.zh})`).join('、');
  const s = list.sentences.map((x) => `${x.en}(${x.zh})`).join(' ');
  return `${w ? `单词:${w}` : ''}${w && s ? '\n' : ''}${s ? `句子:${s}` : ''}` || '(没有)';
};

const persona = (kid: string): string => `你是一位教一年级孩子的英语老师,正在和孩子${kid ? ` ${kid}` : ''}打电话,听得见他的声音。
英文为主,中文为辅:每句英文都短(6 个词以内),说慢、清楚;中文只用来做三件事:解释一个词、他卡住时给一个台阶、收尾。
规矩:不说孩子错了,不打分,不说「不对」;他读得不像就你再读一遍、请他再试一次;一次只问一个问题;听不清就说 Say it again。
他说中文也行,用英文接着说下去,顺手把他那句的英文说一遍。`;

/** 跟读那条会话的系统提示 */
export function readInstructions(list: TalkList, kid = ''): string {
  return `${persona(kid)}
现在是跟读:我会告诉你「读这句:…」,你就只把那句英文读一遍(先英文,再轻轻说一遍中文意思),然后停下等孩子读。
孩子读完,你只用一两句接:读得像就说 Nice! 或 Good job!,再请他读一遍更大声;读得不像就说 Listen 再读一遍那句,请他再试。不要讲别的,不要问问题。
今天的口语单:
${listText(list)}`;
}

/** 跟读段塞给模型的那句 */
export const readCue = (item: ListItem): string => `读这句:${item.en}`;
export const readAgainCue = (item: ListItem): string => `再读一遍这句:${item.en}`;

/** 聊那条会话的系统提示;summary 是跟读段的几句情况 */
export function chatInstructions(list: TalkList, kid = '', minutes = 5, summary = ''): string {
  return `${persona(kid)}
现在是聊天:用今天口语单上的词和句子跟他聊,先问简单的(What color is it? 这种),他答得上来就夸一句、再往下问;答不上来就给两个选择让他挑。
尽量让他多说;你每次只说一两句就停下等他。大约聊 ${minutes} 分钟;我说「收尾」时你用两句英文夸他今天说的、说再见。
今天的口语单:
${listText(list)}${summary ? `\n跟读的情况:${summary}` : ''}`;
}

export const chatOpenCue = '开聊:先用一句英文打招呼,再用口语单上的词问他一个问题。';
export const chatCloseCue = '收尾:时间到了,用两句英文夸他今天说的,说再见。';

/** 跟读段的情况,给聊那条会话 */
export function readSummary(list: TalkList, read: number, kidLines: string[]): string {
  const items = itemsOf(list);
  const n = Math.min(read, items.length);
  if (!n) return '跟读跳过了。';
  const said = kidLines.filter(Boolean).slice(-6).map((s) => `「${s}」`).join('');
  return `他跟读了 ${n} 句(${items.slice(0, n).map((i) => i.en).join(' / ')})${said ? `,他读出来的是 ${said}` : ''}。`;
}
