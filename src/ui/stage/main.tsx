/**
 * 舞台包入口(打成 dist/stage/stage.js,页面在 iframe 里装 /stage/?card=<id>):照页面发来的一节课的状态画现在那一页——
 * 课本、作业照片、白纸 = book.tsx;小课堂(2026-11-17 起是一节课里的一页)= lecture.tsx。所有对外说话都走 postMessage(protocol.ts)。
 * ?bundle=<课包 URL> 不用页面也能开小课堂(调试、截图);?chalk=bake|snap 是做课包时 CDP 开的(chalk/tool.ts),不是孩子端。
 * 界面上没有错误文案:装不上就发 error,什么都不显示。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LectureStage, type LectureStageHandle, type LectureWatch, type StageMark, type WatchEntry } from './lecture.tsx';
import { BookStage, type BookStageHandle } from './book.tsx';
import type { Lesson } from '../../schema/index.ts';
import { STAGE_SOURCE, type FromStage, type ToStage } from './protocol.ts';
import './stage.css';

type LessonMsg = Extract<ToStage, { type: 'lesson' }>;
type Outgoing = FromStage extends infer U ? (U extends FromStage ? Omit<U, 'source'> : never) : never;

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
  /** 调试:?bundle= 直接开的小课堂 */
  const [debug, setDebug] = useState<{ url: string; title: string } | null>(null);
  /** 一节课:页面发来的此刻的样子 */
  const [lesson, setLesson] = useState<LessonMsg | null>(null);
  const book = useRef<BookStageHandle>(null);
  const lecture = useRef<LectureStageHandle>(null);
  /** 录像的 follow 比播放器先到(卡刚到、还没挂上):记着最后那条,挂上了交给它(它自己再等课装好) */
  const pendingFollow = useRef<Extract<ToStage, { type: 'follow' }> | null>(null);

  useEffect(() => {
    // 调试 / 截图:?bundle=<课包 URL> 不用页面也能开小课堂(mock:/stage/?bundle=/api/bundles/<id>/)
    const q = new URLSearchParams(location.search);
    const bundle = q.get('bundle');
    if (bundle) setDebug({ url: bundle.endsWith('/') ? bundle : `${bundle}/`, title: q.get('title') ?? '' });
    const onMsg = (e: MessageEvent<ToStage>): void => {
      const m = e.data;
      if (!m || m.source !== STAGE_SOURCE) return;
      if (m.type === 'lesson') setLesson(m);
      else if (m.type === 'follow') { if (lecture.current) lecture.current.follow(m.ms, m.playing, m.rate, m.marks as StageMark[]); else pendingFollow.current = m; }
      else if (m.type === 'control') {
        if (m.action === 'submit') book.current?.submit();
        else if (m.action === 'peek') void (book.current ? book.current.peek() : Promise.resolve(null)).then((image) => (image ? shrinkJpeg(image, PEEK_SIDE) : null), () => null).then((image) => post({ type: 'peek', image }));
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
  const onPick = useCallback((text: string) => post({ type: 'pick', text }), []);
  const onReveal = useCallback((text: string) => post({ type: 'reveal', text }), []);
  const onBookView = useCallback((box: [number, number, number, number]) => post({ type: 'view', box }), []);
  const onBookShot = useCallback((box: [number, number, number, number], image: string) => post({ type: 'shot', box, image }), []);
  const onLessonSubmit = useCallback(() => post({ type: 'submit' }), []);
  const onStroke = useCallback((pts: [number, number][], strip?: string) => post({ type: 'stroke', pts, ...(strip ? { strip } : {}) }), []);
  const onTurn = useCallback((item: string, deg: number) => post({ type: 'turn', item, deg }), []);
  const onWipe = useCallback(() => post({ type: 'wipe' }), []);
  const onPen = useCallback(() => post({ type: 'pen' }), []);
  const onLectureDone = useCallback((w: LectureWatch) => post({ type: 'lecture', event: 'finished', ...w }), []);
  const onRangeDone = useCallback(() => post({ type: 'phase', phase: 'done' }), []);
  const onMarks = useCallback((marks: StageMark[]) => post({ type: 'marks', marks }), []);
  const onWatch = useCallback((e: WatchEntry) => post({ type: 'watch', ...e }), []);
  const noMarks = useCallback(() => {}, []);

  if (debug) return <LectureStage ref={lecture} bundleUrl={debug.url} title={debug.title} marks={[]} onMarks={noMarks} onFinished={onLectureDone} onError={onError} />;
  const l = lesson?.lesson as Lesson | undefined;
  const page = l ? l.pages.find((p) => p.id === l.at) : undefined;
  // 小课堂那一页:一堂课一个播放器(换了课重装);readonly = 只看(以前的、家长端),follow = 录像跟着放
  if (lesson && l && page?.kind === 'lecture' && lesson.lecture) {
    const lc = lesson.lecture;
    return <LectureStage ref={lecture} key={`lc:${page.bundle}`} bundleUrl={lc.url} title={page.title} video={page.video} marks={lc.marks as StageMark[]} view={lesson.readonly === true} follow={lc.follow === true} left={lesson.hand === 'left'} look={l.look?.at ?? null} play={lc.play} onRangeDone={onRangeDone} onLog={onWatch} onMarks={onMarks} onFinished={onLectureDone} onError={onError} />;
  }
  if (lesson) return <BookStage ref={book} key={lesson.id} id={lesson.id} lesson={lesson.lesson as Lesson} readonly={lesson.readonly === true} hand={lesson.hand === 'left' ? 'left' : 'right'} onStroke={onStroke} onPen={onPen} onTurn={onTurn} onWipe={onWipe} onSubmit={onLessonSubmit} onPick={onPick} onReveal={onReveal} onView={onBookView} onShot={onBookShot} onError={onError} />;
  return <div className="stage-wait" />;
}

// 做课包(cotutor chalk bake / snap):?chalk=bake|snap 不装舞台,只烤画面或停在某一步给 CDP 截图(./chalk/tool.ts,按需装)
const tool = new URLSearchParams(location.search);
if (tool.get('chalk')) void import('./chalk/tool.ts').then((m) => m.runTool(tool));
else createRoot(document.getElementById('root')!).render(<App />);
