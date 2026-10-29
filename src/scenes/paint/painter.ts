/**
 * 画图卡的画:一轮跑完,板书里的 paint 卡在后台画,和配音同一个时机。
 * 落在这张卡的资产目录 <日期>.<job>.cards/<n>/:paint.png 是图,paint.json 是记录(在画 / 画好了 / 没画成,拼好的提示词、模型、几秒、原因)。
 * 一天画几张不限;今天画了几张由工作台概览数(paintedToday)。
 * 一张一张排着画。孩子端没有错误:没画成就停在分幅那几句,原因只给家长看。
 */
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { BoardSection } from '../../lib/kid-board.ts';
import { cardId, conversationFiles } from '../../lib/conversation.ts';
import { PaintPropsSchema, type PaintProps } from '../../cards/index.ts';
import { PAINT_DEFAULT, PAINT_NEGATIVE, type CotutorConfig } from '../../schema/index.ts';
import { paintPrompt, paintPromptFrom, paintSize } from './prompt.ts';

/** 画图卡要的 workspace 那几样:对话目录(卡的资产落在这)、根(给孩子端的相对路径)、画图的配置;传整个 workspace 也行 */
export interface PaintSpace {
  root: string;
  dirs: { conversations: string };
  config: Pick<CotutorConfig, 'paint'>;
}

export type Drawn = ({ ok: true; data: Buffer; model: string } | { ok: false; error: string }) & { ms: number };
/** 画一张(src/media/draw.ts 的 makeDraw 就是这个样子;场景不认 media,由 runner 交进来;测试与 mock 给假的) */
export type Draw = (job: { prompt: string; model: string; size: string; negative?: string }) => Promise<Drawn>;

export const PAINT_PNG = 'paint.png';
export const PAINT_JSON = 'paint.json';
/** 「在画」超过这么久还没落成(服务重起过、进程被杀),当没画成 */
export const PAINT_STALE_MS = 5 * 60_000;

export type PaintRecord =
  | { state: 'drawing'; at: string; prompt: string; model: string; negative?: string }
  | { state: 'done'; at: string; prompt: string; model: string; size: string; ms: number; negative?: string }
  | { state: 'none'; at: string; error: string; prompt?: string; model?: string; ms?: number };

/** 某一轮某张画图卡的记录;过了 PAINT_STALE_MS 还在画的当没画成(stale) */
export async function paintRecordAt(ws: PaintSpace, tutor: string, date: string, job: string, n: number, now: number = Date.now()): Promise<PaintRecord | null> {
  const r = await readRecord(join(conversationFiles(ws.dirs.conversations, tutor, date).cardAssetsDir(job, n), PAINT_JSON));
  return r?.state === 'drawing' && now - Date.parse(r.at) > PAINT_STALE_MS ? { state: 'none', at: r.at, error: 'stale' } : r;
}

async function readRecord(file: string): Promise<PaintRecord | null> {
  try {
    const r = JSON.parse(await readFile(file, 'utf8')) as PaintRecord;
    return r && typeof r.state === 'string' && typeof r.at === 'string' ? r : null;
  } catch {
    return null;
  }
}

