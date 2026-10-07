/**
 * drawtell/core —— 纯计算,不碰 DOM、不带 React:服务端、CLI、检验都能 import。
 * 时钟(课的第 t 毫秒是什么样)、几何(包围盒,文字按量好的字宽)、圈住了什么。
 * 画出来归 drawtell/player(buildAnimatedSvg、ChalkPlayer);两边用同一份时间线(timeline)与拉伸。
 */
export { lessonClock, clockAt, frameAt, elementsAtSvgTime } from './clock.ts';
export type { LessonClock, LessonSegment, LessonFrame } from './clock.ts';
export { charEm, measureText, elementBounds, sceneBounds, unionBounds, boundsGap, samplePoints, insidePolygon, boundsOfPoints, pointsOf } from './geometry.ts';
export type { Bounds, BoundsTuple } from './geometry.ts';
export { circleHits, describeCircle, hitPhrase, colorWord } from './circle.ts';
export type { CircleHit, CircleResult, LessonPicture } from './circle.ts';
export { paintElement, renderFrameSvg, bakedPaths, progressMap, pointerBox, pictureHash, bakeMatches } from './bake.ts';
export type { BakedLesson, BakedPicture, BakedElement, BakedNode, ElementPaint, PathPaint, FrameProgress, RenderOptions } from './bake.ts';
export { CHAR_EM, CJK_EM, FALLBACK_EM, LINE_HEIGHT } from './text-metrics.ts';
export { computeStepWindows, durationOf, freezeTimeSec, FREEZE_EPS_MS, START_MS, stretchToAudio } from '../player/timeline.ts';
export type { StretchInfo, StepWindow } from '../player/timeline.ts';
export type { ChalkScene, ChalkSkeleton, ChalkStep, ChalkBlock, ChalkGroup, ChalkSubscene, ChalkBackground } from '../player/types.ts';
