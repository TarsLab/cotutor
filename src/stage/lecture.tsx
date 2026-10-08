/**
 * 小课堂的播放器(《小课堂设计.md》§三):不用 ChalkPlayer(那是接力式,一步一停、只能跳到步开头),
 * 时钟是 drawtell/core 的(src/lib/lecture.ts):一段 = 一步,段长 = max(画, 配音);一个 <audio> 全程复用,换段换 src。
 * 画面:课包烤过(bake.json,和 scene.json 的画面对得上)就用 drawtell/render 按这一刻每个元素画了多少现画,不用 excalidraw、不用 SMIL;
 * 没烤过的课包在浏览器里现烤一份(drawtell/bake,按需装 excalidraw),画法一样;不再有 SMIL。
 * 能拖到任意一刻(拖的时候不出声),气口不停,放到结尾一次就算看完(发给页面)。
 * 圈(§四):停住了就能在画面上圈,一笔一处;记那一刻(课里的毫秒)与路径(课包坐标:屏幕点经 getScreenCTM 反算到 SVG,再减掉导出时的平移),
 * 进度条上那一刻留一个蓝色记号;圈了、擦了都把整张单子发给页面(页面是圈的主人,带给老师、画圈的卡)。
 * 界面照原型:顶上回去 + 课名,中间画面,下面字幕、进度条(步骤点、圈的记号、拖动、时间)、一行提示。没有错误文案:装不上就发 error。
 * 老师放课里的一段(§六,板书上的小课堂卡,range):舞台的顶栏与字幕行是页面的,这里只有画面与进度条;从那一段的开头放(讲稿交来的自己放),
 * 放到那一段的末尾一次就停在末帧、发 done;放着 / 停着 / 放完都发 phase(页面字幕行显示课里那句)。iPad 不让出声就停着等孩子点「放这一段」。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { frameAt } from 'drawtell/core';
import { mountBaked } from 'drawtell/render';
import { clockLabel, lectureAt, lectureClock, lectureNext, type LectureClock } from '../lib/lecture.ts';
import { loadBaked, loadBundle } from './bundle.ts';

/** 一处圈(页面与舞台之间传的样子):课里的时刻、SVG 停在哪(画缩略图)、路径(课包坐标) */
export interface StageMark {
  atMs: number;
  svgMs: number;
  path: [number, number][];
  /** 视频的圈:那一帧叠上圈的截图(data URL;页面发消息前传成 captures/ 里的文件,换成路径) */
  image?: string;
  /** 圈下去的那一刻(Date.now();录像用,页面发消息时换成离发出去多少毫秒) */
  at?: number;
}

/** 看的过程的一条(录像用):那一刻(Date.now())停在课里的哪儿、之后在不在放 */
export interface WatchEntry {
  at: number;
  pos: number;
  play: boolean;
}

/** 装好的小课堂:时钟、画面的 SVG、课包坐标 → SVG 坐标的平移、画到某一刻;baked = 课包里有烤好的(否则是现烤的) */
export interface BuiltLecture {
  clock: LectureClock;
  svg: SVGSVGElement;
  dx: number;
  dy: number;
  baked: boolean;
  /** 画到课里的这一刻(毫秒) */
  draw(ms: number): void;
}

/** 课包 → 时钟 + 画面:烤好的用 bake.json,没烤过的在浏览器里现烤(drawtell/bake,按需装 excalidraw);画都由 drawtell/render 按 frameAt 现画 */
export async function buildLecture(bundleUrl: string): Promise<BuiltLecture> {
  const [scene, baked] = await Promise.all([loadBundle(bundleUrl), loadBaked(bundleUrl)]);
  const clock = lectureClock(scene.skeletons, scene.steps);
  if (!clock.segments.length) throw new Error('这份课包没有步');
  const picture = baked ?? (await (await import('drawtell/bake')).bakeSkeletons(scene.skeletons, { background: scene.background }));
  const bg = picture.background ? new URL(picture.background.src, new URL(bundleUrl, location.href)).href : undefined;
  const m = mountBaked(picture, { backgroundHref: bg });
  m.paint(frameAt(clock, 0));
  return { clock, svg: m.svg, dx: picture.offset[0], dy: picture.offset[1], baked: Boolean(baked), draw: (ms) => m.paint(frameAt(clock, ms)) };
}

export interface LectureWatch {
  watchedMs: number;
  finished: boolean;
  pauses: number;
}

