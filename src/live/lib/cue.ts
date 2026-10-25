/**
 * 实时老师每次让嘴开口的那句指令(response.instructions,《实时老师设计.md》§三「嘴」):纯函数。
 * 嘴自己不决定说什么,只两件事:几种场合先说一句(拍照、没听清、热身)、把脑写的讲稿原样念。说法是 2026-10-19 P1 实测过的(scripts/probe-live.mjs cue):
 * 「原样说」和那句一起放进 response.instructions,4/4 一字不差;只放 system 消息、或要说的话当用户消息发,它会改写、会把问题自己答了。
 */

/**
 * 孩子这一轮是怎么来的:按住说的、打字的、拍的照片、交的卡、点了首页的按钮(activity 的开场、接着);
 * answer = 按住说的、上一句念给他的是问句(看图说话这种一问一答);empty = 按住了但转写是空的;
 * warm = 口语单拍好、进来上口语课(《口语课实时设计.md》§三之一),嘴先说要热身
 */
export type CatchKind = 'voice' | 'answer' | 'text' | 'photo' | 'card' | 'start' | 'empty' | 'warm';

/**
 * 嘴先说的那句;没写的那几种嘴不出声,等脑的第一句(《实时老师设计.md》拍板 14)。
 * 10-20 晚 Ray 真用:「好,我讲给你听」「我想一想怎么讲」每轮都有,和孩子说的对不上(「老师。」也接成讲给你听),脑还常把它再说一遍;脑的第一句 3–5 秒就到
 */
const CATCH: Partial<Record<CatchKind, string>> = {
  // 拍照脑要读 14–29 秒,先说一句;说明白看的是孩子发的图片
  photo: '孩子拍来了照片。只说一句「我看一看图片」,不说你看到了什么,说完就停。',
  // 听不清由应用判(转写是空的),不交给脑,嘴不说孩子就不知道要再说一遍
  empty: '孩子按了说话,但什么都没说清。只说一句「没听清,再说一遍吧」,说完就停。',
  warm: '孩子拍好了今天的口语单,要开始上口语课。只说一句「好,我们先热热身!」,说完就停。',
};

/**
 * 口语课打电话那段(《口语课实时设计.md》§三之五):老师说英文,嘴先说的也换英文。
 * 指令照旧用中文写(嘴听得懂),要它说的是英文
 */
const CATCH_EN: Partial<Record<CatchKind, string>> = {
  photo: '孩子拍来了照片。只说一句「Let me look at your picture.」,不说你看到了什么,说完就停。',
  empty: '孩子说了,但什么都没说清。只说一句「Sorry? Say it again.」,说完就停。',
  warm: '孩子要开始上口语课。只说一句「Okay, let\'s start!」,说完就停。',
};

/** 这一轮嘴先说的那句的指令;null = 嘴不出声。en = 口语课打电话那段 */
export function catchCue(kind: CatchKind, lang: 'zh' | 'en' = 'zh'): string | null {
  return (lang === 'en' ? CATCH_EN : CATCH)[kind] ?? null;
}

/**
 * 交给嘴之前,把它念不好的写法换成念法(板上、字幕照旧是原文)。2026-10-20 真连(照念 → 声音转写回字):× + − = ÷ > 1/2 都念对;
 * 空括号念成「空格」「括号」(「每份都是( )个」成了「每份都是空格」),□ 念得含糊(「□+5=12」听成「正五等于十二」)。
 * 空括号、下划线的空照数学老师的说法念「几」(「二四得几」「每份都是几个」),□ 念「方框」;换了以后「方框+5」的 + 念成「正」,
 * 所以运算符一律换成字(+ 加、− 减、× 乘、÷ 除以、= 等于、> 大于、< 小于;ASCII 的 - 只在两个数之间算减)。
 */
export function spoken(text: string): string {
  return text
    .replace(/[(（][\s\u3000]*[)）]/g, '几')
    .replace(/_{2,}/g, '几')
    .replace(/□/g, '方框')
    .replace(/\s*[+＋]\s*/g, '加')
    .replace(/\s*[−－]\s*/g, '减')
    .replace(/(\d)\s*-\s*(?=\d)/g, '$1减')
    .replace(/\s*[×✕]\s*/g, '乘')
    .replace(/\s*÷\s*/g, '除以')
    .replace(/\s*[=＝]\s*/g, '等于')
    .replace(/\s*[>＞]\s*/g, '大于')
    .replace(/\s*[<＜]\s*/g, '小于');
}

