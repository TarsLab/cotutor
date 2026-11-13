/**
 * 以板为主的话题里板的日志:`conversations/<老师>/<date>.<话题>.board.jsonl`,一件事一行(2026-11-13《画板为主设计》下篇)。
 * 孩子在板上做的事经实时那条连接一条一条报来(src/runtime/live/call.ts 的 {t:'board'}),应用记的(哪一轮把板交给了老师)也在这里。
 * 进上下文的是合并过的结果(src/runtime/context/board-pack.ts);过程留在这里,录像回放、查认字漏了哪里、以后统计「哪些字孩子总点」都靠它。
 * 底(这块板垫的照片)不记在这里:就是这个话题里孩子最近发的那张照片(索引里有)。
 */
import { z } from 'zod';

/** 一行最多几个字(田字格一张最多四个字;英语单词以后放宽) */
export const BOARD_PICK_CHARS = 4;

export const BoardEventSchema = z.discriminatedUnion('k', [
  /** 孩子点开看了一个字词(应用弹了田字格);base = 那块底(照片的路径,相对 workspace 根) */
  z.object({ at: z.string().min(1), k: z.literal('pick'), text: z.string().min(1).max(BOARD_PICK_CHARS * 2), base: z.string().min(1) }),
  /** 应用把板交给老师的那一轮(上下文包里有 board: 的那条);told = 这一轮把这块底认出的全文给了老师 */
  z.object({ at: z.string().min(1), k: z.literal('turn'), job: z.string().min(1), told: z.string().optional() }),
  /** 孩子动了手以后一直没出声,应用替他叫了一次老师(下一轮 live.app: still) */
  z.object({ at: z.string().min(1), k: z.literal('still') }),
]);
export type BoardEvent = z.infer<typeof BoardEventSchema>;
