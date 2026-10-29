/**
 * 板上的节(board/presentation.ts 的 step):表一格一条 + 随机事件序列跑不变式 + 页面不绕过 step。
 * 孩子端不念讲稿了:讲稿由嘴照念(runtime/delivery/player.ts,tests/live-player.test.ts),这里只剩铺节、画标注、写完、撤掉。
 * 下面的测试列出状态与事件的预期组合;改规则先改这里,再改 step。
 */
import { readFileSync } from 'node:fs';
import {
  initialPlayer,
  isQuestion,
  playerAtEnd,
  step,
  type BoardCard,
  type BoardLine,
  type BoardSection,
  type PlayerEffect,
  type PlayerEvent,
  type PlayerModel,
  type PlayerState,
} from '../src/board/presentation.ts';
import { check, done } from './_check.ts';

const L = (text: string, anchor: number | null): BoardLine => ({ text, audio: null, marks: [], ask: isQuestion(text), anchor, cues: [] });
const text = (t: string): BoardCard => ({ kind: 'text', props: { text: t } });
/** 讲完的一节:末句问句 */
const done0: BoardSection = { cards: [text('a'), text('b')], lines: [L('一', 0), L('二', 0), L('三?', 1)] };
/** 讲完的一节:末句不是问句 */
const said: BoardSection = { cards: [text('c')], lines: [L('四', 0), L('五', 0)] };
/** 老师还在写 */
const live: BoardSection = { cards: [text('d'), text('e')], lines: [L('六', 0), L('七', 1)], partial: true, ready: 1 };

const M = (state: PlayerState): PlayerModel => ({ state });
const kinds = (fx: PlayerEffect[]) => fx.map((f) => (f.kind === 'paint' ? `paint${f.section}` : f.kind)).join(',');
const run = (model: PlayerModel, sections: BoardSection[], ev: PlayerEvent) => step(model, ev, { sections });

// ---- 表:正在…… × 来了……(一行一格)----
interface Row { name: string; model: PlayerModel; sections: BoardSection[]; ev: PlayerEvent; want: (m: PlayerModel, fx: string) => boolean }
const THINK1: PlayerState = { section: 1, line: -1, status: 'thinking' };
const rows: Row[] = [
  { name: '任何 + 换老师 → 回到开头', model: M(THINK1), sections: [done0, live], ev: { type: 'reset' }, want: (m, fx) => m.state.status === 'idle' && m.state.section === -1 && fx === '' },
  { name: '任何 + 停声音 → 只停卡的声音,位置不动', model: M(THINK1), sections: [done0, live], ev: { type: 'halt' }, want: (m, fx) => m.state === THINK1 && fx === 'stop' },
  { name: '老师开始写(流式第一拍)→ 画齐、老师在写、选中态', model: M({ section: 0, line: 2, status: 'waiting' }), sections: [done0, live], ev: { type: 'liveStart', section: 1 }, want: (m, fx) => m.state.section === 1 && m.state.status === 'thinking' && fx === 'paint1,render,showNow' },
  { name: '老师在写这节 + 又就绪一拍 → 画齐、重画字幕', model: M(THINK1), sections: [done0, live], ev: { type: 'liveBeat', section: 1 }, want: (m, fx) => m.state === THINK1 && fx === 'paint1,render' },
  { name: '不在写这节 + 就绪一拍 → 不管', model: M({ section: 0, line: 2, status: 'waiting' }), sections: [done0, live], ev: { type: 'liveBeat', section: 1 }, want: (_m, fx) => fx === '' },
  { name: '老师在写这节 + 写完(末句问句)→ 画齐、等孩子答', model: M(THINK1), sections: [done0, { ...done0 }], ev: { type: 'liveFinal', section: 1 }, want: (m, fx) => m.state.status === 'waiting' && m.state.section === 1 && fx === 'paint1,render,showNow' },
  { name: '老师在写这节 + 写完(末句不是问句)→ 写完', model: M(THINK1), sections: [done0, said], ev: { type: 'liveFinal', section: 1 }, want: (m, fx) => m.state.status === 'done' && fx === 'paint1,render,showNow' },
  { name: '这节不在写了 + 写完 → 画齐、选中态', model: M({ section: 1, line: 1, status: 'done' }), sections: [done0, said], ev: { type: 'liveFinal', section: 1 }, want: (m, fx) => m.state.status === 'done' && fx === 'paint1,showNow' },
  { name: '别的节 + 写完 → 只画齐', model: M({ section: 0, line: 2, status: 'waiting' }), sections: [done0, said], ev: { type: 'liveFinal', section: 1 }, want: (m, fx) => m.state.section === 0 && fx === 'paint1' },
  { name: '老师出错撤掉 → 停声音、停在末尾', model: M(THINK1), sections: [done0], ev: { type: 'liveDropped' }, want: (m, fx) => m.state.status === 'waiting' && m.state.section === 0 && fx === 'stop,render' },
  { name: '整节到了(没流过)→ 画齐、停在末尾、滚到最后一节', model: M({ section: -1, line: -1, status: 'idle' }), sections: [done0, said], ev: { type: 'fresh', sections: [0, 1] }, want: (m, fx) => m.state.status === 'done' && m.state.section === 1 && fx === 'paint0,paint1,render,showNow,scrollLast' },
  { name: '整节到了但是空的 → 不管', model: M(THINK1), sections: [done0], ev: { type: 'fresh', sections: [] }, want: (m, fx) => m.state === THINK1 && fx === '' },
];
for (const r of rows) {
  const out = run(r.model, r.sections, r.ev);
  check(r.name, r.want(out.model, kinds(out.effects)), JSON.stringify({ state: out.model.state, fx: kinds(out.effects) }));
}

