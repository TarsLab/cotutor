/**
 * 课包 → 场景(纯函数,浏览器外可用):scene.json + manifest.json 拼回 ChalkScene,过一遍 zod。
 * 取文件是调用方的事(浏览器 fetch、Node readFile);拼法与校验只有这一份,播放页、CLI、应用都用它。
 * parseBundle 拼 + 校验;assembleBundle 只拼(信得过的课包,省掉 zod)。
 * 课包可能是旧版本或被手改过,错误要能说清楚改哪里。
 */

import { sceneSchema } from '../schema/scene.ts';
import type { ChalkScene } from '../player/types.ts';
import type { BoundsTuple } from './geometry.ts';
import type { LessonPicture } from './circle.ts';

export interface LessonBundle {
  scene: ChalkScene;
  /** build 时量好的包围盒(scene.json 的 bounds);老课包没有 */
  bounds?: Record<string, BoundsTuple>;
  /** 圈住了什么要的画面语义(分组、命中块、包围盒),直接交给 circleHits */
  picture: LessonPicture;
}

export class BundleError extends Error {
  override name = 'BundleError';
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isBounds(v: unknown): v is Record<string, BoundsTuple> {
  return isObject(v) && Object.values(v).every((b) => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number'));
}

/** scene.json 与 manifest.json 拼回场景的样子(还没校验) */
function joinBundle(sceneJson: Record<string, unknown>, manifest: Record<string, unknown>): Record<string, unknown> {
  return {
    id: sceneJson.id,
    title: sceneJson.title,
    problem: sceneJson.problem,
    model: sceneJson.model,
    template: sceneJson.template,
    ...(sceneJson.subject != null ? { subject: sceneJson.subject } : {}),
    ...(sceneJson.background != null ? { background: sceneJson.background } : {}),
    skeletons: sceneJson.skeletons,
    ...(sceneJson.groups != null ? { groups: sceneJson.groups } : {}),
    steps: manifest.steps,
    ...(manifest.blocks != null ? { blocks: manifest.blocks } : {}),
    ...(manifest.subscenes != null ? { subscenes: manifest.subscenes } : {}),
  };
}

function withPicture(scene: ChalkScene, sceneJson: Record<string, unknown>): LessonBundle {
  const bounds = sceneJson.bounds as Record<string, BoundsTuple> | undefined;
  return {
    scene,
    ...(bounds ? { bounds } : {}),
    picture: {
      ...(scene.groups ? { groups: scene.groups } : {}),
      ...(scene.blocks ? { blocks: scene.blocks } : {}),
      ...(bounds ? { bounds } : {}),
    },
  };
}

/** 两份 JSON(已 parse)→ 场景,过 zod;不合契约抛 BundleError(消息不带课包名,调用方加) */
export function parseBundle(sceneJson: unknown, manifest: unknown): LessonBundle {
  if (!isObject(sceneJson)) throw new BundleError('scene.json 不是对象');
  if (!isObject(manifest)) throw new BundleError('manifest.json 不是对象');
  const parsed = sceneSchema.safeParse(joinBundle(sceneJson, manifest));
  if (!parsed.success) {
    const first = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')}:${i.message}`)
      .join(';');
    throw new BundleError(`不符合场景契约:${first}`);
  }
  if (sceneJson.bounds != null && !isBounds(sceneJson.bounds)) throw new BundleError('scene.json 的 bounds 不是「元素 id → [minX, minY, maxX, maxY]」');
  return withPicture(parsed.data, sceneJson);
}

/**
 * 只拼不校验:信得过的课包(自己的服务端读过、校验过)在浏览器里用它,首屏不为 zod 付钱
 * (只 import 它,打包时 zod 会被摇掉)。缺省值同 schema:steps 缺了是空数组。
 */
export function assembleBundle(sceneJson: Record<string, unknown>, manifest: Record<string, unknown>): LessonBundle {
  const joined = joinBundle(sceneJson, manifest);
  return withPicture({ ...joined, steps: joined.steps ?? [] } as ChalkScene, sceneJson);
}
