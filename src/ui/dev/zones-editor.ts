/**
 * 工作台「分块」页的脚本(docs/dev/课本.md;画布 https://claude.ai/artifact/Xvt6t4pp1xkLJ6VA6GBnkR):
 * 剥类型内联进 dev-page 的脚本里(./zones-tab.ts),用那边的 $ / h / api / ask / copy / state;名字都带 zn 前缀,别和 dev-page 的撞。接口在 src/app/http/dev-zones.ts。
 *   左边:挑课本、课(目录上最里一层;每课标着用的哪份)、这一课的页;还原成规则出的;课本换过留下的旧分块。
 *   中间:pdf.js 画页(同舞台,/stage/pdf/),上面叠四层:块(最外一层实线带叫法、里面一层虚线、再里面不画)、作答区、没人认领的候选、字行。
 *     选块:单击落最里面(作答区先),同一处再点往外一层,Esc 回外一层;拖框、拉边吸到候选和字行(6px 以内,画参考线说吸到哪);
 *     「加一块」画框,落进框住它的最里面那块;点没人认领的候选:认成作答区 / 不是要写的(进 ignore)。
 *     当孩子点:不画,点一下照孩子端的先后(能写的格、语文的字、有念法的最小的块)说落到哪、会做什么。
 *   右边:面包屑、改种类叫法念法和给老师的(练什么、怎么引、答案、备注)、这一页的块的树(拖到一行上 = 放进去,两行之间 = 排在那里)、检查。
 * 一课一起存:改了就现查(同 cotutor textbook check),有要改的不让存;规则出的那一课存的时候整课写进 vault,问一次。
 */
import type { PermilleBox, RegionKind, Zone, ZoneKind, ZonePage, ZoneRegion, ZoneWriter } from '../../schema/index.ts';

declare const $: (s: string, root?: ParentNode) => HTMLElement | null;
declare const h: (tag: string, attrs?: Record<string, unknown> | null, ...kids: unknown[]) => HTMLElement;
declare const api: (method: string, path: string, body?: unknown) => Promise<any>;
declare const ask: (title: string, lines: string[], ok: string, no: string) => Promise<boolean>;
declare const copy: (text: string, btn: HTMLElement) => void;
declare const state: { tab: string };

type Box = [number, number, number, number];
interface ZnLessonRow { title: string; key: string; depth: number; leaf: boolean; printed: [number, number]; pages: [number, number]; which: 'vault' | 'rules' | 'mixed'; by?: ZoneWriter; at?: string }
interface ZnBook { file: string; sha: string; layout: string; pages: number; vaultPages: number; problems: string[]; lessons: ZnLessonRow[] }
interface ZnList { books: ZnBook[]; unreadable: string[]; stale: { sha: string; title: string | null; pages: number }[] }
interface ZnLine { id: string; text: string; box: Box; chrome?: true; ch?: [number, number][] }
interface ZnCell { id: string; kind: string; box: Box; ch?: string; m?: string; row?: number; col?: number; table?: string }
interface ZnPage { n: number; printed: number | null; w: number; h: number; zones: ZonePage; cand: { lines: ZnLine[]; cells: ZnCell[]; tables: { id: string; box: Box }[] }; by?: ZoneWriter; at?: string }
interface ZnLesson { file: string; title: string; sha: string; layout: string; lessons: { title: string; pages: [number, number] }[]; which: 'vault' | 'rules' | 'mixed'; version: string; pages: ZnPage[] }
type ZnSel = { kind: 'zone' | 'region'; id: string } | null;
interface ZnHit { x: number; y: number; tint: Box | null; tiers: { title: string; detail: string; win: boolean }[]; says: { label: string; say: string }[] }
interface ZnDrag { mode: 'move' | 'size' | 'add' | 'click'; x0: number; y0: number; box0: Box; edges: string; moved: boolean; snap: string | null }

const ZN_KIND: Record<ZoneKind, string> = { title: '课题', column: '栏目', example: '例题', problem: '题', sub: '小题', group: '一组', para: '自然段', table: '表格', figure: '插图', other: '别的字' };
const ZN_RKIND: Record<RegionKind, string> = { write: '写', circle: '圈', draw: '画', link: '连线', underline: '画线', trace: '描写', tick: '打勾' };
const ZN_WHO: Record<ZoneWriter, string> = { rules: '规则出的', agent: '编程助手', workbench: '工作台' };
const ZN_WRITABLE = new Set(['trace', 'empty', 'blank', 'table', 'tick']);
/** 拖、拉多近吸上去(屏幕像素) */
const ZN_SNAP_PX = 6;

const ZN = {
  list: null as ZnList | null,
  book: '',
  key: '',
  data: null as ZnLesson | null,
  orig: new Map<number, string>(),
  work: new Map<number, ZonePage>(),
  undo: [] as string[],
  n: 0,
  sel: null as ZnSel,
  hover: '' as string,
  mode: 'pick' as 'pick' | 'kid',
  layers: { zones: true, regions: true, cand: true, rows: false },
  check: null as { problems: string[]; notes: string[] } | null,
  checkSeq: 0,
  checkTimer: 0 as unknown as ReturnType<typeof setTimeout>,
  hit: null as ZnHit | null,
  adding: false,
  newBox: null as Box | null,
  last: null as { x: number; y: number } | null,
  pop: null as ZnCell | null,
  drag: null as ZnDrag | null,
  guide: [] as { axis: 'x' | 'y'; at: number; label: string }[],
  ghost: null as Box | null,
  dnd: '',
  /** 左边目录上点开、收起过的单元(没点过的:当前这一课在里面就开着) */
  open: new Map<string, boolean>(),
  thumbs: new Map<string, HTMLCanvasElement>(),
  pdf: null as { file: string; doc: Promise<any> } | null,
  W: 600,
  msg: '',
  saving: false,
  audio: null as HTMLAudioElement | null,
  el: {} as { left?: HTMLElement; tool?: HTMLElement; page?: HTMLElement; ov?: HTMLElement; side?: HTMLElement; bar?: HTMLElement; mid?: HTMLElement; form?: HTMLElement; tree?: HTMLElement; check?: HTMLElement },
};

const znR1 = (v: number): number => Math.round(Math.min(1000, Math.max(0, v)) * 10) / 10;
const znArea = (b: readonly number[]): number => (b[2] - b[0]) * (b[3] - b[1]);
const znIn = (x: number, y: number, b: readonly number[]): boolean => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const znIou = (a: readonly number[], b: readonly number[]): number => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), hh = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || hh <= 0) return 0;
  const i = w * hh;
  return i / (znArea(a) + znArea(b) - i);
};
const znPage = (): ZnPage | null => ZN.data?.pages.find((p) => p.n === ZN.n) ?? null;
const znWork = (): ZonePage | null => ZN.work.get(ZN.n) ?? null;
const znH = (): number => { const p = znPage(); return p ? Math.round((ZN.W * p.h) / p.w) : ZN.W * 1.4; };
const znDirtyPages = (): number[] => [...ZN.work].filter(([n, zp]) => JSON.stringify(zp) !== ZN.orig.get(n)).map(([n]) => n);
const znDirty = (): boolean => ZN.undo.length > 0 && znDirtyPages().length > 0;
const znLessonTitle = (): string => (ZN.data ? ZN.data.lessons.map((l) => '《' + l.title + '》').join('') : '');
const znWhen = (iso?: string): string => (iso ? iso.slice(5, 10) + ' ' + iso.slice(11, 16) : '');

// ——— 页上的东西 ———

/** 这一页的块按树走一遍 */
function znWalk(zs: readonly Zone[], f: (z: Zone, depth: number, parent: Zone | null, list: Zone[]) => void, depth = 0, parent: Zone | null = null): void {
  for (const z of zs) { f(z, depth, parent, zs as Zone[]); if (z.children) znWalk(z.children, f, depth + 1, z); }
}

/** 找一块、一个作答区:在哪个列表里、外面套着谁(从外到里) */
function znFind(sel: ZnSel): { zone?: Zone; region?: ZoneRegion; list: (Zone | ZoneRegion)[]; host: Zone | null; chain: Zone[] } | null {
  const zp = znWork();
  if (!zp || !sel) return null;
  if (sel.kind === 'region') {
    for (const r of zp.regions ?? []) if (r.id === sel.id) return { region: r, list: zp.regions!, host: null, chain: [] };
  }
  let got: ReturnType<typeof znFind> = null;
  const go = (zs: Zone[], chain: Zone[]): void => {
    for (const z of zs) {
      if (got) return;
      if (sel.kind === 'zone' && z.id === sel.id) { got = { zone: z, list: zs, host: chain[chain.length - 1] ?? null, chain }; return; }
      if (sel.kind === 'region') for (const r of z.regions ?? []) if (r.id === sel.id) { got = { region: r, list: z.regions!, host: z, chain: [...chain, z] }; return; }
      if (z.children) go(z.children, [...chain, z]);
    }
  };
  go(zp.zones, []);
  return got;
}

