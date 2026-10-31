/**
 * chalk —— 画面引擎(2026-10-31 从 drawtell 并进来,历史在 git log 里):纯计算,不碰 DOM、不带 React,服务端、命令、舞台都能 import。
 * 时钟(课的第 t 毫秒是什么样)、几何(包围盒,文字按量好的字宽)、圈住了什么、擦掉与换画板、烤好的画面怎么逐笔露出来。
 * 课包怎么读(parseBundle)、元素交给 excalidraw 前怎么预处理(prepareSkeletons)也在这里;场景检查在 check.ts,字母笔顺在 glyphs/。
 * 只能在浏览器里跑的(画烤好的画面 mountBaked、用 excalidraw 烤)在 src/ui/stage/chalk/;做课包的命令在 src/app/cli/chalk/(cotutor chalk)。
 */
export { lessonClock, clockAt, frameAt, elementsAtSvgTime, boardAtSvgTime } from './clock.ts';
export type { LessonClock, LessonSegment, LessonFrame, FrameElement, ElementWindow } from './clock.ts';
export { isAction, resolveActions, finalBoard } from './actions.ts';
export type { ResolvedActions, ResolvedBoard } from './actions.ts';
export { charEm, measureText, elementBounds, sceneBounds, unionBounds, boundsGap, samplePoints, insidePolygon, boundsOfPoints, pointsOf } from './geometry.ts';
export type { Bounds, BoundsTuple } from './geometry.ts';
export { circleHits, describeCircle, hitPhrase, colorWord } from './circle.ts';
export type { CircleHit, CircleResult, LessonPicture } from './circle.ts';
export { BAKE_VERSION, actionState, boardOf, paintElement, renderFrameSvg, bakedPaths, strokeGroups, progressMap, pointerBox, pictureHash, bakeMatches } from './paint.ts';
export type { ActionState, BakedBoard, BakedLesson, BakedPicture, BakedElement, BakedNode, ElementPaint, PathPaint, FrameProgress, RenderOptions } from './paint.ts';
export { parseBundle, assembleBundle, BundleError } from './bundle.ts';
export type { LessonBundle } from './bundle.ts';
export { prepareSkeletons, isEraser } from './prepare.ts';
export { CHAR_EM, CJK_EM, FALLBACK_EM, LINE_HEIGHT } from './text-metrics.ts';
export { computeStepWindows, durationOf, freezeTimeSec, FREEZE_EPS_MS, START_MS, stretchToAudio } from './timeline.ts';
export type { StretchInfo, StepWindow } from './timeline.ts';
export type { ChalkScene, ChalkSkeleton, ChalkErase, ChalkBoard, ChalkStep, ChalkBlock, ChalkGroup, ChalkSubscene, ChalkBackground } from './types.ts';
