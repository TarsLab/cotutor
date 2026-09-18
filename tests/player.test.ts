/**
 * 播放器(kid-board.ts 的 step):仲裁表一格一条 + 随机事件序列跑不变式 + 页面不绕过 step。
 * 仲裁表的中文版在《工作流程.md》§孩子端「播放器」;改规则先改表、再改这里、最后改 step。
 */
import { readFileSync } from 'node:fs';
import {
  CONT_GUARD_MS,
  initialPlayer,
  isQuestion,
  playableLines,
  replayQuiet,
  spokenLines,
  startReplay,
  step,
  type BoardCard,
  type BoardLine,
  type BoardSection,
  type PlayerCtx,
  type PlayerEffect,
  type PlayerEvent,
  type PlayerModel,
  type PlayerState,
} from '../src/lib/kid-board.ts';
import { check, done } from './_check.ts';

const L = (text: string, anchor: number | null, extra: Partial<BoardLine> = {}): BoardLine => ({ text, audio: null, marks: [], ask: isQuestion(text), anchor, cues: [], ...extra });
const text = (t: string): BoardCard => ({ kind: 'text', props: { text: t } });
const scene: BoardCard = { kind: 'scene', props: { bundle: 'b', ready: true, steps: [{}] } };
/** 讲完的一节:卡 0 两句,卡 1 一句问句 */
const done0: BoardSection = { cards: [text('a'), text('b')], lines: [L('一', 0), L('二', 0), L('三?', 1)] };
/** 最新一节:卡 0 一句,末句问句 */
const last: BoardSection = { cards: [text('c')], lines: [L('四', 0), L('五?', 0)] };
/** 老师还在写:前一拍就绪 */
const live: BoardSection = { cards: [text('d'), text('e')], lines: [L('六', 0), L('七', 1)], partial: true, ready: 1 };
/** 念完这句交给场景 */
const withScene: BoardSection = { cards: [scene], lines: [L('看我画', 0, { cues: [{ card: 0, name: 'play' }] }), L('画完了', 0)] };

const ctxOf = (sections: BoardSection[], over: Partial<PlayerCtx> = {}): PlayerCtx => ({ sections, pending: false, autoplay: true, readonly: false, stage: false, limit: false, now: 10_000, ...over });
const M = (state: PlayerState, over: Partial<PlayerModel> = {}): PlayerModel => ({ ...initialPlayer(), state, ...over });
const kinds = (fx: PlayerEffect[]) => fx.map((f) => f.kind).join(',');

const W: PlayerState = { section: 1, line: 1, status: 'waiting' };
const replayingW = M(startReplay(W, 0, [0, 1]), { replayOf: { section: 0, card: 0 } });

