/**
 * 舞台包入口(打成 dist/stage/stage.js,页面在 iframe 里装 /stage/?card=<id>):等页面发 card,按 kind 装组件;
 * 小课堂(孩子从首页看的整堂、老师放的一段)= lecture.tsx;画板卡 = excalidraw 编辑器(步 10)。所有对外说话都走 postMessage(protocol.ts)。
 * 界面上没有错误文案:装不上就发 error,页面关掉舞台、什么都不显示。
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LectureStage, type LectureStageHandle, type LectureTutor, type LectureWatch, type StageMark, type WatchEntry } from './lecture.tsx';
import type { CanvasStageHandle } from './canvas.tsx';
import '@excalidraw/excalidraw/dist/prod/index.css';
import { STAGE_SOURCE, type FromStage, type ToStage } from './protocol.ts';
import './stage.css';

/**
 * 画板的编辑器按需装(esbuild splitting 把它单独成块):只有画板卡要它,
 * 小课堂与轻卡的舞台不该为它等。装载中显示一句「画板准备中」——这不是错误文案,是等待。
 */
const CanvasStage = lazy(async () => ({ default: (await import('./canvas.tsx')).CanvasStage }));

type Card = Extract<ToStage, { type: 'card' }>;
type Outgoing = FromStage extends infer U ? (U extends FromStage ? Omit<U, 'source'> : never) : never;

const noop = (): void => {};
/** 页面发来的老师头像(小课堂左上的「‹ 头像」);形状不对就不画头像 */
const tutorOf = (v: unknown): LectureTutor | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const t = v as Record<string, unknown>;
  if (typeof t.color !== 'string') return undefined;
  return { color: t.color, ...(typeof t.img === 'string' ? { img: t.img } : {}), ...(typeof t.text === 'string' ? { text: t.text } : {}) };
};
const post = (m: Outgoing): void => { window.parent.postMessage({ source: STAGE_SOURCE, ...m }, '*'); };

function App(): JSX.Element {
  const [card, setCard] = useState<Card | null>(null);
  const canvas = useRef<CanvasStageHandle>(null);
  const lecture = useRef<LectureStageHandle>(null);

  useEffect(() => {
    // 调试 / 截图:?bundle=<课包 URL> 不用页面也能开小课堂(mock:/stage/?bundle=/api/bundles/<id>/)
    const q = new URLSearchParams(location.search);
    const bundle = q.get('bundle');
    if (bundle) setCard({ source: STAGE_SOURCE, type: 'card', id: 'debug', kind: 'lecture', props: { bundle, title: q.get('title') ?? '' }, state: null, bundleUrl: bundle.endsWith('/') ? bundle : `${bundle}/`, autoplay: q.get('autoplay') === '1' });
    const onMsg = (e: MessageEvent<ToStage>): void => {
      const m = e.data;
      if (!m || m.source !== STAGE_SOURCE) return;
      if (m.type === 'card') setCard(m);
      else if (m.type === 'follow') lecture.current?.follow(m.ms, m.playing, m.rate, m.marks as StageMark[]);
      else if (m.type === 'control') { if (m.action === 'submit') canvas.current?.submit(); else lecture.current?.control(m.action); }
    };
    window.addEventListener('message', onMsg);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const onError = useCallback((message: string) => post({ type: 'error', message }), []);
  const onInk = useCallback((ink: Record<string, unknown>[]) => post({ type: 'state', state: { ink } }), []);
  const onSubmit = useCallback((ink: Record<string, unknown>[], image: string) => post({ type: 'submit', state: { ink }, image }), []);
  const onLectureDone = useCallback((w: LectureWatch) => post({ type: 'lecture', event: 'finished', ...w }), []);
  const onLectureClose = useCallback((w: LectureWatch) => post({ type: 'lecture', event: 'close', ...w }), []);
  const onLectureAsk = useCallback((w: LectureWatch) => post({ type: 'lecture', event: 'ask', ...w }), []);
  // 卡的样子:phase 给页面字幕行;那一段放完存状态 {done: true}
  const onLecturePhase = useCallback((phase: 'drawing' | 'paused' | 'done', line: string, step: number, total: number) => {
    post({ type: 'phase', phase, step, total, line });
    if (phase === 'done') post({ type: 'state', state: { done: true } });
  }, []);
  const onMarks = useCallback((marks: StageMark[]) => post({ type: 'marks', marks }), []);
  const onWatch = useCallback((e: WatchEntry) => post({ type: 'watch', ...e }), []);

  if (!card) return <div className="stage-wait" />;
  // 板书上的小课堂卡(老师放课里的一段):props 里有下发时补的起止
  if (card.kind === 'lecture' && card.bundleUrl && typeof card.props.start === 'number' && typeof card.props.end === 'number') {
    const range = { start: card.props.start, end: card.props.end };
    return <LectureStage ref={lecture} bundleUrl={card.bundleUrl} title={String(card.props.title ?? '')} marks={[]} range={range} autoplay={card.autoplay} video={card.props.video === true} onPhase={onLecturePhase} onMarks={noop} onFinished={noop} onClose={noop} onError={onError} />;
  }
  if (card.kind === 'lecture' && card.bundleUrl) return <LectureStage ref={lecture} follow={card.props.follow === true} tutor={tutorOf(card.props.tutor)} onLog={onWatch} bundleUrl={card.bundleUrl} title={String(card.props.title ?? '')} marks={Array.isArray(card.props.marks) ? (card.props.marks as StageMark[]) : []} at={typeof card.props.at === 'number' ? card.props.at : undefined} view={card.props.view === true} video={card.props.video === true} onMarks={onMarks} onFinished={onLectureDone} onClose={onLectureClose} onAsk={onLectureAsk} onError={onError} />;
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

createRoot(document.getElementById('root')!).render(<App />);
