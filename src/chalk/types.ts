/**
 * 播放器数据面。
 *
 * 场景语言 = excalidraw skeleton(契约 1),这里只声明我们消费的最小面,
 * 深路径类型脆弱,一律不 import excalidraw 内部类型。
 * 运行时校验在 src/schema/scene.ts(zod),两处结构保持对齐。
 */

/**
 * 三层墨迹(交互重新设计的 InkLayerKind):
 * base = 生成的底层(家长验收,锁定,永久);ink = 孩子手写(持久,是数据);
 * feedback = 系统反馈(高亮、弹窗,短暂,用完自清)。
 * 场景文件里的元素缺省即 base;ink/feedback 是运行时产物,场景一般不落它们。
 * 标记放 customData.layer(excalidraw 编辑器往返可保全),不占顶层字段。
 */
export type ChalkLayer = 'base' | 'ink' | 'feedback';

/** skeleton 元素:draw 顺序 = 数组顺序;id 保持干净,单笔时长走 animateDuration 字段 */
export interface ChalkSkeleton {
  type: string;
  id: string;
  x: number;
  y: number;
  /** 单笔时长(毫秒),缺省 500;由 excalidraw-io 注回 id 喂给 excalidraw-animate */
  animateDuration?: number;
  /** excalidraw 自定义数据;协议只认领 layer 一个键(见 ChalkLayer),其余透传 */
  customData?: { layer?: ChalkLayer; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * 词/字级命中块:孩子圈中(或点中)后播词音频、可再弹出子场景。
 * 命中区域 = elementIds 所指底层元素包围盒的并——块锚在元素上,家长在编辑器里
 * 挪动词块,命中区跟着走,不存坐标副本。
 */
export interface ChalkBlock {
  id: string;
  /** 组成该词条的底层元素(可跨相邻多个 text,如重点字母色拆出的 r + am) */
  elementIds: string[];
  /** 词条文本(英文单词或汉字串);与元素文本一致性由 check 把关,事件记录也用它 */
  text: string;
  /** 圈中即播,相对课包目录(如 audio/tokens/ram.mp3) */
  audioSrc?: string;
  /** 圈中后弹出的子场景(subscenes[].id);与 audioSrc 至少给一个,否则块无事发生 */
  subsceneId?: string;
}

/**
 * 子场景 = 弹窗:excalidraw fill 方框打底的小场景,逐笔画出、读完倒放擦除
 * (反馈层生命周期,永不留存)。坐标系独立于主场景,叠放位置是运行时决定。
 */
export interface ChalkSubscene {
  id: string;
  skeletons: ChalkSkeleton[];
  /** 可选步进(带讲稿);缺省 = 一笔到底连续画完 */
  steps?: ChalkStep[];
  /** 整窗音频(如慢速拼读),相对课包目录 */
  audioSrc?: string;
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
  /** 讲解模型名:时间数轴、实物图……;静态场景写生成来源(如 reading-page) */
  model: string;
  /** 讲解模板三档(架构.md)+ static(静态场景:无时间轴的点读/圈读页,steps 必空) */
  template: 'paper-strict' | 'camera-free' | 'motion' | 'static';
  skeletons: ChalkSkeleton[];
  /** 空数组 = 静态场景(装载即整幅定格);讲解三档必须非空,check 把关 */
  steps: ChalkStep[];
  /** 词/字级命中块;缺省 = 本场景没有块逻辑 */
  blocks?: ChalkBlock[];
  /** 弹窗子场景;由 blocks[].subsceneId 触发 */
  subscenes?: ChalkSubscene[];
}

export type ChalkPhase = 'loading' | 'ready' | 'drawing' | 'gap' | 'done';