function znAllRegions(zp: ZonePage): { r: ZoneRegion; host: Zone | null }[] {
  const out: { r: ZoneRegion; host: Zone | null }[] = (zp.regions ?? []).map((r) => ({ r, host: null }));
  znWalk(zp.zones, (z) => { for (const r of z.regions ?? []) out.push({ r, host: z }); });
  return out;
}

/** 没人认领的候选:孩子要动手的格,没有作答区的 id 是它、也没有框和它重合一半的,也不在 ignore 里 */
function znLoose(): ZnCell[] {
  const p = znPage(), zp = znWork();
  if (!p || !zp) return [];
  const rs = znAllRegions(zp).map((x) => x.r);
  const ignore = new Set(zp.ignore ?? []);
  return p.cand.cells.filter((c) => ZN_WRITABLE.has(c.kind) && !ignore.has(c.id) && !rs.some((r) => r.id === c.id || znIou(r.box, c.box) >= 0.5));
}

/** 框住这一块中心的最里面那块(新的格、新的块往里挂) */
function znHostAt(x: number, y: number, inside?: Box): Zone | null {
  const zp = znWork();
  let best: Zone | null = null, bd = -1;
  if (zp) znWalk(zp.zones, (z, d) => {
    const ok = inside ? inside[0] >= z.box[0] && inside[1] >= z.box[1] && inside[2] <= z.box[2] && inside[3] <= z.box[3] : znIn(x, y, z.box);
    if (ok && d > bd) { best = z; bd = d; }
  });
  return best;
}

// ——— 改 ———

const znSnapshot = (): string => JSON.stringify([...ZN.work]);
function znPush(): void { ZN.undo.push(znSnapshot()); if (ZN.undo.length > 200) ZN.undo.shift(); }
function znUndo(): void {
  const s = ZN.undo.pop();
  if (!s) return;
  ZN.work = new Map(JSON.parse(s) as [number, ZonePage][]);
  if (ZN.sel && !znFind(ZN.sel)) ZN.sel = null;
  znChanged();
}
/** 改了一处:重画、等一下再查 */
function znChanged(): void {
  znPaint();
  clearTimeout(ZN.checkTimer);
  ZN.checkTimer = setTimeout(znRunCheck, 400);
}

async function znRunCheck(): Promise<void> {
  if (!ZN.data) return;
  const seq = ++ZN.checkSeq;
  try {
    const r = await api('POST', '/api/dev/zones/check', { b: ZN.book, l: ZN.key, pages: [...ZN.work.values()] });
    if (seq !== ZN.checkSeq) return;
    ZN.check = r;
  } catch (e) {
    if (seq !== ZN.checkSeq) return;
    ZN.check = { problems: ['查不了:' + (e as Error).message], notes: [] };
  }
  znPaintBar();
  znPaintCheck();
}

function znNewId(stem: string): string {
  const zp = znWork();
  const used = new Set<string>();
  if (zp) { znWalk(zp.zones, (z) => { used.add(z.id); for (const r of z.regions ?? []) used.add(r.id); }); for (const r of zp.regions ?? []) used.add(r.id); }
  for (let k = 1; ; k++) if (!used.has(stem + '-' + k)) return stem + '-' + k;
}

function znDelete(): void {
  const f = znFind(ZN.sel);
  if (!f) return;
  const go = (): void => {
    znPush();
    const k = f.list.indexOf((f.zone ?? f.region)!);
    if (k >= 0) f.list.splice(k, 1);
    if (f.region && f.host?.teacher?.answers) {
      // 答案里引了这一格的去掉它;一条答案一格都不剩就整条去掉
      const id = f.region.id;
      f.host.teacher.answers = f.host.teacher.answers.map((a) => ({ ...a, at: a.at.filter((x) => x !== id) })).filter((a) => a.at.length > 0);
    }
    ZN.sel = f.host ? { kind: 'zone', id: f.host.id } : null;
    znChanged();
  };
  const kids = f.zone ? (f.zone.children?.length ?? 0) + (f.zone.regions?.length ?? 0) : 0;
  if (kids) void ask('删掉「' + f.zone!.label + '」?', ['里面的 ' + kids + ' 个小块和作答区一起删掉(撤销能拿回来)。'], '删掉', '不删').then((ok) => { if (ok) go(); });
  else go();
}

/** 换层级(右边树里拖):where = into 放进去 / before / after 排在它前后;不能放进自己里面 */
function znMove(id: string, target: string, where: 'into' | 'before' | 'after'): void {
  if (id === target) return;
  const from = znFind({ kind: 'zone', id }), to = znFind({ kind: 'zone', id: target });
  if (!from?.zone || !to?.zone) return;
  if (to.chain.some((z) => z.id === id)) return;
  znPush();
  from.list.splice(from.list.indexOf(from.zone), 1);
  if (where === 'into') (to.zone.children ??= []).push(from.zone);
  else { const k = to.list.indexOf(to.zone); (to.list as Zone[]).splice(where === 'before' ? k : k + 1, 0, from.zone); }
  // 空的 children 去掉,文件里不留 []
  znWalk(znWork()!.zones, (z) => { if (z.children && !z.children.length) delete z.children; });
  ZN.sel = { kind: 'zone', id };
  znChanged();
}

/** 没人认领的候选认成作答区:挂到框住它中心的最里面那块上(没有就挂在页上),名字照规则出的那种叫 */
function znClaim(c: ZnCell): void {
  const zp = znWork();
  if (!zp) return;
  znPush();
  const host = znHostAt((c.box[0] + c.box[2]) / 2, (c.box[1] + c.box[3]) / 2);
  const label = c.kind === 'table' ? (host?.label ?? '表格') + '第 ' + (c.row ?? 1) + ' 行第 ' + (c.col ?? 1) + ' 格' : c.kind === 'blank' ? '填空' : c.kind === 'tick' ? '方框' : c.m ? '照着「' + c.m + '」写的格' : '田字格';
  const r: ZoneRegion = c.kind === 'tick'
    ? { id: c.id, kind: 'tick', label, box: c.box }
    : { id: c.id, kind: 'write', label, box: c.box, ...(c.kind !== 'blank' && c.kind !== 'table' ? { tian: true as const } : {}), cell: c.kind as ZoneRegion['cell'], ...(c.ch ? { ch: c.ch } : {}), ...(c.m ? { m: c.m } : {}) };
  if (host) (host.regions ??= []).push(r); else (zp.regions ??= []).push(r);
  ZN.pop = null;
  ZN.sel = { kind: 'region', id: c.id };
  znChanged();
}
function znIgnore(c: ZnCell): void {
  const zp = znWork();
  if (!zp) return;
  znPush();
  zp.ignore = [...(zp.ignore ?? []), c.id];
  ZN.pop = null;
  znChanged();
}

// ——— 吸 ———

/** 能吸的边:候选的格、表格、字行(千分比);x 轴的是左右边,y 轴的是上下边 */
function znTargets(): { x: { v: number; label: string }[]; y: { v: number; label: string }[] } {
  const p = znPage();
  const x: { v: number; label: string }[] = [], y: { v: number; label: string }[] = [];
  if (!p) return { x, y };
  const add = (b: Box, name: string): void => {
    x.push({ v: b[0], label: name + ' 的左边' }, { v: b[2], label: name + ' 的右边' });
    y.push({ v: b[1], label: name + ' 的上边' }, { v: b[3], label: name + ' 的下边' });
  };
  for (const c of p.cand.cells) add(c.box, c.table ? c.table + ' 第 ' + c.row + ' 行第 ' + c.col + ' 格' : '格 ' + c.id);
  for (const t of p.cand.tables) add(t.box, '表格 ' + t.id);
  for (const l of p.cand.lines) if (!l.chrome) add(l.box, '「' + Array.from(l.text).slice(0, 6).join('') + '」那行');
  return { x, y };
}

/** 一条边吸到最近的那条(千分比、阈值);回吸到的值和说法 */
function znSnapEdge(v: number, list: { v: number; label: string }[], tol: number): { v: number; label: string } | null {
  let best: { v: number; label: string } | null = null, d = tol;
  for (const t of list) { const dd = Math.abs(t.v - v); if (dd <= d) { d = dd; best = t; } }
  return best;
}

