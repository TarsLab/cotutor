/**
 * chalk-player 数据面。
 *
 * 场景语言 = excalidraw skeleton(架构.md 契约 1),这里只声明我们消费的最小面,
 * 深路径类型脆弱,一律不 import excalidraw 内部类型。
 * 步结构对齐 schema 的 LessonManifestDraft(M4 定稿前,音频字段可缺省)。
 */

/** skeleton 元素:draw 顺序 = 数组顺序;id 内可携带 `animateDuration:毫秒` 控制单笔时长 */
export interface ChalkSkeleton {
  type: string;
  id: string;
  x: number;
  y: number;
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