// ---- 仲裁表:正在…… × 来了……(一行一格)----
interface Row { name: string; model: PlayerModel; sections: BoardSection[]; ctx?: Partial<PlayerCtx>; ev: PlayerEvent; want: (m: PlayerModel, fx: PlayerEffect[]) => boolean }
const rows: Row[] = [
  // 停下等答
  { name: '等答 + 点继续 → 发「继续」', model: M(W), sections: [done0, last], ev: { type: 'tapButton' }, want: (m, fx) => kinds(fx) === 'send' && m.state.status === 'waiting' },
  { name: '等答 + 再听刚停 0.8 秒内点继续 → 不发', model: M(W, { contGuardUntil: 10_500 }), sections: [done0, last], ev: { type: 'tapButton' }, want: (_m, fx) => fx.length === 0 },
  { name: '等答 + 点喇叭(讲完的卡)→ 再听,念完回等答', model: M(W), sections: [done0, last], ev: { type: 'tapAgain', section: 0, target: 0 }, want: (m, fx) => kinds(fx) === 'replayStart,stop,unpaint,play' && JSON.stringify(m.state.replay?.lines) === '[0,1]' && m.state.replay?.back.status === 'waiting' },
  { name: '等答 + 点字幕 → 再听这句', model: M(W), sections: [done0, last], ev: { type: 'tapSubtitle' }, want: (m, fx) => fx.at(-1)?.kind === 'play' && JSON.stringify(m.state.replay?.lines) === '[1]' && m.replayOf?.card === 'line' },
  { name: '等答 + 点节头 → 整节再听', model: M(W), sections: [done0, last], ev: { type: 'tapAgain', section: 0, target: 'all' }, want: (m) => JSON.stringify(m.state.replay?.lines) === '[0,1,2]' && m.replayOf?.card === 'all' },
  { name: '等答 + 舞台开着点喇叭 → 不响', model: M(W), sections: [done0, last], ctx: { stage: true }, ev: { type: 'tapAgain', section: 0, target: 0 }, want: (m, fx) => fx.length === 0 && !m.state.replay },
  // 老师在念 / 在想:不许再听
  { name: '在念 + 点喇叭 → 不响(不打断正在念的回答)', model: M({ section: 1, line: 0, status: 'playing' }), sections: [done0, last], ev: { type: 'tapAgain', section: 0, target: 0 }, want: (m, fx) => fx.length === 0 && m.state.status === 'playing' },
  { name: '老师在想 + 点喇叭 → 不响', model: M({ section: 1, line: 1, status: 'done' }), sections: [done0, last], ctx: { pending: true }, ev: { type: 'tapAgain', section: 0, target: 0 }, want: (_m, fx) => fx.length === 0 },
  { name: '老师在想 + 点字幕 → 不响', model: M({ section: 1, line: 1, status: 'done' }), sections: [done0, last], ctx: { pending: true }, ev: { type: 'tapSubtitle' }, want: (_m, fx) => fx.length === 0 },
  { name: '等下一拍 + 点喇叭 → 不响', model: M({ section: 1, line: 0, status: 'thinking' }), sections: [done0, live], ctx: { pending: true }, ev: { type: 'tapAgain', section: 0, target: 0 }, want: (_m, fx) => fx.length === 0 },
  // 在念
  { name: '在念 + 点暂停 → 暂停', model: M({ section: 1, line: 0, status: 'playing' }), sections: [done0, last], ev: { type: 'tapButton' }, want: (m, fx) => m.state.status === 'paused' && kinds(fx) === 'stop,render' },
  { name: '暂停 + 点播放 → 接着念', model: M({ section: 1, line: 0, status: 'paused' }), sections: [done0, last], ev: { type: 'tapButton' }, want: (m, fx) => m.state.status === 'playing' && kinds(fx) === 'play' },
  { name: '暂停 + 点喇叭 → 再听,念完回暂停', model: M({ section: 1, line: 0, status: 'paused' }), sections: [done0, last], ev: { type: 'tapAgain', section: 0, target: 0 }, want: (m) => m.state.replay?.back.status === 'paused' },
  { name: '在念 + 一句念完 → 下一句', model: M({ section: 1, line: 0, status: 'playing' }), sections: [done0, last], ev: { type: 'lineEnded' }, want: (m, fx) => m.state.line === 1 && kinds(fx) === 'play' },
  { name: '在念 + 末句问句念完 → 等答、推答题卡', model: M({ section: 1, line: 1, status: 'playing' }), sections: [done0, last], ev: { type: 'lineEnded' }, want: (m, fx) => m.state.status === 'waiting' && kinds(fx) === 'render,openAsk' },
  { name: '以前的话题 + 末句问句念完 → 完(不等答)', model: M({ section: 1, line: 1, status: 'playing' }), sections: [done0, last], ctx: { readonly: true }, ev: { type: 'lineEnded' }, want: (m, fx) => m.state.status === 'done' && kinds(fx) === 'render' },
  { name: '在念 + [[play]] 那句念完 → 交给场景', model: M({ section: 0, line: 0, status: 'playing' }), sections: [withScene], ev: { type: 'lineEnded' }, want: (m, fx) => m.state.status === 'stage' && kinds(fx) === 'openStage' },
  { name: '交给场景 + 场景播完 → 接着念', model: M({ section: 0, line: 0, status: 'stage' }), sections: [withScene], ev: { type: 'stageDone' }, want: (m, fx) => m.state.status === 'playing' && m.state.line === 1 && kinds(fx) === 'play' },
  { name: '在念 + 点卡开舞台 → 暂停', model: M({ section: 1, line: 0, status: 'playing' }), sections: [done0, last], ev: { type: 'stageOpen' }, want: (m) => m.state.status === 'paused' },
  { name: '在念 + 点读 → 暂停', model: M({ section: 1, line: 0, status: 'playing' }), sections: [done0, last], ev: { type: 'segment' }, want: (m) => m.state.status === 'paused' },
  { name: '在念 + 孩子说话 → 完、停声音', model: M({ section: 1, line: 0, status: 'playing' }), sections: [done0, last], ev: { type: 'send' }, want: (m, fx) => m.state.status === 'done' && kinds(fx) === 'stop' },
  // 再听中
  { name: '再听 + 点停 → 回等答,「继续」防误点', model: replayingW, sections: [done0, last], ev: { type: 'tapButton' }, want: (m, fx) => m.state.status === 'waiting' && !m.state.replay && m.replayOf === null && m.contGuardUntil === 10_000 + CONT_GUARD_MS && fx[0].kind === 'stop' && !fx.some((f) => f.kind === 'send') },
  { name: '再听 + 再点同一个喇叭 → 停', model: replayingW, sections: [done0, last], ev: { type: 'tapAgain', section: 0, target: 0 }, want: (m) => !m.state.replay && m.state.status === 'waiting' },
  { name: '再听 + 点别的喇叭 → 换成那个,回的还是最初的位置', model: replayingW, sections: [done0, last], ev: { type: 'tapAgain', section: 0, target: 1 }, want: (m) => JSON.stringify(m.state.replay?.lines) === '[2]' && JSON.stringify(m.state.replay?.back) === JSON.stringify(W) },
  { name: '再听 + 一句念完(还有)→ 下一句', model: replayingW, sections: [done0, last], ev: { type: 'lineEnded' }, want: (m, fx) => m.state.line === 1 && Boolean(m.state.replay) && kinds(fx) === 'play' },
  { name: '再听 + 末句念完 → 回等答,不推答题卡、不发「继续」', model: M(startReplay(W, 0, [1]), { replayOf: { section: 0, card: 0 } }), sections: [done0, last], ev: { type: 'lineEnded' }, want: (m, fx) => m.state.status === 'waiting' && !fx.some((f) => f.kind === 'openAsk' || f.kind === 'send') && m.contGuardUntil > 10_000 },
  { name: '再听 + 孩子说话 → 再听停、完', model: replayingW, sections: [done0, last], ev: { type: 'send' }, want: (m) => !m.state.replay && m.state.status === 'waiting' },
  { name: '再听 + 整节新回答到了 → 再听让路,念新的', model: replayingW, sections: [done0, last, last], ev: { type: 'fresh', sections: [2], silent: false }, want: (m, fx) => !m.state.replay && m.state.section === 2 && m.state.status === 'playing' && fx.at(-1)?.kind === 'play' },
  { name: '再听 + 开舞台 → 再听停', model: replayingW, sections: [done0, last], ev: { type: 'stageOpen' }, want: (m) => !m.state.replay },
  // 老师的新内容
  { name: '等下一拍 + 新的一拍就绪 → 接着念', model: M({ section: 1, line: 0, status: 'thinking' }), sections: [done0, { ...live, ready: 2 }], ctx: { pending: true }, ev: { type: 'liveBeat', section: 1 }, want: (m, fx) => m.state.status === 'playing' && m.state.line === 1 && kinds(fx) === 'play' },
  // 防御:再听只在安静时开始,等下一拍时本来进不了再听;真进了(以后改了安静规则),新的一拍照样抢回来
  { name: '(防御)等下一拍时在再听 + 新的一拍就绪 → 再听让路,接着念', model: M(startReplay({ section: 1, line: 0, status: 'thinking' }, 0, [0]), { replayOf: { section: 0, card: 0 } }), sections: [done0, { ...live, ready: 2 }], ctx: { pending: true }, ev: { type: 'liveBeat', section: 1 }, want: (m, fx) => !m.state.replay && m.state.status === 'playing' && m.state.line === 1 && fx.at(-1)?.kind === 'play' },
  { name: '(防御)等下一拍时在再听 + 老师写完 → 再听让路', model: M(startReplay({ section: 1, line: 0, status: 'thinking' }, 0, [0]), { replayOf: { section: 0, card: 0 } }), sections: [done0, { cards: live.cards, lines: [L('六', 0), L('七', 1)] }], ev: { type: 'liveFinal', section: 1, prevLines: ['六'] }, want: (m) => !m.state.replay && m.state.status === 'playing' },
  { name: '第一拍就绪 → 从第一句念', model: M({ section: 0, line: 2, status: 'done' }), sections: [done0, live], ctx: { pending: true }, ev: { type: 'liveStart', section: 1 }, want: (m, fx) => m.state.section === 1 && m.state.status === 'playing' && fx.at(-1)?.kind === 'play' },
  { name: '等下一拍 + 老师写完(末句问句)→ 接着念', model: M({ section: 1, line: 0, status: 'thinking' }), sections: [done0, { cards: live.cards, lines: [L('六', 0), L('七?', 1)] }], ev: { type: 'liveFinal', section: 1, prevLines: ['六'] }, want: (m, fx) => m.state.status === 'playing' && m.state.line === 1 && fx.at(-1)?.kind === 'play' },
  { name: '老师写完、定稿多了一句 → 按文字找回位置,不念两遍', model: M({ section: 1, line: 0, status: 'paused' }), sections: [done0, { cards: live.cards, lines: [L('零', null), L('六', 0), L('七', 1)] }], ev: { type: 'liveFinal', section: 1, prevLines: ['六', '七'] }, want: (m) => m.state.line === 1 && m.state.status === 'paused' },
  { name: '不自动念 + 整节到了 → 标注画齐、停在末尾', model: M({ section: 0, line: 2, status: 'done' }), sections: [done0, last], ctx: { autoplay: false }, ev: { type: 'fresh', sections: [1], silent: false }, want: (m, fx) => m.state.status === 'waiting' && !fx.some((f) => f.kind === 'play') },
];
for (const r of rows) {
  const out = step(r.model, r.ev, ctxOf(r.sections, r.ctx));
  check(`仲裁表:${r.name}`, r.want(out.model, out.effects), `${JSON.stringify(out.model)} | ${kinds(out.effects)}`);
}