check('打开页面的位置:没节 → idle;末句问句 → 等;否则写完', playerAtEnd([]).status === 'idle' && playerAtEnd([done0]).status === 'waiting' && playerAtEnd([done0, said]).status === 'done');

// ---- 随机事件序列:状态总是合法的(节的下标在范围里;等答只在末句问句时;只有 halt / 撤掉出 stop)----
function rnd(seed: number) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
function fuzz(seed: number): string | null {
  const r = rnd(seed);
  let sections: BoardSection[] = [];
  let m = initialPlayer();
  for (let k = 0; k < 80; k++) {
    const y = r();
    let ev: PlayerEvent;
    if (y < 0.2) { sections = [...sections, { ...live }]; ev = { type: 'liveStart', section: sections.length - 1 }; }
    else if (y < 0.35 && sections.length) ev = { type: 'liveBeat', section: Math.floor(r() * sections.length) };
    else if (y < 0.55 && sections.length && sections[sections.length - 1].partial) { const i = sections.length - 1; sections = [...sections.slice(0, i), r() < 0.5 ? done0 : said]; ev = { type: 'liveFinal', section: i }; }
    else if (y < 0.65 && sections.length && sections[sections.length - 1].partial) { sections = sections.slice(0, -1); ev = { type: 'liveDropped' }; }
    else if (y < 0.8) { sections = [...sections, r() < 0.5 ? done0 : said]; ev = { type: 'fresh', sections: [sections.length - 1] }; }
    else if (y < 0.95) ev = { type: 'halt' };
    else { sections = []; ev = { type: 'reset' }; }
    const out = step(m, ev, { sections });
    m = out.model;
    const s = m.state;
    if (s.section >= sections.length) return `种子 ${seed} 第 ${k} 步:节 ${s.section} 超出 ${sections.length}`;
    if (s.status === 'waiting' && !sections[s.section]?.lines.at(-1)?.ask) return `种子 ${seed} 第 ${k} 步:末句不是问句却在等`;
    if (s.status === 'playing') return `种子 ${seed} 第 ${k} 步:孩子端进了「在念」的状态`;
    if (out.effects.some((f) => f.kind === 'stop') && ev.type !== 'halt' && ev.type !== 'liveDropped') return `种子 ${seed} 第 ${k} 步:${ev.type} 停了声音`;
  }
  return null;
}
const failures: string[] = [];
for (let seed = 1; seed <= 2000 && failures.length < 3; seed++) { const f = fuzz(seed); if (f) failures.push(f); }
check('随机事件序列 2000 条 × 80 步:状态合法、不进「在念」、只有 halt 与撤掉停声音', failures.length === 0, failures.join('\n'));

// ---- 页面不绕过 step;念讲稿的那些都不在了 ----
const page = readFileSync(new URL('../src/ui/kid/kid-page.ts', import.meta.url), 'utf8');
const count = (re: RegExp) => (page.match(re) ?? []).length;
check('页面:S.state 只在 dispatch 里写一次', count(/S\.state = /g) === 1 && count(/S\.state\.\w+ = /g) === 0, String(count(/S\.state = /g)));
check('页面:没有念讲稿、再听讲稿、自动念的开关', !/const playLine\b|[^.\w]playLine\(/.test(page) && !/\bS\.autoplay\b/.test(page) && !/\bagainBtn\b/.test(page) && !/tapAgain|tapSubtitle|tapButton|lineEnded|autoplayOff/.test(page) && !/S\.replayOf|S\.held\b|S\.unfold/.test(page) && !/id="spk"/.test(page));

done();