export interface LectureStageProps {
  bundleUrl: string;
  title: string;
  /** 页面手上还没交出去的圈(再看一遍时接着画在进度条上) */
  marks: StageMark[];
  /** 从这一刻停着打开(点了圈的卡);不给 = 从头、先点「开始看」 */
  at?: number;
  /** 只看不圈(家长端、以前的话题) */
  view?: boolean;
  onMarks(marks: StageMark[]): void;
  onFinished(w: LectureWatch): void;
  onClose(w: LectureWatch): void;
  /** 放完了,孩子点「去问老师」(拍板 37);不给就不画这个按钮 */
  onAsk?(w: LectureWatch): void;
  onError(message: string): void;
  /** 板书上的小课堂卡:只放这一段(毫秒);有它就是卡的样子(没有顶栏、字幕行、提示,只看不圈) */
  range?: { start: number; end: number };
  /** 讲稿交来的:装好就放 */
  autoplay?: boolean;
  /** 卡的样子:放着 / 停着 / 那一段放完,带课里那一句(页面的字幕行) */
  onPhase?(phase: 'drawing' | 'paused' | 'done', line: string, step: number, total: number): void;
  /** 视频小课堂(第 4 步):bundleUrl 是 /api/kid/lectures/<id>/,下面有 lecture.json(一句一段)与 video.mp4 */
  video?: boolean;
  /** 看的过程:放 / 停 / 拖完 / 跳 / 放完 / 回去,一次一条(录像用) */
  onLog?(e: WatchEntry): void;
  /** 家长看录像:只看,时钟跟着页面(follow) */
  follow?: boolean;
  /** 左上返回胶囊里的老师头像(和老师页的「‹ 头像」一样):图或一个字,圈的颜色;不给只画箭头 */
  tutor?: LectureTutor;
}

export interface LectureTutor {
  color: string;
  img?: string;
  text?: string;
}

/** 视频小课堂的时钟:服务端按 lecture.md 拼好的一句一段 */
async function loadVideoClock(url: string): Promise<LectureClock> {
  const r = await fetch(new URL('lecture.json', new URL(url, location.href)).href);
  if (!r.ok) throw new Error(`小课堂的视频读不出来(${r.status})`);
  const j = (await r.json()) as { total: number; segments: { start: number; len: number; line: string }[] };
  if (!j.segments.length) throw new Error('这份视频没有一句');
  return { skeletons: [], segments: j.segments.map((x, i) => ({ index: i, start: x.start, len: x.len, drawStart: 0, drawEnd: 0, audioMs: null, line: x.line })), total: j.total, elements: new Map() };
}

/** 页面的字幕行按钮(control toggle / play / pause)转到这里;家长看录像时页面每 100 毫秒对一次(follow) */
export interface LectureStageHandle {
  control(action: string): void;
  follow(ms: number, playing: boolean, rate: number, marks: StageMark[]): void;
}

/** 放完了停在最后一帧,话音落了多久「再看一遍」「去问老师」才淡入(拍板 37) */
const END_UI_MS = 1000;
/** 声音和画面差多少就把声音拉回来(毫秒) */
const RESYNC_MS = 300;
/** 停在离一处圈多近算「这一刻的圈」(画在画面上、擦得掉) */
const MARK_NEAR_MS = 400;
/** 最多圈几处(路由也拦);视频的每处带一张截图,和照片一共不过 9 张,少一些 */
const MAX_MARKS = 12;
const MAX_VIDEO_MARKS = 6;
/** 截图的长边 */
const SHOT_SIDE = 1280;
/** 一笔算一处圈:至少几个点、多大(SVG 单位) */
const MIN_POINTS = 4;
const MIN_SIZE = 12;
/** 一处圈最多留几个点 */
const MAX_POINTS = 300;
const INK = '#2f6fd6';
const SVG_NS = 'http://www.w3.org/2000/svg';

