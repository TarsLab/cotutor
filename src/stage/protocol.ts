/**
 * 舞台包与孩子端页面之间的 postMessage 协议(《drawtell接入与场景卡.md》§1):页面在 iframe 里装 /stage/?card=<id>,
 * 重卡(scene / canvas)的交互都在包里做,页面只管顶栏、字幕行与输入条。两边都只认带 source 的消息。
 * 这份文件不能有运行时 import(页面那边不用它,只照着写;这里是包的真相)。
 */

export const STAGE_SOURCE = 'cotutor-stage';

/** 页面 → 舞台 */
export type ToStage =
  | { source: typeof STAGE_SOURCE; type: 'card'; id: string; kind: string; props: Record<string, unknown>; state: unknown; /** 课包目录 URL(场景卡),如 /api/bundles/<id>/ */ bundleUrl?: string; /** 装好就播(讲稿 [[play]] 委托) */ autoplay?: boolean }
  | { source: typeof STAGE_SOURCE; type: 'control'; action: 'toggle' | 'next' | 'prev' | 'play' | 'pause' | 'submit' };

/** 舞台 → 页面 */
export type FromStage =
  | { source: typeof STAGE_SOURCE; type: 'ready' }
  | { source: typeof STAGE_SOURCE; type: 'phase'; phase: 'loading' | 'ready' | 'drawing' | 'gap' | 'done' | 'paused'; step: number; total: number; line: string }
  | { source: typeof STAGE_SOURCE; type: 'state'; state: unknown }
  | { source: typeof STAGE_SOURCE; type: 'submit'; state: unknown; /** 画板导出的 png(data URL),页面转存 */ image?: string }
  | { source: typeof STAGE_SOURCE; type: 'close' }
  | { source: typeof STAGE_SOURCE; type: 'error'; message: string };
