/**
 * 场景卡下发前的快照:课包在不在、题面、每步讲稿、终帧缩略图——每次 kidDay 现读 bundles/<id>/,不存状态,
 * 所以 scene-maker 作业落地的那一刻,孩子端下一次轮询就看到 ready(卡自己变成可播)。
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { BoardCard, BoardSection } from '../lib/kid-board.ts';

export interface SceneDirs {
  bundles: string;
  /** 截图目录;缩略图路径按它相对 workspace 根算(thumbBase),没有就不给缩略图 */
  snaps?: string;
  thumbBase?: string;
}

export async function sceneSnapshot(dirs: SceneDirs, bundle: string): Promise<{ title?: string; problem?: string; steps?: string[]; ready: boolean; thumb?: string }> {
  try {
    const dir = join(dirs.bundles, bundle);
    const [scene, manifest] = await Promise.all([readFile(join(dir, 'scene.json'), 'utf8'), readFile(join(dir, 'manifest.json'), 'utf8')]);
    const s = JSON.parse(scene) as { title?: unknown; problem?: unknown };
    const m = JSON.parse(manifest) as { steps?: { line?: unknown }[] };
    const steps = (m.steps ?? []).map((x) => (typeof x.line === 'string' ? x.line : ''));
    let thumb: string | undefined;
    if (dirs.snaps && dirs.thumbBase !== undefined) {
      const png = join(dirs.snaps, bundle, `step-${steps.length}.png`);
      if ((await stat(png).catch(() => null))?.isFile()) thumb = `${dirs.thumbBase}/${bundle}/step-${steps.length}.png`;
    }
    return { ...(typeof s.title === 'string' ? { title: s.title } : {}), ...(typeof s.problem === 'string' ? { problem: s.problem } : {}), steps, ready: true, ...(thumb ? { thumb } : {}) };
  } catch {
    return { ready: false };
  }
}

/** 一节里的场景卡全部补上快照(别的卡原样) */
export async function enrichScenes(dirs: SceneDirs, section: BoardSection): Promise<BoardSection> {
  if (!section.cards.some((c) => c.kind === 'scene')) return section;
  const cards: BoardCard[] = [];
  for (const c of section.cards) {
    if (c.kind !== 'scene' || typeof c.props.bundle !== 'string') { cards.push(c); continue; }
    cards.push({ ...c, props: { ...c.props, ...(await sceneSnapshot(dirs, c.props.bundle)) } });
  }
  return { ...section, cards };
}
