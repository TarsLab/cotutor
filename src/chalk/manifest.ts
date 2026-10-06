/**
 * 课包(lesson bundle)输出契约 —— build 的产物,serve/播放器的输入。
 * 自包含目录:scene.json + manifest.json(+ audio/,TTS 就绪后)。
 * 前身是 growth-apps packages/schema 的 LessonManifestDraft,随架构重设计迁入并定版 v1。
 */

import type { ChalkBlock, ChalkScene, ChalkStep, ChalkSubscene } from '../player/types.ts';

export interface SceneJson {
  schema: 'chalk-scene';
  version: 1;
  id: string;
  title: string;
  problem: string;
  model: string;
  template: ChalkScene['template'];
  subject?: string;
  /** 背景图;src 相对课包目录(build 拷进来的 background.<ext>) */
  background?: ChalkScene['background'];
  skeletons: ChalkScene['skeletons'];
}

/**
 * 切分线:scene.json = 静态画面(家长在编辑器看到的),manifest = 怎么播、怎么交互。
 * v2 新增的 blocks(圈词命中)与 subscenes(弹窗)都是交互,随 steps 落 manifest;
 * 子场景连几何一起整体落这里——弹窗不属于主画面,拆两半反而破坏自包含。
 * v1 课包(无 blocks/subscenes,steps 恒非空)读取路径不变,照常可播。
 */
export interface LessonManifest {
  schema: 'lesson-manifest';
  version: 2;
  steps: LessonStep[];
  blocks?: ChalkBlock[];
  subscenes?: ChalkSubscene[];
}

/** line 兼作字幕;audioSrc 指向课包内 audio/ 文件,audioDurationMs 是它的时长(dub 写入,与 audioSrc 同生命周期) */
export type LessonStep = Pick<ChalkStep, 'step' | 'elementIds' | 'line' | 'pauseAfter' | 'audioSrc' | 'audioDurationMs'>;