async function writeRecord(file: string, r: PaintRecord): Promise<void> {
  await writeFile(`${file}.tmp`, JSON.stringify(r, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}

/** 今天各位老师画好的张数(在画的也算);工作台概览用 */
export async function paintedToday(ws: PaintSpace, date: string, now: number = Date.now()): Promise<number> {
  let n = 0;
  const tutors = await readdir(ws.dirs.conversations, { withFileTypes: true }).catch(() => []);
  for (const t of tutors) {
    if (!t.isDirectory()) continue;
    const dir = join(ws.dirs.conversations, t.name);
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      if (!name.startsWith(`${date}.`) || !name.endsWith('.cards')) continue;
      const cards = await readdir(join(dir, name), { withFileTypes: true }).catch(() => []);
      for (const c of cards) {
        if (!c.isDirectory()) continue;
        const r = await readRecord(join(dir, name, c.name, PAINT_JSON));
        if (r?.state === 'done' || (r?.state === 'drawing' && now - Date.parse(r.at) < PAINT_STALE_MS)) n++;
      }
    }
  }
  return n;
}

/** 一张一张画:整个进程一条队 */
let chain: Promise<unknown> = Promise.resolve();

/**
 * 这一轮板书里的画图卡,一张一张画。已经有记录的不再画(重起、重放都不重画);replay = 回放那轮不画(evals 目录里,不花钱)。
 * painter = 这个话题的 activity 文件「画家收到什么」(模板与不要的);给了就照它画,没给照出厂的画风。
 * 返回画完的 Promise(测试与关服前等它),不抛。
 */
export function startPaints(ws: PaintSpace, tutor: string, date: string, job: string, section: BoardSection, opts: { draw: Draw; now?: () => Date; replay?: boolean; gate?: () => Promise<string | null>; painter?: { prompt: string; negative?: string } | null }): Promise<void> {
  const cfg = ws.config.paint ?? PAINT_DEFAULT;
  const painter = opts.painter ?? null;
  const negative = painter?.negative || PAINT_NEGATIVE;
  const files = conversationFiles(ws.dirs.conversations, tutor, date);
  const at = (): string => (opts.now?.() ?? new Date()).toISOString();
  const work = section.cards.flatMap((c, n) => {
    if (c.kind !== 'paint') return [];
    const p = PaintPropsSchema.safeParse(c.props);
    return p.success ? [{ n, props: p.data }] : [];
  });
  if (!work.length) return Promise.resolve();
  const run = async (): Promise<void> => {
    for (const { n, props } of work) {
      const dir = files.cardAssetsDir(job, n);
      const rec = join(dir, PAINT_JSON);
      if (await readRecord(rec)) continue;
      await mkdir(dir, { recursive: true });
      const prompt = painter ? paintPromptFrom(painter.prompt, props) : paintPrompt(props);
      const model = cfg.model;
      if (opts.replay) { await writeRecord(rec, { state: 'none', at: at(), error: 'replay' }); continue; }
      // activity「应用拦的」:没过就不画、不占张数,下一条告诉老师缺哪条;排在队里现查,同一轮第二张看得到第一张
      const stop = opts.gate ? await opts.gate().catch(() => null) : null;
      if (stop) { await writeRecord(rec, { state: 'none', at: at(), error: `gate:${stop}`, prompt, model }); continue; }
      await writeRecord(rec, { state: 'drawing', at: at(), prompt, model, negative });
      const size = paintSize(props.panels.length, cfg.size);
      const r = await opts.draw({ prompt, model, size, negative });
      if (r.ok) {
        await writeFile(join(dir, PAINT_PNG), r.data);
        await writeRecord(rec, { state: 'done', at: at(), prompt, model, size, ms: r.ms, negative });
      } else await writeRecord(rec, { state: 'none', at: at(), error: r.error, prompt, model, ms: r.ms });
    }
  };
  const p = chain.then(run, run).catch(() => {});
  chain = p;
  return p;
}

/** 家长端那一行:画好了用的模型与秒数;没画成的原因说成人话 */
export function paintNote(r: PaintRecord | null): string {
  if (!r) return '还没开始画';
  if (r.state === 'drawing') return `在画(${r.model})`;
  if (r.state === 'done') return `画好了:${r.model},${Math.round(r.ms / 1000)} 秒`;
  const e = r.error;
  // daily: 是 10-21 前一天几张的上限(去掉了),旧记录照旧说得出来
  const why = e.startsWith('daily:') ? `今天画了 ${e.slice(6).split('/')[0]} 张,到了当时一天的上限(现在不限了)`
    : e.startsWith('gate:') ? `应用拦下了,没交给画家(activity「应用拦的」:${e.slice(5)})`
    : e === 'replay' ? '回放不画'
    : e === 'no_key' ? '拿不到百炼 key(DASHSCOPE_API_KEY,或本机 ~/.qwen/settings.json)'
    : e === 'stale' ? '画到一半服务重起了'
    : e.includes('DataInspectionFailed') ? '百炼的内容审核没过'
    : e === 'timeout' ? '等了太久(超时)'
    : e;
  return `没画成:${why}`;
}

/**
 * 下发时补上画好没有(同 enrichLectures):pic = 图(相对 workspace 根,页面经 /api/kid/image 取),drawn = drawing / done / none;
 * 家长端(parent)再补 note。没有记录:这一轮刚跑完、还没轮到 → drawing;过了 PAINT_STALE_MS 还没有 → none。
 */
export async function enrichPaints(ws: PaintSpace, tutor: string, date: string, job: string, at: string, section: BoardSection, opts: { parent?: boolean; now?: number } = {}): Promise<BoardSection> {
  if (!section.cards.some((c) => c.kind === 'paint')) return section;
  const files = conversationFiles(ws.dirs.conversations, tutor, date);
  const now = opts.now ?? Date.now();
  const cards = await Promise.all(section.cards.map(async (c, n) => {
    if (c.kind !== 'paint') return c;
    let r = await readRecord(join(files.cardAssetsDir(job, n), PAINT_JSON));
    const since = (x: string): number => now - Date.parse(x);
    if (r?.state === 'drawing' && since(r.at) > PAINT_STALE_MS) r = { state: 'none', at: r.at, error: 'stale' };
    const drawn: NonNullable<PaintProps['drawn']> = r ? (r.state === 'done' ? 'done' : r.state) : since(at) > PAINT_STALE_MS ? 'none' : 'drawing';
    const pic = drawn === 'done' ? relative(ws.root, files.cardAsset(job, n, PAINT_PNG)) : undefined;
    return { ...c, props: { ...c.props, drawn, ...(pic ? { pic } : {}), ...(opts.parent ? { note: paintNote(r) } : {}) } };
  }));
  return { ...section, cards };
}

/** 交给老师的那一行(下一条消息的 cards:):老师看不到图,只知道画好没有 */
export async function paintLines(ws: PaintSpace, tutor: string, date: string, job: string, section: BoardSection, now: number = Date.now()): Promise<string[]> {
  const files = conversationFiles(ws.dirs.conversations, tutor, date);
  const out: string[] = [];
  for (const [n, c] of section.cards.entries()) {
    if (c.kind !== 'paint') continue;
    let r = await readRecord(join(files.cardAssetsDir(job, n), PAINT_JSON));
    if (r?.state === 'drawing' && now - Date.parse(r.at) > PAINT_STALE_MS) r = { state: 'none', at: r.at, error: 'stale' };
    const said = !r || r.state === 'drawing' ? '画家还在画,孩子还没看到图' : r.state === 'done' ? '画好了,孩子看到了图(你看不到图,问孩子画得怎样)' : r.error === 'gate:连说过一遍' ? '没画:孩子还没看着整段连着说一遍,孩子只看到分好的几幅' : r.error === 'gate:还能画' ? '没画:这个话题能画的张数到头了,孩子只看到分好的几幅' : r.error.startsWith('gate:') ? `没画:${r.error.slice(5)}没过,孩子只看到分好的几幅` : '没画成,孩子只看到分好的几幅';
    out.push(`${cardId(job, n)} 画图卡:${said}`);
  }
  return out;
}
