/**
 * 画板卡的舞台 = 孩子的工作台(《卡片重设计评估.md》§三 F,原型「画板工作台」):
 * 题目条在顶(可收起);工具是自己画的六个大钮——笔 / 橡皮 / 黑红蓝 / 撤销 / 清空(要点两下),竖屏一行、横屏一列;
 * excalidraw 只当画布,它的工具栏、菜单、缩放钮全藏掉(stage.css),禁选择 / 文字 / 形状,留双指缩放。
 * 底层(课包终帧 / 行内骨架)锁定、灰一档(opacity 45)、打 customData.layer = 'base';孩子画的全打 'ink',全黑(或红 / 蓝)。
 * 状态(ink 元素)改了就回页面(防抖);页面按「给老师看」→ control submit → 导出 png(底图恢复原色)连 ink 一起交回去。
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Excalidraw, convertToExcalidrawElements, exportToBlob } from '@excalidraw/excalidraw';
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

/** 底图灰一档:孩子一眼分出哪是老师画的、哪是自己画的;导出时恢复 */
const BASE_OPACITY = 45;
const INK_COLORS = ['#2b2b2b', '#d9482b', '#2f6fd6'] as const;

async function loadBase(base: CanvasStageProps['base'], bundleUrl?: string): Promise<ExcalidrawElement[]> {
  let skeletons: Record<string, unknown>[] = [];
  if (base && 'skeletons' in base) skeletons = base.skeletons;
  else if (base && 'bundle' in base && bundleUrl) {
    const r = await fetch(`${bundleUrl}scene.json`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`课包 ${base.bundle} 取不到`);
    skeletons = ((await r.json()) as { skeletons?: Record<string, unknown>[] }).skeletons ?? [];
  }
  if (!skeletons.length) return [];
  const els = convertToExcalidrawElements(skeletons.map((s) => ({ ...s, customData: { ...(s.customData as object | undefined), layer: 'base' }, locked: true, opacity: BASE_OPACITY })) as unknown as Skeleton[], { regenerateIds: false });
  return els as unknown as ExcalidrawElement[];
}

const isBase = (el: ExcalidrawElement): boolean => (el.customData as { layer?: string } | undefined)?.layer === 'base';
const isInk = (el: ExcalidrawElement): boolean => !el.isDeleted && !isBase(el);

const svg = (paths: string, size = 26): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: paths }} />
);
const ICON = {
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"></path><path d="M13 7l3 3"></path>',
  eraser: '<path d="M4 15l8-8 6 6-6 6H8z"></path><path d="M12 21h8"></path>',
  undo: '<path d="M8 8H4V4"></path><path d="M4 8a8 8 0 1 1 2 9"></path>',
  trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"></path>',
  chevron: '<path d="M6 9l6 6 6-6"></path>',
};

