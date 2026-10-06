/**
 * 场景契约的运行时校验(zod)。
 * 类型真相在 src/player/types.ts,本 schema 与之对齐,文件底部用赋值断言在编译期锁住。
 * 校验错误面向 agent:每条都要能指出改哪里(README「Design principles」)。
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
  // customData 透传 excalidraw,协议认领 layer(三层墨迹契约)与 tool(橡皮)两个键
  customData: z
    .looseObject({
      layer: z.enum(['base', 'ink', 'feedback']).optional(),
      tool: z.enum(['eraser']).optional(),
    })
    .optional(),
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

/** 命中块:锚在元素上(不存坐标副本);audioSrc / subsceneId 至少一个,lint 把关 */
export const blockSchema = z.strictObject({
  id: z.string().min(1),
  elementIds: z.array(z.string().min(1)).min(1),
  text: z.string().min(1),
  audioSrc: z.string().min(1).optional(),
  subsceneId: z.string().min(1).optional(),
});

/** 弹窗子场景:独立坐标系的小场景,steps 可选(缺省一笔到底) */
export const subsceneSchema = z.strictObject({
  id: z.string().min(1),
  skeletons: z.array(skeletonSchema).min(1),
  steps: z.array(stepSchema).optional(),
  audioSrc: z.string().min(1).optional(),
});

/** 背景图:画板 = 图片,场景坐标即图片像素 */
export const backgroundSchema = z.strictObject({
  src: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const sceneSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id 用作课包目录名,只允许小写字母、数字、连字符'),
  title: z.string().min(1),
  problem: z.string().min(1),
  model: z.string().min(1),
  template: z.enum(['paper-strict', 'camera-free', 'motion', 'static']),
  subject: z.string().min(1).optional(),
  background: backgroundSchema.optional(),
  skeletons: z.array(skeletonSchema).min(1),
  // 可省略 = 静态场景;规范形是空数组。「讲解三档必须非空、static 必须空」是语义,归 lint
  steps: z.array(stepSchema).default([]),
  blocks: z.array(blockSchema).optional(),
  subscenes: z.array(subsceneSchema).optional(),
});

// 编译期断言:zod 推导结果可赋给播放器类型,两份契约不漂移
const assertAligned = (s: z.infer<typeof sceneSchema>): ChalkScene => s;
void assertAligned;
