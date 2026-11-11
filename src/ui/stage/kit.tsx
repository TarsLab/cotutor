/**
 * 教具卡的舞台:老师先画好的一幅图(src/chalk/kit/,方向盘…),孩子在上面转一转、圈一圈。
 * 画面在这里现烤一次(./chalk/bake.ts,按需装 excalidraw),之后和小课堂一样由 ./chalk/render.ts 画:打开时一笔一笔画出来(点一下就画完);
 * 能转的一组收进一个 <g>,转 = 改它的 rotate(绕教具给的那个点),一格一格转、带动画;要保持正着的字各套一层反着转的 <g>,位置跟着走、自己不歪。
 * 孩子的笔画在最上面一层(场景坐标,和小课堂里画的一处同一种换算;蓝、比老师的线粗,src/chalk/pointer.ts 的 KID_INK);转了以后先前画的清掉——圈的是现在的画面。
 * 每张卡只开放老师写的那几种操作(props.ops):有「转」才有转的钮,有别的(切、圈、涂)才拿得起笔。笔画原样留着,不归整。
 * 状态({turn, moves, marks})改了就回页面;页面按「给老师看」→ control submit → 整份状态连一张板此刻的图(png)交回去,老师看图、服务端另算一句大概(describeKit)。
 * 页面再发一张卡进来(老师的下一张):还是同一种教具就不重来——上一张已经有的东西直接在,只把新添的画出来,少了的不见了;孩子上一步的笔画清掉。
 * 工具一列竖着(kid.hand: left 时在右),最底下空出一格放页面浮上来的老师小头像。类名都带 kt-(舞台页也装孩子端的 theme.css)。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { KID_INK, KID_INK_WIDTH, KIT_MARK_MAX, KIT_MARK_POINTS, elementBounds, frameAt, kitOf, kitOps, kitParams, kitTouched, lessonClock, turnOf, type KitState, type KitTurn, type LessonClock } from '../../chalk/index.ts';
import { mountBaked, type MountedLesson } from './chalk/render.ts';

export interface KitStageHandle {
  submit(): void;
}

export interface KitStageProps {
  /** 哪张卡(<job>/<n>):换了一张就重摆,哪怕画法和参数一样(孩子上一步的笔画要清掉) */
  id: string;
  kit: string;
  params: Record<string, unknown>;
  /** 这一步开放的操作;不给 = 这种教具的全部 */
  ops?: unknown;
  state: KitState | null;
  /** 照片做底的画法:那张照片的地址(页面给) */
  imageUrl?: string;
  /** 交给老师过了:只看 */
  readonly?: boolean;
  hand?: 'left' | 'right';
  onState(state: KitState): void;
  /** image = 板此刻的样子(png data URL);导不出来就没有 */
  onSubmit(state: KitState, image?: string): void;
  onError(message: string): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 打开时画出来的速度(课包的笔速的几倍):老师这时在说话,图不该让孩子等 */
const DRAW_RATE = 1.5;
/** 转一格多久(毫秒) */
const TURN_MS = 650;
/** 一笔小到这个数以内算点了一下(SVG 坐标;同 src/chalk/kit 的 TAP) */
const TAP = 14;
/** 交给老师的那张图的长边、纸色 */
const SHOT_SIDE = 1024;
const PAPER = '#fffdf8';

/** 能转的一组在 SVG 里:那层 <g>、绕哪个点(SVG 坐标)、里面保持正着的几样(各自的中心)、现在画在多少度 */
interface TurnLayer {
  t: KitTurn;
  g: SVGGElement;
  px: number;
  py: number;
  ups: { g: SVGGElement; cx: number; cy: number }[];
  deg: number;
}

interface Built {
  m: MountedLesson;
  clock: LessonClock;
  dx: number;
  dy: number;
  turns: TurnLayer[];
  ink: SVGGElement;
  /** 照片做底:那张图(已经载好)、高 ÷ 宽、在 SVG 里占哪一块 */
  photo?: { img: HTMLImageElement; aspect: number; box: [number, number, number, number] };
}

const ease = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const norm = (deg: number): number => ((deg % 360) + 360) % 360;
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

const icon = (paths: string): JSX.Element => (
  <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: paths }} />
);
const ICON = {
  left: '<path d="M8 8H4V4"></path><path d="M4 8a8 8 0 1 1 2 9"></path>',
  right: '<path d="M16 8h4V4"></path><path d="M20 8a8 8 0 1 0-2 9"></path>',
  wipe: '<path d="M4 15l8-8 6 6-6 6H8z"></path><path d="M12 21h8"></path>',
};

