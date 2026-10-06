/**
 * 舞台包与孩子端页面之间的 postMessage 协议:页面在 iframe 里装 /stage/?card=<id>,
 * 重卡(scene / canvas)的交互都在包里做,页面只管顶栏、字幕行与输入条。两边都只认带 source 的消息。
 * 这份文件不能有运行时 import(页面那边不用它,只照着写;这里是包的真相)。
 */

export const STAGE_SOURCE = 'cotutor-stage';

/** 页面 → 舞台 */
export type ToStage =
  | { source: typeof STAGE_SOURCE; type: 'card'; id: string; kind: string; props: Record<string, unknown>; state: unknown; /** 课包目录 URL(场景卡),如 /api/bundles/<id>/ */ bundleUrl?: string; /** 画板底图是一张图(照片)时它的 URL,如 /api/kid/image?p=captures/… */ imageUrl?: string; /** 装好就播(讲稿 [[play]] 委托) */ autoplay?: boolean }
  | { source: typeof STAGE_SOURCE; type: 'control'; action: 'toggle' | 'next' | 'prev' | 'play' | 'pause' | 'submit' }
  /** 家长看录像时的小课堂(card props.follow):录像这一刻停在课里的哪儿、在不在放、倍速、到这一刻圈过的几处;页面每 100 毫秒发一次 */
  | { source: typeof STAGE_SOURCE; type: 'follow'; ms: number; playing: boolean; rate: number; marks: unknown[] };

/** 舞台 → 页面 */
export type FromStage =
  | { source: typeof STAGE_SOURCE; type: 'ready' }
  | { source: typeof STAGE_SOURCE; type: 'phase'; phase: 'loading' | 'ready' | 'drawing' | 'gap' | 'done' | 'paused'; step: number; total: number; line: string }
  | { source: typeof STAGE_SOURCE; type: 'state'; state: unknown }
  | { source: typeof STAGE_SOURCE; type: 'submit'; state: unknown; /** 画板导出的 png(data URL),页面转存 */ image?: string }
  | { source: typeof STAGE_SOURCE; type: 'close' }
  /** 小课堂(《小课堂设计.md》):放到结尾一次 = finished;孩子按回去 = close。都带看了多久、停过几次 */
  | { source: typeof STAGE_SOURCE; type: 'lecture'; event: 'finished' | 'close'; watchedMs: number; finished: boolean; pauses: number }
  /** 小课堂看的过程一条(录像用):那一刻(Date.now())停在课里的哪儿、之后在不在放 */
  | { source: typeof STAGE_SOURCE; type: 'watch'; at: number; pos: number; play: boolean }
  /** 小课堂里圈了 / 擦了:整张单子(时刻、SVG 停在哪、课包坐标的路径);页面是圈的主人(卡 props.marks 发进来的就是它) */
  | { source: typeof STAGE_SOURCE; type: 'marks'; marks: { atMs: number; svgMs: number; path: [number, number][] }[] }
  /** 小课堂的 SVG 装好了(播放器顺手发;页面也可以装一个看不见的舞台 kind lecture-svg 专门要):原样的 SVG 与课包坐标 → SVG 坐标的平移,页面拿它画圈的卡 */
  | { source: typeof STAGE_SOURCE; type: 'svg'; markup: string; dx: number; dy: number }
  | { source: typeof STAGE_SOURCE; type: 'error'; message: string };
