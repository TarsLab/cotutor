/**
 * 家长端「看原文」的一轮全景(2026-09-11):把一次运行拆成六站,一个接口给全。
 * 调试时要回答的不是「老师写了什么」,而是「这一层是谁吃掉的」——孩子没看见那张卡,可能是老师没写、
 * 可能 kidSource 没挑中那一段、可能 parseBoard 没认出那个标签、也可能 stripSecrets 剥过头。
 * 每站的数据都从盘上现读现算,不进索引:原文在 .log,发出去的在 .run.json,卡的状态在 .cards/,配音就看文件在不在。
 * 「重解」= 拿当前解析器再跑一遍原文与索引里存的比 —— 索引是物化的,改完解析器老样本会不会变,只有这样才知道。
 */
import { stat } from 'node:fs/promises';
import { cardLabel, describeCard, stripSecrets } from '../cards/index.ts';
import { annotateSource, type BoardWarning, type SourceRow } from '../lib/board.ts';
import { cardId, conversationFiles, type CardStateFile } from '../lib/conversation.ts';
import { kidSource, truncateReply } from '../lib/kid-view.ts';
import type { BoardCard, BoardSection } from '../lib/kid-board.ts';
import { foldRuns, type TranscriptRow } from '../lib/transcript.ts';
import { resolvePolicy, type ConversationMessage } from '../schema/index.ts';
import type { Workspace } from '../cli/workspace.ts';
import { readErrLog, readIndex, readRunFile, readTranscript, scanCards } from './store.ts';
import { readPostFile, type PostFile } from './post.ts';

export interface RawStation {
  id: 'pack' | 'source' | 'parse' | 'kid' | 'audio' | 'trace' | 'post' | 'ledger';
  title: string;
  /** 体量那行小字 */
  note: string;
  state: 'ok' | 'warn' | 'none';
}

export interface DiffRow {
  s: '+' | '-' | '·';
  text: string;
}

export interface RawKidLine {
  text: string;
  /** 按 replyMaxChars 截掉的尾巴(孩子看不到、也不念);没截就是空串 */
  cut: string;
  /** 配音文件名;null = 没有(没配音色 / 失败,孩子端退浏览器合成) */
  audio: string | null;
  audioOk: boolean;
}

export interface RawCard {
  n: number;
  kind: string;
  label: string;
  /** 孩子在这张卡上做的(describeCard 出的那句);没动过 = null */
  state: string | null;
  /** 已生成的资产(点读段 mp3) */
  assets: string[];
  /** 下发给孩子的 props(答案已剥) */
  props: Record<string, unknown>;
}

export interface RawView {
  tutor: string;
  date: string;
  job: string;
  thread: string | null;
  at: string;
  from: string;
  text: string;
  result: string;
  runtime: string | null;
  costUsd: number | null;
  timing: ConversationMessage['timing'] | null;
  error: string | null;
  stations: RawStation[];
  /** 发出去的:上下文包 + 完整命令行(老 workspace 没落过就是 null) */
  pack: { prompt: string; argv: string[]; runtime: string; resume: boolean; session: string | null; agentBody: boolean } | null;
  /** 老师原文(= 解析器真正吃的那一份)+ 逐行注解 */
  source: { text: string; rows: SourceRow[]; warnings: BoardWarning[] };
  /** 顶层文本块里没进板书正文的那些(「我先看看账本」之类) */
  dropped: string[];
  /** 索引里存着的(当时那版解析器的结果) */
  stored: { section: BoardSection | null; warnings: string[]; kidText: string | null; parentText: string };
  /** 拿当前解析器重解一遍 + 与 stored 的差异 */
  fresh: { section: BoardSection; warnings: BoardWarning[]; diff: DiffRow[]; same: boolean };
  kid: { lines: RawKidLine[]; cards: RawCard[] };
  /** 转录(工具行、子代理),与家长视图同一套折叠 */
  trace: TranscriptRow[];
  /** 第七站:板书后期的输入 / 原始输出 / 校验(<日期>.<job>.post.json);没跑过 → null */
  post: PostFile | null;
  postSummary: { ok: boolean; ms: number; costUsd?: number; dropped: number; error?: string } | null;
  device: string | null;
  /** stderr 尾巴 */
  err: string;
  files: { log: string; run: string | null };
}

const exists = async (f: string): Promise<boolean> => Boolean(await stat(f).catch(() => null));

const cardOneLine = (c: BoardCard): string => `${c.kind} ${cardLabel(c)}`.trim();

