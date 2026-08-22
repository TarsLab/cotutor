/**
 * 播放器数据面。
 *
 * 场景语言 = excalidraw skeleton(契约 1),这里只声明我们消费的最小面,
 * 深路径类型脆弱,一律不 import excalidraw 内部类型。
 * 运行时校验在 src/schema/scene.ts(zod),两处结构保持对齐。
 */

/** skeleton 元素:draw 顺序 = 数组顺序;id 保持干净,单笔时长走 animateDuration 字段 */
export interface ChalkSkeleton {
  type: string;
  id: string;
  x: number;
  y: number;
  /** 单笔时长(毫秒),缺省 500;由 excalidraw-io 注回 id 喂给 excalidraw-animate */
  animateDuration?: number;
  [key: string]: unknown;
}

export interface ChalkStep {
  step: number;
  /** 本步揭示的元素,必须与 skeleton 顺序连续对齐(模板保证笔顺) */
  elementIds: string[];
  /** 讲稿。v1 换 TTS 音轨,当前作字幕 */
  line: string;
  /** 步后气口:停,等孩子点一下(接力交互) */
  pauseAfter: boolean;
  /** 相对课包目录的音频路径,TTS 就绪后启用 */
  audioSrc?: string;
  /** 该步讲稿音频时长(毫秒),由 dub 写入;播放器据此把该步笔画拉伸到讲稿长度(只拉不缩) */
  audioDurationMs?: number;
}

export interface ChalkScene {
  id: string;
  title: string;
  /** 题面,读题环节展示 */
  problem: string;
  /** 讲解模型名:时间数轴、实物图…… */
  model: string;
  /** 讲解模板三档(架构.md) */
  template: 'paper-strict' | 'camera-free' | 'motion';
  skeletons: ChalkSkeleton[];
  steps: ChalkStep[];
}

export type ChalkPhase = 'loading' | 'ready' | 'drawing' | 'gap' | 'done';
