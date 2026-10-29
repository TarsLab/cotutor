#!/usr/bin/env node
/**
 * 百炼 realtime 的 300 秒没输入就关(user_idle_timeout,2026-10-19 ray 的通话里撞上):手动轮次下,只 append 静音、不 commit,能不能让它不关。
 * 真连(三条会话,几分钱,约 7 分钟),不进产品。照 Qwen-Live-Harness 的心跳:每 30 秒 append 1 秒全零 16k PCM。
 *   none   什么都不发(对照):看 error 与 close 什么时候到
 *   beat   心跳,不 clear(缓冲里攒着静音,孩子按下时 call.ts 本来就先 clear)
 *   clear  心跳后马上 clear(缓冲不攒;看 clear 了还算不算输入)
 * 到点(缺省 400 秒)后活着的会话各要一次照念「好的」,看还能不能说话。
 * 用法:node scripts/probe-live-idle.mjs [--secs 400]
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { RealtimeSession, INPUT_RATE } = await import(join(repo, 'src', 'realtime', 'bailian.ts'));
const { readCue } = await import(join(repo, 'src', 'realtime', 'cues.ts'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const secs = Number(arg('--secs', '400'));
const BEAT_MS = 30_000;
const silence = Buffer.alloc(INPUT_RATE * 2);
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const legs = ['none', 'beat', 'clear'].map((mode) => {
  const leg = { mode, errors: [], closed: null, beats: 0, said: '', audio: 0, done: null };
  leg.s = new RealtimeSession({ instructions: '你是一位老师。只照指令说话。', turn: 'manual' }, {
    onError: (m) => { leg.errors.push(`${at()}s ${m}`); console.log(`[${mode}] ${at()}s error ${m}`); },
    onClose: (r) => { leg.closed = `${at()}s ${r}`; console.log(`[${mode}] ${at()}s close ${r}`); },
    onAudio: (pcm) => { leg.audio += pcm.length; },
    onTutorText: (_d, done) => { if (done !== null) leg.said = done; },
    onResponse: (st, status) => { if (st === 'done') leg.done = status; },
  });
  return leg;
});

for (const leg of legs) {
  const why = await leg.s.connect();
  console.log(`[${leg.mode}] ${at()}s connect ${why ?? 'ok'}`);
  if (why !== null) process.exit(1);
}
const timer = setInterval(() => {
  for (const leg of legs) {
    if (leg.mode === 'none' || !leg.s.isReady) continue;
    leg.s.appendAudio(silence);
    if (leg.mode === 'clear') leg.s.clearAudio();
    leg.beats++;
  }
}, BEAT_MS);

while ((Date.now() - t0) / 1000 < secs) await sleep(1000);
clearInterval(timer);

console.log(`\n${at()}s 到点,活着的各照念一次「好的」`);
for (const leg of legs) {
  if (!leg.s.isReady) continue;
  leg.s.clearAudio();
  leg.s.createResponse(readCue(['好的。']));
}
await sleep(8000);
console.log('\n结果:');
for (const leg of legs) {
  console.log(`${leg.mode.padEnd(5)} 心跳 ${leg.beats} 次 · error ${leg.errors.length ? leg.errors.join(' | ') : '无'} · close ${leg.closed ?? '没断'} · 到点后说「${leg.said}」(${leg.done ?? '没回'},声音 ${leg.audio} 字节)`);
  leg.s.close('probe-end');
}
process.exit(0);
