#!/usr/bin/env node
/**
 * 一直听(常开麦)的第 0 步探针(《wip/实时老师常开麦设计.md》§七 A):真连百炼 realtime(几分钱),不进产品。直接走 WebSocket,事件一条不漏地记。
 *   vad    semantic_vad + create_response:false + interrupt_response:false 收不收(看 session.updated 回的 turn_detection);
 *          Ray 的真录音前后垫静音、按真时间推(100 毫秒一块):事件的顺序与时刻,说完到 speech_stopped / committed / 转写多久;不该有 response.created
 *   pause  同几段录音中间插 1.5 秒静音:semantic_vad / server_vad 各切成几句
 *   barge  嘴在念一段长的时推一段孩子的录音:interrupt_response false / true 下,那次回答会不会被服务端掐
 *   idle   推一段录音(commit 了不回答)后一直推静音 330 秒:会不会报 response_idle_timeout(约 6 分钟)
 *   口语课(《wip/口语课改实时老师设计.md》§五之二,官方博客的「实时口语陪练」):
 *   coach   跟读纠音:Ray 10-17 跟读的真原声(从 talk/2026-10-17-1106/call.wav 按 kidVoice 切)和一对 TTS(bus / boss),手动轮次;
 *           老师先念那一项,孩子读,两种接法各一遍——现在的「夸一两个词 + 下一句」与带读(挑一个音、先说对的、请他跟着说)
 *   context 上下文里的短回答:嘴先问一句(英文 / 中文),再喂 Ray 的「好的」、TTS 的 Yes / Red / Yellow / 嗯;和不问直接喂的比,semantic_vad 收不收
 *   noise   嘴在出一段长的时候喂噪声、「嗯」、笑声、一句真插话;interrupt_response 开 / 关,看报不报开口、掐不掐
 * 用法:node scripts/probe-live-vad.mjs <vad|pause|barge|idle|coach|context|noise|all> [--ws ~/cotutor/ray] [--n 6] [--silence 1200] [--out <目录>]
 * 要本机的百炼按量 key 与业务空间 id(同口语课);要 ffmpeg(解 webm)。all 不含 idle。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { dashscopeAuth, endpointOf, sessionConfig, INPUT_RATE, REALTIME_MODEL, REALTIME_VOICE } = await import(join(repo, 'src', 'live', 'realtime.ts'));
const { readCue } = await import(join(repo, 'src', 'live', 'lib', 'cue.ts'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const what = process.argv[2] ?? 'all';
if (!['vad', 'pause', 'barge', 'idle', 'coach', 'context', 'noise', 'all'].includes(what)) { console.error('用法:node scripts/probe-live-vad.mjs <vad|pause|barge|idle|coach|context|noise|all> [--ws <workspace>] [--n 6] [--silence 1200]'); process.exit(2); }
const wsRoot = arg('--ws', process.env.COTUTOR_WORKSPACE ?? join(homedir(), 'cotutor', 'ray'));
const n = Number(arg('--n', '6'));
const silenceMs = Number(arg('--silence', '1200'));
const out = arg('--out', mkdtempSync(join(tmpdir(), 'cotutor-probe-vad-')));
mkdirSync(out, { recursive: true });
const auth = dashscopeAuth();
if (!auth) { console.error('没有百炼按量 key 或业务空间 id(见 src/lib/qianwen.ts)'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [`# 一直听探针(${new Date().toLocaleString('zh-CN')})`, '', `workspace \`${wsRoot}\`,silence ${silenceMs} 毫秒`, ''];
const say = (s = '') => { report.push(s); console.log(s); };
const CHUNK = (INPUT_RATE * 2) / 10; // 100 毫秒
const silence = (ms) => Buffer.alloc(Math.round((INPUT_RATE * ms) / 1000) * 2);
const pcmOfFile = (file) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(INPUT_RATE), '-f', 's16le', '-'], { maxBuffer: 256 << 20 });
const plain = (s) => String(s ?? '').replace(/[\s,，。!！?？、;；:：.「」“”"'()（）…—-]/g, '');

/** 语文老师的真录音(按住说话那几句),取最近的 n 段 */
function recordings() {
  const dir = join(wsRoot, 'conversations', 'chinese-tutor');
  const rows = [];
  for (const f of readdirSync(dir)) {
    if (!/^\d{4}-\d\d-\d\d\.json$/.test(f)) continue;
    for (const m of JSON.parse(readFileSync(join(dir, f), 'utf8')).messages ?? []) {
      if (m.voice && existsSync(join(dir, m.voice.audio))) rows.push({ id: `${f.slice(5, 10)} ${m.job}`, text: m.text, file: join(dir, m.voice.audio) });
    }
  }
  return rows.slice(-n).map((r) => ({ ...r, pcm: pcmOfFile(r.file) }));
}

