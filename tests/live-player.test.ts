/**
 * 实时老师的孩子端仲裁(live-board.ts 的 liveStep):表的每格一条 + 随机事件序列跑不变式。
 * 表的中文版在《工作流程.md》§孩子端「实时老师」;改规则先改表、再改这里、最后改 liveStep。
 */
import { readFileSync } from 'node:fs';
import { initialLive, liveStep, type LiveEffect, type LiveEvent, type LiveModel, type LiveStatus } from '../src/lib/live-board.ts';
import { check, done } from './_check.ts';

const M = (status: LiveStatus, cut = false): LiveModel => ({ ...initialLive(), status, cut });
const kinds = (fx: LiveEffect[]) => fx.map((f) => f.kind).join(',');
const ALL: LiveStatus[] = ['quiet', 'holding', 'mouth', 'card', 'recording'];

// ---- 表:正在…… × 来了……(一行一格)----
interface Row { name: string; from: LiveStatus | LiveStatus[]; ev: LiveEvent; want: (m: LiveModel, fx: string) => boolean }
const rows: Row[] = [
  { name: '安静 + 按住说话 → 告诉服务端 hold,孩子按着', from: 'quiet', ev: { type: 'press' }, want: (m, fx) => m.status === 'holding' && fx === 'hold' && !m.cut },
  { name: '嘴在说 + 按住说话 → 嘴没放完的清掉,hold;那句记成被打断', from: 'mouth', ev: { type: 'press' }, want: (m, fx) => m.status === 'holding' && fx === 'flush,hold' && m.cut },
  { name: '卡在念 + 按住说话 → 卡的声音停,hold', from: 'card', ev: { type: 'press' }, want: (m, fx) => m.status === 'holding' && fx === 'stopCard,hold' && !m.cut },
  { name: '在录 + 按输入条 → 不接(录音卡自己的键在录)', from: 'recording', ev: { type: 'press' }, want: (m, fx) => m.status === 'recording' && fx === '' },
  { name: '孩子按着 + 松手 → release,安静等嘴', from: 'holding', ev: { type: 'release' }, want: (m, fx) => m.status === 'quiet' && fx === 'release' },
  { name: '孩子按着 + 上滑松手 → hush(这一下作废),安静', from: 'holding', ev: { type: 'cancel' }, want: (m, fx) => m.status === 'quiet' && fx === 'hush' },
  { name: '没按着 + 松手 / 上滑 → 什么都不做', from: ['quiet', 'mouth', 'card', 'recording'], ev: { type: 'release' }, want: (_m, fx) => fx === '' },
  { name: '孩子按着 + 嘴的声音到了(按下前在路上的)→ 丢掉', from: 'holding', ev: { type: 'audio' }, want: (m, fx) => m.status === 'holding' && fx === '' },
  { name: '在录 + 嘴的声音到了 → 丢掉', from: 'recording', ev: { type: 'audio' }, want: (m, fx) => m.status === 'recording' && fx === '' },
  { name: '安静 + 嘴的声音到了 → 放,嘴在说', from: 'quiet', ev: { type: 'audio' }, want: (m, fx) => m.status === 'mouth' && fx === 'enqueue,render' },
  { name: '卡在念 + 嘴的声音到了 → 卡先停,再放嘴的', from: 'card', ev: { type: 'audio' }, want: (m, fx) => m.status === 'mouth' && fx === 'stopCard,enqueue,render' },
  { name: '嘴在说 + 又一块声音 → 接着排', from: 'mouth', ev: { type: 'audio' }, want: (m, fx) => m.status === 'mouth' && fx === 'enqueue' },
  { name: '被打断后嘴再出声 → 字幕不再标被打断', from: 'quiet', ev: { type: 'audio' }, want: (m) => !m.cut },
  { name: '嘴在说 + 放完了 → 安静', from: 'mouth', ev: { type: 'drained' }, want: (m, fx) => m.status === 'quiet' && fx === 'render' },
  { name: '嘴在说 + 服务端 flush → 清掉没放的,安静', from: 'mouth', ev: { type: 'flush' }, want: (m, fx) => m.status === 'quiet' && fx === 'flush,render' },
  { name: '嘴在说 / 孩子按着 / 在录 + 点卡上的声音 → 不响', from: ['mouth', 'holding', 'recording'], ev: { type: 'cardTap' }, want: (_m, fx) => fx === '' },
  { name: '安静 + 点卡上的声音 → 念它,卡在念', from: 'quiet', ev: { type: 'cardTap' }, want: (m, fx) => m.status === 'card' && fx === 'playCard' },
  { name: '卡在念 + 点卡上的(另一个)声音 → 换成这个', from: 'card', ev: { type: 'cardTap' }, want: (m, fx) => m.status === 'card' && fx === 'playCard' },
  { name: '卡在念 + 念完 → 安静', from: 'card', ev: { type: 'cardEnded' }, want: (m, fx) => m.status === 'quiet' && fx === '' },
  { name: '嘴在说 + 点卡上的「?」→ 嘴没放完的清掉,send(ask + focus)', from: 'mouth', ev: { type: 'ask' }, want: (m, fx) => m.status === 'quiet' && fx === 'flush,send,render' && m.cut },
  { name: '卡在念 + 点「?」→ 卡的声音停,send', from: 'card', ev: { type: 'ask' }, want: (m, fx) => m.status === 'quiet' && fx === 'stopCard,send,render' },
  { name: '安静 + 打字发出 / 交答案 / 发照片 → send', from: 'quiet', ev: { type: 'send' }, want: (m, fx) => m.status === 'quiet' && fx === 'send,render' },
  { name: '(两根手指)按着 + 点「?」→ 先 hush 那一下,再 send', from: 'holding', ev: { type: 'ask' }, want: (m, fx) => m.status === 'quiet' && fx === 'hush,send,render' },
  { name: '任何 + 卡铺上来、老师写完 → 不出声、不打断谁', from: ALL, ev: { type: 'cards' }, want: (_m, fx) => fx === '' },
  { name: '任何 + 开舞台 / 关舞台 / 拿起相机 → 嘴接着说', from: ALL, ev: { type: 'stage' }, want: (_m, fx) => fx === '' },
  { name: '嘴在说 + 按下录音键 → 嘴没放完的清掉、hush,在录', from: 'mouth', ev: { type: 'recStart' }, want: (m, fx) => m.status === 'recording' && fx === 'flush,hush,render' },
  { name: '安静 + 按下录音键 → hush(脑还在写的不再念),在录', from: 'quiet', ev: { type: 'recStart' }, want: (m, fx) => m.status === 'recording' && fx === 'hush,render' },
  { name: '在录 + 停录 → 安静', from: 'recording', ev: { type: 'recEnd' }, want: (m, fx) => m.status === 'quiet' && fx === 'render' },
  { name: '任何 + 连不上 / 断了 → 声音清掉,回到板书', from: ALL, ev: { type: 'drop' }, want: (m, fx) => m.status === 'quiet' && fx === 'flush,stopCard,board' },
  { name: '任何 + 换老师 / 关老师页 → 声音清掉', from: ALL, ev: { type: 'reset' }, want: (m, fx) => m.status === 'quiet' && fx === 'flush,stopCard' },
];
for (const r of rows) {
  for (const st of Array.isArray(r.from) ? r.from : [r.from]) {
    const out = liveStep(M(st), r.ev);
    check(`表:${r.name}${Array.isArray(r.from) ? `(${st})` : ''}`, r.want(out.model, kinds(out.effects)), `${JSON.stringify(out.model)} | ${kinds(out.effects)}`);
  }
}

