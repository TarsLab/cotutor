/**
 * 阶梯层 1:把场景 TS 模块求值成对象。
 * 依赖 Node ≥22.18 的原生 type stripping;场景必须是纯数据模块
 * (类型用 import type,运行时值导入在 CLI 环境解析不了)。
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 调用方给错了(路径不存在)→ exit 2 */
export class NotFoundError extends Error {}
/** 场景文件本身有问题(求值失败/没导出场景)→ exit 1 */
export class LoadError extends Error {}

export async function loadScene(file: string): Promise<{ raw: unknown; exportName: string }> {
  const abs = resolve(file);
  try {
    await stat(abs);
  } catch {
    throw new NotFoundError(`找不到场景文件:${file}。检查路径;场景文件通常在 scenes/ 下,如 scenes/dengche.ts`);
  }
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
  } catch (err) {
    throw new LoadError(
      `场景模块求值失败(层 1):${err instanceof Error ? err.message : String(err)}\n` +
        '场景文件须是纯数据模块:类型用 import type 引入,不要 import 运行时值。',
    );
  }
  if (mod.default && typeof mod.default === 'object') {
    return { raw: mod.default, exportName: 'default' };
  }
  const names = Object.keys(mod).filter((k) => k !== 'default');
  const sceneish = names.filter((k) => {
    const v = mod[k];
    return typeof v === 'object' && v !== null && 'skeletons' in v && 'steps' in v;
  });
  if (sceneish.length === 1) return { raw: mod[sceneish[0]], exportName: sceneish[0] };
  if (sceneish.length === 0) {
    throw new LoadError(
      `模块没有导出场景对象(需含 skeletons 与 steps 字段)。现有导出:${names.join(', ') || '(无)'}。用 export default 或单个具名导出。`,
    );
  }
  throw new LoadError(
    `模块导出了多个场景(${sceneish.join(', ')}),无法确定目标。一个文件一个场景,或用 export default 指定。`,
  );
}
