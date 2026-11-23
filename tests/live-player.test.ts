/**
 * 实时老师的孩子端仲裁(runtime/delivery/player.ts 的 liveStep):表的每格一条 + 随机事件序列跑不变式。
 * 下面的 rows 列出状态与事件的预期组合;改规则先改这里,再改 liveStep。
 */
import { readFileSync } from 'node:fs';
import { initialLive, liveGate, liveStep, type LiveEffect, type LiveEvent, type LiveModel, type LiveStatus } from '../src/runtime/delivery/player.ts';
import { check, done } from './_check.ts';

const M = (status: LiveStatus, cut = false): LiveModel => ({ ...initialLive(), status, cut });
const kinds = (fx: LiveEffect[]) => fx.map((f) => (f.kind === 'gate' ? `gate:${f.on ? 'on' : 'off'}` : f.kind)).join(',');
const ALL: LiveStatus[] = ['quiet', 'holding', 'mouth', 'lecture', 'replay', 'reading'];

// ---- 表:正在…… × 来了……(一行一格)----
interface Row { name: string; from: LiveStatus | LiveStatus[]; ev: LiveEvent; want: (m: LiveModel, fx: string) => boolean; base?: Partial<LiveModel> }
const rows: Row[] = [
  { name: '安静 + 按住说话 → 告诉服务端 hold,孩子按着', from: 'quiet', ev: { type: 'press' }, want: (m, fx) => m.status === 'holding' && fx === 'hold' && !m.cut },
  { name: '嘴在说 + 按住说话 → 嘴没放完的清掉,hold;那句记成被打断', from: 'mouth', ev: { type: 'press' }, want: (m, fx) => m.status === 'holding' && fx === 'flush,hold' && m.cut },
  { name: '孩子按着 + 松手 → release,安静等嘴', from: 'holding', ev: { type: 'release' }, want: (m, fx) => m.status === 'quiet' && fx === 'release' },
  { name: '孩子按着 + 上滑松手 → hush(这一下作废),安静', from: 'holding', ev: { type: 'cancel' }, want: (m, fx) => m.status === 'quiet' && fx === 'hush' },
  { name: '没按着 + 松手 / 上滑 → 什么都不做', from: ['quiet', 'mouth'], ev: { type: 'release' }, want: (_m, fx) => fx === '' },
  { name: '孩子按着 + 嘴的声音到了(按下前在路上的)→ 丢掉', from: 'holding', ev: { type: 'audio' }, want: (m, fx) => m.status === 'holding' && fx === '' },
  { name: '安静 + 嘴的声音到了 → 放,嘴在说', from: 'quiet', ev: { type: 'audio' }, want: (m, fx) => m.status === 'mouth' && fx === 'enqueue,render' },
  { name: '嘴在说 + 又一块声音 → 接着排', from: 'mouth', ev: { type: 'audio' }, want: (m, fx) => m.status === 'mouth' && fx === 'enqueue' },
  { name: '被打断后嘴再出声 → 字幕不再标被打断', from: 'quiet', ev: { type: 'audio' }, want: (m) => !m.cut },
  { name: '嘴在说 + 放完了 → 安静', from: 'mouth', ev: { type: 'drained' }, want: (m, fx) => m.status === 'quiet' && fx === 'render' },
  { name: '嘴在说 + 放完了、刚念完的那句 [[play]] 到能放的小课堂 → 铺满放那一段,在放小课堂', from: 'mouth', ev: { type: 'drained', play: 'open' }, want: (m, fx) => m.status === 'lecture' && fx === 'openLecture,render' },
  { name: '嘴在说 + 放完了、那句 [[play]] 的小课堂放不了 → staged(服务端接着交),安静', from: 'mouth', ev: { type: 'drained', play: 'skip' }, want: (m, fx) => m.status === 'quiet' && fx === 'staged,render' },
  { name: '在放小课堂 + 那一段放完 / 孩子关了 → staged,安静', from: 'lecture', ev: { type: 'lectureDone' }, want: (m, fx) => m.status === 'quiet' && fx === 'staged,render' },
  { name: '没在放小课堂 + 放完 / 关了(按下时已经停了)→ 什么都不做', from: ['quiet', 'holding', 'mouth'], ev: { type: 'lectureDone' }, want: (_m, fx) => fx === '' },
  { name: '在放小课堂 + 按住说话 → 那一段停下,hold', from: 'lecture', ev: { type: 'press' }, want: (m, fx) => m.status === 'holding' && fx === 'stopLecture,hold' && !m.cut },
  { name: '在放小课堂 + 打字发出 → 那一段停下,send', from: 'lecture', ev: { type: 'send' }, want: (m, fx) => m.status === 'quiet' && fx === 'stopLecture,send,render' },
  { name: '在放小课堂 + 嘴的声音到了 → 那一段停下,放嘴的', from: 'lecture', ev: { type: 'audio' }, want: (m, fx) => m.status === 'mouth' && fx === 'stopLecture,enqueue,render' },
  { name: '嘴在说 + 服务端 flush → 清掉没放的,安静', from: 'mouth', ev: { type: 'flush' }, want: (m, fx) => m.status === 'quiet' && fx === 'flush,render' },
  // ---- 字幕重放:家长提醒着用,什么都不告诉服务端 ----
  { name: '安静、脑不在写 + 点「再听一遍」→ 放这一轮嘴照念过的声音,在重放', from: 'quiet', ev: { type: 'replay' }, want: (m, fx) => m.status === 'replay' && fx === 'playReplay,render' },
  { name: '脑在写 + 点「再听一遍」→ 不响', from: 'quiet', ev: { type: 'replay', pending: true }, want: (m, fx) => m.status === 'quiet' && fx === '' },
  { name: '嘴在说 / 孩子按着 / 在放小课堂 / 在重放 + 点「再听一遍」→ 不响', from: ['mouth', 'holding', 'lecture', 'replay'], ev: { type: 'replay' }, want: (_m, fx) => fx === '' },
  { name: '在重放 + 放完 → 安静', from: 'replay', ev: { type: 'replayEnded' }, want: (m, fx) => m.status === 'quiet' && fx === 'render' },
  { name: '在重放 + 点「停」→ 重放停,安静', from: 'replay', ev: { type: 'replayStop' }, want: (m, fx) => m.status === 'quiet' && fx === 'stopReplay,render' },
  { name: '没在重放 + 放完 / 点停(已经停了)→ 什么都不做', from: ['quiet', 'holding', 'mouth', 'lecture'], ev: { type: 'replayStop' }, want: (_m, fx) => fx === '' },
  { name: '在重放 + 按住说话 → 重放停,hold', from: 'replay', ev: { type: 'press' }, want: (m, fx) => m.status === 'holding' && fx === 'stopReplay,hold' && !m.cut },
  { name: '在重放 + 打字发出 / 交答案 / 发照片 → 重放停,send', from: 'replay', ev: { type: 'send' }, want: (m, fx) => m.status === 'quiet' && fx === 'stopReplay,send,render' },
  { name: '在重放 + 嘴的声音到了 → 重放停,放嘴的', from: 'replay', ev: { type: 'audio' }, want: (m, fx) => m.status === 'mouth' && fx === 'stopReplay,enqueue,render' },
  { name: '在重放 + 服务端 flush(嘴没在放)→ 接着放', from: 'replay', ev: { type: 'flush' }, want: (m, fx) => m.status === 'replay' && fx === 'flush' },
  { name: '一直听 + 点「再听一遍」→ 不推了(重放的老师声音别进麦)', from: 'quiet', base: { open: true }, ev: { type: 'replay' }, want: (m, fx) => m.status === 'replay' && fx === 'playReplay,render,gate:off' },
  { name: '一直听、在重放 + 放完 → 接着推', from: 'replay', base: { open: true }, ev: { type: 'replayEnded' }, want: (m, fx) => m.status === 'quiet' && fx === 'render,gate:on' },
  { name: '嘴在说 + 打字发出 / 交答案 → 嘴没放完的清掉,send(舞台开着带 focus)', from: 'mouth', ev: { type: 'send' }, want: (m, fx) => m.status === 'quiet' && fx === 'flush,send,render' && m.cut },
  { name: '安静 + 打字发出 / 交答案 / 发照片 → send', from: 'quiet', ev: { type: 'send' }, want: (m, fx) => m.status === 'quiet' && fx === 'send,render' },
  { name: '(两根手指)按着 + 交答案 → 先 hush 那一下,再 send', from: 'holding', ev: { type: 'send' }, want: (m, fx) => m.status === 'quiet' && fx === 'hush,send,render' },
  { name: '任何 + 连不上 / 断了 → 声音清掉,过一会儿再连(不回板书)', from: ALL, ev: { type: 'drop' }, want: (m, fx) => m.status === 'quiet' && !m.turn && fx === 'flush,stopLecture,stopReplay,stopRead,retry' },
  { name: '任何 + 换老师 / 关老师页 → 声音清掉', from: ALL, ev: { type: 'reset' }, want: (m, fx) => m.status === 'quiet' && !m.turn && fx === 'flush,stopLecture,stopReplay,stopRead' },
  // ---- 一直听 ----
  { name: '按住说 + 点「一直听」→ listen,开始推声音', from: 'quiet', ev: { type: 'listen', open: true }, want: (m, fx) => m.open && fx === 'listen,render,gate:on' },
  { name: '一直听 + 点掉「一直听」→ listen,不推了', from: 'quiet', base: { open: true }, ev: { type: 'listen', open: false }, want: (m, fx) => !m.open && fx === 'listen,render,gate:off' },
  { name: '一直听、压低着 + 点掉「一直听」→ 音量恢复', from: 'mouth', base: { open: true, ducked: true }, ev: { type: 'listen', open: false }, want: (m, fx) => !m.ducked && fx === 'listen,unduck,render,gate:off' },
  { name: '按着说话时点「一直听」→ 那一下作废(hush),换模式', from: 'holding', ev: { type: 'listen', open: true }, want: (m, fx) => m.status === 'quiet' && m.open && fx === 'hush,listen,render,gate:on' },
  { name: '一直听 + 按输入条 → 不接', from: ['quiet', 'mouth'], base: { open: true }, ev: { type: 'press' }, want: (m, fx) => m.status !== 'holding' && fx === '' },
  { name: '一直听 + 点胶囊关麦 → 不推了', from: ['quiet', 'mouth'], base: { open: true }, ev: { type: 'mute' }, want: (m, fx) => m.muted && fx === 'render,gate:off' },
  { name: '一直听、关着麦 + 点胶囊 → 接着推', from: 'quiet', base: { open: true, muted: true }, ev: { type: 'unmute' }, want: (m, fx) => !m.muted && fx === 'render,gate:on' },
  { name: '一直听 + 服务端 vad 开 → 在听你说(不改谁出声)', from: ['quiet', 'mouth'], base: { open: true }, ev: { type: 'vad', on: true }, want: (m, fx) => m.hearing && fx === 'render' },
  { name: '一直听、在听你说 + 服务端 vad 关 → 回到我在听', from: 'quiet', base: { open: true, hearing: true }, ev: { type: 'vad', on: false }, want: (m, fx) => !m.hearing && fx === 'render' },
  { name: '按住说 + 服务端 vad(换连接前的)→ 不理', from: 'quiet', ev: { type: 'vad', on: true }, want: (m, fx) => !m.hearing && fx === '' },
  { name: '嘴在说 + 服务端 duck → 嘴的声音压到三成', from: 'mouth', base: { open: true }, ev: { type: 'duck' }, want: (m, fx) => m.ducked && m.status === 'mouth' && fx === 'duck' },
  { name: '压低着 + 服务端 unduck → 恢复', from: 'mouth', base: { open: true, ducked: true }, ev: { type: 'unduck' }, want: (m, fx) => !m.ducked && fx === 'unduck' },
  { name: '压低着 + 服务端 flush → 清掉、恢复,安静', from: 'mouth', base: { open: true, ducked: true }, ev: { type: 'flush' }, want: (m, fx) => !m.ducked && m.status === 'quiet' && fx === 'flush,unduck,render' },
  { name: '一直听、嘴在说 + 放完到 [[play]] 的小课堂 → 放那一段、不推了', from: 'mouth', base: { open: true }, ev: { type: 'drained', play: 'open' }, want: (m, fx) => m.status === 'lecture' && fx === 'openLecture,render,gate:off' },
  { name: '一直听、在放小课堂 + 那一段放完 → staged、接着推', from: 'lecture', base: { open: true }, ev: { type: 'lectureDone' }, want: (_m, fx) => fx === 'staged,render,gate:on' },
  // ---- 点读:孩子点了课本上标题、段首的钮,孩子端放这一课的配音(一句一句);孩子点的,嘴、小课堂、重放都让它 ----
  { name: '安静 + 点了段首的钮 → 读,在点读', from: 'quiet', ev: { type: 'read' }, want: (m, fx) => m.status === 'reading' && fx === 'playRead,render' },
  { name: '嘴在说 + 点了段首的钮 → 嘴没放完的清掉、告诉服务端停下(hush),读;那句记成被打断', from: 'mouth', ev: { type: 'read' }, want: (m, fx) => m.status === 'reading' && fx === 'flush,hush,playRead,render' && m.cut },
  { name: '在放小课堂 + 点了段首的钮 → 那一段停下、告诉服务端停下,读', from: 'lecture', ev: { type: 'read' }, want: (m, fx) => m.status === 'reading' && fx === 'stopLecture,hush,playRead,render' },
  { name: '在重放 + 点了段首的钮 → 重放停,读', from: 'replay', ev: { type: 'read' }, want: (m, fx) => m.status === 'reading' && fx === 'stopReplay,playRead,render' },
  { name: '孩子按着 + 点了段首的钮 → 不接', from: 'holding', ev: { type: 'read' }, want: (m, fx) => m.status === 'holding' && fx === '' },
  { name: '在点读 + 点了另一段的钮 → 从那一段读', from: 'reading', ev: { type: 'read' }, want: (m, fx) => m.status === 'reading' && fx === 'playRead' },
  { name: '在点读 + 点暂停 → 停,安静', from: 'reading', ev: { type: 'readStop' }, want: (m, fx) => m.status === 'quiet' && fx === 'stopRead,render' },
  { name: '在点读 + 读完了 → 安静', from: 'reading', ev: { type: 'readEnded' }, want: (m, fx) => m.status === 'quiet' && fx === 'render' },
  { name: '没在点读 + 点暂停 / 读完了(已经停了)→ 什么都不做', from: ['quiet', 'holding', 'mouth', 'lecture', 'replay'], ev: { type: 'readStop' }, want: (_m, fx) => fx === '' },
  { name: '在点读 + 按住说话 → 读停下,hold', from: 'reading', ev: { type: 'press' }, want: (m, fx) => m.status === 'holding' && fx === 'stopRead,hold' && !m.cut },
  { name: '在点读 + 打字发出 / 给老师看 → 读停下,send', from: 'reading', ev: { type: 'send' }, want: (m, fx) => m.status === 'quiet' && fx === 'stopRead,send,render' },
  { name: '在点读 + 嘴的声音到了 → 读停下,放嘴的', from: 'reading', ev: { type: 'audio' }, want: (m, fx) => m.status === 'mouth' && fx === 'stopRead,enqueue,render' },
  { name: '在点读 + 服务端 flush(嘴没在放)→ 接着读', from: 'reading', ev: { type: 'flush' }, want: (m, fx) => m.status === 'reading' && fx === 'flush' },
  { name: '在点读 + 点「再听一遍」→ 不响', from: 'reading', ev: { type: 'replay' }, want: (m, fx) => m.status === 'reading' && fx === '' },
  { name: '等孩子跟 + 点了段首的钮 → 光收,读', from: 'quiet', base: { turn: true }, ev: { type: 'read' }, want: (m, fx) => m.status === 'reading' && !m.turn && fx === 'playRead,render' },
  { name: '一直听 + 点了段首的钮 → 不推了(配音别进麦)', from: 'quiet', base: { open: true }, ev: { type: 'read' }, want: (m, fx) => m.status === 'reading' && fx === 'playRead,render,gate:off' },
  { name: '一直听、在点读 + 读完了 → 接着推', from: 'reading', base: { open: true }, ev: { type: 'readEnded' }, want: (m, fx) => m.status === 'quiet' && fx === 'render,gate:on' },
  // ---- 请孩子说:[[请 说 …]] 那句放完等他说 ----
  { name: '嘴在说 + 放完了、刚念完的那句是请他说的 [[请 说 …]] → 安静,轮到他', from: 'mouth', ev: { type: 'drained', echo: true }, want: (m, fx) => m.status === 'quiet' && m.turn && fx === 'render' },
  { name: '等孩子跟 + 服务端 vad 开 → 光变实(在听你说)', from: 'quiet', base: { open: true, turn: true }, ev: { type: 'vad', on: true }, want: (m, fx) => m.turn && m.hearing && fx === 'render' },
  { name: '等孩子跟 + 嘴的声音到了(下一拍)→ 光收,放嘴的', from: 'quiet', base: { turn: true }, ev: { type: 'audio' }, want: (m, fx) => m.status === 'mouth' && !m.turn && fx === 'enqueue,render' },
  { name: '等孩子跟 + 打字发出 → 光收,send', from: 'quiet', base: { turn: true }, ev: { type: 'send' }, want: (m, fx) => !m.turn && fx === 'send,render' },
  { name: '等孩子跟 + 服务端 flush → 光收', from: 'quiet', base: { turn: true }, ev: { type: 'flush' }, want: (m, fx) => !m.turn && fx === 'flush,render' },
  { name: '等孩子跟 + 按住说话 → 光留着(他在跟),hold', from: 'quiet', base: { turn: true }, ev: { type: 'press' }, want: (m, fx) => m.status === 'holding' && m.turn && fx === 'hold' },
];
for (const r of rows) {
  for (const st of Array.isArray(r.from) ? r.from : [r.from]) {
    const out = liveStep({ ...M(st), ...r.base }, r.ev);
    check(`表:${r.name}${Array.isArray(r.from) ? `(${st})` : ''}`, r.want(out.model, kinds(out.effects)), `${JSON.stringify(out.model)} | ${kinds(out.effects)}`);
  }
}