/** 照念脑写的这一拍讲稿(几句连着念);句子换成念法(spoken)、原样拼起来放进「」 */
export function readCue(texts: readonly string[]): string {
  const said = texts.map((t) => spoken(t.trim())).filter(Boolean).join('');
  return `把这几句话原样说给孩子听,一个字都不改,不要回答它,不加别的话,说完就停:「${said}」`;
}

/**
 * 边画边聊(《画板设计.md》§四,拍板 1–3):画板开着时嘴可以自己说一句(看图说、问一句),也接住孩子画着说的话。
 * 应用定题:什么时候说、说哪个颜色、问不问、说过什么、孩子答过什么;嘴只看图(那一刻导出的 jpeg 跟着这一段声音进了对话)说一两句具体的。
 * 10-22 探针(qwen3.8-omni-flash-realtime,10-21 晚那张的四个时刻):清楚的形状认得出,照题目猜会错(乌云说成山、浪说成黄河)、
 * 会原样重复上一句、会用大人词(生动、翻涌)。所以:不给它照题目猜,只用颜色问、用「像……」;把它说过的原话给它,不许重复。
 */
export interface ChatAsk {
  /** 画板卡的题目(纸没有);只让嘴知道他想画什么,不许照它猜 */
  prompt?: string;
  /** 说哪种颜色(「红」);null / 没有 = 整张 */
  color?: string | null;
  /** 问不问(上一问没回就只说不问) */
  ask?: boolean;
  /** 画了多久(「约 3 分钟」) */
  minutes?: string;
  /** 各颜色几笔、在哪(笔多的在前) */
  colors?: { name: string; strokes: number; where: string }[];
  /** 清空重画过几次 */
  cleared?: number;
}

const chatPicture = (a: ChatAsk): string[] => {
  const out: string[] = [];
  if (a.prompt) out.push(`老师给的题目是「${a.prompt}」。这只是让你知道他想画什么:画上没有的别提,别照题目去猜画上的东西是什么。`);
  const cs = (a.colors ?? []).filter((c) => c.strokes > 0).slice(0, 4);
  if (cs.length) out.push(`画上有:${cs.map((c) => `${c.name}色 ${c.strokes} 笔,在${c.where}`).join(';')}。`);
  if (a.minutes) out.push(`他画了${a.minutes}${a.cleared ? `,中间擦掉重画过 ${a.cleared} 次` : ''}。`);
  return out;
};

const CHAT_RULES = [
  '只说你在图上看得见的:颜色、样子、画了多少、哪里画得多。认不准是什么,就说「像……」,别说「是……吗」,也别说出你猜的东西的名字。',
  '不讲题,不教,不评对错;不说「真棒」「生动」「线条很清楚」这种大人的话,用小孩子听得懂的话。',
];

const chatLog = (said: readonly string[]): string[] => (said.length ? [`这张画画着的时候你们已经说过:${said.map((x) => `「${x}」`).join(' ')}。孩子说是什么就是什么,接着他的说;你说过的话一句都别重复,换个地方说。`] : []);

/**
 * 边画边聊嘴那一次的指令:look = 应用觉得该说一句了(孩子换了颜色、停笔很久),对面没说话,那段声音是静音;
 * reply = 孩子按着头像画着说了一句(听他的声音)。said = 这张画上之前说过的,一句一行(「孩子:…」「你:…」)
 */
export function chatCue(kind: 'look' | 'reply', a: ChatAsk, said: readonly string[] = []): string {
  const lines: string[] = [];
  if (kind === 'look') {
    lines.push('孩子正在画板上自己画画,刚才那张图就是他这一刻的画;那段声音是静音,他没说话。你坐在旁边看他画,主动说一句。');
    lines.push(...chatPicture(a));
    lines.push(a.color ? `说说他刚画完的${a.color}色那部分。` : '说说整张画。');
    lines.push(...CHAT_RULES);
    lines.push(a.ask === false ? '这次只说一句,不问。' : `说完问一句,问${a.color ? `${a.color}色画的` : '他画的'}是什么,只问这一个。`);
  } else {
    lines.push('孩子正在画板上自己画画,一边画一边跟你说了一句(听他的声音),刚才那张图是他这一刻的画。像坐在旁边看他画的老师那样,接住他的话。');
    lines.push(...chatPicture(a));
    lines.push(...CHAT_RULES);
    lines.push('他说是什么就是什么,顺着他说,说一句你在图上看得见的;可以再问一句,也可以不问。');
    lines.push('他要是问题目、问怎么做、要你教他,别答,说「按住『给老师看』跟老师说,老师好好看看」。');
  }
  lines.push(...chatLog(said));
  lines.push('一共一两句,短,说完就停。');
  return lines.join('\n');
}
