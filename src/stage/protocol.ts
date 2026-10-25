/**
 * 舞台包与孩子端页面之间的 postMessage 协议:页面在 iframe 里装 /stage/?card=<id>,
 * 重卡(小课堂 / 画板)的交互都在包里做,页面只管顶栏、字幕行与输入条。两边都只认带 source 的消息。
 * 这份文件不能有运行时 import(页面那边不用它,只照着写;这里是包的真相)。
 */

export const STAGE_SOURCE = 'cotutor-stage';

/** 页面 → 舞台 */
export type ToStage =
  | { source: typeof STAGE_SOURCE; type: 'card'; id: string; kind: string; props: Record<string, unknown>; state: unknown; /** 课包目录 URL(小课堂、画板的底),如 /api/bundles/<id>/ */ bundleUrl?: string; /** 画板底图是一张图(照片)时它的 URL,如 /api/kid/image?p=captures/… */ imageUrl?: string; /** 装好就播(讲稿 [[play]] 委托) */ autoplay?: boolean; /** 交给老师过了:画板只看,不能再画 */ readonly?: boolean; /** 画板铺满(《画板设计.md》§二):题目在页面顶栏,工具一列、底下给老师的小头像留一格;hand = left 工具在右 */ full?: boolean; hand?: 'left' | 'right' }
  /** snap = 画板导一张这一刻的 jpeg 回来(边画边聊给嘴看,回 snap) */
  | { source: typeof STAGE_SOURCE; type: 'control'; action: 'toggle' | 'next' | 'prev' | 'play' | 'pause' | 'submit' | 'snap' }
  /** 家长看录像时的小课堂(card props.follow):录像这一刻停在课里的哪儿、在不在放、倍速、到这一刻画过的几处;页面每 100 毫秒发一次 */
  | { source: typeof STAGE_SOURCE; type: 'follow'; ms: number; playing: boolean; rate: number; marks: unknown[] };

/** 舞台 → 页面 */
export type FromStage =
  | { source: typeof STAGE_SOURCE; type: 'ready' }
  | { source: typeof STAGE_SOURCE; type: 'phase'; phase: 'drawing' | 'paused' | 'done'; step: number; total: number; line: string }
  | { source: typeof STAGE_SOURCE; type: 'state'; state: unknown }
  | { source: typeof STAGE_SOURCE; type: 'submit'; state: unknown; /** 画板导出的 png(data URL),页面转存 */ image?: string }
  /** 画板清空了(要点两下):清空的时刻、那一版第一笔画完的时刻、几笔、清空前的图(jpeg data URL,页面转存进 captures/)(《画板设计.md》拍板 9) */
  | { source: typeof STAGE_SOURCE; type: 'cleared'; at: number; from?: number; strokes: number; image?: string }
  /** control snap 的回话:这一刻的画(长边 768 的 jpeg data URL;还没画是 null) */
  | { source: typeof STAGE_SOURCE; type: 'snap'; image: string | null }
  | { source: typeof STAGE_SOURCE; type: 'close' }
  /** 小课堂(《小课堂设计.md》):放到结尾一次 = finished(停在最后一帧,页面不收);孩子按回去 = close;放完点「去问老师」= ask。都带看了多久、停过几次 */
  | { source: typeof STAGE_SOURCE; type: 'lecture'; event: 'finished' | 'close' | 'ask'; watchedMs: number; finished: boolean; pauses: number }
  /** 小课堂看的过程一条(录像用):那一刻(Date.now())停在课里的哪儿、之后在不在放 */
  | { source: typeof STAGE_SOURCE; type: 'watch'; at: number; pos: number; play: boolean }
  /** 小课堂里画了 / 擦了 / 截好图了:整张单子(时刻、SVG 停在哪、课包坐标的几笔、截图);页面是画的主人(卡 props.marks 发进来的就是它) */
  | { source: typeof STAGE_SOURCE; type: 'marks'; marks: { atMs: number; svgMs: number; strokes: [number, number][][]; image?: string; at?: number }[] }
  | { source: typeof STAGE_SOURCE; type: 'error'; message: string };
