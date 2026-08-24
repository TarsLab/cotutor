/**
 * build:场景(已过 check)→ 课包目录。幂等:同输入产出相同字节。
 * 课包 = 自包含目录:scene.json + manifest.json(+ audio/,由 drawtell dub 落进来;build 不动 audio/)。
 * audio/index.json 里讲稿 hash 仍匹配的步,build 会把 audioSrc 回填进 manifest——
 * 讲稿改了的步自动失去音频(等重新 dub),不会拿旧音配新词。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChalkScene } from '../player/types.ts';
import { sceneSchema } from '../schema/scene.ts';
import type { LessonManifest, SceneJson } from '../schema/lesson-manifest.ts';
import { attachAudio } from './dub.ts';
import { LoadError, NotFoundError } from './load-scene.ts';

export async function buildBundle(scene: ChalkScene, outDir: string): Promise<string[]> {
  const sceneJson: SceneJson = {
    schema: 'chalk-scene',
    version: 1,
    id: scene.id,
    title: scene.title,
    problem: scene.problem,
    model: scene.model,
    template: scene.template,
    skeletons: scene.skeletons,
  };
  const manifest: LessonManifest = {
    schema: 'lesson-manifest',
    version: 2,
    steps: scene.steps.map((s) => ({
      step: s.step,
      elementIds: s.elementIds,
      line: s.line,
      pauseAfter: s.pauseAfter,
      ...(s.audioSrc ? { audioSrc: s.audioSrc } : {}),
      ...(s.audioSrc && s.audioDurationMs ? { audioDurationMs: s.audioDurationMs } : {}),
    })),
    ...(scene.blocks?.length ? { blocks: scene.blocks } : {}),
    ...(scene.subscenes?.length ? { subscenes: scene.subscenes } : {}),
  };
  await mkdir(outDir, { recursive: true });
  await attachAudio(outDir, manifest);
  const files: string[] = [];
  for (const [name, data] of [
    ['scene.json', sceneJson],
    ['manifest.json', manifest],
  ] as const) {
    const p = join(outDir, name);
    await writeFile(p, `${JSON.stringify(data, null, 2)}\n`);
    files.push(p);
  }
  return files;
}

/** 课包 → 场景(load-bundle.ts 的 Node 版):snap 直接吃 bundle id 时用 */
export async function readBundle(bundlesDir: string, id: string): Promise<ChalkScene> {
  let sceneJson: Record<string, unknown>;
  let manifest: Record<string, unknown>;
  try {
    sceneJson = JSON.parse(await readFile(join(bundlesDir, id, 'scene.json'), 'utf8')) as Record<string, unknown>;
    manifest = JSON.parse(await readFile(join(bundlesDir, id, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    throw new NotFoundError(`课包 '${id}' 不存在或不完整(${join(bundlesDir, id)}/ 需含 scene.json + manifest.json);先 drawtell build <scene.ts>`);
  }
  const parsed = sceneSchema.safeParse({
    id: sceneJson.id,
    title: sceneJson.title,
    problem: sceneJson.problem,
    model: sceneJson.model,
    template: sceneJson.template,
    skeletons: sceneJson.skeletons,
    steps: manifest.steps,
    ...(manifest.blocks != null ? { blocks: manifest.blocks } : {}),
    ...(manifest.subscenes != null ? { subscenes: manifest.subscenes } : {}),
  });
  if (!parsed.success) {
    const first = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')}:${i.message}`)
      .join(';');
    throw new LoadError(`课包 '${id}' 不符合场景契约:${first}。用源 TS 重新 drawtell build`);
  }
  return parsed.data;
}