/** 一条连接:turn_detection 由调用方给;所有事件带毫秒记下;推进去的声音按墙钟记,好把 audio_end_ms 换回墙钟 */
async function open(td, label, instructions = '你是一位老师。只照指令说话。') {
  const c = { label, events: [], sentMs: 0, marks: [], updated: null, closed: null, t0: Date.now() };
  const ws = new WebSocket(endpointOf(auth.workspaceId, REALTIME_MODEL), { headers: { authorization: `Bearer ${auth.key}` } });
  c.ws = ws;
  const ready = new Promise((resolve) => {
    ws.onmessage = (m) => {
      const e = JSON.parse(String(m.data));
      const at = Date.now();
      if (e.type === 'response.audio.delta') { if (!c.events.some((x) => x.type === 'audio' && x.after === c.lastCreated)) c.events.push({ at, type: 'audio', after: c.lastCreated }); return; }
      if (e.type === 'response.audio_transcript.delta' || e.type === 'response.text.delta') return;
      if (e.type === 'response.created') c.lastCreated = at;
      c.events.push({ at, type: e.type, e });
      if (e.type === 'session.created') {
        const s = sessionConfig({ instructions, voice: REALTIME_VOICE, turn: 'manual', silenceMs });
        ws.send(JSON.stringify({ type: 'session.update', session: { ...s, turn_detection: td } }));
      }
      if (e.type === 'session.updated' && !c.updated) { c.updated = e.session?.turn_detection ?? null; resolve(null); }
      if (e.type === 'error' && !c.updated) resolve(e.error?.message ?? 'error');
    };
    ws.onclose = (e) => { c.closed = `${e.code} ${e.reason}`; resolve(c.closed); };
  });
  c.why = await Promise.race([ready, sleep(10_000).then(() => 'timeout')]);
  c.send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  /** 按真时间推一段声音(100 毫秒一块),每块记下它在会话声音里的位置与推出去的墙钟 */
  c.feed = async (pcm) => {
    const start = Date.now();
    for (let p = 0, i = 0; p < pcm.length; p += CHUNK, i++) {
      const wait = start + i * 100 - Date.now();
      if (wait > 0) await sleep(wait);
      const chunk = pcm.subarray(p, p + CHUNK);
      c.marks.push({ ms: c.sentMs, at: Date.now() });
      c.send({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') });
      c.sentMs += chunk.length / ((INPUT_RATE * 2) / 1000);
    }
  };
  /** 会话声音里的第 ms 毫秒是哪个墙钟推出去的 */
  c.wallOf = (ms) => { let best = c.marks[0]; for (const m of c.marks) { if (m.ms <= ms) best = m; else break; } return best ? best.at + (ms - best.ms) : null; };
  c.since = (t) => c.events.filter((x) => x.at >= t);
  c.close = () => { try { ws.close(1000, 'probe'); } catch { /* 已经断了 */ } };
  return c;
}

const semantic = (o = {}) => ({ type: 'semantic_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: silenceMs, create_response: false, interrupt_response: false, ...o });
const brief = (x) => {
  const e = x.e ?? {};
  if (x.type === 'conversation.item.input_audio_transcription.completed') return `转写「${e.transcript}」`;
  if (x.type === 'conversation.item.input_audio_transcription.delta') return `转写片段「${e.delta ?? e.text ?? e.stash ?? ''}」`;
  if (x.type === 'error') return `error ${e.error?.code ?? ''} ${e.error?.message ?? ''}`;
  if (x.type === 'response.done') return `response.done ${e.response?.status}`;
  if (x.type === 'input_audio_buffer.speech_started') return `speech_started @${e.audio_start_ms}`;
  if (x.type === 'input_audio_buffer.speech_stopped') return `speech_stopped @${e.audio_end_ms}`;
  return x.type;
};

// ---- vad ----
async function vad(recs) {
  say('## vad:semantic_vad + create_response:false + interrupt_response:false');
  const c = await open(semantic(), 'vad');
  say(`连上:${c.why ?? 'ok'};session.updated 回的 turn_detection:\`${JSON.stringify(c.updated)}\``);
  if (c.why) return;
  say('');
  say('| 段 | 原来的字 | 转写 | 句数 | 停了(说完后) | committed(停后) | 转写(committed 后) | 别的事件 |');
  say('|---|---|---|---|---|---|---|---|');
  const lat = { stop: [], commit: [], text: [], end: [] };
  for (const r of recs) {
    const from = Date.now();
    const base = c.sentMs + 800;
    await c.feed(Buffer.concat([silence(800), r.pcm, silence(3000)]));
    await sleep(1500);
    const evs = c.since(from);
    const stopped = evs.filter((x) => x.type === 'input_audio_buffer.speech_stopped');
    const committed = evs.filter((x) => x.type === 'input_audio_buffer.committed');
    const texts = evs.filter((x) => x.type === 'conversation.item.input_audio_transcription.completed');
    const stopMs = stopped.map((x) => x.at - c.wallOf(x.e.audio_end_ms));
    const commitMs = committed.map((x, i) => (stopped[i] ? x.at - stopped[i].at : null));
    const textMs = texts.map((x, i) => (committed[i] ? x.at - committed[i].at : null));
    lat.stop.push(...stopMs); lat.commit.push(...commitMs); lat.text.push(...textMs);
    // 孩子真的说完在哪:最后一块响度过最响一成的 100 毫秒;那一刻推出去到最后一句 committed 多久(孩子停下到能接住)
    const levels = [];
    for (let p = 0; p + CHUNK <= r.pcm.length; p += CHUNK) { let q = 0; for (let k = p; k < p + CHUNK; k += 2) { const v = r.pcm.readInt16LE(k) / 32768; q += v * v; } levels.push(Math.sqrt(q / (CHUNK / 2))); }
    const peak = Math.max(...levels, 0);
    const lastLoud = levels.reduce((acc, v, i) => (v > peak * 0.1 ? i : acc), -1);
    const endAt = lastLoud >= 0 ? c.wallOf(base + (lastLoud + 1) * 100) : null;
    const lastCommit = committed[committed.length - 1];
    if (endAt && lastCommit) lat.end.push(lastCommit.at - endAt);
    const others = [...new Set(evs.map((x) => x.type).filter((t) => !/speech_|committed|transcription\.completed|item\.created|^audio$/.test(t)))];
    // 段间:上一句判停的位置到下一句开口的位置(会话声音里的毫秒;判停的位置已经含了 silence)
    const started = evs.filter((x) => x.type === 'input_audio_buffer.speech_started');
    const gaps = started.slice(1).map((x, i) => (stopped[i] ? x.e.audio_start_ms - stopped[i].e.audio_end_ms : null));
    say(`| ${r.id} | ${r.text} | ${texts.map((x) => x.e.transcript).join(' / ')} | ${committed.length} | ${stopMs.join(' / ')} | ${commitMs.join(' / ')} | ${textMs.join(' / ')} | ${gaps.length ? `段间 ${gaps.join(' / ')}` : ''} ${others.join(' ') || '—'} |`);
  }
  const med = (xs) => { const a = xs.filter((x) => x != null).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; };
  say('');
  say(`中位:判停的位置到 speech_stopped ${med(lat.stop)} 毫秒,stopped 到 committed ${med(lat.commit)},committed 到转写 ${med(lat.text)}`);
  say(`孩子真说完(响度)到最后一句 committed:${lat.end.join(' / ')} 毫秒`);
  const delta = c.events.find((x) => x.type === 'conversation.item.input_audio_transcription.delta');
  if (delta) say(`转写片段长这样:\`${JSON.stringify(delta.e).slice(0, 300)}\``);
  say(`有没有 response.created(不该有):${c.events.some((x) => x.type === 'response.created') ? '有' : '没有'};item.created 在 committed 之前:${c.events.findIndex((x) => x.type === 'conversation.item.created') < c.events.findIndex((x) => x.type === 'input_audio_buffer.committed') ? '是' : '否'}`);
  say('');
  say('事件顺序(第一段):');
  const first = c.events.filter((x) => x.type !== 'session.created' && x.type !== 'session.updated').slice(0, 14);
  say(first.map((x) => `- +${x.at - first[0].at} ${brief(x)}`).join('\n'));
  say('');
  c.close();
}

// ---- pause ----
async function pause(recs) {
  say('## pause:录音中间插 1.5 秒静音,切成几句');
  for (const [label, td] of [['semantic_vad', semantic()], ['server_vad', semantic({ type: 'server_vad' })]]) {
    const c = await open(td, label);
    if (c.why) { say(`${label} 连不上:${c.why}`); continue; }
    const rows = [];
    for (const r of recs.slice(0, 4)) {
      const from = Date.now();
      const mid = Math.floor(r.pcm.length / 4) * 2;
      await c.feed(Buffer.concat([silence(800), r.pcm.subarray(0, mid), silence(1500), r.pcm.subarray(mid), silence(3000)]));
      await sleep(1500);
      const texts = c.since(from).filter((x) => x.type === 'conversation.item.input_audio_transcription.completed').map((x) => x.e.transcript);
      rows.push(`${r.id}:${texts.length} 句(${texts.join(' / ')})`);
    }
    say(`- ${label}:${rows.join(';')}`);
    c.close();
  }
  say('');
}

// ---- barge ----
async function barge(recs) {
  say('## barge:嘴在念时推孩子的录音');
  const long = '下课铃响了,小朋友们跑到操场上。有的在跳绳,有的在踢毽子,还有的在玩老鹰捉小鸡。老师站在旁边看着大家,笑得眯起了眼睛。';
  for (const ir of [false, true]) {
    const c = await open(semantic({ interrupt_response: ir }), `barge-${ir}`);
    if (c.why) { say(`interrupt_response:${ir} 连不上:${c.why}`); continue; }
    const from = Date.now();
    c.send({ type: 'response.create', response: { instructions: readCue([long]) } });
    while (!c.events.some((x) => x.type === 'audio' && x.at >= from) && Date.now() - from < 10_000) await sleep(20);
    await sleep(1500);
    const kidAt = Date.now();
    await c.feed(Buffer.concat([recs[0].pcm, silence(2500)]));
    await sleep(2000);
    const evs = c.since(from).filter((x) => x.type !== 'audio');
    say(`- interrupt_response:${ir}:${evs.map((x) => `+${x.at - kidAt} ${brief(x)}`).join(' · ')}`);
    c.close();
  }
  say('');
}

// ---- idle ----
async function idle(recs) {
  say('## idle:commit 了不回答,一直推静音 330 秒');
  const c = await open(semantic(), 'idle');
  if (c.why) { say(`连不上:${c.why}`); return; }
  const from = Date.now();
  await c.feed(Buffer.concat([recs[0].pcm, silence(3000)]));
  const until = Date.now() + 330_000;
  while (Date.now() < until && !c.closed) await c.feed(silence(10_000));
  const evs = c.since(from).filter((x) => /error|session\.|closed|committed|transcription\.completed/.test(x.type));
  say(evs.map((x) => `- +${Math.round((x.at - from) / 1000)} 秒 ${brief(x)}`).join('\n'));
  say(`连接:${c.closed ? `断了 ${c.closed}` : '还连着'}`);
  if (!c.closed) {
    const t = Date.now();
    c.send({ type: 'response.create', response: { instructions: readCue(['好的。']) } });
    await sleep(5000);
    say(`到点后要一次回答:${c.since(t).map((x) => brief(x)).join(' · ') || '没回音'}`);
  }
  c.close();
  say('');
}

// ---- 口语课的三个(§五之二)----
const talkDir = join(wsRoot, 'talk', '2026-10-17-1106');
/** call.wav(24k,孩子和老师按时刻混在一条)里切一段,转成 16k:跟读时老师读完才推麦克风,孩子那几段里没有老师的声音 */
const cut = (fromMs, toMs) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(fromMs / 1000), '-to', String(toMs / 1000), '-i', join(talkDir, 'call.wav'), '-ac', '1', '-ar', String(INPUT_RATE), '-f', 's16le', '-'], { maxBuffer: 64 << 20 });
const tts = (text, voice) => {
  const f = join(out, `tts-${voice}-${Buffer.from(text).toString('hex').slice(0, 16)}.aiff`);
  execFileSync('say', ['-v', voice, '-o', f, text]);
  return execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', String(INPUT_RATE), '-f', 's16le', '-'], { maxBuffer: 64 << 20 });
};
const noise = (ms, amp = 0.35) => execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `anoisesrc=d=${ms / 1000}:c=pink:a=${amp}`, '-af', `afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, ms / 1000 - 0.08)}:d=0.08`, '-ac', '1', '-ar', String(INPUT_RATE), '-f', 's16le', '-'], { maxBuffer: 16 << 20 });
/** 要一次回答,等它 done;回它说的字与 done 的状态 */
async function respond(c, instructions, ms = 40_000) {
  const from = Date.now();
  c.send({ type: 'response.create', response: { instructions } });
  while (!c.since(from).some((x) => x.type === 'response.done') && Date.now() - from < ms && !c.closed) await sleep(30);
  const evs = c.since(from);
  return { said: evs.filter((x) => x.type === 'response.audio_transcript.done').map((x) => x.e.transcript).join(' '), status: evs.find((x) => x.type === 'response.done')?.e.response?.status ?? 'timeout', ms: Date.now() - from };
}
/** 手动轮次推一段孩子的声音并 commit,等转写 */
async function kidSays(c, pcm) {
  const from = Date.now();
  for (let p = 0; p < pcm.length; p += CHUNK) c.send({ type: 'input_audio_buffer.append', audio: pcm.subarray(p, p + CHUNK).toString('base64') });
  c.send({ type: 'input_audio_buffer.commit' });
  while (!c.since(from).some((x) => /transcription\.(completed|failed)/.test(x.type)) && Date.now() - from < 8000) await sleep(30);
  return c.since(from).find((x) => x.type === 'conversation.item.input_audio_transcription.completed')?.e.transcript ?? '(没转写)';
}

