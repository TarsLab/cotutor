/**
 * 写字格:孩子点开课本上一个空的田字格(或描红格)、一个填空(算式里的□、空着的括号),在这张卡上写,「放好」就缩进页上那一格(docs/dev/课本.md)。
 * 谁用:课本页的舞台(./book.tsx 的 BookStage):它决定开哪一格、卡摆在哪(贴着那一格,页挪了跟着走)、放好以后挪到同一排下一个空格。
 * 卡上:左上角小格是照着写的范字(描红格没有,红字淡铺在大格底下让他描);点它,大格里照笔顺一笔一笔写一遍(笔顺数据 /api/kid/tianzige/<字>,
 * 同点字弹的田字格:每一笔的中线用粗线描、外面套这一笔的轮廓做 clipPath),孩子一落笔它就淡下去、留着给他描;数据里没有的字点了不动。
 * 大田字格里写;「擦」擦这一格写的;「放好」交出去;× 不要了(没放好的笔画丢掉)。
 * 手指、Apple Pencil、鼠标都能写(格子小,点开再写;不像页上只有笔能落笔);笔在写时别的手指(手掌)不算。
 * 坐标:左上角起,长的那一边是 CELL_UNIT(田字格见方;括号宽、矮);交出去的笔画就是这个坐标(一节课状态里 kid.cells 的样子)。填空的卡照格的宽高比,没有田字格的线。
 * 页上没有对错:写成什么样都收。
 */
import { forwardRef, useRef, useState } from 'react';
import { CELL_UNIT, LESSON_CELL_STROKES, LESSON_INK_POINTS } from '../../schema/index.ts';

/** 孩子写字的铅笔色(谁画的一眼分得出:写进格子的字是铅笔灰,不是记号的蓝) */
export const WRITE_INK = '#4a5260';
/** 笔画粗细:占格的短边的几分之几(页上缩进格里也照这个比例) */
export const WRITE_WIDTH = 0.045;

export interface CellPadProps {
  /** 照着写的字(范字);描红格是要描的那个字 */
  model?: string;
  trace: boolean;
  /** 填空(算式里的□、括号):没有田字格的线 */
  blank: boolean;
  /** 格的宽、高(场景单位,只用比例) */
  w: number;
  h: number;
  /** 这一格以前写过的(点开写过的格接着改) */
  strokes: [number, number][][];
  /** 学科色(「放好」的底色、范字小格的边) */
  color: string;
  onSave(strokes: [number, number][][]): void;
  onClose(): void;
  /** 写了还没放好:舞台照它决定点页上别处收不收这张卡 */
  onDirty(dirty: boolean): void;
}

const U = CELL_UNIT;
/** 笔顺:一笔写多久、下一笔晚多少(毫秒;同 stage.css 的 .cp-run) */
const STROKE_MS = 650;

/** 一个字的笔顺(hanzi-writer 的数据:1024 见方、y 向上;strokes 每笔轮廓,medians 每笔中线);没有 = null。同一个字只取一次 */
interface Hanzi { strokes: string[]; medians: number[][][] }
const hanzi = new Map<string, Promise<Hanzi | null>>();
const hanziOf = (ch: string): Promise<Hanzi | null> => {
  if (!hanzi.has(ch)) hanzi.set(ch, fetch(`/api/kid/tianzige/${encodeURIComponent(ch)}`).then((r) => (r.ok ? (r.json() as Promise<Hanzi>) : null)).catch(() => null));
  return hanzi.get(ch)!;
};
const pathD = (pts: readonly [number, number][]): string => (pts.length === 1 ? `M${pts[0][0]} ${pts[0][1]}l0.1 0` : pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(''));

/** 田字格的线:外框实线、中线虚线(同听写页);填空只有外框 */
function Grid({ w, h, plain }: { w: number; h: number; plain?: boolean }): JSX.Element {
  return (
    <g className="cp-grid">
      <rect x={0} y={0} width={w} height={h} />
      {plain ? null : <path className="mid" d={`M0 ${h / 2}H${w}M${w / 2} 0V${h}`} />}
    </g>
  );
}

