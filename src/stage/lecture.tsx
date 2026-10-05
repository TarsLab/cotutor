/**
 * 小课堂的播放器(《小课堂设计.md》§三):不用 ChalkPlayer(那是接力式,一步一停、只能跳到步开头),
 * 用 drawtell 公开的 buildAnimatedSvg 画出带 SMIL 逐笔动画的 SVG,时钟自己管(src/lib/lecture.ts):
 * 一段 = 一步,段长 = max(画, 配音);SVG 永远暂停,每帧 setCurrentTime 到这一刻;一个 <audio> 全程复用,换段换 src。
 * 能拖到任意一刻(拖的时候不出声),气口不停,放到结尾一次就算看完(发给页面)。
 * 界面照原型:顶上回去 + 课名,中间画面,下面字幕、进度条(步骤点、拖动、时间)、一行提示。没有错误文案:装不上就发 error。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAnimatedSvg } from 'drawtell/player';
import { clockLabel, lectureAt, lectureClock, type LectureClock } from '../lib/lecture.ts';
import { loadBundle } from './scene.tsx';

export interface LectureWatch {
  watchedMs: number;
  finished: boolean;
  pauses: number;
}

export interface LectureStageProps {
  bundleUrl: string;
  title: string;
  onFinished(w: LectureWatch): void;
  onClose(w: LectureWatch): void;
  onError(message: string): void;
}

/** 声音和画面差多少就把声音拉回来(毫秒) */
const RESYNC_MS = 300;