// ---- 随机事件序列:模拟孩子、两样声音与服务端,每一步查不变式 ----
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const KID = new Set(['press', 'release', 'cancel', 'send', 'listen', 'read']);
const SERVER_DUCK = new Set(['duck', 'unduck', 'flush', 'listen', 'reset', 'drop']);

function run(seed: number, steps: number): string | null {
  const r = rng(seed);
  // 世界:孩子端两样声音在不在出、服务端以为孩子按没按着、孩子手指在不在按钮上
  const w = { m: initialLive(), mouth: false, lecture: false, replay: false, read: false, serverHold: false, finger: false, gate: false, ducked: false, log: [] as string[] };
  const dispatch = (ev: LiveEvent): string | null => {
    const before = w.m;
    const { model, effects } = liveStep(before, ev);
    const k = kinds(effects);
    w.log.push(`${ev.type} ${before.status}→${model.status} [${k}]`);
    // 不变式 2:状态机不替孩子发话(hold / release / hush / send 只跟着孩子的动作)
    if (effects.some((f) => f.kind === 'hold' || f.kind === 'release' || f.kind === 'hush' || f.kind === 'send') && !KID.has(ev.type)) return '状态机替孩子发了话';
    // 不变式 7:小课堂那一段只在嘴放完、刚念完 [[play]] 那句才放;staged 只在那一段放完 / 被关 / 放不了时发
    if (effects.some((f) => f.kind === 'openLecture') && !(ev.type === 'drained' && ev.play === 'open')) return '小课堂自己放了';
    if (effects.some((f) => f.kind === 'staged') && !(ev.type === 'lectureDone' || (ev.type === 'drained' && ev.play === 'skip'))) return '没放完就说 staged';
    // 不变式 8(一直听):listen 只跟着孩子点开关;一直听时没有 hold / release;duck / unduck 只跟着服务端(换模式时恢复)
    if (effects.some((f) => f.kind === 'listen') && ev.type !== 'listen') return 'listen 不是孩子点的';
    if (before.open && effects.some((f) => f.kind === 'hold' || f.kind === 'release')) return '一直听时发了 hold / release';
    if (effects.some((f) => f.kind === 'duck' || f.kind === 'unduck') && !SERVER_DUCK.has(ev.type)) return '自己压低 / 恢复了';
    // 不变式 13(重放):只在孩子点了「再听一遍」才放;重放的事件不告诉服务端任何东西
    if (effects.some((f) => f.kind === 'playReplay') && ev.type !== 'replay') return '重放自己放了';
    if ((ev.type === 'replay' || ev.type === 'replayStop' || ev.type === 'replayEnded') && effects.some((f) => f.kind === 'hold' || f.kind === 'release' || f.kind === 'hush' || f.kind === 'send' || f.kind === 'staged' || f.kind === 'listen')) return '重放告诉了服务端';
    if (ev.type === 'replay' && ev.pending && effects.length) return '脑在写时放了重放';
    // 不变式 14(点读):只在孩子点了钮才读;hush 只在点读掐断嘴、小课堂时发;点读的事件不发 hold / release / send
    if (effects.some((f) => f.kind === 'playRead') && ev.type !== 'read') return '点读自己读了';
    if (ev.type === 'read' && effects.some((f) => f.kind === 'hush') && !(before.status === 'mouth' || before.status === 'lecture')) return '点读没掐什么就 hush 了';
    if ((ev.type === 'read' || ev.type === 'readStop' || ev.type === 'readEnded') && effects.some((f) => f.kind === 'hold' || f.kind === 'release' || f.kind === 'send' || f.kind === 'staged' || f.kind === 'listen')) return '点读告诉了服务端别的';
    // 照单执行
    for (const f of effects) {
      if (f.kind === 'enqueue') { if (w.lecture) return '小课堂还在放就放了嘴的'; if (w.replay) return '重放还在放就放了嘴的'; if (w.read) return '点读还在读就放了嘴的'; w.mouth = true; }
      if (f.kind === 'playReplay') { if (w.mouth || w.lecture || w.read) return '嘴 / 小课堂 / 点读在响时放了重放'; w.replay = true; }
      if (f.kind === 'stopReplay') w.replay = false;
      if (f.kind === 'playRead') { if (w.mouth || w.lecture || w.replay) return '嘴 / 小课堂 / 重放在响时点读'; w.read = true; }
      if (f.kind === 'stopRead') w.read = false;
      if (f.kind === 'openLecture') { if (w.mouth || w.replay || w.read) return '嘴 / 重放 / 点读在响时放了小课堂'; w.lecture = true; }
      if (f.kind === 'stopLecture' || f.kind === 'staged') w.lecture = false;
      if (f.kind === 'flush') w.mouth = false;
      // 不变式 4:每次按下告诉服务端一次,之后一定跟一个 release 或 hush;release 只跟在 hold 后面
      if (f.kind === 'hold') { if (w.serverHold) return 'hold 了两次中间没有 release / hush'; w.serverHold = true; }
      if (f.kind === 'release') { if (!w.serverHold) return '没 hold 就 release'; w.serverHold = false; }
      if (f.kind === 'hush') w.serverHold = false;
      if (f.kind === 'retry') w.serverHold = false;
      // 不变式 9:gate 只在推不推变了时发
      if (f.kind === 'gate') { if (f.on === w.gate) return `gate ${f.on} 发了两次`; w.gate = f.on; }
      if (f.kind === 'duck') w.ducked = true;
      if (f.kind === 'unduck') w.ducked = false;
    }
    // 不变式 10:推不推 = 一直听、没关麦、小课堂没在放、没在重放;服务端知道的和孩子端推的一样
    const push = model.open && !model.muted && !w.lecture && !w.replay && !w.read && model.status !== 'holding';
    if (liveGate(model) !== push) return `推不推算错了(${liveGate(model)})`;
    if (liveGate(model) !== w.gate) return '孩子端推不推和告诉服务端的对不上';
    if (w.ducked !== model.ducked) return '压没压低对不上';
    if (ev.type === 'reset') w.serverHold = false; // 关页 = 连接关了
    // 不变式 5:几样声音不同时响;按着时不出声
    if (w.lecture && w.mouth) return '小课堂和嘴同时响';
    if (w.replay && (w.mouth || w.lecture)) return '重放和嘴 / 小课堂同时响';
    if (w.read && (w.mouth || w.lecture || w.replay)) return '点读和别的声音同时响';
    if (model.status === 'holding' && (w.mouth || w.lecture || w.replay || w.read)) return '按着时还在出声';
    // 不变式 6:状态说的就是在响的
    if ((model.status === 'mouth') !== w.mouth) return `状态 ${model.status} 和嘴在不在响对不上`;
    if ((model.status === 'lecture') !== w.lecture) return `状态 ${model.status} 和小课堂在不在放对不上`;
    if ((model.status === 'replay') !== w.replay) return `状态 ${model.status} 和重放在不在放对不上`;
    if ((model.status === 'reading') !== w.read) return `状态 ${model.status} 和点读在不在读对不上`;
    // 不变式 12(请他说):轮到他时嘴不在说
    if (model.turn && w.mouth) return '嘴在说时还轮到他';
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
    else if (x < 0.48) { if (!w.mouth) continue; w.mouth = false; const p = r(); ev = p < 0.45 ? { type: 'drained' } : p < 0.65 ? { type: 'drained', echo: true } : { type: 'drained', play: p < 0.88 ? 'open' : 'skip' }; }
    else if (x < 0.52) ev = { type: 'flush' };
    else if (x < 0.68) { if (w.lecture || r() < 0.1) ev = { type: 'lectureDone' }; else continue; }
    else if (x < 0.8) ev = { type: 'send' };
    else if (x < 0.89) { const p = r(); if (w.read && p < 0.3) { w.read = false; ev = { type: 'readEnded' }; } else ev = p < 0.75 ? { type: 'read' } : { type: 'readStop' }; }
    else if (x < 0.935) ev = { type: r() < 0.5 ? 'reset' : 'drop' };
    else if (x < 0.95) ev = { type: 'listen', open: r() < 0.7 };
    else if (x < 0.965) ev = { type: r() < 0.5 ? 'mute' : 'unmute' };
    else if (x < 0.975) ev = { type: 'vad', on: r() < 0.5 };
    else if (x < 0.985) ev = { type: r() < 0.6 ? 'duck' : 'unduck' };
    else { const p = r(); if (w.replay && p < 0.4) { w.replay = false; ev = { type: 'replayEnded' }; } else ev = p < 0.8 ? { type: 'replay', ...(r() < 0.3 ? { pending: true } : {}) } : { type: 'replayStop' }; }
    const bad = dispatch(ev);
    if (bad) return `种子 ${seed} 第 ${i} 步:${bad}\n  ${w.log.slice(-8).join('\n  ')}`;
  }
  return null;
}
const failures: string[] = [];
for (let seed = 1; seed <= 3000 && failures.length < 3; seed++) { const f = run(seed, 150); if (f) failures.push(f); }
check('随机事件序列 3000 条 × 150 步:不变式都成立', failures.length === 0, failures.join('\n'));