const COACH_SYS = '你是这个家的英语老师,对面是一年级的孩子 Ray,刚开始学英语,在跟你一个一个读口语单上的单词和句子。说话亲切、慢一点;英文为主,孩子听不懂时用一句中文。';
const NOW_CUE = (next) => `孩子跟着读完了。先用一两个英文词夸他(比如 Nice! / Good job!),不评对错,然后原样说下一项:「${next}」,说完就停。`;
const COACH_CUE = (target) => `孩子刚跟着读了「${target}」。仔细听他的发音。如果哪个音读偏了或者漏了,只挑最要紧的一个,用一两句话带读:先说那个词正确的样子,再请他跟你说一遍。不说「错了」「不对」,不讲音标,不说别的词。要是读得好,只夸一句。要是他说的是中文、不是在读,就温柔地请他再读一遍。说完就停。`;
/** 一对一对的:念对的、念偏的(TTS),看带读的接法分不分得出(--pairs) */
const PAIRS = process.argv.includes('--sentences')
  ? [['The ducks are under the bus.', 'The docks are onder the boss.'], ["I'm driving my car.", 'I driving my cart.']]
  : [['duck', 'dock'], ['bus', 'boss'], ['red', 'led'], ['under', 'onder']];

async function coachPairs() {
  say('## coach --pairs:念对 / 念偏(TTS Junior),带读的接法(没有举例),各两遍');
  say('');
  say('| 要读的 | 念的 | 转写 | 第一遍 | 第二遍 |');
  say('|---|---|---|---|---|');
  for (const [target, wrong] of PAIRS) {
    for (const spoken of [target, wrong]) {
      const pcm = tts(spoken.endsWith('.') ? spoken : `${spoken}.`, 'Junior');
      const runs = [];
      let heard = '';
      for (let k = 0; k < 2; k++) {
        const c = await open(null, 'pairs', COACH_SYS);
        if (c.why) { runs.push(`连不上 ${c.why}`); continue; }
        await respond(c, `原样说:「${target}」,说完就停。`);
        heard = await kidSays(c, Buffer.concat([silence(300), pcm, silence(300)]));
        runs.push((await respond(c, COACH_CUE(target))).said);
        c.close();
      }
      say(`| ${target} | ${spoken === target ? '念对' : `念成 ${spoken}`} | ${heard} | ${runs[0] ?? ''} | ${runs[1] ?? ''} |`);
    }
  }
  say('');
}

