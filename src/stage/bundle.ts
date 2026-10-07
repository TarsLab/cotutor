/**
 * 课包怎么读进舞台:scene.json + manifest.json 拼回 ChalkScene(与 drawtell 播放页同一拼法),烤好的画面另取 bake.json。
 * 小课堂(lecture.tsx)用它;课包从 bundleUrl 取,如 /api/bundles/<id>/。
 */
import { bakeMatches, type BakedLesson } from 'drawtell/core';
import type { ChalkScene } from 'drawtell/player';

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<Record<string, unknown>>;
}

/** 课包 → ChalkScene(不再过 zod:课包是 drawtell build 的产物,已经校验过) */
export async function loadBundle(bundleUrl: string): Promise<ChalkScene> {
  const [scene, manifest] = await Promise.all([fetchJson(`${bundleUrl}scene.json`), fetchJson(`${bundleUrl}manifest.json`)]);
  return {
    id: String(scene.id),
    title: String(scene.title ?? ''),
    problem: String(scene.problem ?? ''),
    model: String(scene.model ?? ''),
    template: (scene.template as ChalkScene['template']) ?? 'paper-strict',
    ...(scene.subject != null ? { subject: String(scene.subject) } : {}),
    ...(scene.background != null ? { background: scene.background as NonNullable<ChalkScene['background']> } : {}),
    skeletons: (scene.skeletons as ChalkScene['skeletons']) ?? [],
    steps: (manifest.steps as ChalkScene['steps']) ?? [],
    ...(manifest.blocks != null ? { blocks: manifest.blocks as ChalkScene['blocks'] } : {}),
    ...(manifest.subscenes != null ? { subscenes: manifest.subscenes as ChalkScene['subscenes'] } : {}),
  };
}

/** 烤好的画面:bake.json 在、和 scene.json 的画面对得上才用(画面改过没重烤就当没有) */
export async function loadBaked(bundleUrl: string): Promise<BakedLesson | null> {
  const base = new URL(bundleUrl, location.href);
  try {
    const [b, sj] = await Promise.all([fetch(new URL('bake.json', base)), fetch(new URL('scene.json', base))]);
    if (!b.ok || !sj.ok) return null;
    const baked: unknown = await b.json();
    return bakeMatches(baked, (await sj.json()) as { skeletons?: unknown; background?: unknown }) ? baked : null;
  } catch {
    return null;
  }
}
