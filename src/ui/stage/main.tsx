/**
 * 舞台包入口(打成 dist/stage/stage.js,页面在 iframe 里装 /stage/?card=<id>):等页面发 card,按 kind 装组件;
 * 小课堂(孩子从首页看的整堂、老师放的一段)= lecture.tsx;教具卡 = kit.tsx(老师先画好的图,孩子转、圈)。所有对外说话都走 postMessage(protocol.ts)。
 * ?chalk=bake|snap 是做课包时 CDP 开的(chalk/tool.ts),不是孩子端。
 * 界面上没有错误文案:装不上就发 error,页面关掉舞台、什么都不显示。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LectureStage, type LectureBack, type LectureStageHandle, type LectureWatch, type StageMark, type WatchEntry } from './lecture.tsx';

/** 页面发来的胶囊上的老师(颜色、首字);形状不对就浅底只放 logo */
const backOf = (v: unknown): LectureBack | null => {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  return typeof b.color === 'string' && typeof b.initial === 'string' && b.initial ? { color: b.color, initial: b.initial } : null;
};
import { KitStage, type KitStageHandle } from './kit.tsx';
import { BookStage } from './book.tsx';
import type { KitState } from '../../chalk/index.ts';
import type { Lesson } from '../../schema/index.ts';
import { STAGE_SOURCE, type FromStage, type ToStage } from './protocol.ts';
import './stage.css';

type Card = Extract<ToStage, { type: 'card' }>;
type LessonMsg = Extract<ToStage, { type: 'lesson' }>;
type Outgoing = FromStage extends infer U ? (U extends FromStage ? Omit<U, 'source'> : never) : never;

const noop = (): void => {};
/** 话题预览图的长边(首页「今天」那一格两三百像素宽,按 2 倍屏) */
const PEEK_SIDE = 480;
/** 一张图(data URL)缩成长边 side 的 jpeg;本来就小的照原尺寸转 */
async function shrinkJpeg(url: string, side: number): Promise<string | null> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.naturalWidth * k));
  cv.height = Math.max(1, Math.round(img.naturalHeight * k));
  const g = cv.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.78);
}
const post = (m: Outgoing): void => { window.parent.postMessage({ source: STAGE_SOURCE, ...m }, '*'); };

