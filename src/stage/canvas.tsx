/**
 * 画板卡的舞台:excalidraw 编辑器。底层(课包终帧 / 行内骨架)锁定、打 customData.layer = 'base';孩子画的全打 'ink'。
 * 状态(ink 元素)改了就回页面(防抖);页面按「给老师看」→ control submit → 导出 png(data URL)连 ink 一起交回去。
 * 工具栏用 excalidraw 自带的(禅模式,收掉菜单与导出);初始工具是笔。
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Excalidraw, MainMenu, convertToExcalidrawElements, exportToBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

export interface CanvasStageHandle {
  submit(): void;
}

export interface CanvasStageProps {
  base: { bundle: string } | { skeletons: Record<string, unknown>[] } | null;
  bundleUrl?: string;
  prompt?: string;
  ink: Record<string, unknown>[];
  onState(ink: Record<string, unknown>[]): void;
  onSubmit(ink: Record<string, unknown>[], image: string): void;
  onError(message: string): void;
}

type Skeleton = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number];

async function loadBase(base: CanvasStageProps['base'], bundleUrl?: string): Promise<ExcalidrawElement[]> {
  let skeletons: Record<string, unknown>[] = [];
  if (base && 'skeletons' in base) skeletons = base.skeletons;
  else if (base && 'bundle' in base && bundleUrl) {
    const r = await fetch(`${bundleUrl}scene.json`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`课包 ${base.bundle} 取不到`);
    skeletons = ((await r.json()) as { skeletons?: Record<string, unknown>[] }).skeletons ?? [];
  }
  if (!skeletons.length) return [];
  const els = convertToExcalidrawElements(skeletons.map((s) => ({ ...s, customData: { ...(s.customData as object | undefined), layer: 'base' }, locked: true })) as unknown as Skeleton[], { regenerateIds: false });
  return els as unknown as ExcalidrawElement[];
}

const isInk = (el: ExcalidrawElement): boolean => !el.isDeleted && (el.customData as { layer?: string } | undefined)?.layer !== 'base';

export const CanvasStage = forwardRef<CanvasStageHandle, CanvasStageProps>(function CanvasStage({ base, bundleUrl, prompt, ink, onState, onSubmit, onError }, ref) {
  const [initial, setInitial] = useState<ExcalidrawElement[] | null>(null);
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const timer = useRef<number | null>(null);
  const last = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    loadBase(base, bundleUrl)
      .then((els) => { if (!cancelled) setInitial([...els, ...(ink as unknown as ExcalidrawElement[])]); })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
    // 只在装载时取一次:ink 之后由编辑器自己管
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, bundleUrl]);

  const inkNow = useCallback((): Record<string, unknown>[] => {
    const els = api.current?.getSceneElements() ?? [];
    return els.filter(isInk).map((el) => ({ ...(el as unknown as Record<string, unknown>), customData: { ...(el.customData ?? {}), layer: 'ink' } }));
  }, []);

  const onChange = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const cur = inkNow();
      const key = cur.map((e) => `${String(e.id)}:${String(e.version)}`).join(',');
      if (key === last.current) return;
      last.current = key;
      onState(cur);
    }, 500);
  }, [inkNow, onState]);

  useImperativeHandle(ref, () => ({
    submit() {
      const a = api.current;
      if (!a) return;
      const elements = a.getSceneElements();
      exportToBlob({ elements, appState: { ...a.getAppState(), exportBackground: true, viewBackgroundColor: '#fffdf8', exportWithDarkMode: false }, files: a.getFiles(), mimeType: 'image/png', exportPadding: 16, maxWidthOrHeight: 1600 })
        .then((blob: Blob) => new Promise<string>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(new Error('png 读不出')); fr.readAsDataURL(blob); }))
        .then((image: string) => onSubmit(inkNow(), image))
        .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    },
  }), [inkNow, onSubmit, onError]);

  if (!initial) return <div className="stage-wait">画板准备中…</div>;
  return (
    <div className="canvas-wrap">
      {prompt ? <div className="canvas-prompt">{prompt}</div> : null}
      <div className="canvas-board">
        <Excalidraw
          excalidrawAPI={(a) => { api.current = a; }}
          initialData={{ elements: initial, appState: { viewBackgroundColor: '#fffdf8', currentItemStrokeColor: '#2b2b2b', currentItemStrokeWidth: 2, activeTool: { type: 'freedraw', customType: null, locked: true, lastActiveTool: null } }, scrollToContent: true }}
          onChange={onChange}
          zenModeEnabled
          UIOptions={{ canvasActions: { export: false, loadScene: false, saveToActiveFile: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false }, tools: { image: false } }}
          langCode="zh-CN"
        >
          <MainMenu />
        </Excalidraw>
      </div>
    </div>
  );
});