export const CellPad = forwardRef<HTMLDivElement, CellPadProps>(function CellPad({ model, trace, blank, w: cw, h: ch, strokes: initial, color, onSave, onClose, onDirty }, ref) {
  // 长的那一边是 U;卡上的大格照这个比例(宽的括号卡宽些、矮些)
  const big = Math.max(cw, ch, 1), VW = Math.round((U * cw) / big), VH = Math.round((U * ch) / big);
  // 见方的 220px;宽的(括号)宽一些、矮一些,最宽 360px
  const ratio = VW / VH, padW = ratio >= 1 ? Math.min(360, 220 * Math.sqrt(ratio)) : 220 * ratio;
  const sizeCss = { width: Math.round(padW), height: Math.round(ratio >= 1 ? padW / ratio : 220) };
  const [strokes, setStrokes] = useState<[number, number][][]>(initial);
  const [dirty, setDirty] = useState(false);
  const live = useRef<{ id: number; type: string; pts: [number, number][] } | null>(null);
  const [, redraw] = useState(0);
  const box = useRef<SVGSVGElement>(null);
  /** 笔顺:数据、第几次写(换 key 重放)、孩子落了笔就淡下去 */
  const [demo, setDemo] = useState<{ hz: Hanzi; n: number; faint: boolean } | null>(null);
  const uid = useRef(`cp${Math.random().toString(36).slice(2, 8)}`).current;
  const play = (): void => { if (model) void hanziOf(model).then((hz) => { if (hz) setDemo((d) => ({ hz, n: (d?.n ?? 0) + 1, faint: false })); }); };

  const mark = (d: boolean): void => { setDirty(d); onDirty(d); };
  const local = (e: React.PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    const k = (v: number, a: number, w: number, to: number): number => Math.round(Math.min(to, Math.max(0, ((v - a) / w) * to)));
    return [k(e.clientX, r.left, r.width, VW), k(e.clientY, r.top, r.height, VH)];
  };
  const down = (e: React.PointerEvent<SVGSVGElement>): void => {
    e.stopPropagation();
    // 笔在写:手掌不算
    if (live.current && live.current.type === 'pen' && e.pointerType === 'touch') return;
    if (strokes.length >= LESSON_CELL_STROKES) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成的指针捕获不了 */ }
    live.current = { id: e.pointerId, type: e.pointerType, pts: [local(e)] };
    if (demo && !demo.faint) setDemo({ ...demo, faint: true });
    redraw((n) => n + 1);
  };
  const move = (e: React.PointerEvent<SVGSVGElement>): void => {
    e.stopPropagation();
    const L = live.current;
    if (!L || L.id !== e.pointerId || L.pts.length >= LESSON_INK_POINTS) return;
    const p = local(e), q = L.pts[L.pts.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 6) return;
    L.pts.push(p);
    redraw((n) => n + 1);
  };
  const up = (e: React.PointerEvent<SVGSVGElement>): void => {
    e.stopPropagation();
    const L = live.current;
    if (!L || L.id !== e.pointerId) return;
    live.current = null;
    setStrokes((s) => [...s, L.pts]);
    mark(true);
  };
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation();
  const ink = { fill: 'none', stroke: WRITE_INK, strokeWidth: Math.min(VW, VH) * WRITE_WIDTH, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  return (
    <div className="bk-pad" ref={ref} style={{ ['--sc' as string]: color }} onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onWheel={stop}>
      <button type="button" className="bk-pad-x" aria-label="收起来" onClick={onClose}>
        <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      {model && !trace && !blank ? (
        <div className="bk-pad-model" role="button" tabIndex={0} aria-label={`看「${model}」的笔顺`} onClick={play} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') play(); }}>
          <svg viewBox={`0 0 ${U} ${U}`}>
            <Grid w={U} h={U} />
            <text x={U / 2} y={U * 0.8} textAnchor="middle" fontSize={U * 0.78}>{model}</text>
          </svg>
          <span>范字</span>
        </div>
      ) : null}
      <svg className="bk-pad-grid" ref={box} viewBox={`0 0 ${VW} ${VH}`} style={sizeCss} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <Grid w={VW} h={VH} plain={blank} />
        {trace && model ? <text className="cp-trace" x={U / 2} y={U * 0.8} textAnchor="middle" fontSize={U * 0.78}>{model}</text> : null}
        {demo ? (
          <g key={demo.n} className={`cp-demo${demo.faint ? ' cp-faint' : ''}`} transform={`scale(${VW / 1024}) translate(0 900) scale(1 -1)`}>
            <defs>{demo.hz.strokes.map((d, i) => <clipPath key={i} id={`${uid}-${demo.n}-${i}`}><path d={d} /></clipPath>)}</defs>
            {demo.hz.strokes.map((d, i) => <path key={`g${i}`} className="cp-ghost" d={d} />)}
            {demo.hz.medians.map((m, i) => <path key={`m${i}`} className="cp-run" d={`M${m.map((q) => `${q[0]} ${q[1]}`).join(' L')}`} pathLength={1} clipPath={`url(#${uid}-${demo.n}-${i})`} style={{ animationDelay: `${i * STROKE_MS}ms` }} />)}
          </g>
        ) : null}
        {strokes.map((st, i) => <path key={i} d={pathD(st)} {...ink} />)}
        {live.current ? <path d={pathD(live.current.pts)} {...ink} /> : null}
      </svg>
      <div className="bk-pad-btns">
        <button type="button" disabled={!strokes.length} onClick={() => { setStrokes([]); mark(true); }}>擦</button>
        <button type="button" className="pri" disabled={!dirty} onClick={() => { onSave(strokes); mark(false); }}>放好</button>
      </div>
    </div>
  );
});