export function LectureStage({ bundleUrl, title, onFinished, onClose, onError }: LectureStageProps): JSX.Element {
  const [clock, setClock] = useState<LectureClock | null>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const t = useRef(0);
  const last = useRef(0);
  const seg = useRef(-1);
  const scrubbing = useRef(false);
  const watch = useRef<LectureWatch>({ watchedMs: 0, finished: false, pauses: 0 });

  // 装课包:时钟和 SVG 用同一份拉伸后的笔画(时长一致);SVG 暂停在开头
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const scene = await loadBundle(bundleUrl);
      const c = lectureClock(scene.skeletons, scene.steps);
      if (!c.segments.length) throw new Error('这份课包没有步');
      const built = await buildAnimatedSvg(c.skeletons as typeof scene.skeletons);
      if (cancelled) return;
      const svg = built.svg;
      svg.pauseAnimations();
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.classList.add('lc-svg');
      host.current?.replaceChildren(svg);
      svgRef.current = svg;
      svg.setCurrentTime(lectureAt(c, 0).svgMs / 1000);
      setClock(c);
    })().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
  }, [bundleUrl, onError]);

  /** 这一段的声音:换段换 src,从段内 offset 放;没有配音 / 放不出来都不拦 */
  const syncAudio = useCallback((c: LectureClock, ms: number, play: boolean) => {
    const a = (audio.current ??= new Audio());
    const at = lectureAt(c, ms);
    const s = c.segments[at.index];
    if (!s) return;
    if (seg.current !== at.index) {
      seg.current = at.index;
      if (s.audioSrc) { a.src = new URL(s.audioSrc, new URL(bundleUrl, location.href)).href; } else a.removeAttribute('src');
    }
    if (!s.audioSrc || s.audioMs === null || at.offset >= s.audioMs) { a.pause(); return; }
    if (Math.abs(a.currentTime * 1000 - at.offset) > RESYNC_MS) { try { a.currentTime = at.offset / 1000; } catch { /* 还没装好 metadata */ } }
    if (play && a.paused) a.play().catch(() => {});
    if (!play && !a.paused) a.pause();
  }, [bundleUrl]);

  /** 画到这一刻 */
  const paint = useCallback((c: LectureClock, ms: number) => {
    t.current = ms;
    svgRef.current?.setCurrentTime(lectureAt(c, ms).svgMs / 1000);
    setNow(ms);
  }, []);

  // 一个时钟:播着就按真实时间往前走;到了结尾停下,算看完
  useEffect(() => {
    if (!clock || !playing) return;
    let raf = 0;
    last.current = performance.now();
    const tick = (p: number): void => {
      const dt = p - last.current;
      last.current = p;
      if (!scrubbing.current) {
        const next = Math.min(clock.total, t.current + dt);
        paint(clock, next);
        watch.current.watchedMs = Math.max(watch.current.watchedMs, next);
        syncAudio(clock, next, true);
        if (next >= clock.total) {
          setPlaying(false);
          audio.current?.pause();
          if (!watch.current.finished) { watch.current.finished = true; onFinished({ ...watch.current }); }
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock, playing, paint, syncAudio, onFinished]);

  const toggle = useCallback(() => {
    if (!clock) return;
    setStarted(true);
    if (playing) { setPlaying(false); audio.current?.pause(); watch.current.pauses++; return; }
    if (t.current >= clock.total) paint(clock, 0);
    syncAudio(clock, t.current, true);
    setPlaying(true);
  }, [clock, playing, paint, syncAudio]);

  // 拖:按下就跟手,不出声;松手从那一刻接着(原来在放就接着放)
  const track = useRef<HTMLDivElement>(null);
  const msAt = (clientX: number): number => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !clock) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * clock.total;
  };
  const onDown = (e: React.PointerEvent): void => {
    if (!clock) return;
    scrubbing.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    audio.current?.pause();
    paint(clock, msAt(e.clientX));
  };
  const onMove = (e: React.PointerEvent): void => { if (scrubbing.current && clock) paint(clock, msAt(e.clientX)); };
  const onUp = (): void => {
    if (!scrubbing.current || !clock) return;
    scrubbing.current = false;
    seg.current = -1;
    syncAudio(clock, t.current, playing);
  };
  const jump = (ms: number): void => {
    if (!clock) return;
    setStarted(true);
    paint(clock, ms);
    seg.current = -1;
    syncAudio(clock, ms, playing);
  };

  useEffect(() => () => { audio.current?.pause(); }, []);

  const at = clock ? lectureAt(clock, now) : null;
  const line = clock && at ? (clock.segments[at.index]?.line ?? '') : '';
  const dots = useMemo(() => (clock ? clock.segments.map((s) => ({ i: s.index, left: (s.start / clock.total) * 100, start: s.start })) : []), [clock]);
  const pct = clock ? (now / clock.total) * 100 : 0;

  return (
    <div className="lc">
      <div className="lc-top">
        <button type="button" className="lc-round" aria-label="回首页" onClick={() => onClose({ ...watch.current })}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.5 4 6.5 10l6 6" /></svg>
        </button>
        <div className="lc-chip"><span className="lc-tag">小课堂</span><span className="lc-title">{title}</span></div>
      </div>
      <div className="lc-canvas">
        <div className="lc-host" ref={host} />
        {!clock && <div className="stage-wait">课还在路上…</div>}
        {clock && !started && (
          <button type="button" className="lc-start" onClick={toggle}>
            <svg width="28" height="28" viewBox="0 0 18 18"><path d="M5 3.5v11l9-5.5z" fill="currentColor" /></svg>
            开始看
          </button>
        )}
      </div>
      <div className="lc-line">{started ? line : ''}</div>
      <div className="lc-bar">
        <button type="button" className="lc-play" aria-label={playing ? '暂停' : '播放'} onClick={toggle} disabled={!clock}>
          {playing
            ? <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="3" width="4.2" height="14" rx="1" /><rect x="11.8" y="3" width="4.2" height="14" rx="1" /></svg>
            : <svg width="20" height="20" viewBox="0 0 18 18"><path d="M5 3.5v11l9-5.5z" fill="currentColor" /></svg>}
        </button>
        <div className="lc-mid">
          <div className="lc-dots">
            {dots.map((d) => (
              <button key={d.i} type="button" className={'lc-dot' + (now >= d.start ? ' on' : '')} style={{ left: `${d.left}%` }} aria-label={`从 ${clockLabel(d.start)} 放`} onClick={() => jump(d.start)}>{d.i + 1}</button>
            ))}
          </div>
          <div className="lc-track" ref={track} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <div className="lc-fill" style={{ width: `${pct}%` }} />
            <div className="lc-knob" style={{ left: `${pct}%` }} />
          </div>
        </div>
        <div className="lc-time">{clockLabel(now)} / {clock ? clockLabel(clock.total) : '0:00'}</div>
      </div>
      <div className="lc-hint">看完就能问老师</div>
    </div>
  );
}
