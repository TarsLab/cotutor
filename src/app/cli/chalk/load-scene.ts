/**
 * 阶梯层 1:把场景源变成对象。两条创作路,同一收敛点(checkScene):
 * - TS 纯数据模块(讲解场景;依赖 Node ≥22.18 原生 type stripping,类型用 import type)
 * - 双文件目录(生成器/excalidraw 编辑器产物):scene.excalidraw(画面)+ scene.json(信封:
 *   除 skeletons 外的全部 ChalkScene 字段——id/title/blocks/subscenes…)
 */

import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 调用方给错了(路径不存在)→ exit 2 */
export class NotFoundError extends Error {}
/** 场景文件本身有问题(求值失败/没导出场景)→ exit 1 */
export class LoadError extends Error {}

/** 双文件场景源的固定文件名(约定即引用) */
export const ENVELOPE_FILE = 'scene.json';
export const EXCALIDRAW_FILE = 'scene.excalidraw';

/** 输入分发:目录或 scene.json 路径 = 双文件;其余 = TS 模块 */
export async function resolveSceneInput(file: string): Promise<{ kind: 'ts' } | { kind: 'files'; dir: string }> {
  const abs = resolve(file);
  let st;
  try {
    st = await stat(abs);
  } catch {
    throw new NotFoundError(
      `找不到场景源:${file}。TS 场景通常在 scenes/ 下(如 scenes/dengche.ts);双文件场景给目录(内含 ${ENVELOPE_FILE} + ${EXCALIDRAW_FILE})`,
    );
  }
  if (st.isDirectory()) return { kind: 'files', dir: abs };
  if (basename(abs) === ENVELOPE_FILE) return { kind: 'files', dir: dirname(abs) };
  return { kind: 'ts' };
}

async function readJsonFile(path: string, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new NotFoundError(`双文件场景缺 ${basename(path)}(${what}):${path} 不存在。${ENVELOPE_FILE} 与 ${EXCALIDRAW_FILE} 必须同目录`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new LoadError(`${basename(path)} 不是合法 JSON:${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 双文件 → 与 TS 路同形的 raw 对象:信封字段 + skeletons(excalidraw 元素,滤掉 isDeleted)。
 * 深校验不在这里——合并后的对象走 checkScene(schema + lint),错误信息同一套。
 */
export async function loadSceneFiles(dir: string): Promise<{ raw: unknown; exportName: string }> {
  const envelope = await readJsonFile(join(dir, ENVELOPE_FILE), '信封');
  const exca = await readJsonFile(join(dir, EXCALIDRAW_FILE), '画面');

  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw new LoadError(`${ENVELOPE_FILE} 应是对象(场景源信封),拿到 ${Array.isArray(envelope) ? '数组' : typeof envelope}`);
  }
  const env = envelope as Record<string, unknown>;
  if (env.schema !== 'chalk-scene-src') {
    throw new LoadError(
      `${ENVELOPE_FILE} 的 schema 应为 'chalk-scene-src'(场景源信封),拿到 '${String(env.schema)}'。` +
        `注意:课包产物里的 scene.json 是 'chalk-scene',不能当场景源再 build`,
    );
  }
  if (env.version !== 1) {
    throw new LoadError(`${ENVELOPE_FILE} 的 version 应为 1,拿到 ${String(env.version)}`);
  }
  if ('skeletons' in env) {
    throw new LoadError(`信封不含画面:skeletons 来自 ${EXCALIDRAW_FILE},从 ${ENVELOPE_FILE} 里删掉 skeletons 字段`);
  }
  const ex = exca as Record<string, unknown>;
  if (typeof exca !== 'object' || exca === null || ex.type !== 'excalidraw' || !Array.isArray(ex.elements)) {
    throw new LoadError(`${EXCALIDRAW_FILE} 应是标准 excalidraw 文件(type: 'excalidraw' + elements 数组);用编辑器或生成器导出`);
  }

  const { schema: _s, version: _v, ...fields } = env;
  const skeletons = (ex.elements as unknown[]).filter((el) => !(typeof el === 'object' && el !== null && (el as { isDeleted?: unknown }).isDeleted));
  return { raw: { ...fields, skeletons }, exportName: `${ENVELOPE_FILE}+${EXCALIDRAW_FILE}` };
}

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
