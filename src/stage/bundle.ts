/**
 * 课包怎么读进舞台:scene.json + manifest.json 拼回 ChalkScene(drawtell/core 的 assembleBundle,与 drawtell 播放页同一拼法),烤好的画面另取 bake.json。
 * 小课堂(lecture.tsx)用它;课包从 bundleUrl 取,如 /api/bundles/<id>/。
 */
import { assembleBundle, bakeMatches, type BakedLesson, type ChalkScene } from 'drawtell/core';

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<Record<string, unknown>>;
}

/** 课包 → ChalkScene:拼法是 drawtell 的 assembleBundle(不过 zod:服务端 readBundleLecture 已用 parseBundle 校验过,舞台首屏不带 zod) */
export async function loadBundle(bundleUrl: string): Promise<ChalkScene> {
  const [scene, manifest] = await Promise.all([fetchJson(`${bundleUrl}scene.json`), fetchJson(`${bundleUrl}manifest.json`)]);
  return assembleBundle(scene, manifest).scene;
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