function App(): JSX.Element {
  const [card, setCard] = useState<Card | null>(null);
  /** 一节课(课本做底):页面发来的此刻的样子;有它就画课本,不看卡 */
  const [lesson, setLesson] = useState<LessonMsg | null>(null);
  const kit = useRef<KitStageHandle>(null);
  const lecture = useRef<LectureStageHandle>(null);
  /** 录像的 follow 比播放器先到(卡刚到、还没挂上):记着最后那条,挂上了交给它(它自己再等课装好) */
  const pendingFollow = useRef<Extract<ToStage, { type: 'follow' }> | null>(null);

  useEffect(() => {
    // 调试 / 截图:?bundle=<课包 URL> 不用页面也能开小课堂(mock:/stage/?bundle=/api/bundles/<id>/)
    const q = new URLSearchParams(location.search);
    const bundle = q.get('bundle');
    if (bundle) setCard({ source: STAGE_SOURCE, type: 'card', id: 'debug', kind: 'lecture', props: { bundle, title: q.get('title') ?? '' }, state: null, bundleUrl: bundle.endsWith('/') ? bundle : `${bundle}/`, autoplay: q.get('autoplay') === '1' });
    const onMsg = (e: MessageEvent<ToStage>): void => {
      const m = e.data;
      if (!m || m.source !== STAGE_SOURCE) return;
      if (m.type === 'card') { setCard(m); setLesson(null); }
      else if (m.type === 'lesson') setLesson(m);
      else if (m.type === 'follow') { if (lecture.current) lecture.current.follow(m.ms, m.playing, m.rate, m.marks as StageMark[]); else pendingFollow.current = m; }
      else if (m.type === 'control') {
        if (m.action === 'submit') kit.current?.submit();
        else if (m.action === 'peek') void (kit.current ? kit.current.peek() : Promise.resolve(null)).then((image) => (image ? shrinkJpeg(image, PEEK_SIDE) : null), () => null).then((image) => post({ type: 'peek', image }));
        else lecture.current?.control(m.action);
      }
    };
    window.addEventListener('message', onMsg);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    const f = pendingFollow.current;
    if (f && lecture.current) { pendingFollow.current = null; lecture.current.follow(f.ms, f.playing, f.rate, f.marks as StageMark[]); }
  });

  const onError = useCallback((message: string) => post({ type: 'error', message }), []);
  const onKitState = useCallback((state: KitState) => post({ type: 'state', state }), []);
  const onKitPick = useCallback((text: string) => post({ type: 'pick', text }), []);
  const onKitReveal = useCallback((text: string) => post({ type: 'reveal', text }), []);
  const onBookView = useCallback((box: [number, number, number, number]) => post({ type: 'view', box }), []);
  const onBookShot = useCallback((box: [number, number, number, number], image: string) => post({ type: 'shot', box, image }), []);
  const onKitSubmit = useCallback((state: KitState, image?: string) => post({ type: 'submit', state, ...(image ? { image } : {}) }), []);
  const onLessonSubmit = useCallback(() => post({ type: 'submit', state: null }), []);
  const onStroke = useCallback((pts: [number, number][], strip?: string) => post({ type: 'stroke', pts, ...(strip ? { strip } : {}) }), []);
  const onTurn = useCallback((item: string, deg: number) => post({ type: 'turn', item, deg }), []);
  const onWipe = useCallback(() => post({ type: 'wipe' }), []);
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

  if (lesson) return <BookStage ref={kit} key={lesson.id} id={lesson.id} lesson={lesson.lesson as Lesson} readonly={lesson.readonly === true} hand={lesson.hand === 'left' ? 'left' : 'right'} onStroke={onStroke} onTurn={onTurn} onWipe={onWipe} onSubmit={onLessonSubmit} onPick={onKitPick} onReveal={onKitReveal} onView={onBookView} onShot={onBookShot} onError={onError} />;
  if (!card) return <div className="stage-wait" />;
  // 板书上的小课堂卡(老师放课里的一段):props 里有下发时补的起止
  if (card.kind === 'lecture' && card.bundleUrl && typeof card.props.start === 'number' && typeof card.props.end === 'number') {
    const range = { start: card.props.start, end: card.props.end };
    return <LectureStage ref={lecture} bundleUrl={card.bundleUrl} title={String(card.props.title ?? '')} marks={[]} range={range} autoplay={card.autoplay} video={card.props.video === true} onPhase={onLecturePhase} onMarks={noop} onFinished={noop} onClose={noop} onError={onError} />;
  }
  if (card.kind === 'lecture' && card.bundleUrl) return <LectureStage ref={lecture} follow={card.props.follow === true} back={backOf(card.props.back)} onLog={onWatch} bundleUrl={card.bundleUrl} title={String(card.props.title ?? '')} marks={Array.isArray(card.props.marks) ? (card.props.marks as StageMark[]) : []} at={typeof card.props.at === 'number' ? card.props.at : undefined} view={card.props.view === true} video={card.props.video === true} onMarks={onMarks} onFinished={onLectureDone} onClose={onLectureClose} onAsk={onLectureAsk} onError={onError} />;
  if (card.kind === 'kit') {
    const p = card.props as { kit?: unknown; params?: unknown; ops?: unknown };
    return <KitStage ref={kit} id={card.id} kit={String(p.kit ?? '')} params={p.params && typeof p.params === 'object' ? (p.params as Record<string, unknown>) : {}} ops={p.ops} state={(card.state ?? null) as KitState | null} imageUrl={typeof card.imageUrl === 'string' ? card.imageUrl : undefined} wordsUrl={typeof card.wordsUrl === 'string' ? card.wordsUrl : undefined} onPick={onKitPick} onReveal={onKitReveal} readonly={card.readonly === true} hand={card.hand === 'left' ? 'left' : 'right'} onState={onKitState} onSubmit={onKitSubmit} onError={onError} />;
  }
  return <div className="stage-wait">{String(card.props.title ?? card.props.text ?? '')}</div>;
}

// 做课包(cotutor chalk bake / snap):?chalk=bake|snap 不装舞台,只烤画面或停在某一步给 CDP 截图(./chalk/tool.ts,按需装)
const tool = new URLSearchParams(location.search);
if (tool.get('chalk')) void import('./chalk/tool.ts').then((m) => m.runTool(tool));
else createRoot(document.getElementById('root')!).render(<App />);
