/**
 * 以板为主的话题:每一轮给老师的那段「板此刻的样子」(上下文包的 board:,形状在 schema 的 ContextPack.slate)。纯函数。
 * 文字每一轮都给;图只在文字说不清时给(孩子交板,src/brain/ 的 boards)。2026-11-13《画板为主设计》下篇「老师怎么看到板」:
 *   底       孩子拍的那张(路径,认出了课名就带上),没有照片就是白板
 *   全文     底上认出的正文:换底以后第一次认完那一轮给全,之后只写「未变」;还在认写「还在认」;这一轮刚发的照片不写(图随这一轮附上)
 *   你画的   老师上一次在板上画的(那张板卡的参数,图不算)
 *   开放     现在孩子能做的操作
 *   孩子做的 从上一轮到现在孩子在板上做的,合并过(点开看了哪几个字、各几次)
 *   最近点的 30 秒内点的最后一项(孩子说「这个」时指它)
 * 整段控制在 SLATE_MAX 字以内:超了先截全文。
 */
import type { BoardEvent, ContextPack } from '../../schema/index.ts';

/** 「最近点的」多久以内算(孩子说「这个」指它);起点,试用后调 */
export const RECENT_PICK_MS = 30_000;
/** 板的说明最多多少字 */
export const SLATE_MAX = 600;
export const WHITE_BOARD = '白板';

export interface SlateInput {
  /** 底:孩子最近发的那张照片(相对 workspace 根);null = 白板 */
  photo: string | null;
  /** 这一轮孩子刚发了这张照片(图随这一轮附上,全文还没认) */
  fresh: boolean;
  /** 底上认出的东西(src/scenes/photo-words/store.ts 的那份);没认、白板 = null */
  words: { state: 'running' | 'done' | 'failed'; lesson: string | null; full: readonly string[] } | null;
  /** 这个话题板的日志 */
  events: readonly BoardEvent[];
  /** 老师上一次在这块底上画的板卡:画法与参数、开放的操作;还没画 = null */
  kit: { kit: string; params: Readonly<Record<string, string>>; ops: readonly string[] } | null;
  /** 老师还没画时孩子就能做的(照片底开了认字 = 点字) */
  ops: readonly string[];
  /** 这一刻(毫秒) */
  now: number;
}

const ago = (ms: number): string => `${Math.max(1, Math.round(ms / 1000))} 秒前`;

/** 老师画的那张板卡说成一行:画法加上写了的参数(照片的「图」就是底,不重复) */
export function drawnLine(kit: NonNullable<SlateInput['kit']>): string {
  const parts = Object.entries(kit.params).filter(([k, v]) => v && k !== '图').map(([k, v]) => `${k} ${v.replace(/\|$/, '').replace(/\|/g, ' 在 ')}`);
  return parts.length ? `${kit.kit}:${parts.join(';')}` : kit.kit;
}

/** 点开看的那些合并成一句:「点开看了笔顺:傍(2 次)、晒」 */
function pickLine(picks: readonly string[]): string | null {
  if (!picks.length) return null;
  const n = new Map<string, number>();
  for (const p of picks) n.set(p, (n.get(p) ?? 0) + 1);
  return `点开看了笔顺:${[...n].map(([w, k]) => (k > 1 ? `${w}(${k} 次)` : w)).join('、')}`;
}

/** 板此刻的样子;told = 这一轮把这块底的全文给了老师(记进日志,下一轮写「未变」) */
export function slateOf(x: SlateInput): { slate: NonNullable<ContextPack['slate']>; told?: string } {
  const base = x.photo ?? WHITE_BOARD;
  const onBase = (e: BoardEvent): e is BoardEvent & { k: 'pick' } => e.k === 'pick' && e.base === base;
  // 上一轮交给老师以后的事
  let from = 0;
  x.events.forEach((e, i) => { if (e.k === 'turn') from = i + 1; });
  const since = x.events.slice(from);
  const did = [pickLine(since.filter(onBase).map((e) => e.text))].filter((s): s is string => Boolean(s));
  const last = [...x.events].reverse().find(onBase);
  const lastMs = last ? x.now - Date.parse(last.at) : Infinity;
  const recent = last && lastMs >= 0 && lastMs <= RECENT_PICK_MS ? `${last.text}(${ago(lastMs)})` : undefined;
  let text: string[] | undefined;
  let told: string | undefined;
  if (x.photo && !x.fresh && x.words) {
    const toldBefore = x.events.some((e) => e.k === 'turn' && e.told === x.photo);
    if (toldBefore) text = ['未变'];
    else if (x.words.state === 'running') text = ['还在认'];
    else if (x.words.full.length) { text = [...x.words.full]; told = x.photo; }
  }
  const lesson = x.words?.lesson;
  const slate: NonNullable<ContextPack['slate']> = {
    base: x.photo ? (lesson ? `${x.photo}(《${lesson}》)` : x.photo) : WHITE_BOARD,
    ...(text ? { text } : {}),
    ...(x.kit ? { drawn: drawnLine(x.kit) } : {}),
    ops: [...(x.kit ? x.kit.ops : x.ops)],
    did,
    ...(recent ? { recent } : {}),
  };
  // 超了先截全文(从后往前),截掉的说一句
  const size = (s: typeof slate): number => JSON.stringify(s).length;
  if (slate.text && slate.text.length > 1 && size(slate) > SLATE_MAX) {
    const all = slate.text;
    let keep = all.length;
    while (keep > 1 && size({ ...slate, text: [...all.slice(0, keep), '…'] }) > SLATE_MAX) keep--;
    slate.text = [...all.slice(0, keep), `…(后面还有 ${all.length - keep} 行,看照片)`];
  }
  return { slate, ...(told ? { told } : {}) };
}
