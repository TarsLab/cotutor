/**
 * 舞台包入口(打成 dist/stage/stage.js,页面在 iframe 里装 /stage/?card=<id>):等页面发 card,按 kind 装组件;
 * 场景卡 = ChalkPlayer;画板卡 = excalidraw 编辑器(步 10)。所有对外说话都走 postMessage(protocol.ts)。
 * 界面上没有错误文案:装不上就发 error,页面关掉舞台、什么都不显示。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'drawtell/player/chalk-player.css';
import { SceneStage, type SceneStageHandle } from './scene.tsx';
import { CanvasStage, type CanvasStageHandle } from './canvas.tsx';
import '@excalidraw/excalidraw/dist/prod/index.css';
import { STAGE_SOURCE, type FromStage, type ToStage } from './protocol.ts';
import './stage.css';

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
    if (bundle) setCard({ source: STAGE_SOURCE, type: 'card', id: 'debug', kind: 'scene', props: { bundle }, state: null, bundleUrl: bundle.endsWith('/') ? bundle : `${bundle}/`, autoplay: q.get('autoplay') === '1' });
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

  if (!card) return <div className="stage-wait" />;
  if (card.kind === 'scene' && card.bundleUrl) return <SceneStage ref={scene} bundleUrl={card.bundleUrl} autoplay={card.autoplay} onPhase={onPhase} onError={onError} />;
  if (card.kind === 'canvas') {
    const st = (card.state ?? {}) as { ink?: Record<string, unknown>[] };
    const base = (card.props.base ?? null) as { bundle: string } | { skeletons: Record<string, unknown>[] } | null;
    return <CanvasStage ref={canvas} base={base} bundleUrl={card.bundleUrl} prompt={typeof card.props.prompt === 'string' ? card.props.prompt : undefined} ink={Array.isArray(st.ink) ? st.ink : []} onState={onInk} onSubmit={onSubmit} onError={onError} />;
  }
  return <div className="stage-wait">{String(card.props.title ?? card.props.text ?? '')}</div>;
}

createRoot(document.getElementById('root')!).render(<App />);
