/**
 * 以板为主的话题里板的日志:`conversations/<老师>/<date>.<话题>.board.jsonl`,一件事一行(2026-11-13《画板为主设计》下篇)。
 * 孩子在板上做的事经实时那条连接一条一条报来(src/runtime/live/call.ts 的 {t:'board'}),应用记的(哪一轮把板交给了老师)也在这里。
 * 进上下文的是合并过的结果(src/runtime/context/board-pack.ts);过程留在这里,录像回放、查认字漏了哪里、以后统计「哪些字孩子总点」都靠它。
 * 底(这块板垫的照片)不记在这里:就是这个话题里孩子最近发的那张照片(索引里有)。课本做底时 base 是「册子的文件名#课名」(目录是「#目录」)。
 */
import { z } from 'zod';

/** 点的一项最多几个字符(田字格一张最多四个字;英文单词最多 20 个字母) */
export const BOARD_PICK_CHARS = 20;

export const BoardEventSchema = z.discriminatedUnion('k', [
  /** 孩子点开看了一个字词(应用弹了田字格);base = 那块底(照片的路径,相对 workspace 根) */
  z.object({ at: z.string().min(1), k: z.literal('pick'), text: z.string().min(1).max(BOARD_PICK_CHARS), base: z.string().min(1) }),
  /** 孩子点开了一处盖住的拼音(老师写的「遮」);base 同上 */
  z.object({ at: z.string().min(1), k: z.literal('reveal'), text: z.string().min(1).max(BOARD_PICK_CHARS), base: z.string().min(1) }),
  /** 应用把板交给老师的那一轮(上下文包里有 board: 的那条);told = 这一轮把这块底认出的全文给了老师 */
  z.object({ at: z.string().min(1), k: z.literal('turn'), job: z.string().min(1), told: z.string().optional() }),
  /** 课本做底:孩子自己挪了、放大了窗,停下来的地方(应用照课本说成一句:「第 55 页:第 7 段」);base = 「册子#课」 */
  z.object({ at: z.string().min(1), k: z.literal('view'), text: z.string().min(1).max(80), base: z.string().min(1) }),
  /**
   * 课本做底:窗停下来以后舞台交来的一张窗里的图(老师移完、孩子挪完、落了笔;src/ui/stage/book.tsx 的 shoot),text 是那一块的名字(同 view)。
   * 图只留最新一张(<date>.<话题>.shot.jpg);下一轮交给老师时挪成那一轮的(<date>.<job>.shot.jpg)、附给脑
   */
  z.object({ at: z.string().min(1), k: z.literal('shot'), text: z.string().min(1).max(80), base: z.string().min(1) }),
  /** 一节课(课本):孩子落了一笔;wipe = 擦掉了自己画的(笔画本身在一节课的状态里,这里只记几时、在哪一页) */
  z.object({ at: z.string().min(1), k: z.literal('ink'), base: z.string().min(1), wipe: z.literal(true).optional() }),
  /** 孩子动了手以后一直没出声,应用替他叫了一次老师(下一轮 live.app: still) */
  z.object({ at: z.string().min(1), k: z.literal('still') }),
]);
export type BoardEvent = z.infer<typeof BoardEventSchema>;
