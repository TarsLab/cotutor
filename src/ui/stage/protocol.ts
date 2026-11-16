/**
 * 舞台包与孩子端页面之间的 postMessage 协议:页面在 iframe 里装 /stage/?card=<id>,
 * 重卡(小课堂 / 教具)的交互都在包里做,页面只管顶栏、字幕行与输入条。两边都只认带 source 的消息。
 * 这份文件不能有运行时 import(页面那边不用它,只照着写;这里是包的真相)。
 */

export const STAGE_SOURCE = 'cotutor-stage';

/** 页面 → 舞台 */
export type ToStage =
  | { source: typeof STAGE_SOURCE; type: 'card'; id: string; kind: string; props: Record<string, unknown>; state: unknown; /** 课包目录 URL(小课堂),如 /api/bundles/<id>/ */ bundleUrl?: string; /** 照片板的那张照片的 URL,如 /api/kid/image?p=captures/… */ imageUrl?: string; /** 照片板开放了「点字」:这张照片认出的字词从哪读,如 /api/kid/photo-words?p=captures/… */ wordsUrl?: string; /** 装好就播(讲稿 [[play]] 委托) */ autoplay?: boolean; /** 交给老师过了:教具只看,不能再动 */ readonly?: boolean; /** 教具铺满:题目在页面顶栏,工具一列、底下给老师的小头像留一格;hand = left 工具在右 */ full?: boolean; hand?: 'left' | 'right' }
  /** 一节课此刻的样子(src/schema/lesson.ts):页面一句一句落好老师的动作、孩子做的事也落上,变了就发;舞台照它画课本(book.tsx) */
  | { source: typeof STAGE_SOURCE; type: 'lesson'; id: string; lesson: unknown; readonly?: boolean; hand?: 'left' | 'right' }
  /** peek = 板此刻的样子导一张小图(话题的预览图,首页「今天」用;回 peek) */
  | { source: typeof STAGE_SOURCE; type: 'control'; action: 'toggle' | 'next' | 'prev' | 'play' | 'pause' | 'submit' | 'peek' }
  /** 家长看录像时的小课堂(card props.follow):录像这一刻停在课里的哪儿、在不在放、倍速、到这一刻画过的几处;页面每 100 毫秒发一次 */
  | { source: typeof STAGE_SOURCE; type: 'follow'; ms: number; playing: boolean; rate: number; marks: unknown[] };

/** 舞台 → 页面 */
export type FromStage =
  | { source: typeof STAGE_SOURCE; type: 'ready' }
  | { source: typeof STAGE_SOURCE; type: 'phase'; phase: 'drawing' | 'paused' | 'done'; step: number; total: number; line: string }
  /** 教具:{turn, moves, marks}(转到多少度、按了几次、画的几笔) */
  | { source: typeof STAGE_SOURCE; type: 'state'; state: unknown }
  /** 照片板的「点字」:孩子点中了一个字词(一到四个汉字),页面在板上面弹它的田字格 */
  | { source: typeof STAGE_SOURCE; type: 'pick'; text: string }
  /** 照片板上点开了一块盖住的拼音(老师写的「遮」) */
  | { source: typeof STAGE_SOURCE; type: 'reveal'; text: string }
  /** 课本:孩子自己挪了窗、放大了,停下来的地方(场景坐标 [左, 上, 右, 下]);页面报给服务端说成一句给老师 */
  | { source: typeof STAGE_SOURCE; type: 'view'; box: [number, number, number, number] }
  /** 课本:窗停下来以后窗里那一块的图(jpeg data URL,长边 1024);页面交给服务端,下一轮附给老师 */
  | { source: typeof STAGE_SOURCE; type: 'shot'; box: [number, number, number, number]; image: string }
  | { source: typeof STAGE_SOURCE; type: 'submit'; state: unknown; /** 板导出的 png(data URL),页面转存 */ image?: string }
  /** 一节课(课本):孩子落了一笔(场景坐标)/ 擦掉了自己画的;页面照 lessonStep 改状态、报给服务端 */
  | { source: typeof STAGE_SOURCE; type: 'stroke'; pts: [number, number][] }
  | { source: typeof STAGE_SOURCE; type: 'wipe' }
  /** control peek 的回话:板此刻的样子(长边 480 的 jpeg data URL;课本是窗里那块;导不出、小课堂这种不是板的 null) */
  | { source: typeof STAGE_SOURCE; type: 'peek'; image: string | null }
  | { source: typeof STAGE_SOURCE; type: 'close' }
  /** 小课堂:放到结尾一次 = finished(停在最后一帧,页面不收);孩子按回去 = close;放完点「去问老师」= ask。都带看了多久、停过几次 */
  | { source: typeof STAGE_SOURCE; type: 'lecture'; event: 'finished' | 'close' | 'ask'; watchedMs: number; finished: boolean; pauses: number }
  /** 小课堂看的过程一条(录像用):那一刻(Date.now())停在课里的哪儿、之后在不在放 */
  | { source: typeof STAGE_SOURCE; type: 'watch'; at: number; pos: number; play: boolean }
  /** 小课堂里画了 / 擦了 / 截好图了:整张单子(时刻、SVG 停在哪、课包坐标的几笔、截图);页面是画的主人(卡 props.marks 发进来的就是它) */
  | { source: typeof STAGE_SOURCE; type: 'marks'; marks: { atMs: number; svgMs: number; strokes: [number, number][][]; image?: string; at?: number }[] }
  | { source: typeof STAGE_SOURCE; type: 'error'; message: string };