// ---- 随机事件序列:模拟孩子、两样声音与服务端,每一步查不变式 ----
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const KID = new Set(['press', 'release', 'cancel', 'ask', 'send', 'recStart']);

function run(seed: number, steps: number): string | null {
  const r = rng(seed);
  // 世界:孩子端两样声音在不在出、服务端以为孩子按没按着、孩子手指在不在按钮上
  const w = { m: initialLive(), mouth: false, card: false, serverHold: false, finger: false, log: [] as string[] };
  const dispatch = (ev: LiveEvent): string | null => {
    const before = w.m;
    const { model, effects } = liveStep(before, ev);
    const k = kinds(effects);
    w.log.push(`${ev.type} ${before.status}→${model.status} [${k}]`);
    // 不变式 1:卡的声音只在孩子点了才响
    if (effects.some((f) => f.kind === 'playCard') && ev.type !== 'cardTap') return '卡的声音自己响了';
    // 不变式 2:状态机不替孩子发话(hold / release / hush / send 只跟着孩子的动作)
    if (effects.some((f) => f.kind === 'hold' || f.kind === 'release' || f.kind === 'hush' || f.kind === 'send') && !KID.has(ev.type)) return '状态机替孩子发了话';
    // 不变式 3:卡铺上来、开舞台不打断谁
    if ((ev.type === 'cards' || ev.type === 'stage') && effects.length) return '卡铺上来 / 开舞台动了声音';
    // 照单执行
    for (const f of effects) {
      if (f.kind === 'enqueue') { if (w.card) return '卡还在念就放了嘴的'; w.mouth = true; }
      if (f.kind === 'flush') w.mouth = false;
      if (f.kind === 'stopCard') w.card = false;
      if (f.kind === 'playCard') { if (w.mouth) return '嘴在说时念了卡'; w.card = true; }
      // 不变式 4:每次按下告诉服务端一次,之后一定跟一个 release 或 hush;release 只跟在 hold 后面
      if (f.kind === 'hold') { if (w.serverHold) return 'hold 了两次中间没有 release / hush'; w.serverHold = true; }
      if (f.kind === 'release') { if (!w.serverHold) return '没 hold 就 release'; w.serverHold = false; }
      if (f.kind === 'hush') w.serverHold = false;
      if (f.kind === 'board') w.serverHold = false;
    }
    if (ev.type === 'reset') w.serverHold = false; // 关页 = 连接关了
    // 不变式 5:两样声音不同时响;按着、在录时不出声
    if (w.mouth && w.card) return '嘴和卡同时响';
    if ((model.status === 'holding' || model.status === 'recording') && (w.mouth || w.card)) return '按着 / 在录时还在出声';
    // 不变式 6:状态说的就是在响的
    if ((model.status === 'mouth') !== w.mouth) return `状态 ${model.status} 和嘴在不在响对不上`;
    if ((model.status === 'card') !== w.card) return `状态 ${model.status} 和卡在不在响对不上`;
    if (w.serverHold && model.status !== 'holding') return '服务端以为按着,孩子端不在按着';
    w.m = model;
    return null;
  };
  for (let i = 0; i < steps; i++) {
    const x = r();
    let ev: LiveEvent;
    if (x < 0.1) { ev = { type: 'press' }; w.finger = true; }
    else if (x < 0.18) { ev = { type: r() < 0.75 ? 'release' : 'cancel' }; w.finger = false; }
    else if (x < 0.4) ev = { type: 'audio' };
    else if (x < 0.48) { if (!w.mouth) continue; w.mouth = false; ev = { type: 'drained' }; }
    else if (x < 0.52) ev = { type: 'flush' };
    else if (x < 0.62) ev = { type: 'cardTap' };
    else if (x < 0.68) { if (!w.card) continue; w.card = false; ev = { type: 'cardEnded' }; }
    else if (x < 0.72) ev = { type: r() < 0.5 ? 'ask' : 'send' };
    else if (x < 0.8) ev = { type: 'cards' };
    else if (x < 0.85) ev = { type: 'stage' };
    else if (x < 0.89) ev = { type: 'recStart' };
    else if (x < 0.94) ev = { type: 'recEnd' };
    else if (x < 0.97) ev = { type: 'reset' };
    else ev = { type: 'drop' };
    const bad = dispatch(ev);
    if (bad) return `种子 ${seed} 第 ${i} 步:${bad}\n  ${w.log.slice(-8).join('\n  ')}`;
  }
  return null;
}
const failures: string[] = [];
for (let seed = 1; seed <= 3000 && failures.length < 3; seed++) { const f = run(seed, 150); if (f) failures.push(f); }
check('随机事件序列 3000 条 × 150 步:不变式都成立', failures.length === 0, failures.join('\n'));

// ---- 页面不绕过 liveStep:实时的状态只在 liveDispatch 里写;卡上的声音都先过 cardSoundOk(板书时那里停讲稿,实时时问 liveStep)----
const page = readFileSync(new URL('../src/server/kid-page.ts', import.meta.url), 'utf8');
const count = (re: RegExp) => (page.match(re) ?? []).length;
check('页面:LV.model 只在 liveDispatch 里写一次', count(/LV\.model = /g) === 1 && count(/LV\.model\.\w+ = /g) === 0, String(count(/LV\.model = /g)));
check('页面:卡上的声音(点读、单词、示范、回放)都先过 cardSoundOk;segment 只剩它里面那一处', count(/dispatch\(\{ type: 'segment' \}\)/g) === 1 && count(/cardSoundOk\(\)/g) === 4, `${count(/dispatch\(\{ type: 'segment' \}\)/g)} ${count(/cardSoundOk\(\)/g)}`);
check('页面:WebSocket 上发出去的 hold / release / hush / send 只在 liveDispatch 里', count(/lvSend\(\{ t: '(hold|release|hush|send)'/g) === 4 && count(/t: 'hold'/g) === 1, String(count(/lvSend\(\{ t: '(hold|release|hush|send)'/g)));

done();
