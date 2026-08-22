/**
 * 场景契约的运行时校验(zod)。
 * 类型真相在 src/player/types.ts,本 schema 与之对齐,文件底部用赋值断言在编译期锁住。
 * 校验错误面向 agent:每条都要能指出改哪里(agent-friendly.md)。
 */

import { z } from 'zod';
import type { ChalkScene } from '../player/types.ts';

/** 已在引擎(convertToExcalidrawElements + animateSvg)上验证过的元素类型 */
export const KNOWN_ELEMENT_TYPES = [
  'rectangle',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'text',
  'freedraw',
] as const;

/** 元素允许携带 excalidraw 的任意属性(strokeColor、points、text……),故 loose */
export const skeletonSchema = z.looseObject({
  type: z.string().min(1),
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  animateDuration: z.number().int().positive().optional(),
});

/** 步结构固定,strict 抓字段拼写错误(pauseAfer 这类) */
export const stepSchema = z.strictObject({
  step: z.number().int().min(1),
  elementIds: z.array(z.string().min(1)).min(1),
  line: z.string().min(1),
  pauseAfter: z.boolean(),
  audioSrc: z.string().min(1).optional(),
  audioDurationMs: z.number().positive().optional(),
});

export const sceneSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id 用作课包目录名,只允许小写字母、数字、连字符'),
  title: z.string().min(1),
  problem: z.string().min(1),
  model: z.string().min(1),
  template: z.enum(['paper-strict', 'camera-free', 'motion']),
  skeletons: z.array(skeletonSchema).min(1),
  steps: z.array(stepSchema).min(1),
});

// 编译期断言:zod 推导结果可赋给播放器类型,两份契约不漂移
const assertAligned = (s: z.infer<typeof sceneSchema>): ChalkScene => s;
void assertAligned;
