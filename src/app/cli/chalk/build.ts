/**
 * build:场景(已过 check)→ 课包目录。幂等:同输入产出相同字节。
 * 课包 = 自包含目录:scene.json + manifest.json(+ audio/,TTS 就绪后;已存在的 audio/ 不动)。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChalkScene } from '../player/types';
import type { LessonManifest, SceneJson } from '../schema/lesson-manifest';

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
    version: 1,
    steps: scene.steps.map((s) => ({
      step: s.step,
      elementIds: s.elementIds,
      line: s.line,
      pauseAfter: s.pauseAfter,
      ...(s.audioSrc ? { audioSrc: s.audioSrc } : {}),
    })),
  };
  await mkdir(outDir, { recursive: true });
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