async function coach() {
  if (process.argv.includes('--pairs')) { await coachPairs(); return; }
  say('## coach:跟读纠音(手动轮次,同一段原声两种接法)');
  // Ray 10-17 跟读的那几段(reel.json 的 kidVoice,call.wav 上的毫秒)
  const items = [
    { target: 'duck', heard: '怎么?你读一下。duck,鸭子。', pcm: cut(3200, 6500), from: 'Ray 10-17' },
    { target: 'under', heard: 'under under 在下面。', pcm: cut(12400, 16600), from: 'Ray 10-17' },
    { target: 'bus', heard: 'Boss.', pcm: cut(23200, 23800), from: 'Ray 10-17' },
    { target: 'The ducks are under the bus.', heard: 'The dog.', pcm: cut(30300, 31900), from: 'Ray 10-17' },
    { target: 'bus', heard: '(TTS 念对的 bus)', pcm: tts('bus.', 'Samantha'), from: 'TTS' },
    { target: 'bus', heard: '(TTS 念成 boss)', pcm: tts('boss.', 'Samantha'), from: 'TTS' },
    { target: 'The ducks are under the bus.', heard: '(TTS 念对整句)', pcm: tts('The ducks are under the bus.', 'Junior'), from: 'TTS' },
  ];
  say('');
  say('| 要读的 | 孩子(当时认的) | 来源 | 这次转写 | 现在的接法 | 带读的接法 |');
  say('|---|---|---|---|---|---|');
  for (const it of items) {
    const row = [];
    for (const cue of ['now', 'coach']) {
      const c = await open(null, `coach-${cue}`, COACH_SYS);
      if (c.why) { row.push(`连不上 ${c.why}`); continue; }
      await respond(c, `原样说:「${it.target}」,说完就停。`);
      const heard = await kidSays(c, Buffer.concat([silence(300), it.pcm, silence(300)]));
      const r = await respond(c, cue === 'now' ? NOW_CUE('under') : COACH_CUE(it.target));
      row.push({ heard, said: r.said });
      c.close();
    }
    say(`| ${it.target} | ${it.heard} | ${it.from} | ${row[0]?.heard ?? ''} | ${row[0]?.said ?? row[0]} | ${row[1]?.said ?? row[1]} |`);
  }
  say('');
}

