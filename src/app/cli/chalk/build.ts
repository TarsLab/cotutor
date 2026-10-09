/**
 * build:场景(已过 check)→ 课包目录。幂等:同输入产出相同字节。
 * 课包 = 自包含目录:scene.json + manifest.json(+ audio/,由 drawtell dub 落进来;build 不动 audio/)。
 * audio/index.json 里讲稿 hash 仍匹配的步,build 会把 audioSrc 回填进 manifest——
 * 讲稿改了的步自动失去音频(等重新 dub),不会拿旧音配新词。
 */

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { ChalkBackground, ChalkScene } from '../player/types.ts';
import type { LessonManifest, SceneJson } from '../schema/lesson-manifest.ts';
import { attachAudio } from './dub.ts';
import { sceneBounds } from '../core/geometry.ts';
import { parseBundle } from '../core/bundle.ts';
import { LoadError, NotFoundError } from './load-scene.ts';

/**
 * sourceDir:场景源所在目录,background.src 相对它解析;build 把图拷进课包(background.<ext>)并改写 src。
 * 不给 sourceDir = 场景已是课包形态(src 相对课包目录),原样保留。
 */
export async function buildBundle(scene: ChalkScene, outDir: string, sourceDir?: string): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  // 背景图拷进课包、改写 src:第一块画板 background.<ext>,换画板的 background-<board id>.<ext>
  const copyBackground = async (bg: ChalkBackground, stem: string, where: string): Promise<ChalkBackground> => {
    const from = resolve(sourceDir!, bg.src);
    const name = `${stem}${extname(bg.src).toLowerCase()}`;
    try {
      await copyFile(from, join(outDir, name));
    } catch {
      throw new LoadError(`背景图读不到:${from}(${where} '${bg.src}' 相对场景文件所在目录解析);检查路径`);
    }
    files.push(join(outDir, name));
    return { ...bg, src: name };
  };
  let background = scene.background;
  let skeletons = scene.skeletons;
  if (sourceDir) {
    if (background) background = await copyBackground(background, 'background', 'background.src');
    skeletons = [];
    for (const e of scene.skeletons) {
      const bg = e.type === 'board' ? (e.background as ChalkBackground | undefined) : undefined;
      skeletons.push(bg ? { ...e, background: await copyBackground(bg, `background-${e.id}`, `换画板 '${e.id}' 的 background.src`) } : e);
    }
  }
  const sceneJson: SceneJson = {
    schema: 'chalk-scene',
    version: 1,
    id: scene.id,
    title: scene.title,
    problem: scene.problem,
    model: scene.model,
    template: scene.template,
    ...(scene.subject ? { subject: scene.subject } : {}),
    ...(background ? { background } : {}),
    skeletons,
    ...(scene.groups?.length ? { groups: scene.groups } : {}),
    bounds: sceneBounds(skeletons),
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
  await attachAudio(outDir, manifest);
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

/** 课包 → 场景(拼法与校验在 core 的 parseBundle):snap 直接吃 bundle id 时用 */
export async function readBundle(bundlesDir: string, id: string): Promise<ChalkScene> {
  let sceneJson: unknown;
  let manifest: unknown;
  try {
    sceneJson = JSON.parse(await readFile(join(bundlesDir, id, 'scene.json'), 'utf8'));
    manifest = JSON.parse(await readFile(join(bundlesDir, id, 'manifest.json'), 'utf8'));
  } catch {
    throw new NotFoundError(`课包 '${id}' 不存在或不完整(${join(bundlesDir, id)}/ 需含 scene.json + manifest.json);先 drawtell build <scene.ts>`);
  }
  try {
    return parseBundle(sceneJson, manifest).scene;
  } catch (e) {
    throw new LoadError(`课包 '${id}' ${(e as Error).message}。用源 TS 重新 drawtell build`);
  }
}