function znApplyDrag(px: number, py: number): void {
  const d = ZN.drag, f = znFind(ZN.sel);
  if (!d || !f) return;
  const obj = (f.zone ?? f.region)!;
  const tx = (ZN_SNAP_PX / ZN.W) * 1000, ty = (ZN_SNAP_PX / znH()) * 1000;
  const T = znTargets();
  const dx = px - d.x0, dy = py - d.y0;
  const b: Box = [...d.box0];
  ZN.guide = [];
  if (d.mode === 'move') {
    b[0] += dx; b[2] += dx; b[1] += dy; b[3] += dy;
    const sx = [znSnapEdge(b[0], T.x, tx), znSnapEdge(b[2], T.x, tx)].map((s, k) => (s ? { s, off: s.v - b[k * 2] } : null)).filter(Boolean).sort((a, c) => Math.abs(a!.off) - Math.abs(c!.off))[0];
    if (sx) { b[0] += sx.off; b[2] += sx.off; ZN.guide.push({ axis: 'x', at: sx.s.v, label: sx.s.label }); }
    const sy = [znSnapEdge(b[1], T.y, ty), znSnapEdge(b[3], T.y, ty)].map((s, k) => (s ? { s, off: s.v - b[k * 2 + 1] } : null)).filter(Boolean).sort((a, c) => Math.abs(a!.off) - Math.abs(c!.off))[0];
    if (sy) { b[1] += sy.off; b[3] += sy.off; ZN.guide.push({ axis: 'y', at: sy.s.v, label: sy.s.label }); }
  } else {
    const e = d.edges;
    const edge = (k: number, delta: number, axis: 'x' | 'y'): void => {
      const v = d.box0[k] + delta;
      const s = znSnapEdge(v, axis === 'x' ? T.x : T.y, axis === 'x' ? tx : ty);
      b[k] = s ? s.v : v;
      if (s) ZN.guide.push({ axis, at: s.v, label: s.label });
    };
    if (e.includes('w')) edge(0, dx, 'x');
    if (e.includes('e')) edge(2, dx, 'x');
    if (e.includes('n')) edge(1, dy, 'y');
    if (e.includes('s')) edge(3, dy, 'y');
  }
  const nb: Box = [znR1(Math.min(b[0], b[2])), znR1(Math.min(b[1], b[3])), znR1(Math.max(b[0], b[2])), znR1(Math.max(b[1], b[3]))];
  if (nb[2] - nb[0] < 1) nb[2] = znR1(nb[0] + 1);
  if (nb[3] - nb[1] < 1) nb[3] = znR1(nb[1] + 1);
  (obj as { box: PermilleBox }).box = nb;
}

// ——— 点一下 ———

/** 这一点上的东西,从里到外:没人认领的候选、作答区(小的先)、块(深的先,同深小的先) */
function znStack(x: number, y: number): ({ kind: 'cand'; c: ZnCell } | { kind: 'zone' | 'region'; id: string })[] {
  const zp = znWork();
  if (!zp) return [];
  const out: ({ kind: 'cand'; c: ZnCell } | { kind: 'zone' | 'region'; id: string })[] = [];
  if (ZN.layers.cand) for (const c of znLoose()) if (znIn(x, y, c.box)) out.push({ kind: 'cand', c });
  if (ZN.layers.regions) for (const { r } of znAllRegions(zp).filter((v) => znIn(x, y, v.r.box)).sort((a, b) => znArea(a.r.box) - znArea(b.r.box))) out.push({ kind: 'region', id: r.id });
  const zs: { z: Zone; d: number }[] = [];
  znWalk(zp.zones, (z, d) => { if (znIn(x, y, z.box)) zs.push({ z, d }); });
  zs.sort((a, b) => b.d - a.d || znArea(a.z.box) - znArea(b.z.box));
  for (const v of zs) out.push({ kind: 'zone', id: v.z.id });
  return out;
}

/** 单击:落最里面;同一处再点往外一层 */
function znClick(x: number, y: number): void {
  const st = znStack(x, y);
  const near = ZN.last && Math.abs(ZN.last.x - x) * ZN.W / 1000 <= 4 && Math.abs(ZN.last.y - y) * znH() / 1000 <= 4;
  ZN.last = { x, y };
  ZN.pop = null;
  if (!st.length) { ZN.sel = null; znPaint(); return; }
  let k = 0;
  if (near) {
    const at = st.findIndex((s) => s.kind !== 'cand' && ZN.sel && s.kind === ZN.sel.kind && s.id === ZN.sel.id);
    k = at >= 0 ? (at + 1) % st.length : 0;
  }
  const s = st[k];
  if (s.kind === 'cand') ZN.pop = s.c;
  else ZN.sel = { kind: s.kind, id: s.id };
  znPaint();
}

/** 当孩子点:能写的格开写字卡、语文的字点字、再是框住这一点的有念法的最小的块 */
function znKidHit(x: number, y: number): void {
  const p = znPage(), zp = znWork();
  if (!p || !zp) return;
  const hit: ZnHit = { x, y, tint: null, tiers: [], says: [] };
  const write = znAllRegions(zp).map((v) => v.r).filter((r) => r.kind === 'write' && znIn(x, y, r.box)).sort((a, b) => znArea(a.box) - znArea(b.box))[0];
  hit.tiers.push(write
    ? { title: '作答区「' + write.label + '」', detail: write.cell === 'model' ? '范字格 → 照常点字' : '写 → 开写字卡', win: true }
    : { title: '作答区', detail: '这里没有能写的格(打勾、圈、连的格手指点不开卡)', win: false });
  if (write) hit.tint = write.box;
  let ch = '';
  if (ZN.data?.layout === 'prose') {
    for (const l of p.cand.lines) {
      const pad = (l.box[3] - l.box[1]) * 0.2;
      if (!l.ch || y < l.box[1] - pad || y > l.box[3] + pad || x < l.box[0] - pad || x > l.box[2] + pad) continue;
      const k = l.ch.findIndex(([a, b]) => Math.abs((a + b) / 2 - x) < (b - a) * 1.2);
      if (k >= 0) { ch = (l.text.match(/\p{Script=Han}/gu) ?? [])[k] ?? ''; if (!hit.tint) hit.tint = [l.ch[k][0], l.box[1], l.ch[k][1], l.box[3]]; break; }
    }
  }
  const second = !write && Boolean(ch);
  hit.tiers.push(ZN.data?.layout === 'prose' ? { title: ch ? '字「' + ch + '」' : '字', detail: ch ? '→ 点字卡' : '这里没有字', win: second } : { title: '字', detail: '只有语文的页上点字', win: false });
  const says: { z: Zone; a: number }[] = [];
  znWalk(zp.zones, (z) => { if (z.say && znIn(x, y, z.box)) says.push({ z, a: znArea(z.box) }); });
  says.sort((a, b) => a.a - b.a);
  hit.says = says.map((v) => ({ label: v.z.label, say: v.z.say! }));
  const third = !write && !ch && says.length > 0;
  hit.tiers.push(says.length ? { title: '有念法的块「' + says[0].z.label + '」', detail: '念「' + says[0].z.say + '」', win: third } : { title: '有念法的块', detail: '这一点不在哪块有念法的块里', win: false });
  if (third) hit.tint = says[0].z.box;
  ZN.hit = hit;
  znPaintOverlay();
  znPaintSide();
}

