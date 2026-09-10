/**
 * 场景卡的舞台:drawtell 的 ChalkPlayer 全屏,controls 关——控制条是板书自己的字幕行,phase 经 postMessage 回页面,
 * 页面的按钮映射回 control。课包从 bundleUrl 取(scene.json + manifest.json 拼回 ChalkScene,与 drawtell 播放页同一拼法)。
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { ChalkPlayer, type ChalkPhase, type ChalkPlayerHandle, type ChalkScene } from 'drawtell/player';

export interface SceneStageHandle {
  control(action: 'toggle' | 'next' | 'prev' | 'play' | 'pause'): void;
}

export interface SceneStageProps {
  bundleUrl: string;
  autoplay?: boolean;
  onPhase(phase: ChalkPhase | 'paused', step: number, total: number, line: string): void;
  onError(message: string): void;
}

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
    skeletons: (scene.skeletons as ChalkScene['skeletons']) ?? [],
    steps: (manifest.steps as ChalkScene['steps']) ?? [],
    ...(manifest.blocks != null ? { blocks: manifest.blocks as ChalkScene['blocks'] } : {}),
    ...(manifest.subscenes != null ? { subscenes: manifest.subscenes as ChalkScene['subscenes'] } : {}),
  };
}

export const SceneStage = forwardRef<SceneStageHandle, SceneStageProps>(function SceneStage({ bundleUrl, autoplay, onPhase, onError }, ref) {
  const [scene, setScene] = useState<ChalkScene | null>(null);
  const player = useRef<ChalkPlayerHandle>(null);
  const started = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadBundle(bundleUrl)
      .then((s) => { if (!cancelled) setScene(s); })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
  }, [bundleUrl, onError]);

  // ChalkPlayer 的 stepIndex 是 0 起的下标:drawing / gap / done 都指当前这步;ready / loading 时显示题面。对外报的 step 是 1 起的「第几步」
  const handlePhase = useCallback((phase: ChalkPhase, idx: number) => {
    if (!scene) return;
    const showing = phase === 'ready' || phase === 'loading' || !scene.steps.length;
    onPhase(phase, showing ? 0 : idx + 1, scene.steps.length, showing ? scene.problem : (scene.steps[idx]?.line ?? ''));
    if (phase === 'ready' && autoplay && !started.current) { started.current = true; player.current?.toggle(); }
  }, [scene, autoplay, onPhase]);

  useImperativeHandle(ref, () => ({
    control(action) {
      const p = player.current;
      if (!p) return;
      if (action === 'toggle') p.toggle();
      else if (action === 'next') p.next();
      else if (action === 'prev') p.prev();
      else if (action === 'play') { if (p.isPaused()) p.resume(); else p.toggle(); }
      else if (action === 'pause') p.pause();
    },
  }), []);

  if (!scene) return <div className="stage-wait">图还在路上…</div>;
  return <ChalkPlayer ref={player} scene={scene} audioBaseUrl={bundleUrl} pointer controls={false} onPhaseChange={handlePhase} />;
});