export const KitStage = forwardRef<KitStageHandle, KitStageProps>(function KitStage({ id, kit, params, ops, state, imageUrl, readonly, hand, onState, onSubmit, onError }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const built = useRef<Built | null>(null);
  /** 孩子做到哪了(舞台是它的主人;页面只在装的时候、看录像时发进来) */
  const cur = useRef<KitState>({ turn: {}, moves: 0, marks: [] });
  const stroke = useRef<{ pts: [number, number][]; el: SVGPathElement } | null>(null);
  const drawRaf = useRef(0);
  const turnRaf = useRef(0);
  const resize = useRef<ResizeObserver | null>(null);
  /** 板上现在这幅是哪种教具、有哪些元素(id → 原样):下一张还是它,已经有的不重画 */
  const shown = useRef<{ kit: string; els: Map<string, string> } | null>(null);
  const kitDef = kitOf(kit);
  const open = kitDef ? kitOps(kitDef, ops) : [];
  const canTurn = open.includes('转');
  const canPen = open.some((o) => o !== '转');
  /** loading 第一次还在烤 · swapping 换成下一张、还在烤(上一张的画面先留着)· drawing 正一笔一笔画 · ready 能动手了 */
  const [phase, setPhase] = useState<'loading' | 'swapping' | 'drawing' | 'ready'>('loading');
  const [turning, setTurning] = useState(false);
  const [marks, setMarks] = useState(0);
  const key = `${id}|${kit}|${JSON.stringify(params)}|${imageUrl ?? ''}`;

  const setAngle = (L: TurnLayer, deg: number): void => {
    L.deg = deg;
    L.g.setAttribute('transform', `rotate(${deg} ${L.px} ${L.py})`);
    for (const u of L.ups) u.g.setAttribute('transform', `rotate(${-deg} ${u.cx} ${u.cy})`);
  };

  /** 孩子画的几笔画到最上面那层:一笔一条线;点一下是一个小圈 */
  const paintInk = useCallback(() => {
    const b = built.current;
    if (!b) return;
    const out: SVGElement[] = [];
    for (const st of cur.current.marks ?? []) {
      const xs = st.map((p) => p[0]), ys = st.map((p) => p[1]);
      const tiny = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < TAP;
      const common = { fill: 'none', stroke: KID_INK, 'stroke-width': String(KID_INK_WIDTH), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', opacity: '0.9' };
      if (tiny) out.push(el('circle', { cx: String(st[0][0] + b.dx), cy: String(st[0][1] + b.dy), r: '20', ...common }));
      else out.push(el('path', { d: st.map((p, i) => `${i ? 'L' : 'M'}${(p[0] + b.dx).toFixed(1)} ${(p[1] + b.dy).toFixed(1)}`).join(' '), ...common }));
    }
    b.ink.replaceChildren(...out, ...(stroke.current ? [stroke.current.el] : []));
    setMarks((cur.current.marks ?? []).length);
  }, []);

  const emit = useCallback(() => {
    const s = cur.current;
    onState({ turn: { ...(s.turn ?? {}) }, moves: s.moves ?? 0, marks: (s.marks ?? []).map((st) => st.map((p) => [p[0], p[1]] as [number, number])), ...(s.aspect ? { aspect: s.aspect } : {}) });
  }, [onState]);

  // 装:排画面、烤、挂上;没动过手的从头画一遍,动过的(重开、只看)直接是画完的样子
  useEffect(() => {
    let cancelled = false;
    setPhase((p) => (p === 'loading' ? p : 'swapping'));
    (async () => {
      const k = kitOf(kit);
      if (!k) throw new Error(`没有这种教具:${kit}`);
      const kp = kitParams(k, params);
      // 照片做底:先把照片载进来量高宽比(记号要按它排才不扁),再排画面
      let photoImg: HTMLImageElement | null = null;
      if (k.build(kp).photo) {
        if (!imageUrl) throw new Error('照片底板没有照片的地址');
        photoImg = new Image();
        photoImg.src = imageUrl;
        await photoImg.decode();
        if (cancelled) return;
      }
      const aspect = photoImg && photoImg.naturalWidth > 0 ? Math.round((photoImg.naturalHeight / photoImg.naturalWidth) * 10000) / 10000 : undefined;
      const scene = k.build(kp, { aspect });
      const picture = await (await import('./chalk/bake.ts')).bakeSkeletons(scene.skeletons, scene.photo ? { background: scene.photo } : {});
      if (cancelled) return;
      const m = mountBaked(picture, scene.photo && imageUrl ? { backgroundHref: imageUrl } : {});
      // 上一张是同一种教具:原样还在的元素一下子就在(1 毫秒),只有新添的一笔一笔画
      const before = shown.current && shown.current.kit === kit ? shown.current.els : null;
      const timed = scene.skeletons.map((e) => (before && before.get(e.id) === JSON.stringify(e) ? { ...e, animateDuration: 1 } : e));
      const clock = lessonClock(timed, [{ step: 1, elementIds: timed.map((e) => e.id), line: '', pauseAfter: false }]);
      shown.current = { kit, els: new Map(scene.skeletons.map((e) => [e.id, JSON.stringify(e)])) };
      const [dx, dy] = picture.offset;
      const svg = m.svg;
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.classList.add('kt-svg');
      // 能转的一组收进一层(插在这一组第一样的位置);保持正着的字再各套一层,绕自己的中心反着转
      const turns: TurnLayer[] = [];
      for (const t of scene.turns) {
        const roots = t.elementIds.map((id) => ({ id, root: m.rootOf(id) })).filter((x): x is { id: string; root: SVGElement } => Boolean(x.root));
        if (!roots.length) continue;
        const g = el('g', { class: 'kt-turn' });
        roots[0].root.before(g);
        const ups: TurnLayer['ups'] = [];
        for (const { id, root } of roots) {
          if (!t.upright.includes(id)) { g.append(root); continue; }
          const w = el('g', { class: 'kt-up' });
          g.append(w);
          w.append(root);
          const b = elementBounds(scene.skeletons.find((e) => e.id === id)!);
          ups.push({ g: w, cx: (b.minX + b.maxX) / 2 + dx, cy: (b.minY + b.maxY) / 2 + dy });
        }
        turns.push({ t, g, px: t.pivot[0] + dx, py: t.pivot[1] + dy, ups, deg: 0 });
      }
      const ink = el('g', { class: 'kt-ink' });
      svg.append(ink);
      built.current = { m, clock, dx, dy, turns, ink, ...(scene.photo && photoImg && aspect ? { photo: { img: photoImg, aspect, box: [dx, dy, scene.photo.width, scene.photo.height] as [number, number, number, number] } } : {}) };
      // 画框按 viewBox 的宽高比铺(同小课堂):手指画的那一圈贴着画面
      // 教具给了画框就按它铺(板上添了线、少了线,画面不挪地方)
      const vb: [number, number, number, number] = scene.frame ? [scene.frame[0] + dx, scene.frame[1] + dy, scene.frame[2], scene.frame[3]] : picture.viewBox;
      if (scene.frame) svg.setAttribute('viewBox', vb.join(' '));
      const box = document.createElement('div');
      box.className = 'kt-box';
      box.append(svg);
      host.current?.replaceChildren(box);
      const fit = (): void => { const hb = host.current?.getBoundingClientRect(); if (!hb || !(vb[2] > 0 && vb[3] > 0)) return; const s = Math.min(hb.width / vb[2], hb.height / vb[3]); box.style.width = `${Math.floor(vb[2] * s)}px`; box.style.height = `${Math.floor(vb[3] * s)}px`; };
      fit();
      resize.current?.disconnect();
      if (host.current) { resize.current = new ResizeObserver(fit); resize.current.observe(host.current); }
      const s0: KitState = { turn: { ...(state?.turn ?? {}) }, moves: state?.moves ?? 0, marks: (state?.marks ?? []).slice(0, KIT_MARK_MAX), ...(aspect ? { aspect } : {}) };
      cur.current = s0;
      for (const L of turns) setAngle(L, turnOf(L.t, s0));
      paintInk();
      if (readonly || kitTouched(s0)) { m.paint(frameAt(clock, clock.total)); setPhase('ready'); return; }
      // 一笔一笔画出来
      setPhase('drawing');
      const t0 = performance.now();
      const tick = (now: number): void => {
        const ms = Math.min(clock.total, (now - t0) * DRAW_RATE);
        m.paint(frameAt(clock, ms));
        if (ms >= clock.total) { setPhase('ready'); return; }
        drawRaf.current = requestAnimationFrame(tick);
      };
      m.paint(frameAt(clock, 0));
      drawRaf.current = requestAnimationFrame(tick);
    })().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; cancelAnimationFrame(drawRaf.current); cancelAnimationFrame(turnRaf.current); built.current = null; };
    // state、readonly 只在装的时候用一次;之后页面再发进来的状态走下面那个 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onError]);

  /** 还在画的时候点一下:直接画完 */
  const finishDrawing = useCallback(() => {
    const b = built.current;
    if (!b) return;
    cancelAnimationFrame(drawRaf.current);
    b.m.paint(frameAt(b.clock, b.clock.total));
    setPhase('ready');
  }, []);

  /** 这一组从现在的角度转到 to(可以超过一圈的数,转完收回 0–359);转完叫 done */
  const animateTo = useCallback((L: TurnLayer, to: number, done: () => void) => {
    cancelAnimationFrame(turnRaf.current);
    const from = L.deg;
    const t0 = performance.now();
    setTurning(true);
    const tick = (now: number): void => {
      const x = Math.min(1, (now - t0) / TURN_MS);
      setAngle(L, from + (to - from) * ease(x));
      if (x < 1) { turnRaf.current = requestAnimationFrame(tick); return; }
      setAngle(L, norm(to));
      setTurning(false);
      done();
    };
    turnRaf.current = requestAnimationFrame(tick);
  }, []);

  /** 按一下转一格:dir = 1 顺时针、−1 逆时针;先前画的清掉(圈的是转之前的画面) */
  const turn = useCallback((dir: 1 | -1) => {
    const b = built.current;
    const L = b?.turns[0];
    if (!b || !L || readonly || !canTurn || turning || phase !== 'ready') return;
    cur.current = { ...cur.current, marks: [] };
    paintInk();
    animateTo(L, L.deg + dir * L.t.step, () => {
      cur.current = { ...cur.current, turn: { ...(cur.current.turn ?? {}), [L.t.id]: L.deg }, moves: (cur.current.moves ?? 0) + 1 };
      emit();
    });
  }, [readonly, canTurn, turning, phase, paintInk, animateTo, emit]);

  const wipe = useCallback(() => {
    if (readonly || !(cur.current.marks ?? []).length) return;
    cur.current = { ...cur.current, marks: [] };
    paintInk();
    emit();
  }, [readonly, paintInk, emit]);

  // 页面又发了一份状态进来(家长看录像:孩子那时转了、画了):和手上的不一样就照它摆
  const incoming = JSON.stringify(state ?? null);
  useEffect(() => {
    const b = built.current;
    if (!b || phase !== 'ready' || !state) return;
    const mine = cur.current;
    const same = JSON.stringify({ turn: mine.turn ?? {}, moves: mine.moves ?? 0, marks: mine.marks ?? [] }) === JSON.stringify({ turn: state.turn ?? {}, moves: state.moves ?? 0, marks: state.marks ?? [] });
    if (same) return;
    cur.current = { turn: { ...(state.turn ?? {}) }, moves: state.moves ?? 0, marks: (state.marks ?? []).slice(0, KIT_MARK_MAX), ...(mine.aspect ? { aspect: mine.aspect } : {}) };
    for (const L of b.turns) {
      const to = turnOf(L.t, cur.current);
      if (to === norm(L.deg)) continue;
      // 走近的那一边
      const d = ((to - norm(L.deg) + 540) % 360) - 180;
      animateTo(L, L.deg + d, () => {});
    }
    paintInk();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, phase]);

  /** 板此刻的样子导成一张 png(老师画的 + 孩子画的,纸色打底):把 SVG 整个画进 canvas;字体是烤的时候内嵌的。导不出来回 undefined */
  const snapshot = useCallback(async (): Promise<string | undefined> => {
    const b = built.current;
    if (!b) return undefined;
    try {
      const vb = (b.m.svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
      if (vb.length !== 4 || !(vb[2] > 0 && vb[3] > 0)) return undefined;
      const k = SHOT_SIDE / Math.max(vb[2], vb[3]);
      const copy = b.m.svg.cloneNode(true) as SVGSVGElement;
      // 照片另画(SVG 当图片用时载不了外面的图):这里先拿掉,下面直接画进 canvas
      if (b.photo) for (const im of Array.from(copy.querySelectorAll('image'))) im.remove();
      copy.setAttribute('xmlns', SVG_NS);
      copy.setAttribute('width', String(Math.round(vb[2] * k)));
      copy.setAttribute('height', String(Math.round(vb[3] * k)));
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
      try {
        // 画两遍:SVG 当图片用时,内嵌的字体是另起的文档里现装的,头一遍 decode 回来字可能还没装上(那一遍字是空的)
        let img = new Image();
        img.src = url;
        await img.decode();
        await new Promise((r) => setTimeout(r, 80));
        img = new Image();
        img.src = url;
        await img.decode();
        const cv = document.createElement('canvas');
        cv.width = Math.round(vb[2] * k);
        cv.height = Math.round(vb[3] * k);
        const g = cv.getContext('2d');
        if (!g) return undefined;
        g.fillStyle = PAPER;
        g.fillRect(0, 0, cv.width, cv.height);
        if (b.photo) g.drawImage(b.photo.img, (b.photo.box[0] - vb[0]) * k, (b.photo.box[1] - vb[1]) * k, b.photo.box[2] * k, b.photo.box[3] * k);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        return cv.toDataURL('image/png');
      } finally { URL.revokeObjectURL(url); }
    } catch {
      return undefined;
    }
  }, []);

  useImperativeHandle(ref, () => ({
    submit() {
      const s = cur.current;
      const st: KitState = { turn: { ...(s.turn ?? {}) }, moves: s.moves ?? 0, marks: s.marks ?? [], ...(s.aspect ? { aspect: s.aspect } : {}) };
      void snapshot().then((image) => onSubmit(st, image), () => onSubmit(st));
    },
  }), [onSubmit, snapshot]);

  // ---- 笔 ----
  /** 屏幕点 → SVG 坐标 */
  const toSvg = (x: number, y: number): [number, number] | null => {
    const m = built.current?.m.svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(x, y).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const pathD = (pts: readonly [number, number][]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const penDown = (e: React.PointerEvent): void => {
    if (phase === 'drawing') { finishDrawing(); return; }
    if (readonly || !canPen || turning || phase !== 'ready') return;
    const p = toSvg(e.clientX, e.clientY);
    if (!p || !built.current) return;
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* 合成的指针(探针)捕获不了,不碍事 */ }
    const path = el('path', { d: pathD([p]), fill: 'none', stroke: KID_INK, 'stroke-width': String(KID_INK_WIDTH), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', opacity: '0.9' });
    built.current.ink.append(path);
    stroke.current = { pts: [p], el: path };
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
    const b = built.current;
    stroke.current = null;
    if (!s || !b) return;
    // 抽稀到一笔的上限;换成场景坐标。只点了一下也算(一个点记成两个一样的)
    const step = Math.ceil(s.pts.length / KIT_MARK_POINTS);
    const pts = s.pts.filter((_, i) => i % step === 0 || i === s.pts.length - 1).slice(-KIT_MARK_POINTS).map(([x, y]) => [Math.round(x - b.dx), Math.round(y - b.dy)] as [number, number]);
    const mark = pts.length >= 2 ? pts : [pts[0], pts[0]];
    // 画满了:最早的那一笔让出来(他最后画的才是他要说的)
    cur.current = { ...cur.current, marks: [...(cur.current.marks ?? []), mark].slice(-KIT_MARK_MAX) };
    paintInk();
    emit();
  };

  const can = phase === 'ready' && !readonly;
  const btn = (cls: string, label: string, onClick: () => void, disabled: boolean, inner: JSX.Element): JSX.Element => (
    <button type="button" className={`kt-btn ${cls}`} onClick={onClick} disabled={disabled} aria-label={label}>{inner}<span>{label}</span></button>
  );
  return (
    <div className={`kt-wrap${hand === 'left' ? ' kt-hand-left' : ''}`}>
      {readonly ? null : <div className="kt-tools">
        {canTurn && btn('kt-left', '向左转', () => turn(-1), !can || turning, icon(ICON.left))}
        {canTurn && btn('kt-right', '向右转', () => turn(1), !can || turning, icon(ICON.right))}
        {canTurn && canPen && <span className="kt-sep" />}
        {canPen && btn('kt-wipe', '擦掉', wipe, !can || !marks, icon(ICON.wipe))}
      </div>}
      <div className={`kt-board${can && canPen ? ' kt-pen' : ''}`} data-phase={phase} data-marks={marks} onPointerDown={penDown} onPointerMove={penMove} onPointerUp={penUp} onPointerCancel={penUp}>
        <div className="kt-host" ref={host} />
        {phase === 'loading' && <div className="stage-wait">老师在画…</div>}
      </div>
    </div>
  );
});