// ---- 随机事件序列:模拟页面、声音与老师,每一步查不变式 ----
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NESTED = new Set(['play', 'send', 'openStage', 'openAsk']);

interface World { m: PlayerModel; sections: BoardSection[]; pending: boolean; autoplay: boolean; stage: boolean; now: number; log: string[] }

/** 一次完整的老师回复(有卡、末句可能是问句、可能带场景) */
function reply(r: () => number, n: number): BoardSection {
  if (r() < 0.2) return { cards: [scene, text('x' + n)], lines: [L('看我画' + n, 0, { cues: [{ card: 0, name: 'play' }] }), L('好了' + n, 1), L('懂了吗' + n + '?', 1)] };
  const cards = [text('p' + n), text('q' + n)];
  return { cards, lines: [L('开头' + n, null), L('甲' + n, 0), L('乙' + n, 1), L(r() < 0.6 ? '对吗' + n + '?' : '完' + n, 1)] };
}

function run(seed: number, steps: number): string | null {
  const r = rng(seed);
  const w: World = { m: initialPlayer(), sections: [], pending: false, autoplay: r() < 0.8, stage: false, now: 1_000, log: [] };
  let target: BoardSection | null = null; // 老师在写的这一节(写完的样子)
  let nth = 0;
  const ctx = (): PlayerCtx => ({ sections: w.sections, pending: w.pending, autoplay: w.autoplay, readonly: false, stage: w.stage, limit: false, now: w.now });
  // 开头:已经有一两节(打开页面、不出声)
  w.sections.push(reply(r, nth++));
  if (r() < 0.5) w.sections.push(reply(r, nth++));
  const q: PlayerEvent[] = [{ type: 'fresh', sections: w.sections.map((_s, i) => i), silent: true }];

  const dispatch = (ev: PlayerEvent): string | null => {
    const before = w.m;
    const c = ctx();
    const { model, effects } = step(before, ev, c);
    w.log.push(`${ev.type}${'section' in ev ? ':' + ev.section : ''} ${before.state.status}→${model.state.status}${model.state.replay ? '(再听)' : ''} [${kinds(effects)}]`);
    // 不变式 1:会让页面再 dispatch 的事最多一个、且在最后
    const nested = effects.filter((f) => NESTED.has(f.kind));
    if (nested.length > 1 || (nested.length === 1 && effects.at(-1) !== nested[0])) return '会再 dispatch 的事不在最后';
    // 不变式 2:「继续」只由孩子在停下等答、不在再听、过了防误点时点出来
    if (effects.some((f) => f.kind === 'send') && !(ev.type === 'tapButton' && before.state.status === 'waiting' && !before.state.replay && c.now >= before.contGuardUntil)) return '「继续」不是孩子在等答时点的';
    // 不变式 3:再听只在板上安静、舞台没开时开始
    const began = model.state.replay && (!before.state.replay || JSON.stringify(model.replayOf) !== JSON.stringify(before.replayOf));
    if (began && (!replayQuiet(before.state, c.pending) || c.stage)) return '板上不安静时开始了再听';
    // 不变式 4:要念就一定在念;在再听就知道在听哪个
    if (effects.some((f) => f.kind === 'play') && model.state.status !== 'playing') return '要念但状态不是 playing';
    if (Boolean(model.state.replay) !== Boolean(model.replayOf)) return 'replay 与 replayOf 不一致';
    // 不变式 5:再听不改「念到哪」
    if ((before.state.replay || model.state.replay) && ev.type !== 'fresh' && ev.type !== 'liveStart' && ev.type !== 'liveBeat' && ev.type !== 'liveFinal' && ev.type !== 'liveDropped' && ev.type !== 'jump' && ev.type !== 'send' && ev.type !== 'reset' && ev.type !== 'autoplayOff') {
      for (let i = 0; i < w.sections.length; i++) if (spokenLines(before.state, w.sections, i) !== spokenLines(model.state, w.sections, i) && before.state.status !== 'playing') return `再听改了第 ${i} 节念到哪`;
    }
    // 不变式 6:位置合法
    const s = model.state;
    if (s.section >= w.sections.length || (s.section >= 0 && s.line >= w.sections[s.section].lines.length)) return '位置越界';
    // 不变式 7:新的一拍就绪、孩子没手动停,老师的回答不会卡住
    if (ev.type === 'liveBeat' && c.autoplay) {
      const base = before.state.replay ? before.state.replay.back : before.state;
      if (base.section === ev.section && base.status === 'thinking' && playableLines(w.sections[ev.section]) > base.line + 1 && (model.state.status === 'thinking' || model.state.replay)) return '新的一拍到了还卡着';
    }
    w.m = model;
    // 页面执行会再 dispatch 的事
    for (const f of effects) {
      if (f.kind === 'send') { q.unshift({ type: 'send' }); w.pending = true; }
      if (f.kind === 'openStage') w.stage = true;
      if (f.kind === 'openAsk') { q.unshift({ type: 'stageOpen' }); w.stage = true; }
    }
    return null;
  };

  for (let k = 0; k < steps; k++) {
    w.now += Math.floor(r() * 900);
    if (!q.length) {
      const x = r();
      const st = w.m.state;
      if (st.status === 'playing' && x < 0.35) q.push({ type: 'lineEnded' });
      else if (w.pending && x < 0.6) {
        // 老师:第一拍 / 下一拍 / 写完 / 整节一次到 / 出错
        const liveIdx = w.sections.findIndex((s) => s.partial);
        const y = r();
        if (liveIdx < 0 && !target) {
          target = reply(r, nth++);
          if (y < 0.3) { w.sections.push(target); target = null; w.pending = false; q.push({ type: 'fresh', sections: [w.sections.length - 1], silent: false }); }
          else { w.sections.push({ ...target, partial: true, ready: 1 }); q.push({ type: 'liveStart', section: w.sections.length - 1 }); }
        } else if (liveIdx >= 0 && target) {
          const cur = w.sections[liveIdx];
          if (y < 0.1) { w.sections.splice(liveIdx, 1); target = null; w.pending = false; q.push({ type: 'liveDropped' }); }
          else if ((cur.ready ?? 0) < 2 && y < 0.6) { w.sections[liveIdx] = { ...cur, ready: (cur.ready ?? 0) + 1 }; q.push({ type: 'liveBeat', section: liveIdx }); }
          else { const prevLines = cur.lines.map((l) => l.text); w.sections[liveIdx] = target; target = null; w.pending = false; q.push({ type: 'liveFinal', section: liveIdx, prevLines }); }
        }
      } else {
        // 孩子
        const y = r();
        const sec = Math.floor(r() * Math.max(1, w.sections.length));
        const tgt: number | 'all' = r() < 0.3 ? 'all' : Math.floor(r() * 2);
        if (w.stage && y < 0.3) { w.stage = false; q.push({ type: 'stageDone' }); }
        else if (y < 0.3) q.push({ type: 'tapButton' });
        else if (y < 0.55) q.push({ type: 'tapAgain', section: sec, target: tgt });
        else if (y < 0.65) q.push({ type: 'tapSubtitle' });
        else if (y < 0.7) { w.stage = true; q.push({ type: 'stageOpen' }); }
        else if (y < 0.74) q.push({ type: 'segment' });
        else if (y < 0.8 && !w.pending) { q.push({ type: 'send' }); w.pending = true; }
        else if (y < 0.82) { w.autoplay = !w.autoplay; if (!w.autoplay) q.push({ type: 'autoplayOff' }); }
        else if (y < 0.84) q.push({ type: 'halt' });
      }
    }
    const ev = q.shift();
    if (!ev) continue;
    const bad = dispatch(ev);
    if (bad) return `种子 ${seed} 第 ${k} 步:${bad}\n  ${w.log.slice(-8).join('\n  ')}`;
  }
  return null;
}

