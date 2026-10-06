/**
 * 舞台包入口(打成 dist/stage/stage.js,页面在 iframe 里装 /stage/?card=<id>):等页面发 card,按 kind 装组件;
 * 场景卡 = ChalkPlayer;画板卡 = excalidraw 编辑器(步 10)。所有对外说话都走 postMessage(protocol.ts)。
 * 界面上没有错误文案:装不上就发 error,页面关掉舞台、什么都不显示。
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'drawtell/player/chalk-player.css';
import { SceneStage, type SceneStageHandle } from './scene.tsx';
import { LectureStage, buildLecture, type LectureWatch, type StageMark } from './lecture.tsx';
import type { CanvasStageHandle } from './canvas.tsx';
import '@excalidraw/excalidraw/dist/prod/index.css';
import { STAGE_SOURCE, type FromStage, type ToStage } from './protocol.ts';
import './stage.css';

/**
 * 画板的编辑器按需装(esbuild splitting 把它单独成块):八张卡里只有画板卡要它,
 * 场景卡与轻卡的舞台不该为它等。装载中显示一句「画板准备中」——这不是错误文案,是等待。
 */
const CanvasStage = lazy(async () => ({ default: (await import('./canvas.tsx')).CanvasStage }));

type Card = Extract<ToStage, { type: 'card' }>;
type Outgoing = FromStage extends infer U ? (U extends FromStage ? Omit<U, 'source'> : never) : never;

const post = (m: Outgoing): void => { window.parent.postMessage({ source: STAGE_SOURCE, ...m }, '*'); };

function App(): JSX.Element {
  const [card, setCard] = useState<Card | null>(null);
  const scene = useRef<SceneStageHandle>(null);
  const canvas = useRef<CanvasStageHandle>(null);

  useEffect(() => {
    // 调试 / 截图:?bundle=<课包 URL>&autoplay=1 不用页面也能开(mock:/stage/?bundle=/api/bundles/<id>/)
    const q = new URLSearchParams(location.search);
    const bundle = q.get('bundle');
    if (bundle) setCard({ source: STAGE_SOURCE, type: 'card', id: 'debug', kind: q.get('lecture') === '1' ? 'lecture' : 'scene', props: { bundle, title: q.get('title') ?? '' }, state: null, bundleUrl: bundle.endsWith('/') ? bundle : `${bundle}/`, autoplay: q.get('autoplay') === '1' });
    const onMsg = (e: MessageEvent<ToStage>): void => {
      const m = e.data;
      if (!m || m.source !== STAGE_SOURCE) return;
      if (m.type === 'card') setCard(m);
      else if (m.type === 'control') { if (m.action === 'submit') canvas.current?.submit(); else scene.current?.control(m.action); }
    };
    window.addEventListener('message', onMsg);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const onPhase = useCallback((phase: 'loading' | 'ready' | 'drawing' | 'gap' | 'done' | 'paused', step: number, total: number, line: string) => {
    post({ type: 'phase', phase, step, total, line });
    if (phase === 'gap' || phase === 'done') post({ type: 'state', state: { step, done: phase === 'done' } });
  }, []);
  const onError = useCallback((message: string) => post({ type: 'error', message }), []);
  const onInk = useCallback((ink: Record<string, unknown>[]) => post({ type: 'state', state: { ink } }), []);
  const onSubmit = useCallback((ink: Record<string, unknown>[], image: string) => post({ type: 'submit', state: { ink }, image }), []);
  const onLectureDone = useCallback((w: LectureWatch) => post({ type: 'lecture', event: 'finished', ...w }), []);
  const onLectureClose = useCallback((w: LectureWatch) => post({ type: 'lecture', event: 'close', ...w }), []);
  const onMarks = useCallback((marks: StageMark[]) => post({ type: 'marks', marks }), []);
  const onSvg = useCallback((markup: string, dx: number, dy: number) => post({ type: 'svg', markup, dx, dy }), []);

  if (!card) return <div className="stage-wait" />;
  if (card.kind === 'lecture' && card.bundleUrl) return <LectureStage bundleUrl={card.bundleUrl} title={String(card.props.title ?? '')} marks={Array.isArray(card.props.marks) ? (card.props.marks as StageMark[]) : []} at={typeof card.props.at === 'number' ? card.props.at : undefined} view={card.props.view === true} onMarks={onMarks} onSvg={onSvg} onFinished={onLectureDone} onClose={onLectureClose} onError={onError} />;
  if (card.kind === 'lecture-svg' && card.bundleUrl) return <LectureSvg bundleUrl={card.bundleUrl} onSvg={onSvg} onError={onError} />;
  if (card.kind === 'scene' && card.bundleUrl) return <SceneStage ref={scene} bundleUrl={card.bundleUrl} autoplay={card.autoplay} onPhase={onPhase} onError={onError} />;
  if (card.kind === 'canvas') {
    const st = (card.state ?? {}) as { ink?: Record<string, unknown>[] };
    const base = (card.props.base ?? null) as { bundle: string } | { skeletons: Record<string, unknown>[] } | { image: string } | null;
    return (
      <Suspense fallback={<div className="stage-wait">画板准备中…</div>}>
        {/* key 跟着笔数:页面重发 card(家长看录像时孩子又画了一笔)就按新笔迹重装;孩子端平时只在 ready 发一次,不受影响 */}
        <CanvasStage key={Array.isArray(st.ink) ? st.ink.length : 0} ref={canvas} base={base} bundleUrl={card.bundleUrl} imageUrl={card.imageUrl} prompt={typeof card.props.prompt === 'string' ? card.props.prompt : undefined} ink={Array.isArray(st.ink) ? st.ink : []} onState={onInk} onSubmit={onSubmit} onError={onError} />
      </Suspense>
    );
  }
  return <div className="stage-wait">{String(card.props.title ?? card.props.text ?? '')}</div>;
}

/** 看不见的舞台:只装小课堂的 SVG 发给页面(页面画圈的卡的缩略图;刷新过、家长端都靠它) */
function LectureSvg({ bundleUrl, onSvg, onError }: { bundleUrl: string; onSvg(markup: string, dx: number, dy: number): void; onError(message: string): void }): JSX.Element {
  useEffect(() => {
    buildLecture(bundleUrl).then((b) => onSvg(b.svg.outerHTML, b.dx, b.dy), (e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  }, [bundleUrl, onSvg, onError]);
  return <div className="stage-wait" />;
}

createRoot(document.getElementById('root')!).render(<App />);
