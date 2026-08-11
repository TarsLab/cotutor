/**
 * 课包(lesson bundle)输出契约 —— build 的产物,serve/播放器的输入。
 * 自包含目录:scene.json + manifest.json(+ audio/,TTS 就绪后)。
 * 前身是 growth-apps packages/schema 的 LessonManifestDraft,随架构重设计迁入并定版 v1。
 */

import type { ChalkScene, ChalkStep } from '../player/types';

export interface SceneJson {
  schema: 'chalk-scene';
  version: 1;
  id: string;
  title: string;
  problem: string;
  model: string;
  template: ChalkScene['template'];
  skeletons: ChalkScene['skeletons'];
}

export interface LessonManifest {
  schema: 'lesson-manifest';
  version: 1;
  steps: LessonStep[];
}

/** line 暂充字幕;TTS 就绪后 audioSrc 指向课包内 audio/ 文件 */
export type LessonStep = Pick<ChalkStep, 'step' | 'elementIds' | 'line' | 'pauseAfter' | 'audioSrc'>;
