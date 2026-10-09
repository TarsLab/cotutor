/**
 * drawtell/core —— 纯计算,不碰 DOM、不带 React:服务端、CLI、检验都能 import。
 * 时钟(课的第 t 毫秒是什么样)、几何(包围盒,文字按量好的字宽)、圈住了什么。
 * 课包怎么读(parseBundle)、元素交给 excalidraw 前怎么预处理(prepareSkeletons)也在这里。
 * 画出来归 drawtell/render(mountBaked)与 drawtell/player(ChalkPlayer);两边用同一份时间线(timeline)与拉伸。
 */
export { lessonClock, clockAt, frameAt, elementsAtSvgTime, boardAtSvgTime } from './clock.ts';
export type { LessonClock, LessonSegment, LessonFrame, FrameElement, ElementWindow } from './clock.ts';
export { isAction, resolveActions, finalBoard } from './actions.ts';
export type { ResolvedActions, ResolvedBoard } from './actions.ts';
export { charEm, measureText, elementBounds, sceneBounds, unionBounds, boundsGap, samplePoints, insidePolygon, boundsOfPoints, pointsOf } from './geometry.ts';
export type { Bounds, BoundsTuple } from './geometry.ts';
export { circleHits, describeCircle, hitPhrase, colorWord } from './circle.ts';
export type { CircleHit, CircleResult, LessonPicture } from './circle.ts';
export { BAKE_VERSION, actionState, boardOf, paintElement, renderFrameSvg, bakedPaths, strokeGroups, progressMap, pointerBox, pictureHash, bakeMatches } from './bake.ts';
export type { ActionState, BakedBoard, BakedLesson, BakedPicture, BakedElement, BakedNode, ElementPaint, PathPaint, FrameProgress, RenderOptions } from './bake.ts';
export { parseBundle, assembleBundle, BundleError } from './bundle.ts';
export type { LessonBundle } from './bundle.ts';
export { prepareSkeletons, isEraser } from './prepare.ts';
export { CHAR_EM, CJK_EM, FALLBACK_EM, LINE_HEIGHT } from './text-metrics.ts';
export { computeStepWindows, durationOf, freezeTimeSec, FREEZE_EPS_MS, START_MS, stretchToAudio } from '../player/timeline.ts';
export type { StretchInfo, StepWindow } from '../player/timeline.ts';
export type { ChalkScene, ChalkSkeleton, ChalkErase, ChalkBoard, ChalkStep, ChalkBlock, ChalkGroup, ChalkSubscene, ChalkBackground } from '../player/types.ts';