async function context(recs) {
  say(`## context:嘴先问一句,再喂短回答(${arg('--type', 'semantic_vad')}、silence ${silenceMs}、create_response 关)`);
  const hao = recs.find((r) => r.id.endsWith('1119-10'))?.pcm;
  const clips = [
    { name: 'Ray「好的」', pcm: hao, ask: '你想再听一遍吗?' },
    { name: 'TTS Yes.', pcm: tts('Yes.', 'Junior'), ask: 'Do you like ducks?' },
    { name: 'TTS Red.', pcm: tts('Red.', 'Junior'), ask: 'What color is the bus?' },
    { name: 'TTS Yellow.', pcm: tts('Yellow.', 'Junior'), ask: 'What color is the duck?' },
    { name: 'Ray「Boss.」', pcm: cut(23200, 23800), ask: 'What is this? It is a…' },
    { name: 'TTS「嗯」', pcm: tts('嗯。', 'Tingting'), ask: '你想再听一遍吗?' },
  ].filter((x) => x.pcm);
  say('');
  say('| 短回答 | 先问的 | 不问直接喂 | 问了再喂 |');
  say('|---|---|---|---|');
  for (const cl of clips) {
    const cells = [];
    for (const asked of [false, true]) {
      const c = await open(semantic({ type: arg('--type', 'semantic_vad') }), `ctx-${asked}`);
      if (c.why) { cells.push(`连不上 ${c.why}`); continue; }
      if (asked) await respond(c, `原样说:「${cl.ask}」,说完就停。`);
      await sleep(800);
      const from = Date.now();
      await c.feed(Buffer.concat([silence(600), cl.pcm, silence(3000)]));
      await sleep(1500);
      const evs = c.since(from);
      const started = evs.some((x) => x.type === 'input_audio_buffer.speech_started');
      const text = evs.filter((x) => x.type === 'conversation.item.input_audio_transcription.completed').map((x) => x.e.transcript).join(' / ');
      const rejected = evs.some((x) => x.type === 'error' && /not accepted/i.test(x.e.error?.message ?? ''));
      cells.push(started ? (text ? `收「${text}」` : rejected ? '开口了、拒收' : '开口了、没转写') : '没报开口');
      c.close();
    }
    say(`| ${cl.name} | ${cl.ask} | ${cells[0]} | ${cells[1]} |`);
  }
  say('');
}