// ---- 两份状态机都内联进孩子端页面(libSource):顶层的名字撞了,后一份的函数声明会盖掉前一份(2026-10-20 live-board 的 step 盖了 kid-board 的 step,板书页整个不动)----
{
  // 原来都在 src/lib/,2026-10-29 目录归位以后各在各的模块
  const AT: Record<string, string> = { 'presentation.ts': '../src/board/presentation.ts', 'player.ts': '../src/runtime/delivery/player.ts', 'voice-view.ts': '../src/ui/kid/voice-view.ts', 'photo-edit.ts': '../src/ui/kid/photo-edit.ts', 'reel.ts': '../src/ui/kid/reel.ts' };
  const names = (f: string) => new Set([...readFileSync(new URL(AT[f], import.meta.url), 'utf8').matchAll(/^(?:export )?(?:function|const|let|class) ([A-Za-z_$][\w$]*)/gm)].map((x) => x[1]));
  const kb = names('presentation.ts');
  const both = [...names('player.ts')].filter((n) => kb.has(n));
  check('player.ts 与 presentation.ts 顶层的名字不撞', both.length === 0, both.join());
  // 孩子端页面内联的几份(kid-page.ts 的 libSource)两两不撞
  const libs = ['presentation.ts', 'player.ts', 'voice-view.ts', 'photo-edit.ts', 'reel.ts'].map((f) => [f, names(f)] as const);
  const clash = libs.flatMap(([a, na], i) => libs.slice(i + 1).flatMap(([b, nb]) => [...na].filter((n) => nb.has(n)).map((n) => `${a}/${b}:${n}`)));
  check('孩子端页面内联的几份纯函数顶层的名字两两不撞', clash.length === 0, clash.join());
}

// ---- 页面不绕过 liveStep:实时的状态只在 liveDispatch 里写 ----
const page = readFileSync(new URL('../src/ui/kid/kid-page.ts', import.meta.url), 'utf8');
const count = (re: RegExp) => (page.match(re) ?? []).length;
check('页面:LV.model 只在 liveDispatch 里写一次', count(/LV\.model = /g) === 1 && count(/LV\.model\.\w+ = /g) === 0, String(count(/LV\.model = /g)));
check('页面:卡的声音(cardSoundOk、cardTap)不在了,板书的 segment 也没了', count(/dispatch\(\{ type: 'segment' \}\)/g) === 0 && !/cardSoundOk|cardTap|cardEnded/.test(page));
check('页面:WebSocket 上发出去的 hold / release / hush / send 只在 liveDispatch 里', count(/lvSend\(\{ t: '(hold|release|hush|send)'/g) === 4 && count(/t: 'hold'/g) === 1, String(count(/lvSend\(\{ t: '(hold|release|hush|send)'/g)));

done();