const failures: string[] = [];
for (let seed = 1; seed <= 3000 && failures.length < 3; seed++) { const f = run(seed, 120); if (f) failures.push(f); }
check('随机事件序列 3000 条 × 120 步:不变式都成立', failures.length === 0, failures.join('\n'));

// ---- 页面不绕过 step:播放状态只在 dispatch 里写,停声音只剩 silence ----
const page = readFileSync(new URL('../src/server/kid-page.ts', import.meta.url), 'utf8');
const count = (re: RegExp) => (page.match(re) ?? []).length;
check('页面:S.state / S.replayOf / S.contGuard 只在 dispatch 里写一次', count(/S\.state = /g) === 1 && count(/S\.replayOf = /g) === 1 && count(/S\.contGuard = /g) === 1 && count(/S\.state\.\w+ = /g) === 0, `${count(/S\.state = /g)} ${count(/S\.replayOf = /g)} ${count(/S\.contGuard = /g)} ${count(/S\.state\.\w+ = /g)}`);
check('页面:没有会顺手改状态的 stopVoice;advance / startSection / startReplay 不在页面里直接调', !/stopVoice\(/.test(page) && !/\badvance\(/.test(page) && !/\bstartSection\(/.test(page) && !/\bstartReplay\(/.test(page) && !/\bplayerAtEnd\(/.test(page));

done();