/** 卡与讲稿逐条比:同序对齐,不同就一减一加。给「改完解析器,老样本会不会变」用 */
export function diffSections(stored: BoardSection | null, fresh: BoardSection): DiffRow[] {
  const rows: DiffRow[] = [];
  const a = stored?.cards ?? [];
  const b = fresh.cards;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    const label = (c: BoardCard): string => `卡 ${i + 1}　${cardOneLine(c)}`;
    if (!x && y) rows.push({ s: '+', text: label(y) });
    else if (x && !y) rows.push({ s: '-', text: label(x) });
    else if (x && y && (x.kind !== y.kind || JSON.stringify(x.props) !== JSON.stringify(y.props))) {
      rows.push({ s: '-', text: label(x) });
      rows.push({ s: '+', text: label(y) });
    } else if (x) rows.push({ s: '·', text: label(x) });
  }
  const la = stored?.lines ?? [];
  const lb = fresh.lines;
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    const x = la[i];
    const y = lb[i];
    if (!x && y) rows.push({ s: '+', text: `讲稿 ${i + 1}　${y.text}` });
    else if (x && !y) rows.push({ s: '-', text: `讲稿 ${i + 1}　${x.text}` });
    else if (x && y && x.text !== y.text) {
      rows.push({ s: '-', text: `讲稿 ${i + 1}　${x.text}` });
      rows.push({ s: '+', text: `讲稿 ${i + 1}　${y.text}` });
    }
  }
  return rows;
}