async function znSay(text: string, btn: HTMLElement): Promise<void> {
  ZN.audio?.pause();
  btn.setAttribute('disabled', '');
  try {
    const r = await fetch('/api/dev/zones/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: ZN.book, text }), cache: 'no-store' });
    if (!r.ok) { const j = await r.json().catch(() => null); throw new Error((j && j.message) || 'HTTP ' + r.status); }
    ZN.audio = new Audio(URL.createObjectURL(await r.blob()));
    void ZN.audio.play();
  } catch (e) {
    alert('念不了:' + (e as Error).message);
  } finally {
    btn.removeAttribute('disabled');
  }
}

// ——— 画 ———

async function znPdf(): Promise<any> {
  if (ZN.pdf?.file === ZN.book) return ZN.pdf.doc;
  const base = '/stage/pdf/';
  const doc = (async () => {
    const lib = await import(/* @vite-ignore */ base + 'pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
    return lib.getDocument({ url: '/api/kid/textbook/pdf?b=' + encodeURIComponent(ZN.book), cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', rangeChunkSize: 1 << 16, disableAutoFetch: true, disableStream: true }).promise;
  })();
  ZN.pdf = { file: ZN.book, doc };
  doc.catch(() => { if (ZN.pdf?.doc === doc) ZN.pdf = null; });
  return doc;
}

/** 把 PDF 的一页画进 canvas(宽 w 个 CSS 像素) */
async function znDraw(cv: HTMLCanvasElement, n: number, w: number): Promise<boolean> {
  try {
    const doc = await znPdf();
    const page = await doc.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: (w / vp1.width) * dpr });
    cv.width = Math.round(vp.width);
    cv.height = Math.round(vp.height);
    await page.render({ canvas: cv, canvasContext: cv.getContext('2d'), viewport: vp, background: '#ffffff', annotationMode: 0 }).promise;
    return true;
  } catch {
    return false;
  }
}

const znPx = (b: readonly number[]): string => 'left:' + (b[0] / 10) + '%;top:' + (b[1] / 10) + '%;width:' + ((b[2] - b[0]) / 10) + '%;height:' + ((b[3] - b[1]) / 10) + '%;';

function znPaintOverlay(): void {
  const ov = ZN.el.ov, zp = znWork(), p = znPage();
  if (!ov || !zp || !p) return;
  ov.className = 'zn-ov' + (ZN.adding ? ' add' : '');
  const out: HTMLElement[] = [];
  const blue = '47,94,158';
  if (ZN.mode === 'kid') {
    const hit = ZN.hit;
    if (hit) {
      if (hit.tint) out.push(h('div', { style: znPx(hit.tint) + 'background:rgba(47,127,193,.24);border-radius:3px' }));
      out.push(h('div', { class: 'zn-finger', style: 'left:' + hit.x / 10 + '%;top:' + hit.y / 10 + '%' }));
    }
    ov.replaceChildren(...out);
    return;
  }
  if (ZN.layers.rows) for (const l of p.cand.lines) out.push(h('div', { style: znPx(l.box) + 'background:rgba(138,135,129,.16);border-bottom:1px solid rgba(138,135,129,.55)' }));
  const f = znFind(ZN.sel);
  const chain = new Set((f?.chain ?? []).map((z) => z.id));
  const selZone = f?.zone ?? null;
  const sibs = new Set<string>();
  if (selZone) for (const z of f!.list as Zone[]) sibs.add(z.id);
  const kids = new Set((selZone?.children ?? []).map((z) => z.id));
  if (ZN.layers.zones) znWalk(zp.zones, (z, d) => {
    let border = '', bg = '', tag = false, on = false;
    if (selZone && z.id === selZone.id) { border = '2px solid rgb(' + blue + ')'; bg = 'rgba(' + blue + ',.07)'; tag = true; on = true; }
    else if (chain.has(z.id)) { border = '1.5px dashed rgb(' + blue + ')'; tag = true; }
    else if (ZN.sel) {
      if ((selZone && sibs.has(z.id)) || kids.has(z.id)) border = '1px solid rgba(' + blue + ',.55)';
      else if (d === 0) border = '1px solid rgba(' + blue + ',.22)';
      else if (d === 1) border = '1px dashed rgba(' + blue + ',.2)';
    } else if (d === 0) { border = '1.5px solid rgb(' + blue + ')'; tag = true; }
    else if (d === 1) border = '1px dashed rgba(' + blue + ',.6)';
    if (ZN.hover === z.id) { bg = 'rgba(' + blue + ',.12)'; if (!border) border = '1px solid rgba(' + blue + ',.55)'; }
    if (!border) return;
    out.push(h('div', { style: znPx(z.box) + 'border:' + border + ';border-radius:3px;' + (bg ? 'background:' + bg : '') },
      tag ? h('span', { class: 'zn-tag' + (on ? ' on' : '') + (z.box[1] < 30 ? ' in' : '') }, z.label) : null));
  });
  if (ZN.layers.regions) for (const { r, host } of znAllRegions(zp)) {
    const mine = f?.region?.id === r.id;
    const near = !ZN.sel || mine || (selZone && host?.id === selZone.id) || (f?.region && host === f.host);
    out.push(h('div', { style: znPx(r.box) + 'border-radius:2px;border:' + (mine ? '2px solid var(--accent);background:rgba(180,83,31,.12)' : '1.5px solid ' + (near ? 'var(--accent)' : 'rgba(180,83,31,.3)')) }));
  }
  if (ZN.layers.cand) for (const c of znLoose()) out.push(h('div', { style: znPx(c.box) + 'border:1.5px dashed var(--err);background:rgba(176,58,46,.06);border-radius:2px' }));
  if (ZN.ghost) out.push(h('div', { style: znPx(ZN.ghost) + 'border:1.5px dashed var(--faint);border-radius:3px' }));
  if (ZN.newBox) out.push(h('div', { style: znPx(ZN.newBox) + 'border:2px dashed rgb(' + blue + ');background:rgba(' + blue + ',.06)' }));
  const obj = f?.zone ?? f?.region;
  if (obj) {
    const b = obj.box, mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2;
    for (const [x, y] of [[b[0], b[1]], [mx, b[1]], [b[2], b[1]], [b[2], my], [b[2], b[3]], [mx, b[3]], [b[0], b[3]], [b[0], my]]) out.push(h('div', { class: 'zn-hd', style: 'left:' + x / 10 + '%;top:' + y / 10 + '%' }));
  }
  for (const g of ZN.guide) {
    out.push(h('div', { class: 'zn-guide' + (g.axis === 'y' ? ' y' : ''), style: g.axis === 'x' ? 'left:' + g.at / 10 + '%;top:0;height:100%' : 'top:' + g.at / 10 + '%;left:0;width:100%' }));
    out.push(h('span', { class: 'zn-gl', style: g.axis === 'x' ? 'left:' + Math.min(g.at / 10 + 0.6, 70) + '%;top:6px' : 'top:calc(' + g.at / 10 + '% + 4px);left:6px' }, '吸到 ' + g.label));
  }
  if (ZN.pop) {
    const c = ZN.pop;
    const left = Math.min(c.box[0], 1000 - (220 / ZN.W) * 1000);
    out.push(h('div', { class: 'zn-pop', style: 'left:' + left / 10 + '%;top:calc(' + c.box[3] / 10 + '% + 6px)', on: { pointerdown: (e: Event) => e.stopPropagation() } },
      h('span', {}, h('b', {}, '没人认领的候选'), h('br'), h('span', { class: 'num' }, c.id + ' · ' + (c.kind === 'table' ? (c.table ?? '') + ' 第 ' + c.row + ' 行第 ' + c.col + ' 格' : c.kind))),
      h('div', { class: 'acts' },
        h('button', { type: 'button', class: 'btn small soft', on: { click: () => znClaim(c) } }, '认成作答区'),
        h('button', { type: 'button', class: 'btn small', on: { click: () => znIgnore(c) } }, '不是要写的'))));
  }
  ov.replaceChildren(...out);
}

function znPaintBar(): void {
  const bar = ZN.el.bar;
  if (!bar) return;
  const pages = znDirtyPages();
  if (!ZN.undo.length || !pages.length) { bar.hidden = true; bar.replaceChildren(); return; }
  bar.hidden = false;
  const probs = ZN.check?.problems.length ?? 0;
  const save = h('button', { type: 'button', class: 'btn small primary', on: { click: znSave } }, ZN.saving ? '在存……' : '存这一课');
  if (probs || ZN.saving || !ZN.check) save.setAttribute('disabled', '');
  bar.replaceChildren(
    h('span', { class: 'dot warn' }),
    h('b', {}, znLessonTitle() + '改了 ' + ZN.undo.length + ' 处,没存'),
    h('span', {}, '第 ' + pages.join('、') + ' 页 · ' + (!ZN.check ? '在查……' : probs ? '检查有 ' + probs + ' 条要改,改完才能存' : '检查过了,能存')),
    h('div', { class: 'acts' },
      h('button', { type: 'button', class: 'btn small', on: { click: znUndo } }, '撤销'),
      h('button', { type: 'button', class: 'btn small danger', on: { click: () => { void ask('丢掉这一课没存的改动?', [], '丢掉', '留着').then((ok) => { if (ok) void znOpen(ZN.book, ZN.key, ZN.n); }); } } }, '丢掉改动'),
      save));
}

function znPaintLeft(): void {
  const left = ZN.el.left, list = ZN.list;
  if (!left || !list) return;
  const book = list.books.find((b) => b.file === ZN.book);
  const parts: HTMLElement[] = [];
  const sel = h('select', { id: 'zn-book', 'aria-label': '课本', on: { change: (e: Event) => { void znPick((e.target as HTMLSelectElement).value, ''); } } },
    ...list.books.map((b) => h('option', { value: b.file, selected: b.file === ZN.book }, b.file.replace(/\.pdf$/i, ''))));
  const head = h('div', { class: 'zn-card' }, h('label', { class: 'zn-lab', for: 'zn-book' }, '课本'), sel,
    book ? h('span', { class: 'num', style: 'font-size:11.5px;color:var(--faint)' }, '指纹 ' + book.sha.slice(0, 8) + (book.vaultPages ? ' · vault 里改过 ' + book.vaultPages + ' 页' : '')) : null);
  for (const s of list.stale) head.append(h('div', { class: 'zn-warn' }, '这本课本换过,以前改的分块用不上了(' + (s.title ? '《' + s.title + '》' : '') + s.pages + ' 页)',
    h('button', { type: 'button', class: 'btn small danger', on: { click: () => { void ask('删掉旧的分块?', ['vault 的 教材/.zones/' + s.sha + '/ 里 ' + s.pages + ' 页:是换掉的那个课本 PDF 的,现在哪本课本都用不上。这里删了找不回;vault 有备份的从备份里拿。'], '删掉', '不删').then(async (ok) => { if (!ok) return; await api('DELETE', '/api/dev/zones/stale?sha=' + s.sha); await znLoadList(); znPaintLeft(); }); } } }, '删掉旧的')));
  for (const f of list.unreadable) head.append(h('div', { class: 'zn-warn' }, '《' + f + '》读不出来'));
  for (const pr of book?.problems ?? []) head.append(h('div', { class: 'zn-warn' }, pr));
  parts.push(head);
  if (book) {
    const tree = h('div', { class: 'zn-card zn-tree-l' });
    const cur = book.lessons.find((l) => l.key === ZN.key);
    const hidden: number[] = [];
    book.lessons.forEach((l) => {
      while (hidden.length && l.depth <= hidden[hidden.length - 1]) hidden.pop();
      if (hidden.length) return;
      if (!l.leaf) {
        const open = ZN.open.get(l.key) ?? Boolean(cur && cur.pages[0] >= l.pages[0] && cur.pages[1] <= l.pages[1]);
        tree.append(h('button', { type: 'button', class: 'zn-uh' + (open ? ' in' : ''), style: 'padding-left:' + (8 + l.depth * 10) + 'px', 'aria-expanded': String(open), on: { click: () => { ZN.open.set(l.key, !open); znPaintLeft(); } } }, (open ? '⌄ ' : '› ') + l.title));
        if (!open) hidden.push(l.depth);
        return;
      }
      const tag = l.which === 'rules' ? h('span', { class: 'st' }, '规则') : h('span', { class: 'st info' }, (l.by ? ZN_WHO[l.by] : 'vault') + (l.at ? ' ' + l.at.slice(5, 10) : ''));
      tree.append(h('button', { type: 'button', class: 'zn-ls' + (l.key === ZN.key ? ' on' : ''), style: 'margin-left:' + l.depth * 10 + 'px;width:calc(100% - ' + l.depth * 10 + 'px)', on: { click: () => { void znPick(ZN.book, l.key); } } },
        h('b', {}, l.title), h('span', {}, h('span', { class: 'num' }, 'p' + l.pages[0] + '–' + l.pages[1]), tag)));
    });
    parts.push(tree);
  }
  if (ZN.data) {
    const dirty = new Set(znDirtyPages());
    const grid = h('div', { class: 'zn-thumbs' });
    for (const p of ZN.data.pages) {
      const tk = ZN.book + '|' + p.n;
      let cv = ZN.thumbs.get(tk);
      if (!cv) { cv = h('canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement; ZN.thumbs.set(tk, cv); void znDraw(cv, p.n, 36); }
      grid.append(h('button', { type: 'button', class: 'zn-th' + (p.n === ZN.n ? ' on' : ''), title: 'PDF 第 ' + p.n + ' 页' + (p.printed ? '(印的 ' + p.printed + ')' : ''), on: { click: () => znGo(p.n) } }, cv, h('small', {}, String(p.n)), dirty.has(p.n) ? h('span', { class: 'dot' }) : null));
    }
    parts.push(h('div', { class: 'zn-card' }, h('span', { class: 'zn-lab' }, '这一课的页'), grid));
    const restore = h('button', { type: 'button', class: 'btn small danger', style: 'align-self:flex-start', on: { click: znRestore } }, '这一课还原成规则出的…');
    if (ZN.data.which === 'rules') { restore.setAttribute('disabled', ''); restore.title = '这一课用的就是规则出的'; }
    parts.push(restore);
  }
  left.replaceChildren(...parts);
}

function znPaintTool(): void {
  const tool = ZN.el.tool, p = znPage();
  if (!tool || !ZN.data || !p) return;
  const seg = h('div', { class: 'seg', role: 'tablist' },
    h('button', { type: 'button', role: 'tab', class: ZN.mode === 'pick' ? 'on' : '', 'aria-selected': String(ZN.mode === 'pick'), on: { click: () => { ZN.mode = 'pick'; ZN.hit = null; znPaint(); } } }, '选块'),
    h('button', { type: 'button', role: 'tab', class: ZN.mode === 'kid' ? 'on' : '', 'aria-selected': String(ZN.mode === 'kid'), on: { click: () => { ZN.mode = 'kid'; ZN.adding = false; ZN.pop = null; znPaint(); } } }, '当孩子点'));
  const lay = ([['zones', '块', 'z'], ['regions', '作答区', 'r'], ['cand', '候选', 'c'], ['rows', '字行', 'w']] as const).map(([k, t, c]) => {
    const on = ZN.layers[k];
    const b = h('button', { type: 'button', class: 'zn-tg ' + c + (on ? ' on' : ''), 'aria-pressed': String(on), on: { click: () => { ZN.layers[k] = !on; znPaint(); } } }, h('i'), t);
    if (ZN.mode === 'kid') b.setAttribute('disabled', '');
    return b;
  });
  const k = ZN.data.pages.findIndex((x) => x.n === ZN.n);
  const prev = h('button', { type: 'button', class: 'btn small', 'aria-label': '上一页', on: { click: () => znGo(ZN.data!.pages[k - 1].n) } }, '‹');
  const next = h('button', { type: 'button', class: 'btn small', 'aria-label': '下一页', on: { click: () => znGo(ZN.data!.pages[k + 1].n) } }, '›');
  if (k <= 0) prev.setAttribute('disabled', '');
  if (k >= ZN.data.pages.length - 1) next.setAttribute('disabled', '');
  const src = ZN.data.which === 'rules' ? h('span', { class: 'st' }, '规则出的') : h('span', { class: 'st info' }, (p.by ? ZN_WHO[p.by] : '改好的') + (p.at ? ' ' + znWhen(p.at) : ''));
  tool.replaceChildren(...[seg,
    ZN.mode === 'pick' ? h('button', { type: 'button', class: 'btn small' + (ZN.adding ? ' soft' : ''), 'aria-pressed': String(ZN.adding), title: '在页上画一个框,落进框住它的最里面那块', on: { click: () => { ZN.adding = !ZN.adding; ZN.pop = null; znPaintTool(); znPaintOverlay(); } } }, ZN.adding ? '在页上画框…' : '+ 加一块') : null,
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:2px' }, ...lay),
    h('div', { class: 'right' }, prev, h('span', { style: 'font-size:13px;padding:0 4px' }, '第 ' + p.n + ' 页' + (p.printed ? ' · 印 ' + p.printed : '')), next, src)].filter((x): x is HTMLElement => x !== null));
}

/** 改一个字段:第一下记一份撤销,之后同一个框里接着改不再记 */
function znField(label: string, value: string, set: (v: string) => void, opts: { id: string; hint?: string; extra?: HTMLElement } ): HTMLElement {
  let pushed = false;
  const inp = h('input', { id: opts.id, value, on: { focus: () => { pushed = false; }, input: (e: Event) => { if (!pushed) { znPush(); pushed = true; } set((e.target as HTMLInputElement).value); znPaintOverlay(); znPaintBar(); znPaintTree(); clearTimeout(ZN.checkTimer); ZN.checkTimer = setTimeout(znRunCheck, 500); } } });
  return h('div', { class: 'zn-f' }, h('label', { for: opts.id }, label, opts.hint ? h('small', {}, ' · ' + opts.hint) : null), opts.extra ? h('div', { class: 'zn-inl' }, inp, opts.extra) : inp);
}

function znSelectField<K extends string>(label: string, id: string, names: Record<K, string>, value: K, set: (v: K) => void): HTMLElement {
  const sel = h('select', { id, on: { change: (e: Event) => { znPush(); set((e.target as HTMLSelectElement).value as K); znChanged(); } } },
    ...(Object.keys(names) as K[]).map((k) => h('option', { value: k, selected: k === value }, names[k])));
  return h('div', { class: 'zn-f' }, h('label', { for: id }, label), sel);
}

function znZoneForm(z: Zone, f: NonNullable<ReturnType<typeof znFind>>): HTMLElement[] {
  const out: HTMLElement[] = [];
  const sayBtn = h('button', { type: 'button', class: 'btn small', style: 'height:34px', on: { click: (e: Event) => { if (z.say) void znSay(z.say, e.currentTarget as HTMLElement); } } }, '▶ 念一遍');
  out.push(h('div', { class: 'zn-sec' },
    h('div', { class: 'zn-row2' },
      znSelectField('种类', 'zn-kind', ZN_KIND, z.kind, (v) => { z.kind = v; }),
      znField('叫法', z.label, (v) => { z.label = v; }, { id: 'zn-label', hint: z.kind === 'sub' ? '同一组里不重名' : '一课里不重名' })),
    znField('念法', z.say ?? '', (v) => { if (v.trim()) z.say = v; else delete z.say; }, { id: 'zn-say', hint: '照印的念,空着的念「几」', extra: sayBtn }),
    h('div', { class: 'zn-ids' }, h('span', {}, 'id ', h('span', { class: 'num' }, z.id)), h('span', {}, '框 ', h('span', { class: 'num' }, z.box.map((v) => Math.round(v)).join(' '))))));
  if (z.regions?.length) {
    const loose = new Set(znPage()?.cand.cells.map((c) => c.id));
    out.push(h('div', { class: 'zn-sec' }, h('span', { class: 'zn-lab' }, '作答区 ' + z.regions.length + ' 个'),
      ...z.regions.map((r) => h('button', { type: 'button', class: 'zn-reg', on: { click: () => { ZN.sel = { kind: 'region', id: r.id }; znPaint(); } } }, h('i'), r.label, h('span', { class: 'st' }, ZN_RKIND[r.kind]), h('span', { class: 'num' + (loose.has(r.id) ? ' ok' : '') }, loose.has(r.id) ? '候选 ' + r.id : r.src === 'measured' ? '量的' : r.id)))));
  }
  // 给老师的:练什么、卡住怎么引、每一格的答案、备注;都空了就去掉 teacher
  const t = (): NonNullable<Zone['teacher']> => (z.teacher ??= {});
  const tidy = (): void => { const tt = z.teacher; if (tt && !tt.goal && !tt.hint && !tt.note && !(tt.answers?.length)) delete z.teacher; else if (tt && tt.answers && !tt.answers.length) delete tt.answers; };
  const answers: HTMLElement[] = [];
  const name = (id: string): string => z.regions?.find((r) => r.id === id)?.label ?? id;
  (z.teacher?.answers ?? []).forEach((a, k) => {
    if (!a.ok) { answers.push(h('div', { class: 'zn-note' }, '答案 · ' + a.at.map(name).join('、') + ':' + (a.note ?? (a.links ? '连线 ' + a.links.length + ' 条' : '')))); return; }
    answers.push(znField('答案 · ' + a.at.map(name).join('、'), a.ok.join(' / '), (v) => {
      const ok = v.split('/').map((s) => s.trim()).filter(Boolean);
      const list = t().answers ?? [];
      if (ok.length) list[k] = { ...list[k], ok }; else if (list[k]?.note || list[k]?.links) { const { ok: _o, ...rest } = list[k]; list[k] = rest; } else list.splice(k, 1);
      t().answers = list;
      tidy();
    }, { id: 'zn-ans-' + k, hint: '几种都算对的用 / 隔开' }));
  });
  for (const r of z.regions ?? []) {
    if (r.kind !== 'write' || (z.teacher?.answers ?? []).some((a) => a.at.includes(r.id))) continue;
    let made = -1;
    answers.push(znField('答案 · ' + r.label, '', (v) => {
      const ok = v.split('/').map((s) => s.trim()).filter(Boolean);
      const list = (t().answers ??= []);
      if (made < 0 && ok.length) { list.push({ at: [r.id], ok }); made = list.length - 1; }
      else if (made >= 0) { if (ok.length) list[made] = { at: [r.id], ok }; else { list.splice(made, 1); made = -1; } }
      tidy();
    }, { id: 'zn-new-' + r.id, hint: '几种都算对的用 / 隔开' }));
  }
  out.push(h('div', { class: 'zn-sec' }, h('span', { class: 'zn-lab' }, '给老师的 · 不给孩子'),
    znField('练什么', z.teacher?.goal ?? '', (v) => { if (v.trim()) t().goal = v; else if (z.teacher) delete z.teacher.goal; tidy(); }, { id: 'zn-goal' }),
    znField('卡住怎么引', z.teacher?.hint ?? '', (v) => { if (v.trim()) t().hint = v; else if (z.teacher) delete z.teacher.hint; tidy(); }, { id: 'zn-hint' }),
    ...answers,
    znField('备注', z.teacher?.note ?? '', (v) => { if (v.trim()) t().note = v; else if (z.teacher) delete z.teacher.note; tidy(); }, { id: 'zn-note', hint: '没把握的答案写这里' })));
  out.push(h('div', { class: 'zn-sec', style: 'flex-direction:row;justify-content:space-between' },
    h('button', { type: 'button', class: 'btn small', disabled: !f.host, on: { click: () => { if (f.host) { ZN.sel = { kind: 'zone', id: f.host.id }; znPaint(); } } } }, '往外一层'),
    h('button', { type: 'button', class: 'btn small danger', on: { click: znDelete } }, '删掉这一块')));
  return out;
}

function znRegionForm(r: ZoneRegion, f: NonNullable<ReturnType<typeof znFind>>): HTMLElement[] {
  const cand = znPage()?.cand.cells.find((c) => c.id === r.id);
  return [
    h('div', { class: 'zn-sec' },
      h('div', { class: 'zn-row2' },
        znSelectField('种类', 'zn-rkind', ZN_RKIND, r.kind, (v) => { r.kind = v; }),
        znField('名字', r.label, (v) => { r.label = v; }, { id: 'zn-rlabel', hint: '老师照它说孩子在哪写了' })),
      h('div', { class: 'zn-ids' }, h('span', {}, 'id ', h('span', { class: 'num' }, r.id)), h('span', {}, '框 ', h('span', { class: 'num' }, r.box.map((v) => Math.round(v)).join(' '))),
        h('span', {}, cand ? (znIou(cand.box, r.box) >= 0.5 ? '吸在候选上' : '和候选 ' + r.id + ' 对不上(存的时候吸过去)') : r.src === 'measured' ? '量的(不是候选)' : '不是候选'))),
    h('div', { class: 'zn-sec', style: 'flex-direction:row;justify-content:space-between' },
      h('button', { type: 'button', class: 'btn small', disabled: !f.host, on: { click: () => { if (f.host) { ZN.sel = { kind: 'zone', id: f.host.id }; znPaint(); } } } }, '往外一层'),
      h('button', { type: 'button', class: 'btn small danger', on: { click: znDelete } }, '删掉这一格')),
  ];
}

function znTree(): HTMLElement {
  const zp = znWork()!;
  const box = h('div', { style: 'display:flex;flex-direction:column' });
  const clear = (): void => { for (const el of box.querySelectorAll('.into,.before,.after')) el.classList.remove('into', 'before', 'after'); };
  znWalk(zp.zones, (z, d) => {
    const regs = z.regions?.length ?? 0;
    const meta = [z.say ? '念' : '', regs ? regs + ' 格' : '', z.teacher ? '给老师' : ''].filter(Boolean).join(' · ');
    const on = ZN.sel?.kind === 'zone' && ZN.sel.id === z.id;
    const row = h('div', { class: 'zn-tr' + (on ? ' on' : ''), draggable: 'true', style: 'padding-left:' + (8 + d * 16) + 'px', title: '拖到一行上 = 放进去,拖到两行之间 = 排在那里',
      on: {
        click: () => { ZN.sel = { kind: 'zone', id: z.id }; ZN.pop = null; znPaint(); },
        mouseenter: () => { ZN.hover = z.id; znPaintOverlay(); },
        mouseleave: () => { if (ZN.hover === z.id) { ZN.hover = ''; znPaintOverlay(); } },
        dragstart: (e: DragEvent) => { ZN.dnd = z.id; e.dataTransfer?.setData('text/plain', z.id); },
        dragend: () => { ZN.dnd = ''; clear(); },
        dragover: (e: DragEvent) => {
          if (!ZN.dnd || ZN.dnd === z.id) return;
          e.preventDefault();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), k = (e.clientY - r.top) / r.height;
          clear();
          (e.currentTarget as HTMLElement).classList.add(k < 0.25 ? 'before' : k > 0.75 ? 'after' : 'into');
        },
        dragleave: (e: DragEvent) => { (e.currentTarget as HTMLElement).classList.remove('into', 'before', 'after'); },
        drop: (e: DragEvent) => {
          e.preventDefault();
          const el = e.currentTarget as HTMLElement;
          const where = el.classList.contains('before') ? 'before' : el.classList.contains('after') ? 'after' : 'into';
          clear();
          if (ZN.dnd) znMove(ZN.dnd, z.id, where);
        },
      } }, h('span', { class: 'zn-k' }, ZN_KIND[z.kind]), h('span', { class: 'l' }, z.label), meta ? h('span', { class: 'm' }, meta) : null);
    box.append(row);
  });
  const loose = zp.regions?.length ?? 0;
  if (loose) box.append(h('div', { class: 'zn-tr', style: 'cursor:default;color:var(--muted)' }, '不在哪一块里的格 ' + loose + ' 个'));
  if (!zp.zones.length) box.append(h('p', { class: 'note', style: 'padding:4px 8px' }, '这一页没有块。'));
  return box;
}

function znPaintTree(): void {
  const el = ZN.el.tree;
  if (!el || !znWork()) return;
  el.replaceChildren(h('h3', { style: 'padding:0 8px' }, '这一页的块', h('small', {}, '拖一行换层级')), znTree());
}

function znPaintCheck(): void {
  const el = ZN.el.check, d = ZN.data;
  if (!el || !d) return;
  const c = ZN.check, p = znPage();
  el.replaceChildren(
    h('span', { style: 'display:flex;align-items:center;gap:8px;font-size:13px' }, h('span', { class: 'st ' + (!c ? '' : c.problems.length ? 'err' : 'ok') }, '检查'), !c ? '在查……' : c.problems.length ? c.problems.length + ' 条要改' : '这一课没有要改的'),
    ...(c?.problems ?? []).slice(0, 30).map((t) => h('div', { class: 'zn-prob' }, t)),
    ...(c?.notes ?? []).slice(0, 10).map((t) => h('div', { class: 'zn-note' }, '提醒:' + t)),
    h('span', { class: 'zn-lab' }, p?.by ? '这一页 ' + ZN_WHO[p.by] + ' ' + znWhen(p.at) + ' 存的' : d.which === 'rules' ? '这一课用的是规则出的(没改过)' : ''));
}

function znPaintSide(): void {
  const side = ZN.el.side;
  if (!side || !ZN.data || !znWork()) return;
  const secs: HTMLElement[] = [];
  if (ZN.mode === 'kid') {
    ZN.el.form = ZN.el.tree = ZN.el.check = undefined;
    const hit = ZN.hit;
    secs.push(h('div', { class: 'zn-sec' }, h('h3', {}, '这一下落在哪'), h('span', { class: 'zn-lab' }, '照孩子端的先后:先能写的格,再语文的字,再有念法的块;在页上点一下')));
    if (hit) {
      secs.push(h('div', { class: 'zn-sec', style: 'gap:6px' }, ...hit.tiers.map((t, k) => h('div', { class: 'zn-hit' + (t.win ? ' win' : '') }, h('span', { class: 'num' }, String(k + 1)), h('div', {}, h('b', {}, t.title), h('span', {}, t.detail), t.win ? h('small', {}, '落在这里') : null))),
        hit.tiers.every((t) => !t.win) ? h('div', { class: 'zn-note' }, '都不是:孩子点这里没有回应。') : null));
      if (hit.says.length) secs.push(h('div', { class: 'zn-sec' }, h('span', { class: 'zn-lab' }, '听一听 · 用点读的声音,合成过的不再花钱'),
        h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, ...hit.says.map((s) => h('button', { type: 'button', class: 'btn small', title: s.say, on: { click: (e: Event) => { void znSay(s.say, e.currentTarget as HTMLElement); } } }, '▶ ' + s.label)))));
    }
    side.replaceChildren(...secs);
    return;
  }
  const form = h('div', {});
  const f = znFind(ZN.sel);
  if (f) {
    const crumbs: unknown[] = [];
    for (const z of f.chain) crumbs.push(h('button', { type: 'button', on: { click: () => { ZN.sel = { kind: 'zone', id: z.id }; znPaint(); } } }, z.label), h('i', {}, '›'));
    crumbs.push(h('b', {}, (f.zone ?? f.region)!.label));
    form.append(h('div', { class: 'zn-sec' }, h('div', { class: 'zn-crumb' }, ...crumbs)), ...(f.zone ? znZoneForm(f.zone, f) : znRegionForm(f.region!, f)));
  }
  const tree = h('div', { class: 'zn-sec', style: 'padding-left:8px;padding-right:8px' });
  const check = h('div', { class: 'zn-sec' });
  ZN.el.form = form; ZN.el.tree = tree; ZN.el.check = check;
  znPaintTree();
  znPaintCheck();
  side.replaceChildren(form, tree, check, h('div', { class: 'zn-sec', style: 'gap:6px' }, h('span', { class: 'zn-lab' }, '页上的颜色'),
    h('span', { class: 'zn-legend' }, h('i', { style: 'border:1.5px solid var(--info)' }), '块(最外一层实线,里面一层虚线)'),
    h('span', { class: 'zn-legend' }, h('i', { style: 'border:1.5px solid var(--accent);border-radius:2px' }), '作答区:写、圈、连、打勾'),
    h('span', { class: 'zn-legend' }, h('i', { style: 'border:1.5px dashed var(--err);border-radius:2px' }), '没人认领的候选(漏了的格)'),
    h('span', { class: 'zn-legend' }, h('i', { style: 'background:rgba(138,135,129,.16);border-bottom:1px solid rgba(138,135,129,.55);border-radius:0' }), '文字层的行'),
    h('span', { class: 'zn-lab', style: 'line-height:1.6' }, '单击落到最里面,同一处再点往外一层;Esc 回外一层,Delete 删,⌘Z 撤销')));
}

/** 页图:宽照中间那栏,换页、换宽才重画 */
function znPaintPage(): void {
  const page = ZN.el.page, p = znPage();
  if (!page || !p || !ZN.el.mid) return;
  const W = Math.max(320, Math.min(780, ZN.el.mid.clientWidth - 28));
  const key = ZN.book + '|' + p.n + '|' + W;
  page.style.width = W + 'px';
  page.style.height = Math.round((W * p.h) / p.w) + 'px';
  ZN.W = W;
  if (page.dataset.key === key) return;
  page.dataset.key = key;
  const cv = h('canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const msg = h('p', { class: 'zn-msg' }, '在画页……');
  page.replaceChildren(cv, msg, ZN.el.ov!);
  void znDraw(cv, p.n, W).then((ok) => { if (ok) msg.remove(); else msg.textContent = '页图画不出来:舞台包没打包(pnpm run build:stage)或课本读不出。块照样能看能改。'; });
}

function znPaint(): void {
  if (!ZN.data) return;
  znPaintBar();
  znPaintLeft();
  znPaintTool();
  znPaintPage();
  znPaintOverlay();
  znPaintSide();
  const q = '#zones?b=' + encodeURIComponent(ZN.book) + '&l=' + encodeURIComponent(ZN.key) + '&p=' + ZN.n;
  if (state.tab === 'zones' && location.hash !== q) history.replaceState(null, '', q);
}

function znGo(n: number): void {
  if (!ZN.data?.pages.some((p) => p.n === n)) return;
  ZN.n = n; ZN.sel = null; ZN.pop = null; ZN.hit = null; ZN.guide = []; ZN.last = null;
  znPaint();
}

// ——— 指针 ———

function znPoint(e: PointerEvent): [number, number] {
  const r = ZN.el.ov!.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * 1000, ((e.clientY - r.top) / r.height) * 1000];
}

function znBindOverlay(ov: HTMLElement): void {
  ov.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [x, y] = znPoint(e);
    if (ZN.mode === 'kid') { znKidHit(x, y); return; }
    ov.setPointerCapture(e.pointerId);
    if (ZN.adding) { ZN.drag = { mode: 'add', x0: x, y0: y, box0: [x, y, x, y], edges: '', moved: false, snap: null }; return; }
    const f = znFind(ZN.sel), obj = f?.zone ?? f?.region;
    if (obj) {
      const b = obj.box, tx = (7 / ZN.W) * 1000, ty = (7 / znH()) * 1000;
      const near = (a: number, v: number, t: number): boolean => Math.abs(a - v) <= t;
      const inX = x >= b[0] - tx && x <= b[2] + tx, inY = y >= b[1] - ty && y <= b[3] + ty;
      let edges = '';
      if (inX && near(y, b[1], ty)) edges += 'n';
      if (inX && near(y, b[3], ty)) edges += 's';
      if (inY && near(x, b[0], tx)) edges += 'w';
      if (inY && near(x, b[2], tx)) edges += 'e';
      // 只算拉手:四角、四边的中点
      const mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2;
      const onHandle = (edges.length === 2) || (edges === 'n' || edges === 's' ? near(x, mx, tx) : edges === 'w' || edges === 'e' ? near(y, my, ty) : false);
      if (edges && onHandle) { ZN.drag = { mode: 'size', x0: x, y0: y, box0: [...b] as Box, edges, moved: false, snap: null }; return; }
      if (znIn(x, y, b)) { ZN.drag = { mode: 'move', x0: x, y0: y, box0: [...b] as Box, edges: '', moved: false, snap: null }; return; }
    }
    ZN.drag = { mode: 'click', x0: x, y0: y, box0: [x, y, x, y], edges: '', moved: false, snap: null };
  });
  ov.addEventListener('pointermove', (e) => {
    const d = ZN.drag;
    if (!d) return;
    const [x, y] = znPoint(e);
    if (!d.moved && Math.abs(x - d.x0) * ZN.W / 1000 < 3 && Math.abs(y - d.y0) * znH() / 1000 < 3) return;
    if (!d.moved) {
      d.moved = true;
      if (d.mode === 'move' || d.mode === 'size') { znPush(); ZN.ghost = d.box0; }
    }
    if (d.mode === 'add') ZN.newBox = [znR1(Math.min(d.x0, x)), znR1(Math.min(d.y0, y)), znR1(Math.max(d.x0, x)), znR1(Math.max(d.y0, y))];
    else if (d.mode === 'move' || d.mode === 'size') znApplyDrag(x, y);
    znPaintOverlay();
  });
  const end = (e: PointerEvent): void => {
    const d = ZN.drag;
    ZN.drag = null;
    if (!d) return;
    const [x, y] = znPoint(e);
    ZN.guide = []; ZN.ghost = null;
    if (d.mode === 'add') {
      const b = ZN.newBox;
      ZN.newBox = null; ZN.adding = false;
      if (b && (b[2] - b[0]) * ZN.W / 1000 > 6 && (b[3] - b[1]) * znH() / 1000 > 6) znAdd(b); else znPaint();
      return;
    }
    if (!d.moved) { znClick(x, y); return; }
    znChanged();
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', (e) => { if (ZN.drag?.moved && (ZN.drag.mode === 'move' || ZN.drag.mode === 'size')) { const f = znFind(ZN.sel); if (f) ((f.zone ?? f.region) as { box: Box }).box = ZN.drag.box0; ZN.undo.pop(); } ZN.drag = null; ZN.newBox = null; ZN.guide = []; ZN.ghost = null; void e; znPaintOverlay(); });
}

/** 加一块:落进完全框住它的最里面那块;种类先是「别的字」,叫法要家长改 */
function znAdd(b: Box): void {
  const zp = znWork();
  if (!zp) return;
  znPush();
  const host = znHostAt(0, 0, b);
  const names = new Set<string>();
  for (const zz of ZN.work.values()) znWalk(zz.zones, (z) => names.add(z.label));
  let k = 1;
  while (names.has('新的一块 ' + k)) k++;
  const z: Zone = { id: znNewId('块'), kind: 'other', label: '新的一块 ' + k, box: b };
  if (host) (host.children ??= []).push(z); else zp.zones.push(z);
  ZN.sel = { kind: 'zone', id: z.id };
  znChanged();
  setTimeout(() => { const el = $('#zn-label') as HTMLInputElement | null; el?.focus(); el?.select(); }, 0);
}

// ——— 读、存、还原 ———

async function znLoadList(): Promise<void> {
  ZN.list = await api('GET', '/api/dev/zones');
}

async function znOpen(book: string, key: string, n?: number): Promise<void> {
  const d: ZnLesson = await api('GET', '/api/dev/zones/lesson?b=' + encodeURIComponent(book) + '&l=' + encodeURIComponent(key));
  const keepSel = ZN.book === book && ZN.key === key ? ZN.sel : null;
  ZN.book = book; ZN.key = key; ZN.data = d;
  ZN.work = new Map(d.pages.map((p) => [p.n, JSON.parse(JSON.stringify(p.zones)) as ZonePage]));
  ZN.orig = new Map(d.pages.map((p) => [p.n, JSON.stringify(p.zones)]));
  ZN.undo = []; ZN.check = null; ZN.hit = null; ZN.pop = null; ZN.adding = false; ZN.guide = []; ZN.ghost = null;
  ZN.n = n && d.pages.some((p) => p.n === n) ? n : d.pages[0].n;
  ZN.sel = keepSel && znFind(keepSel) ? keepSel : null;
  znPaint();
  void znRunCheck();
}

/** 换一课、换一本:没存的问一次 */
async function znPick(book: string, key: string): Promise<void> {
  if (znDirty() && !(await ask(znLessonTitle() + '还有 ' + ZN.undo.length + ' 处没存', ['换过去就丢掉这些改动。'], '丢掉,换过去', '留下'))) { znPaintLeft(); return; }
  const b = ZN.list?.books.find((x) => x.file === book);
  if (!b) return;
  const want = key || (b.lessons.find((l) => l.leaf && l.which !== 'rules') ?? b.lessons.find((l) => l.leaf))?.key || '';
  if (!want) { ZN.book = book; ZN.data = null; znShell(); return; }
  try { await znOpen(book, want); } catch (e) { alert('读不出这一课:' + (e as Error).message); }
}

async function znSave(): Promise<void> {
  const d = ZN.data;
  if (!d || ZN.saving || ZN.check?.problems.length) return;
  if (d.which !== 'vault') {
    const dirty = new Set(znDirtyPages());
    const lines = ['这一课现在用的是规则出的分块。存的时候这一课 ' + d.pages.length + ' 页一起写进 vault,以后这一课用改过的:',
      ...d.pages.map((p) => '第 ' + p.n + ' 页:' + (dirty.has(p.n) ? '你改的' : '照规则出的抄一份')),
      '写到 教材/.zones/' + d.sha + '/,记「工作台」'];
    if (!(await ask('存' + znLessonTitle(), lines, '存这一课', '先不存'))) return;
  }
  ZN.saving = true;
  znPaintBar();
  try {
    const r = await api('PUT', '/api/dev/zones/lesson', { b: ZN.book, l: ZN.key, version: d.version, pages: [...ZN.work.values()] });
    if (!r.ok) { ZN.check = { problems: r.problems, notes: r.notes }; return; }
    await znLoadList();
    await znOpen(ZN.book, ZN.key, ZN.n);
  } catch (e) {
    if ((e as { status?: number }).status === 409) {
      if (await ask('这一课的分块在别处改过了', ['多半是编程助手刚 push 过。重新读进来就丢掉这边没存的改动;不读进来存不了。'], '重新读进来', '先留着')) { await znLoadList(); await znOpen(ZN.book, ZN.key, ZN.n); }
    } else alert('存不了:' + (e as Error).message);
  } finally {
    ZN.saving = false;
    znPaintBar();
    znPaintSide();
  }
}

async function znRestore(): Promise<void> {
  const d = ZN.data;
  if (!d || d.which === 'rules') return;
  const who = d.pages.filter((p) => p.by).map((p) => ZN_WHO[p.by!] + ' ' + (p.at ?? '').slice(5, 10));
  const ok = await ask(znLessonTitle() + '还原成规则出的?', ['会删掉 vault 里这一课的 ' + d.pages.length + ' 页(' + [...new Set(who)].join('、') + ' 改的)。这一课的叫法、念法、给老师的话和答案都没有了,老师照规则出的块教。', '这里删了找不回;vault 有备份的,从备份里拿得回来', '孩子以前在格里写的字照旧在'], '删掉,还原', '不还原');
  if (!ok) return;
  await api('DELETE', '/api/dev/zones/lesson?b=' + encodeURIComponent(ZN.book) + '&l=' + encodeURIComponent(ZN.key));
  await znLoadList();
  await znOpen(ZN.book, ZN.key, ZN.n);
}

// ——— 一页的架子 ———

function znShell(): void {
  const main = $('#zones');
  if (!main) return;
  const head = h('header', { class: 'ph' }, h('h1', {}, '分块'), h('span', { class: 'sub' }, '课本页上的块、能写的格、点了念什么、给老师的话'));
  if (!ZN.list?.books.length) {
    main.replaceChildren(h('div', { class: 'wrap zn-wrap' }, head, h('p', { class: 'note' }, ZN.list ? 'vault 的 教材/ 里还没有课本 PDF。' : '在读……')));
    return;
  }
  const cp = h('button', { type: 'button', class: 'btn soft', title: '贴进编程助手(Codex 这类),它照 cotutor-textbook 技能改这一课', on: { click: (e: Event) => { const l = ZN.list?.books.find((b) => b.file === ZN.book)?.lessons.find((x) => x.key === ZN.key); copy('把课本《' + ZN.book.replace(/\.pdf$/i, '') + '》里' + (l ? '《' + l.title + '》' : '') + '的分块改好(用 cotutor-textbook 技能)', e.currentTarget as HTMLElement); } } }, '复制给编程助手的一句');
  head.append(h('div', { class: 'right' }, cp));
  const bar = h('div', { class: 'zn-bar', hidden: true });
  const left = h('section', { class: 'zn-left' });
  const tool = h('div', { class: 'zn-tool' });
  const ov = h('div', { class: 'zn-ov' });
  znBindOverlay(ov);
  const page = h('div', { class: 'zn-page' }, ov);
  const mid = h('section', { class: 'zn-mid' }, tool, h('div', { class: 'zn-stage' }, page));
  const side = h('section', { class: 'zn-side' });
  ZN.el = { left, tool, page, ov, side, bar, mid };
  main.replaceChildren(h('div', { class: 'wrap zn-wrap' }, head, bar, h('div', { class: 'zn' }, left, mid, side)));
  if (!ZN.data) { znPaintLeft(); side.replaceChildren(h('div', { class: 'zn-sec' }, h('p', { class: 'note' }, '左边挑一课。'))); }
}

/** dev-page 的 showTab 切到「分块」时调(export 只为过 noUnusedLocals,内联时剥掉) */
export async function renderZones(): Promise<void> {
  if (!ZN.list) {
    znShell();
    try { await znLoadList(); } catch (e) { $('#zones')?.replaceChildren(h('div', { class: 'wrap' }, h('p', { class: 'fb bad' }, '列不出来:' + (e as Error).message))); return; }
  }
  if (state.tab !== 'zones') return;
  if (ZN.data && ZN.el.ov?.isConnected) { znPaint(); return; }
  znShell();
  if (ZN.data) { znPaint(); return; }
  // #zones?b=<册>&l=<课>&p=<页>;没有就开第一本里改过的第一课
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const books = ZN.list!.books;
  const book = books.find((b) => b.file === q.get('b')) ?? books[0];
  if (!book) return;
  const l = book.lessons.find((x) => x.key === q.get('l') && x.leaf) ?? book.lessons.find((x) => x.leaf && x.which !== 'rules') ?? book.lessons.find((x) => x.leaf);
  ZN.book = book.file;
  if (!l) { znPaintLeft(); return; }
  try { await znOpen(book.file, l.key, Number(q.get('p')) || undefined); } catch (e) { alert('读不出这一课:' + (e as Error).message); }
}

document.addEventListener('keydown', (e) => {
  if (state.tab !== 'zones' || !ZN.data) return;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); znUndo(); return; }
  if (e.key === 'Escape') {
    if (ZN.pop || ZN.adding) { ZN.pop = null; ZN.adding = false; znPaint(); return; }
    const f = znFind(ZN.sel);
    ZN.sel = f?.host ? { kind: 'zone', id: f.host.id } : null;
    znPaint();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ZN.sel && ZN.mode === 'pick') { e.preventDefault(); znDelete(); }
});
window.addEventListener('resize', () => { if (state.tab === 'zones' && ZN.data) { znPaintPage(); znPaintOverlay(); } });
window.addEventListener('beforeunload', (e) => { if (znDirty()) { e.preventDefault(); e.returnValue = ''; } });