export const CanvasStage = forwardRef<CanvasStageHandle, CanvasStageProps>(function CanvasStage({ base, bundleUrl, prompt, ink, onState, onSubmit, onError }, ref) {
  const [initial, setInitial] = useState<ExcalidrawElement[] | null>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState<string>(INK_COLORS[0]);
  const [count, setCount] = useState(ink.length);
  const [promptOpen, setPromptOpen] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
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
      setCount(cur.length);
      onState(cur);
    }, 500);
  }, [inkNow, onState]);

  /** 工具:笔(锁住,画完一笔还是笔)/ 橡皮;颜色改的是「下一笔」 */
  const usePen = useCallback((c: string) => {
    setTool('pen'); setColor(c);
    const a = api.current;
    if (!a) return;
    (a.setActiveTool as (t: { type: 'freedraw'; locked?: boolean }) => void)({ type: 'freedraw', locked: true });
    a.updateScene({ appState: { currentItemStrokeColor: c } });
  }, []);
  const useEraser = useCallback(() => {
    setTool('eraser');
    (api.current?.setActiveTool as ((t: { type: 'eraser'; locked?: boolean }) => void) | undefined)?.({ type: 'eraser', locked: true });
  }, []);
  /** 撤销 = 抹掉孩子最后一笔(不动底图);清空 = 抹掉孩子的全部,要点两下 */
  const undo = useCallback(() => {
    const a = api.current;
    if (!a) return;
    const els = a.getSceneElements();
    const inks = els.filter(isInk);
    const lastInk = inks[inks.length - 1];
    if (!lastInk) return;
    a.updateScene({ elements: els.map((e) => (e === lastInk ? { ...e, isDeleted: true } : e)) as ExcalidrawElement[] });
    onChange();
  }, [onChange]);
  const clear = useCallback(() => {
    if (!confirmClear) { setConfirmClear(true); window.setTimeout(() => setConfirmClear(false), 2500); return; }
    setConfirmClear(false);
    const a = api.current;
    if (!a) return;
    a.updateScene({ elements: a.getSceneElements().map((e) => (isInk(e) ? { ...e, isDeleted: true } : e)) as ExcalidrawElement[] });
    onChange();
  }, [confirmClear, onChange]);

  useImperativeHandle(ref, () => ({
    submit() {
      const a = api.current;
      if (!a) return;
      // 导出时底图恢复原色(老师看的是完整的图)
      const elements = a.getSceneElements().map((e) => (isBase(e) ? { ...e, opacity: 100 } : e)) as ExcalidrawElement[];
      exportToBlob({ elements, appState: { ...a.getAppState(), exportBackground: true, viewBackgroundColor: '#fffdf8', exportWithDarkMode: false }, files: a.getFiles(), mimeType: 'image/png', exportPadding: 16, maxWidthOrHeight: 1600 })
        .then((blob: Blob) => new Promise<string>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(new Error('png 读不出')); fr.readAsDataURL(blob); }))
        .then((image: string) => onSubmit(inkNow(), image))
        .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    },
  }), [inkNow, onSubmit, onError]);

  if (!initial) return <div className="stage-wait">画板准备中…</div>;
  const btn = (cls: string, on: boolean, onClick: () => void, label: string, inner: JSX.Element): JSX.Element => (
    <button type="button" className={`ct-btn ${cls}${on ? ' on' : ''}`} onClick={onClick} aria-label={label} title={label}>{inner}</button>
  );
  return (
    <div className="canvas-wrap">
      {prompt ? (
        <div className={`canvas-prompt${promptOpen ? '' : ' closed'}`}>
          <span className="canvas-prompt-text">{prompt}</span>
          <button type="button" className="canvas-prompt-toggle" onClick={() => setPromptOpen((v) => !v)} aria-label={promptOpen ? '收起题目' : '展开题目'}>{svg(ICON.chevron, 20)}</button>
        </div>
      ) : null}
      <div className="canvas-main">
        <div className="canvas-tools" data-count={count}>
          {btn('tool', tool === 'pen', () => usePen(color), '笔', svg(ICON.pen))}
          {btn('tool', tool === 'eraser', useEraser, '橡皮', svg(ICON.eraser))}
          <span className="canvas-sep" />
          {INK_COLORS.map((c) => btn('dot', tool === 'pen' && color === c, () => usePen(c), '颜色', <span className="dot" style={{ background: c }} />))}
          <span className="canvas-sep" />
          {btn('tool', false, undo, '撤销上一笔', svg(ICON.undo))}
          {btn(`tool${confirmClear ? ' danger' : ''}`, false, clear, confirmClear ? '再点一下就清空' : '清空', svg(ICON.trash))}
        </div>
        <div className="canvas-board">
          <Excalidraw
            excalidrawAPI={(a) => { api.current = a; }}
            initialData={{ elements: initial, appState: { viewBackgroundColor: '#fffdf8', currentItemStrokeColor: color, currentItemStrokeWidth: 2, currentItemRoughness: 0, activeTool: { type: 'freedraw', customType: null, locked: true, lastActiveTool: null } }, scrollToContent: true }}
            onChange={onChange}
            zenModeEnabled
            gridModeEnabled={false}
            UIOptions={{ canvasActions: { export: false, loadScene: false, saveToActiveFile: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false }, tools: { image: false } }}
            langCode="zh-CN"
          />
        </div>
      </div>
    </div>
  );
});