async function noiseProbe(recs) {
  say(`## noise:嘴在出一段长的时候喂一段声音(${arg('--type', 'semantic_vad')}、create_response 关)`);
  const long = '我们来看这幅图。下课了,小朋友们都跑到操场上。有的在跳绳,有的在踢毽子,还有的在玩老鹰捉小鸡。老师站在旁边看着大家,笑得眯起了眼睛。操场边上有一棵大树,树下坐着两个小朋友在看书。天上飘着白白的云,太阳暖暖地照着大家。';
  const real = recs.find((r) => r.id.endsWith('1205-2'))?.pcm ?? tts('老师,等一下。', 'Tingting');
  const stim = [
    { name: '粉噪声 0.3 秒', pcm: noise(300) },
    { name: '粉噪声 1 秒(大)', pcm: noise(1000, 0.6) },
    { name: 'TTS「嗯」', pcm: tts('嗯。', 'Tingting') },
    { name: 'TTS 笑声「哈哈哈」', pcm: tts('哈哈哈。', 'Tingting') },
    { name: 'Ray 真插话「老师三明治怎么写」', pcm: real },
  ];
  say('');
  say('| 喂的 | interrupt_response 关:报开口? / 回答 | 开:报开口? / 回答 | 不在说时喂:报开口? |');
  say('|---|---|---|---|');
  for (const st of stim) {
    const cells = [];
    for (const ir of [false, true]) {
      const c = await open(semantic({ type: arg('--type', 'semantic_vad'), interrupt_response: ir }), `noise-${ir}`);
      if (c.why) { cells.push(`连不上 ${c.why}`); continue; }
      const from = Date.now();
      c.send({ type: 'response.create', response: { instructions: readCue([long]) } });
      while (!c.since(from).some((x) => x.type === 'audio') && Date.now() - from < 10_000) await sleep(20);
      await sleep(300);
      // 回答还在出(服务端出得比念快,一段 40 秒的话约 6 秒出完):趁这时候喂
      const inFlight = !c.since(from).some((x) => x.type === 'response.done');
      await c.feed(Buffer.concat([st.pcm, silence(2500)]));
      while (!c.since(from).some((x) => x.type === 'response.done') && Date.now() - from < 30_000) await sleep(50);
      const evs = c.since(from);
      const started = evs.some((x) => x.type === 'input_audio_buffer.speech_started');
      const status = evs.find((x) => x.type === 'response.done')?.e.response?.status ?? '?';
      cells.push(`${inFlight ? '' : '(喂时已出完)'}${started ? '报了' : '没报'} / ${status}`);
      c.close();
    }
    const c = await open(semantic({ type: arg('--type', 'semantic_vad') }), 'noise-quiet');
    const from = Date.now();
    await c.feed(Buffer.concat([silence(600), st.pcm, silence(2500)]));
    await sleep(1200);
    cells.push(c.since(from).some((x) => x.type === 'input_audio_buffer.speech_started') ? '报了' : '没报');
    c.close();
    say(`| ${st.name} | ${cells.join(' | ')} |`);
  }
  say('');
}

const recs = recordings();
say(`录音 ${recs.length} 段:${recs.map((r) => r.id).join('、')}`);
say('');
if (what === 'vad' || what === 'all') await vad(recs);
if (what === 'pause' || what === 'all') await pause(recs);
if (what === 'barge' || what === 'all') await barge(recs);
if (what === 'idle') await idle(recs);
if (what === 'coach') await coach();
if (what === 'context') await context(recs);
if (what === 'noise') await noiseProbe(recs);
writeFileSync(join(out, `report-${what}.md`), report.join('\n') + '\n');
console.log(`\n报告:${join(out, `report-${what}.md`)}`);
process.exit(0);