const secs = (ms?: number): string => (ms === undefined ? '' : ms < 10000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`);

export async function rawView(ws: Workspace, tutor: string, date: string, job: string): Promise<RawView | null> {
  const index = await readIndex(ws, tutor, date);
  const m = index.messages.find((x) => x.job === job);
  if (!m) return null;
  const files = conversationFiles(ws.dirs.conversations, tutor, date);
  const policy = resolvePolicy(ws.config, tutor);
  const transcript = await readTranscript(ws, tutor, date, job);
  const pack = await readRunFile(ws, tutor, date, job);
  const blocks = (transcript?.items ?? []).filter((i) => i.kind === 'text' && !i.sub).map((i) => i.text.trim());
  const src = (transcript ? kidSource(transcript) : null) ?? '';
  const dropped = blocks.filter((b) => b && !src.includes(b));
  const ann = annotateSource(src);
  const stored = m.section ?? null;
  // 索引里的讲稿已经按 replyMaxChars 截过,重解的还没有——比之前先截,免得每句都报「不同」
  const freshCut: BoardSection = { ...ann.section, lines: ann.section.lines.map((l) => ({ ...l, text: truncateReply(l.text, policy.replyMaxChars).text })) };
  const diff = diffSections(stored, freshCut);
  const same = diff.every((d) => d.s === '·');

  // 下发给孩子那一份:讲稿按 replyMaxChars 截、配音文件在不在、卡剥完答案是什么样
  const shown = stripSecrets(ann.section);
  const { states, assets } = await scanCards(ws, tutor, date);
  const jobStates: Record<number, CardStateFile> = states[job] ?? {};
  // 发出去的是索引里那一份(这轮真下发的);被 replyMaxChars 截掉的尾巴拿没截过的原句比出来
  const lines: RawKidLine[] = [];
  for (const [i, l] of (stored?.lines ?? freshCut.lines).entries()) {
    const full = ann.section.lines[i]?.text ?? l.text;
    const head = l.text.replace(/…$/, '');
    const audio = l.audio ?? null;
    lines.push({ text: l.text, cut: full.length > l.text.length && full.startsWith(head) ? full.slice(head.length) : '', audio, audioOk: audio ? await exists(files.lineAudio(job, i + 1)) : false });
  }
  const cards: RawCard[] = (stored?.cards ?? ann.section.cards).map((c, n) => ({
    n,
    kind: c.kind,
    label: cardLabel(c),
    state: jobStates[n] ? describeCard(c, jobStates[n].state) : null,
    assets: assets[job]?.[n] ?? [],
    props: (shown.cards[n]?.props ?? c.props) as Record<string, unknown>,
  }));

  const err = await readErrLog(ws, tutor, date, job);
  const warnCount = ann.warnings.length + (m.warnings?.length ?? 0);
  const dubbed = lines.filter((l) => l.audioOk).length;
  const stations: RawStation[] = [
    { id: 'pack', title: '上下文包', note: pack ? `${pack.prompt.length} 字 · ${pack.resume ? 'resume' : '新开'}` : '这一轮没落(老 workspace)', state: pack ? 'ok' : 'none' },
    { id: 'source', title: '老师原文', note: `${src ? src.split('\n').length : 0} 行 · 顶层 ${blocks.length} 段${dropped.length ? ` · 丢 ${dropped.length} 段` : ''}`, state: src ? 'ok' : 'none' },
    { id: 'parse', title: '解析结果', note: `${ann.section.cards.length} 卡 · ${ann.section.lines.length} 句${warnCount ? ` · ${warnCount} 提醒` : ''}${same ? '' : ' · 与索引不同'}`, state: warnCount || !same ? 'warn' : 'ok' },
    { id: 'kid', title: '下发给孩子', note: `${lines.length} 句${lines.some((l) => l.cut) ? ` · 截了 ${lines.filter((l) => l.cut).length} 句` : ''} · ${cards.length} 卡`, state: lines.length || cards.length ? 'ok' : 'none' },
    { id: 'audio', title: '配音与资产', note: !lines.length ? '这轮没有讲稿' : !lines.some((l) => l.audio) ? '没配音 · 孩子端用浏览器的声' : `${dubbed} / ${lines.length} 句${m.timing?.dubbedMs !== undefined ? ` · ${secs(m.timing.dubbedMs)}` : ''}`, state: !lines.length || !lines.some((l) => l.audio) ? 'none' : dubbed === lines.length ? 'ok' : 'warn' },
    { id: 'trace', title: '转录与报错', note: `${transcript?.items.length ?? 0} 条${err ? ' · stderr 有东西' : ''}`, state: m.result === 'error' || err ? 'warn' : 'ok' },
  ];
  // 第七站:板书后期(有卡的轮次才有;关着 / 老板书没跑过 → none)
  const postFile: PostFile | null = await readPostFile(ws, tutor, date, job);
  if (m.post || postFile) {
    const kept = postFile?.kept;
    const note = m.post?.ok
      ? `${secs(m.post.ms)}${m.post.costUsd !== undefined ? ` · $${m.post.costUsd.toFixed(3)}` : ''} · 标注 ${kept?.marks ?? '?'} 锚点 ${kept?.anchors ?? '?'} ${kept?.layout ? '排了行' : '没排行'} 样子 ${kept?.looks ?? '?'}${m.post.dropped ? ` · 丢 ${m.post.dropped}` : ''}`
      : `没成:${m.post?.error ?? postFile?.error ?? '?'}(素版)`;
    stations.push({ id: 'post', title: '板书后期', note, state: m.post?.ok ? (m.post.dropped ? 'warn' : 'ok') : 'warn' });
  } else if (stored?.cards.length) stations.push({ id: 'post', title: '板书后期', note: policy.post.mode === 'off' ? '关着(policy post.mode = off),素版' : '这轮没跑过(老板书);可以「再做一次」', state: 'none' });
  if (m.artifacts.length) stations.push({ id: 'ledger', title: '账本', note: `产物 ${m.artifacts.join('、')}`, state: 'ok' });

  return {
    tutor,
    date,
    job,
    thread: m.thread ?? null,
    at: m.at,
    from: m.from,
    text: m.text,
    result: m.result,
    runtime: m.runtime ?? null,
    costUsd: m.costUsd ?? null,
    timing: m.timing ?? null,
    error: m.error ?? null,
    stations,
    pack: pack ? { prompt: pack.prompt, argv: pack.argv, runtime: pack.runtime, resume: pack.resume, session: pack.session, agentBody: pack.agentBody } : null,
    source: { text: src, rows: ann.rows, warnings: ann.warnings },
    dropped,
    stored: { section: stored, warnings: m.warnings ?? [], kidText: m.kidText ?? null, parentText: m.parentText ?? '' },
    fresh: { section: ann.section, warnings: ann.warnings, diff, same },
    kid: { lines, cards },
    trace: foldRuns(transcript?.items ?? []),
    err: err.slice(-4000),
    post: postFile ? { ...postFile, raw: postFile.raw.slice(0, 20000) } : null,
    postSummary: m.post ?? null,
    device: m.device ?? null,
    files: { log: `${date}.${job}.log`, run: pack ? `${date}.${job}.run.json` : null },
  };
}

/** 「存成 fixture」:原文原样一份,文件名按 job;家长端下载,开发者放进 tests/fixtures/board/ */
export function fixtureOf(view: RawView): { name: string; text: string } {
  return { name: `${view.tutor}-${view.date}-${view.job}.md`, text: view.source.text.endsWith('\n') ? view.source.text : `${view.source.text}\n` };
}

/** 卡 id(家长端显示「孩子在板书上做的」那套 id) */
export const rawCardId = cardId;