export const LectureStage = forwardRef<LectureStageHandle, LectureStageProps>(function LectureStage({ bundleUrl, title, marks: initialMarks, at: rawAt, view: rawView = false, onMarks, onFinished, onClose, onAsk, onError, range, autoplay = false, onPhase, video = false, onLog, follow = false, tutor }, ref): JSX.Element {
  const card = range !== undefined;
  const view = rawView || card || follow;
  /** 录像跟着放:倍速 */
  const rate = useRef(1);
  const openAt = card ? range.start : rawAt;
  const [clock, setClock] = useState<LectureClock | null>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(openAt !== undefined);
  /** 那一段放完过(卡的样子):只停一次,之后孩子要接着放就接着放 */
  const rangeDone = useRef(false);
  /** iPad 不让出声(play() 被拒):停下,等孩子点一下 */
  const blocked = useRef(false);
  const [marks, setMarks] = useState<StageMark[]>(initialMarks);
  const [pen, setPen] = useState(true);
  /** 刚圈好的那一处的时刻:字幕行换成「圈好了,记在 0:26」 */
  const [fresh, setFresh] = useState<number | null>(null);
  /** 放完了,按钮淡入了没有 */
  const [endUi, setEndUi] = useState(false);
  const shift = useRef({ dx: 0, dy: 0 });
  const ink = useRef<SVGGElement | null>(null);
  const stroke = useRef<{ pts: [number, number][]; el: SVGPathElement } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** 画到课里的某一刻(课包;buildLecture 给的) */
  const drawRef = useRef<((ms: number) => void) | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** 视频小课堂:画面与声音都是它;svgRef 是叠在上面圈用的那层(viewBox = 视频自己的像素) */
  const vid = useRef<HTMLVideoElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const hush = (): void => { audio.current?.pause(); vid.current?.pause(); };
  const onBlocked = (e: unknown): void => { if (e instanceof DOMException && e.name === 'NotAllowedError') { blocked.current = true; vid.current?.pause(); setPlaying(false); setStarted(false); } };
  const t = useRef(0);
  const last = useRef(0);
  const seg = useRef(-1);
  /** 配音放到哪、从什么时候起没动(时钟跟着声音走,拍板 36) */
  const voiceAt = useRef({ index: -1, pos: -1, since: 0 });
  const scrubbing = useRef(false);
  const watch = useRef<LectureWatch>({ watchedMs: 0, finished: false, pauses: 0 });

  // 装课包:时钟和 SVG 用同一份拉伸后的笔画(时长一致);SVG 暂停在开头
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (video) {
        const c = await loadVideoClock(bundleUrl);
        const v = document.createElement('video');
        v.playsInline = true;
        v.setAttribute('webkit-playsinline', '');
        v.preload = 'auto';
        v.className = 'lc-video';
        v.src = new URL('video.mp4', new URL(bundleUrl, location.href)).href;
        await new Promise<void>((res, rej) => { v.addEventListener('loadedmetadata', () => res(), { once: true }); v.addEventListener('error', () => rej(new Error('小课堂的视频放不出来')), { once: true }); });
        if (cancelled) return;
        const W = v.videoWidth || 16, H = v.videoHeight || 9;
        const over = document.createElementNS(SVG_NS, 'svg');
        over.setAttribute('viewBox', `0 0 ${W} ${H}`);
        over.setAttribute('class', 'lc-over');
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'lc-ink');
        over.append(g);
        ink.current = g;
        const b = document.createElement('div');
        b.className = 'lc-vbox';
        b.append(v, over);
        // 画框按视频的宽高比铺在画面里(圈那层与视频严丝合缝)
        const fit = (): void => { const hb = host.current?.getBoundingClientRect(); if (!hb) return; const k = Math.min(hb.width / W, hb.height / H); b.style.width = `${Math.floor(W * k)}px`; b.style.height = `${Math.floor(H * k)}px`; };
        host.current?.replaceChildren(b);
        fit();
        new ResizeObserver(fit).observe(host.current!);
        vid.current = v;
        box.current = b;
        svgRef.current = over;
        const start = openAt !== undefined ? Math.max(0, Math.min(openAt, c.total)) : 0;
        t.current = start;
        v.currentTime = start / 1000;
        setNow(start);
        setClock(c);
        return;
      }
      const built = await buildLecture(bundleUrl);
      const { clock: c, svg, dx, dy } = built;
      if (cancelled) return;
      drawRef.current = built.draw;
      shift.current = { dx, dy };
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.classList.add('lc-svg');
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'lc-ink');
      svg.append(g);
      ink.current = g;
      host.current?.replaceChildren(svg);
      svgRef.current = svg;
      const start = openAt !== undefined ? Math.max(0, Math.min(openAt, c.total)) : 0;
      t.current = start;
      // 老课包:Safari(iPad)把 SVG 放进页面时时间轴重新走起来,之前的暂停不算——draw 里会再停一次
      built.draw(start);
      setNow(start);
      setClock(c);
    })().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
    // openAt 只在装的时候用一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleUrl, onError]);

  /** 这一段的声音:换段换 src,从段内 offset 放;没有配音 / 放不出来都不拦 */
  const syncAudio = useCallback((c: LectureClock, ms: number, play: boolean) => {
    const v = vid.current;
    if (v) {
      v.playbackRate = rate.current;
      if (play && v.paused && !v.ended) v.play().catch(onBlocked);
      if (!play && !v.paused) v.pause();
      return;
    }
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
    a.playbackRate = rate.current;
    if (play && a.paused) a.play().catch(onBlocked);
    if (!play && !a.paused) a.pause();
  }, [bundleUrl]);

  /** 画到这一刻;视频:seek = 把视频挪过去(放着的时候时钟跟视频走,不挪) */
  const paint = useCallback((_c: LectureClock, ms: number, seek = true) => {
    t.current = ms;
    if (vid.current) { if (seek) vid.current.currentTime = ms / 1000; }
    else drawRef.current?.(ms);
    setNow(ms);
  }, []);

  /**
   * 正在放的配音:第几段、放到哪、多久没动了;没在放、放不出来(404 之类)= null。
   * 还没装好(readyState < 2)的 currentTime 是我们刚设的值,不算动了,位置当 0(时钟原地等)。
   */
  const voiceOf = (p: number): { index: number; posMs: number; stalledMs: number } | null => {
    const a = audio.current;
    if (!a || a.paused || a.error || seg.current < 0 || !a.getAttribute('src')) return null;
    const ready = a.readyState >= 2;
    const pos = ready ? a.currentTime * 1000 : -1;
    const w = voiceAt.current;
    if (w.index !== seg.current || (ready && w.pos !== pos)) voiceAt.current = { index: seg.current, pos, since: p };
    return { index: seg.current, posMs: Math.max(0, pos), stalledMs: p - voiceAt.current.since };
  };

  // 一个时钟:播着就往前走(课包跟着配音);到了结尾停下,算看完
  useEffect(() => {
    if (!clock || !playing) return;
    let raf = 0;
    last.current = performance.now();
    const tick = (p: number): void => {
      const dt = (p - last.current) * rate.current;
      last.current = p;
      if (!scrubbing.current) {
        // 视频:时钟就是视频自己的;课包:配音在放跟着配音走,没在放按真实时间往前走(看录像跟页面的钟,不跟声音)
        const v = vid.current;
        let next = v ? (v.ended ? clock.total : Math.min(clock.total, v.currentTime * 1000)) : lectureNext(clock, t.current, dt, follow ? null : voiceOf(p));
        // 卡的样子:放到那一段的末尾停在末帧(退 1 毫秒,不露下一段的头一笔),只停这一次
        if (range && !rangeDone.current && t.current < range.end && next >= range.end) {
          next = Math.max(range.start, range.end - 1);
          hush();
          paint(clock, next);
          rangeDone.current = true;
          setPlaying(false);
          onRangeEnd.current();
          return;
        }
        paint(clock, next, false);
        watch.current.watchedMs = Math.max(watch.current.watchedMs, next);
        syncAudio(clock, next, true);
        if (next >= clock.total) {
          setPlaying(false);
          hush();
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
    setFresh(null);
    blocked.current = false;
    // 视频:停下时时钟对到视频真停的那一帧(圈与截图是同一刻)
    if (playing) { setPlaying(false); hush(); if (vid.current) paint(clock, vid.current.currentTime * 1000, false); watch.current.pauses++; return; }
    if (t.current >= clock.total) paint(clock, 0);
    syncAudio(clock, t.current, true);
    setPlaying(true);
  }, [clock, playing, paint, syncAudio]);

  // ---- 卡的样子(老师放课里的一段) ----
  const phaseOf = useRef(onPhase);
  phaseOf.current = onPhase;
  const sayPhase = (c: LectureClock, phase: 'drawing' | 'paused' | 'done'): void => {
    const i = lectureAt(c, t.current).index;
    phaseOf.current?.(phase, c.segments[i]?.line ?? '', i + 1, c.segments.length);
  };
  const onRangeEnd = useRef(() => {});
  onRangeEnd.current = () => { if (clock) sayPhase(clock, 'done'); };
  // 讲稿交来的:装好就从那一段开头放
  useEffect(() => {
    if (clock && card && autoplay) toggle();
    // 只在装好时一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock]);
  // 放着 / 停着、换了一句:告诉页面(字幕行);那一段放完的 done 在时钟里说
  const atIndex = clock ? lectureAt(clock, now).index : -1;
  useEffect(() => {
    if (!clock || !card || !started) return;
    if (!playing && rangeDone.current && Math.abs(t.current - (range.end - 1)) < 2) return;
    sayPhase(clock, playing ? 'drawing' : 'paused');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, playing, atIndex, started]);
  useImperativeHandle(ref, () => ({
    control(action: string) {
      if (action === 'toggle' || (action === 'play' && !playing) || (action === 'pause' && playing)) toggle();
    },
    // 录像:页面的时钟是准的;差 300 毫秒以上(拖了、压过一段空白)就挪过去,放着就自己按倍速走(画面每帧都画)
    follow(ms: number, play: boolean, r: number, ms2: StageMark[]) {
      if (!clock) return;
      rate.current = r;
      setStarted(true);
      setMarks((cur) => (cur.length === ms2.length ? cur : ms2));
      if (!play || Math.abs(t.current - ms) > RESYNC_MS) { paint(clock, ms); seg.current = -1; }
      if (play && !playing) { syncAudio(clock, ms, true); setPlaying(true); }
      else if (!play && playing) { setPlaying(false); hush(); }
    },
  }), [toggle, playing, clock, paint, syncAudio]);

  // ---- 看的过程(录像用):放 / 停变了记一条;拖完、跳、点记号挪了位置也记 ----
  const logOf = useRef(onLog);
  logOf.current = onLog;
  const log = (play: boolean): void => { if (!follow) logOf.current?.({ at: Date.now(), pos: Math.round(t.current), play }); };
  useEffect(() => {
    if (clock && started) log(playing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, started, clock]);

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
    hush();
    paint(clock, msAt(e.clientX));
  };
  const onMove = (e: React.PointerEvent): void => { if (scrubbing.current && clock) paint(clock, msAt(e.clientX)); };
  const onUp = (): void => {
    if (!scrubbing.current || !clock) return;
    scrubbing.current = false;
    seg.current = -1;
    syncAudio(clock, t.current, playing);
    log(playing);
  };
  const jump = (ms: number): void => {
    if (!clock) return;
    setStarted(true);
    setFresh(null);
    paint(clock, ms);
    seg.current = -1;
    syncAudio(clock, ms, playing);
    log(playing);
  };

  useEffect(() => () => { audio.current?.pause(); vid.current?.pause(); }, []);

  // ---- 圈 ----
  const changeMarks = (next: StageMark[]): void => { setMarks(next); onMarks(next); };
  const here = (m: StageMark): boolean => Math.abs(m.atMs - now) <= MARK_NEAR_MS;
  const canDraw = Boolean(clock) && started && !playing && pen && !view && marks.length < (video ? MAX_VIDEO_MARKS : MAX_MARKS);
  /** 屏幕点 → SVG 坐标(viewBox 里,怎么缩放都对) */
  const toSvg = (clientX: number, clientY: number): [number, number] | null => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const pathD = (pts: readonly [number, number][]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const inkPath = (pts: readonly [number, number][]): SVGPathElement => {
    const el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('d', pathD(pts));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', INK);
    el.setAttribute('stroke-width', '5');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.setAttribute('opacity', '0.9');
    return el;
  };
  // 画面上的圈:停着的时候画出这一刻的(课包坐标 + 平移 = SVG 坐标);放着不画
  useEffect(() => {
    const g = ink.current;
    if (!g) return;
    const { dx, dy } = shift.current;
    if (playing && !g.childNodes.length) return;
    const shown = playing ? [] : marks.filter(here);
    g.replaceChildren(...shown.map((m) => inkPath(m.path.map(([x, y]) => [x + dx, y + dy] as [number, number]))), ...(stroke.current ? [stroke.current.el] : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, now, playing, clock]);
  const penDown = (e: React.PointerEvent): void => {
    if (!canDraw || !clock) return;
    const p = toSvg(e.clientX, e.clientY);
    if (!p) return;
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* 合成的指针(探针)捕获不了,不碍事 */ }
    const el = inkPath([p]);
    ink.current?.append(el);
    stroke.current = { pts: [p], el };
  };
  const penMove = (e: React.PointerEvent): void => {
    const s = stroke.current;
    if (!s) return;
    const p = toSvg(e.clientX, e.clientY);
    if (!p) return;
    const last = s.pts[s.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
    s.pts.push(p);
    s.el.setAttribute('d', pathD(s.pts));
  };
  const penUp = (): void => {
    const s = stroke.current;
    stroke.current = null;
    if (!s || !clock) return;
    s.el.remove();
    const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
    if (s.pts.length < MIN_POINTS || Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < MIN_SIZE) { setMarks((m) => [...m]); return; }
    const step = Math.ceil(s.pts.length / MAX_POINTS);
    const { dx, dy } = shift.current;
    const path = s.pts.filter((_, i) => i % step === 0 || i === s.pts.length - 1).map(([x, y]) => [Math.round(x - dx), Math.round(y - dy)] as [number, number]);
    const at = Math.round(t.current);
    const image = vid.current ? shot(vid.current, path) : undefined;
    changeMarks([...marks, { atMs: at, svgMs: vid.current ? 0 : Math.round(lectureAt(clock, at).svgMs * 10) / 10, path, ...(image ? { image } : {}), at: Date.now() }].sort((a, b) => a.atMs - b.atMs));
    setFresh(at);
  };
  /** 视频的圈:这一帧画到 canvas 上,叠上圈(视频像素坐标),出一张 jpeg;画不出来(没帧)就不带图 */
  const shot = (v: HTMLVideoElement, path: readonly [number, number][]): string | undefined => {
    try {
      const W = v.videoWidth, H = v.videoHeight;
      if (!W || !H) return undefined;
      const k = Math.min(1, SHOT_SIDE / Math.max(W, H));
      const cv = document.createElement('canvas');
      cv.width = Math.round(W * k);
      cv.height = Math.round(H * k);
      const g = cv.getContext('2d');
      if (!g) return undefined;
      g.drawImage(v, 0, 0, cv.width, cv.height);
      g.strokeStyle = INK;
      g.lineWidth = Math.max(3, Math.round(cv.width / 160));
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      path.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
      g.stroke();
      return cv.toDataURL('image/jpeg', 0.85);
    } catch {
      return undefined;
    }
  };
  const erase = (): void => { changeMarks(marks.filter((m) => !here(m))); setFresh(null); };
  const showMark = (m: StageMark): void => {
    if (!clock) return;
    setStarted(true);
    if (playing) { setPlaying(false); hush(); }
    paint(clock, m.atMs);
    seg.current = -1;
    setFresh(null);
    log(false);
  };

  const at = clock ? lectureAt(clock, now) : null;
  const line = clock && at ? (clock.segments[at.index]?.line ?? '') : '';
  const dots = useMemo(() => (clock ? clock.segments.map((s) => ({ i: s.index, left: (s.start / clock.total) * 100, start: s.start })) : []), [clock]);
  const pct = clock ? (now / clock.total) * 100 : 0;
  const paused = Boolean(clock) && started && !playing;
  /** 放完了停在最后一帧(孩子的那份):按钮晚一点淡入,不打断孩子还在听、还在想的那一下 */
  const ended = paused && !card && !follow && !view && Boolean(clock) && now >= clock!.total;
  useEffect(() => {
    if (!ended) { setEndUi(false); return; }
    const id = setTimeout(() => setEndUi(true), END_UI_MS);
    return () => clearTimeout(id);
  }, [ended]);
  const herePen = marks.filter(here).length;
  const say = fresh !== null ? `圈好了,记在 ${clockLabel(fresh)}。问老师的时候,圈的地方会一起带上。` : started ? line : '';

  /** 圈一圈:停着 = 拿起 / 放下笔;放着 = 停下并拿起笔(少按一次暂停) */
  const penTool = (): void => {
    if (!clock) return;
    if (playing) { toggle(); setPen(true); return; }
    setPen(!pen);
  };
  const again = ended && endUi;

  return (
    <div className={'lc' + (card ? ' lc-card' : ' lc-full') + (video ? ' lc-vid' : '')}>
      {/* 左上「‹ 头像」浮在上面,和老师页的返回胶囊一个样子(拍板 39) */}
      {!card && !follow && <button type="button" className="lc-back" aria-label="回首页" onClick={() => { log(false); onClose({ ...watch.current }); }}>
        <i className="lc-back-ic"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg></i>
        {tutor && <span className="lc-av" style={{ borderColor: tutor.color, color: tutor.color }}>{tutor.img ? <img src={tutor.img} alt="" /> : tutor.text}</span>}
      </button>}
      {!card && <div className={'lc-rail' + (follow ? '' : ' lc-under')}>
        <div className="lc-name"><span className="lc-tag">小课堂</span><span className="lc-title">{title}</span></div>
        {!view && <div className="lc-tools">
          <button type="button" className={'lc-tool' + (paused && pen ? ' on' : '')} aria-pressed={paused && pen} disabled={!clock || !started} onClick={penTool}>
            <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><ellipse cx="10" cy="10" rx="7.5" ry="6" /></svg>
            圈一圈
          </button>
          <button type="button" className="lc-tool" disabled={!paused || !herePen} onClick={erase}>
            <svg width="24" height="24" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12.5 9.5 6l4 4L7 16.5H3.5z" /><path d="M9 16.5h6" /></svg>
            擦掉
          </button>
        </div>}
      </div>}
      <div className={'lc-canvas' + (canDraw ? ' lc-pen' : '')} onPointerDown={penDown} onPointerMove={penMove} onPointerUp={penUp} onPointerCancel={penUp}>
        <div className="lc-host" ref={host} />
        {!clock && <div className="stage-wait">课还在路上…</div>}
        {clock && !started && !follow && (
          <button type="button" className="lc-start" onClick={toggle}>
            <svg width="28" height="28" viewBox="0 0 18 18"><path d="M5 3.5v11l9-5.5z" fill="currentColor" /></svg>
            {card ? '放这一段' : '开始看'}
          </button>
        )}
      </div>
      {!card && <div className={'lc-line' + (fresh !== null ? ' ink' : '')}>{say}</div>}
      <div className="lc-bar">
        <button type="button" className={'lc-play' + (again ? ' again' : paused && clock && now < clock.total ? ' go' : '')} aria-label={playing ? '暂停' : '播放'} onClick={toggle} disabled={!clock}>
          {playing
            ? <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="3" width="4.2" height="14" rx="1" /><rect x="11.8" y="3" width="4.2" height="14" rx="1" /></svg>
            : again
              ? <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6" /><path d="M3.5 3v3.5H7" /></svg>
              : <svg width="20" height="20" viewBox="0 0 18 18"><path d="M5 3.5v11l9-5.5z" fill="currentColor" /></svg>}
          {again ? <span>再看一遍</span> : paused && clock && now < clock.total ? <span>{card && !rangeDone.current ? '放这一段' : '接着看'}</span> : null}
        </button>
        <div className="lc-mid">
          <div className="lc-dots">
            {dots.map((d) => (
              <button key={d.i} type="button" className={'lc-dot' + (now >= d.start ? ' on' : '')} style={{ left: `${d.left}%` }} aria-label={`从 ${clockLabel(d.start)} 放`} onClick={() => jump(d.start)}>{d.i + 1}</button>
            ))}
          </div>
          <div className="lc-track" ref={track} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {clock && range && <div className="lc-range" style={{ left: `${(range.start / clock.total) * 100}%`, width: `${((range.end - range.start) / clock.total) * 100}%` }} />}
            <div className="lc-fill" style={{ width: `${pct}%` }} />
            <div className="lc-knob" style={{ left: `${pct}%` }} />
            {clock && marks.map((m) => (
              <button key={`${m.atMs}-${m.path.length}`} type="button" className="lc-mark" style={{ left: `${(m.atMs / clock.total) * 100}%` }} aria-label={`看 ${clockLabel(m.atMs)} 圈的`} onPointerDown={(e) => e.stopPropagation()} onClick={() => showMark(m)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round"><ellipse cx="8" cy="8" rx="5.5" ry="4.5" /></svg>
              </button>
            ))}
          </div>
        </div>
        <div className="lc-time">
          <span>{clockLabel(now)} / {clock ? clockLabel(clock.total) : '0:00'}</span>
          {marks.length ? <small>圈了 {marks.length} 处</small> : null}
        </div>
        {/* 「看完就能问老师」与「去问老师」占同一个位置:放完了话音落了一会儿才换(拍板 37) */}
        {!card && !follow && <div className="lc-slot">
          {!ended
            ? <span className="lc-hint">看完就能问老师</span>
            : again && onAsk
              ? <button type="button" className="lc-askbtn lc-in" onClick={() => { log(false); onAsk({ ...watch.current }); }}>
                  去问老师
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4 6 6-6 6" /></svg>
                </button>
              : null}
        </div>}
      </div>
    </div>
  );
});
