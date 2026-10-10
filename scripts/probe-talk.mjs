#!/usr/bin/env node
/**
 * 口语课第一期的探针(《wip/口语课设想.md》§七 1):不开页面,服务端直连百炼 realtime 走一遍跟读 + 聊。要百炼 key 与业务空间 id(一次几分钱)。
 *   1 跟读的会话(手动轮次):塞一条「读这句」,量首音频包、整句;老师的声音存 wav
 *   2 孩子那句(macOS say 念的英文)按住 → 松手,看转写与老师怎么接
 *   3 聊的会话(semantic_vad,另一条:silence 喂过音频就改不了,见 realtime.ts):按真实节奏流一句(前后留白),看 VAD 判不判、自动回不回;老师说着插嘴
 *   4 老师的声音再交给 omni 听写(listen.ts 那条路),核对说的和字幕一致
 * 用法:node scripts/probe-talk.mjs [--voice Serena] [--keep-wav <dir>]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const voice = arg('--voice', 'Serena');
const outDir = arg('--keep-wav', mkdtempSync(join(tmpdir(), 'cotutor-probe-talk-')));
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const { RealtimeSession, OUTPUT_RATE, INPUT_RATE } = await import(join(repo, 'src', 'talk', 'realtime.ts'));
const { listenOmni } = await import(join(repo, 'src', 'server', 'listen.ts'));

// ---- 素材:say 念的英文当孩子的声音 → 16k 单声道 PCM16 ----
const enVoice = (() => { const v = execFileSync('say', ['-v', '?']).toString(); for (const name of ['Samantha', 'Karen', 'Daniel', 'Moira', 'Alex']) if (v.includes(name + ' ')) return name; return null; })();
function speech(text, tag) {
  const aiff = join(outDir, `${tag}.aiff`), wav = join(outDir, `${tag}.wav`);
  execFileSync('say', [...(enVoice ? ['-v', enVoice] : []), '-r', '150', '-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${INPUT_RATE}`, '-c', '1', aiff, wav]);
  return pcmOfWav(readFileSync(wav));
}
function pcmOfWav(buf) {
  let p = 12;
  while (p + 8 <= buf.length) { const id = buf.toString('ascii', p, p + 4), len = buf.readUInt32LE(p + 4); if (id === 'data') return buf.subarray(p + 8, p + 8 + len); p += 8 + len + (len & 1); }
  throw new Error('wav 里没有 data 块');
}
function wavOfPcm(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const silence = (ms) => Buffer.alloc(Math.round((INPUT_RATE * ms) / 1000) * 2);

const INSTRUCTIONS = `你是一位教一年级孩子的英语老师,正在和孩子 Ray 打电话。英文为主,中文为辅:每句英文都短(5 个词以内),说慢;中文只用来解释一个词、给一个台阶、收尾。
今天的口语单:red(红色)、blue(蓝色)、car(车)、bus(公共汽车);What color is it?(它是什么颜色?);It's a red car.(这是一辆红色的车。)
规矩:不说孩子错了,不打分;他读得不对就再读一遍、请他再试一次;一次只问一个问题;听不清就说 Say it again。
跟读段:我会告诉你「读这句」,你只把那句读一遍,然后等孩子;孩子读完你用一两句接(Nice! / 再来一遍),不要讲别的。`;

// ---- 一条会话,记下所有事件 ----
const log = [];
let audioChunks = [];
let firstAudioAt = null;
let t0 = 0;
const responses = [];
let tutorLines = [];
let kidLines = [];
let speech_ = [];
let errors = [];
let closed = null;
const events = {
  onAudio: (pcm) => { if (firstAudioAt === null) firstAudioAt = Date.now() - t0; audioChunks.push(pcm); },
  onTutorText: (delta, done) => { if (done !== null) tutorLines.push(done); },
  onKidText: (t) => kidLines.push(t),
  onSpeech: (s) => speech_.push([s, Date.now() - t0]),
  onResponse: (state, status, usage) => { if (state === 'done') responses.push({ status, usage, ms: Date.now() - t0 }); },
  onError: (m) => errors.push(m),
  onClose: (r) => { closed = r; },
};
let session = new RealtimeSession({ instructions: INSTRUCTIONS, voice, turn: 'manual' }, events);
const waitResponse = async (ms = 20000) => { const n = responses.length; const until = Date.now() + ms; while (responses.length === n && Date.now() < until && !closed) await sleep(20); return responses.length > n ? responses[responses.length - 1] : null; };
const takeAudio = (tag) => { const pcm = Buffer.concat(audioChunks); audioChunks = []; const f = join(outDir, `${tag}.wav`); writeFileSync(f, wavOfPcm(pcm, OUTPUT_RATE)); return { pcm, file: f, seconds: pcm.length / 2 / OUTPUT_RATE }; };

const tc = Date.now();
const why = await session.connect();
ok('跟读的会话:连上并配好(session.updated)', why === null, why ?? `${Date.now() - tc}ms,模型 ${session.model},音色 ${session.voice}`);
if (why !== null) { console.log(`${bad ? '有' : '没'}失败`); process.exit(1); }

// 1 跟读:老师读一句
t0 = Date.now(); firstAudioAt = null;
session.addText('读这句:It\'s a red car.');
session.createResponse();
let r = await waitResponse();
let a = takeAudio('1-tutor-reads');
ok('1 跟读:老师读了那句,有声音', r && r.status === 'completed' && a.seconds > 0.5, `首音频包 ${firstAudioAt}ms,整句 ${r?.ms}ms,${a.seconds.toFixed(1)} 秒声音,字幕「${tutorLines.at(-1)}」,usage ${JSON.stringify(r?.usage)}`);

// 2 孩子按住读
const kid1 = speech("It's a red car.", 'kid-1');
t0 = Date.now(); firstAudioAt = null;
for (let p = 0; p < kid1.length; p += 3200) session.appendAudio(kid1.subarray(p, p + 3200));
session.commit();
session.createResponse();
r = await waitResponse();
a = takeAudio('2-tutor-after-kid');
ok('2 跟读:孩子读完,转写出来了、老师接了一两句', r && r.status === 'completed' && kidLines.length >= 1 && a.seconds > 0.2, `孩子转写「${kidLines.at(-1)}」,老师「${tutorLines.at(-1)}」,首音频包 ${firstAudioAt}ms,整句 ${r?.ms}ms,${a.seconds.toFixed(1)} 秒`);

// 3 聊:另一条会话,semantic_vad,静音 1200
session.close();
closed = null;
session = new RealtimeSession({ instructions: INSTRUCTIONS + '\n跟读已经结束:孩子把口语单都读过一遍了,读得不错。', voice, turn: 'semantic_vad', silenceMs: 1200 }, events);
const t3 = Date.now();
const why3 = await session.connect();
const switched = why3 === null;
ok('3 聊的会话:semantic_vad 连上', switched, why3 ?? `${Date.now() - t3}ms`);
if (switched) {
  session.addText('现在用口语单上的词和孩子聊一聊,先问他一个问题。');
  session.createResponse();
  r = await waitResponse();
  a = takeAudio('3-tutor-opens-chat');
  ok('3 老师开聊,问了一个问题', r && r.status === 'completed' && a.seconds > 0.3, `老师「${tutorLines.at(-1)}」,${a.seconds.toFixed(1)} 秒`);
  // 孩子按真实节奏说一句,前后留白;不 commit,看 VAD(回答可能在还没推完留白时就到,先记下个数)
  const kid2 = Buffer.concat([silence(400), speech('Red. It is red.', 'kid-2'), silence(2500)]);
  t0 = Date.now(); firstAudioAt = null; const nKid = kidLines.length; const nSp = speech_.length; const nR = responses.length;
  for (let p = 0; p < kid2.length; p += 3200) { session.appendAudio(kid2.subarray(p, p + 3200)); await sleep(100); }
  const until = Date.now() + 15000;
  while (responses.length === nR && Date.now() < until) await sleep(20);
  r = responses.length > nR ? responses[nR] : null;
  a = takeAudio('4-tutor-vad-reply');
  const sp = speech_.slice(nSp).map(([s, ms]) => `${s}@${ms}`).join(' ');
  ok('3 VAD 判出孩子说完、自动回了', r && r.status === 'completed' && speech_.length > nSp && kidLines.length > nKid, `VAD ${sp || '没事件'};孩子转写「${kidLines.at(-1)}」;老师「${tutorLines.at(-1)}」;老师首音频包(从开始推音频算)${firstAudioAt}ms,说完 ${r?.ms}ms;${a.seconds.toFixed(1)} 秒`);
  // 插嘴:让老师讲一段长的,讲着就送孩子的声音;看服务端掐不掐(status),孩子那句认不认
  session.addText('给孩子讲一个关于 a red car 和 a blue bus 的小故事,至少十句英文,慢慢讲。');
  session.createResponse();
  await sleep(1200);
  const nResp = responses.length, nKid3 = kidLines.length, nSp3 = speech_.length;
  const kid3 = Buffer.concat([speech('Blue bus! I like the blue bus.', 'kid-3'), silence(2500)]);
  t0 = Date.now();
  for (let p = 0; p < kid3.length; p += 3200) { session.appendAudio(kid3.subarray(p, p + 3200)); await sleep(100); }
  const until3 = Date.now() + 15000;
  while (responses.length < nResp + 2 && Date.now() < until3) await sleep(20);
  const cut = responses.slice(nResp);
  a = takeAudio('5-tutor-interrupted');
  const sp3 = speech_.slice(nSp3).map(([s, ms]) => `${s}@${ms}`).join(' ');
  ok('3 插嘴:老师讲着被掐(有 cancelled / incomplete),孩子那句认了、老师又接了', cut.some((x) => x.status !== 'completed') && kidLines.length > nKid3 && cut.length >= 2, `回答状态 ${cut.map((x) => x.status).join(',')};VAD ${sp3 || '没事件'};孩子「${kidLines.at(-1)}」;老师最后「${tutorLines.at(-1)}」;${a.seconds.toFixed(1)} 秒声音`);
}

// 4 老师的声音再听写,核对字幕
const heard = await listenOmni({ data: readFileSync(join(outDir, '1-tutor-reads.wav')), ext: 'wav' });
ok('4 老师读的那句再交给 omni 听写,和字幕一致', heard.ok && /red car/i.test(heard.text), `听写「${heard.ok ? heard.text : heard.error}」`);

session.close();
await sleep(200);
ok('没有服务端报错', errors.length === 0, errors.join(' | '));
const totalIn = responses.reduce((s, x) => s + (x.usage?.input ?? 0), 0), totalOut = responses.reduce((s, x) => s + (x.usage?.output ?? 0), 0);
console.log(`\n${responses.length} 次回答,token 输入 ${totalIn} 输出 ${totalOut};声音在 ${outDir}(afplay 听)`);
console.log(`老师说过的:\n${tutorLines.map((l) => '  ' + l).join('\n')}\n孩子转写:\n${kidLines.map((l) => '  ' + l).join('\n')}`);
process.exit(bad ? 1 : 0);
