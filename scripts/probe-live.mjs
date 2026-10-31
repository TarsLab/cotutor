#!/usr/bin/env node
/**
 * 实时老师的 P1 探针:真连百炼 realtime(一次几毛钱),不进产品。
 * 结果写进 --out 目录的 report.md,听的 wav 也在那里。
 *   voices  realtime 几个音色照念同一段语文 / 数学老师的话(念得对不对照字幕核);几个候选卡的声音(src/media/tts.ts)念同一段卡上的字(含英文单词),和两位老师现在的声音放一起
 *   ray     Ray 的真录音(workspace 的 conversations/<老师>/<日期>.<job>.voice.webm)按话题一条连接、手动轮次喂进去:松手到首包、realtime 的转写、嘴回了什么
 *   script  看图说话(10-17 1113-1 那串):嘴的系统指令 = 人设 + activity「老师怎么带」+ 嘴的规矩;开头交那幅图和一段「图上有什么」(故意错一处),
 *           按顺序喂 Ray 的 8 段录音;第 2 段后塞一张板上的卡,第 3 段后塞一条更正;每句查问号、评判的词
 *   image   单问一次:图 + 一句「图上的小朋友在干什么?」(say 念的),看它看没看见
 *   cue     要嘴原样说一句,四种交法各两遍:用户消息带「原样念」/ response.instructions / system 消息 / 孩子说完一句后 instructions「先接,再原样说」;看照没照说、有没有把问题自己答了
 * 用法:node scripts/probe-live.mjs <voices|ray|script|image|cue|all> [--ws ~/cotutor/ray] [--out <目录>] [--voice Serena]
 * 要本机的百炼按量 key 与业务空间 id(同口语课);要 ffmpeg(解 webm)、say / afconvert / sips(macOS)。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { RealtimeSession, INPUT_RATE, OUTPUT_RATE, REALTIME_VOICE, MAX_IMAGE_B64 } = await import(join(repo, 'src', 'realtime', 'bailian.ts'));
const { pcmOfWav, wavOfPcm } = await import(join(repo, 'src', 'shared', 'wav.ts'));
const { synthesize } = await import(join(repo, 'src', 'media', 'tts.ts'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const what = process.argv[2] ?? 'all';
if (!['voices', 'ray', 'script', 'image', 'cue', 'all'].includes(what)) { console.error('用法:node scripts/probe-live.mjs <voices|ray|script|image|cue|all> [--ws <workspace>] [--out <目录>]'); process.exit(2); }
const wsRoot = arg('--ws', process.env.COTUTOR_WORKSPACE ?? join(homedir(), 'cotutor', 'ray'));
const out = arg('--out', mkdtempSync(join(tmpdir(), 'cotutor-probe-live-')));
const voice = arg('--voice', REALTIME_VOICE);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [`# 实时老师 P1 探针(${new Date().toLocaleString('zh-CN')})`, '', `workspace \`${wsRoot}\`,输出 \`${out}\`,嘴的音色 ${voice}`, ''];
const say = (s = '') => { report.push(s); console.log(s); };
const pct = (xs, p) => { const a = xs.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
const plain = (s) => String(s ?? '').replace(/[\s,，。!！?？、;；:：.「」“”"'()（）…—-]/g, '');

// ---- 素材 ----
const pcmOfFile = (file) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(INPUT_RATE), '-f', 's16le', '-'], { maxBuffer: 256 << 20 });
function sayZh(text, tag) {
  const aiff = join(out, `${tag}.aiff`), wav = join(out, `${tag}.wav`);
  execFileSync('say', ['-v', 'Tingting', '-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${INPUT_RATE}`, '-c', '1', aiff, wav]);
  return pcmOfWav(readFileSync(wav)).pcm;
}
const silence = (ms) => Buffer.alloc(Math.round((INPUT_RATE * ms) / 1000) * 2);
/** 拍的照片缩成 realtime 一帧装得下的 JPEG(base64 ≤ MAX_IMAGE_B64):长边 1024 起,装不下再缩 */
function smallJpeg(file) {
  for (const [side, q] of [[1024, 70], [1024, 50], [800, 50], [640, 45]]) {
    const to = join(out, `photo-${side}-${q}.jpg`);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(q), '-Z', String(side), file, '--out', to], { stdio: 'ignore' });
    const b = readFileSync(to);
    if (b.toString('base64').length <= MAX_IMAGE_B64) return b;
  }
  throw new Error('照片缩不进一帧');
}

// ---- 一条连接,一轮一轮地问 ----
async function open(instructions, v = voice) {
  const st = { audio: [], reply: null, kid: null, firstAudio: null, done: null, t0: 0, closed: null, errors: [] };
  const s = new RealtimeSession({ instructions, voice: v, turn: 'manual' }, {
    onAudio: (pcm) => { if (st.firstAudio === null) st.firstAudio = Date.now() - st.t0; st.audio.push(pcm); },
    onTutorText: (_d, whole) => { if (whole !== null) st.reply = whole; },
    onKidText: (t) => { st.kid = t; st.kidMs = Date.now() - st.t0; },
    onResponse: (state, status, usage) => { if (state === 'done') st.done = { status, usage, ms: Date.now() - st.t0 }; },
    onError: (m) => st.errors.push(m),
    onClose: (r) => { st.closed = r; },
  });
  const why = await s.connect();
  /** 一轮:可选孩子的声音(和一张图)、可选一条文字;回首包、转写、回答、用时 */
  const turn = async ({ pcm = null, image = null, text = null, role = 'user', instructions = null, wav = null } = {}) => {
    Object.assign(st, { audio: [], reply: null, kid: null, kidMs: null, firstAudio: null, done: null });
    if (pcm) for (let p = 0; p < pcm.length; p += 3200) s.appendAudio(pcm.subarray(p, p + 3200));
    if (image) s.appendImage(image);
    st.t0 = Date.now();
    if (pcm) s.commit();
    if (text) s.addText(text, role);
    s.createResponse(instructions ?? undefined);
    const until = Date.now() + 40_000;
    while ((!st.done || (pcm && st.kid === null && Date.now() < st.t0 + (st.done?.ms ?? 0) + 3000)) && Date.now() < until && !st.closed) await sleep(20);
    const audio = Buffer.concat(st.audio);
    if (wav) writeFileSync(join(out, wav), wavOfPcm(audio, OUTPUT_RATE));
    return { firstAudio: st.firstAudio, kid: st.kid, kidMs: st.kidMs, reply: st.reply ?? '', done: st.done, seconds: audio.length / 2 / OUTPUT_RATE };
  };
  /** 静静塞一条(不让它说) */
  const note = (text) => s.addText(text);
  return { why, turn, note, close: () => s.close(), st };
}

// ---- voices ----
const TEACH = {
  语文: '我们来看这幅图。图上有好多同学,他们在操场上玩。你先说说看,图上有谁呀?',
  数学: '我们一行一行数。第一行有六个桃子,第二行也有六个。那一共有几个桃子呢?',
};
// 2026-10-19:只在系统提示里说「你是朗读员」、文字当用户消息发,每个音色都改写、还把数学题自己答了;照念要把「原样说」和那句一起放进 response.instructions(见 cue)
const READER = '你是小学老师,对一年级的孩子说话:慢一点、亲切。';
// Bella、Pip、Ethan、Chelsie 2026-10-19 回 InvalidPara(这个模型不认)
const RT_VOICES = ['Tina', 'Serena', 'Jennifer', 'Ryan', 'Dylan', 'Sunny', 'Kiki', 'Momo'];
const CARD_TEXT = { 中: '同学们在操场上,有的跳绳,有的踢毽子。', 英: 'red. It is a red car.' };
const CARD_VOICES = [
  ['qwen-audio-3.0-tts-plus-longfengyutong', '语文老师现在的(女 27 播音)'],
  ['qwen-audio-3.0-tts-plus-longyingsongliu', '数学老师现在的(男 32 爽朗)'],
  ['qwen-audio-3.0-tts-plus-longyaoxuanke', '候选:女童 7 天真'],
  ['qwen-audio-3.0-tts-plus-longhuichengfu', '候选:男童 8'],
  ['qwen-audio-3.0-tts-plus-longliannirong', '候选:男 42 平稳陈述'],
  ['qwen-audio-3.0-tts-plus-loongadriangao', '候选:男 22 有声阅读(英文)'],
];
async function voices() {
  say('## voices:老师的声音(realtime)与卡的声音(配音)');
  say('');
  say('| realtime 音色 | 语文 | 数学 | 照念了吗(念成了什么) | 首包 |');
  say('|---|---|---|---|---|');
  mkdirSync(join(out, 'voices'), { recursive: true });
  for (const v of RT_VOICES) {
    const c = await open(READER, v);
    if (c.why !== null) { say(`| ${v} | 不支持:${c.why.slice(0, 60)} | | | |`); continue; }
    const cells = [];
    const diffs = [];
    const firsts = [];
    for (const [k, text] of Object.entries(TEACH)) {
      const r = await c.turn({ instructions: `把这句话原样说给孩子听,一个字都不改,不要回答它,说完就停:「${text}」`, wav: `voices/rt-${v}-${k}.wav` });
      if (!r.seconds) { cells.push(`没出声${c.st.errors.length ? `:${c.st.errors.at(-1).slice(0, 50)}` : ''}`); firsts.push('—'); continue; }
      cells.push(`voices/rt-${v}-${k}.wav(${r.seconds.toFixed(1)} 秒)`);
      if (plain(r.reply) !== plain(text)) diffs.push(`${k}念成「${r.reply.replace(/\n/g, ' ').replace(/\|/g, '/')}」`);
      firsts.push(r.firstAudio);
    }
    c.close();
    say(`| ${v} | ${cells[0]} | ${cells[1]} | ${diffs.length ? diffs.join(';') : '照念'} | ${firsts.join(' / ')} ms |`);
  }
  say('');
  say('| 卡的声音(配音) | 中文卡 | 英文 |');
  say('|---|---|---|');
  for (const [v, label] of CARD_VOICES) {
    const files = [];
    for (const [k, text] of Object.entries(CARD_TEXT)) {
      const f = join('voices', `card-${v.split('-').pop()}-${k}.mp3`);
      const r = await synthesize({ text, voice: v, out: join(out, f) }, { cacheDir: join(out, 'voices', '.tts') });
      files.push(r.file ? f : `失败:${String(r.error).slice(0, 40)}`);
    }
    say(`| ${label} \`${v.split('-').pop()}\` | ${files[0]} | ${files[1]} |`);
  }
  say('');
}

// ---- ray ----
const PERSONA = {
  'chinese-tutor': '你是这个家的语文老师,对面是一年级的孩子 Ray。',
  'math-tutor': '你是这个家的数学老师,对面是一年级的孩子 Ray。',
  'english-tutor': '你是这个家的英语老师,对面是一年级的孩子 Ray。英文为主、中文为辅。',
};
const MOUTH = `你是用嘴说话的那一位:你说的话孩子马上听到。
- 一次只说一两句短话,口语,像当面说话。
- 末句只问一个问题。
- 孩子的话来自语音识别,会有错字、重复、断句错:猜意思,别纠正,别说没听清。
- 不说孩子错了,不说「不对」,不打分。`;
function recordings() {
  const rows = [];
  const conv = join(wsRoot, 'conversations');
  for (const t of readdirSync(conv)) {
    for (const f of readdirSync(join(conv, t))) {
      if (!/^\d{4}-\d\d-\d\d\.json$/.test(f)) continue;
      const idx = JSON.parse(readFileSync(join(conv, t, f), 'utf8'));
      for (const m of idx.messages ?? []) {
        if (!m.voice) continue;
        const file = join(conv, t, m.voice.audio);
        if (existsSync(file)) rows.push({ tutor: t, date: f.slice(0, 10), job: m.job, thread: m.thread ?? m.job, seconds: m.voice.seconds, text: m.text, file });
      }
    }
  }
  return rows.sort((a, b) => (a.date + a.job).localeCompare(b.date + b.job, 'en', { numeric: true }));
}
async function ray() {
  say('## ray:Ray 的真录音,一个话题一条连接、手动轮次');
  say('');
  say('| 老师 · 日期 · job | 秒 | 当时浏览器认的 | realtime 认的 | 首包(松手起) | 转写到 | 嘴回了什么 |');
  say('|---|---|---|---|---|---|---|');
  mkdirSync(join(out, 'ray'), { recursive: true });
  const rows = recordings();
  const groups = new Map();
  for (const r of rows) { const k = `${r.tutor}|${r.date}|${r.thread}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const firsts = [];
  for (const [k, list] of groups) {
    const tutor = k.split('|')[0];
    const c = await open(`${PERSONA[tutor] ?? PERSONA['chinese-tutor']}\n${MOUTH}\n这是测试:你没有前情,就顺着孩子的话接。`);
    if (c.why !== null) { say(`| ${k} | 连不上:${c.why} | | | | | |`); continue; }
    for (const r of list) {
      let pcm;
      try { pcm = pcmOfFile(r.file); } catch (e) { say(`| ${r.tutor} ${r.date} ${r.job} | 解不开:${String(e.message).slice(0, 40)} | | | | | |`); continue; }
      const x = await c.turn({ pcm, wav: `ray/${r.tutor.split('-')[0]}-${r.date}-${r.job}.wav` });
      firsts.push(x.firstAudio);
      const cut = (s, n) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, n);
      say(`| ${r.tutor.split('-')[0]} ${r.date.slice(5)} ${r.job} | ${r.seconds} | ${cut(r.text, 40)} | ${cut(x.kid, 40)} | ${x.firstAudio ?? '—'} ms | ${x.kidMs ?? '—'} ms | ${cut(x.reply, 80)} |`);
    }
    c.close();
  }
  say('');
  say(`首包(松手 commit 起到第一块声音):${firsts.filter((x) => x != null).length} 次,中位 ${pct(firsts, 0.5)} ms,九成 ${pct(firsts, 0.9)} ms,最慢 ${pct(firsts, 1)} ms`);
  say('');
}

// ---- script:看图说话 ----
function activityHow() {
  const body = readFileSync(join(repo, 'grades', 'grade-2', 'agents', 'chinese-tutor', 'activities', '看图说话.md'), 'utf8');
  const m = body.match(/## 老师怎么带\n([\s\S]*?)(?=\n## |\n收:)/);
  return (m ? m[1] : '').replace(/<!--[\s\S]*?-->/g, '').trim();
}
const SCRIPT_THREAD = { date: '2026-10-17', tutor: 'chinese-tutor', jobs: ['1115-3', '1115-4', '1116-5', '1116-6', '1117-7', '1117-8', '1119-9', '1119-10'], photo: 'captures/2026-10-17/1114-1.jpg' };
async function script() {
  say('## script:看图说话,嘴照 activity 带');
  say('');
  const instructions = `你是这个家的语文老师,正在带一年级的孩子 Ray 看图说话。你是用嘴说话的那一位:你说的话孩子马上听到;板上的卡由另一位老师写,板上出了什么,我会用「[板上] …」告诉你,说到它时可以说「你看板上」。
下面是这个活动的做法,原来是写给写板书的老师的:卡怎么放你不用管,只照着怎么问、怎么接。
---
${activityHow()}
---
你的规矩:
${MOUTH}
- 提示放在问题前面,说成一句话,不说成问句。一句话里只有末尾一个问号。
- 「[更正] …」是另一位老师发现前面说错了:下一句自然地改口,只说老师自己说错了,不说孩子错。`;
  const c = await open(instructions);
  if (c.why !== null) { say(`连不上:${c.why}`); return; }
  const image = smallJpeg(join(wsRoot, SCRIPT_THREAD.photo));
  const lines = [];
  const look = (tag, r, extra = '') => {
    const q = (r.reply.match(/[??]/g) ?? []).length;
    const judge = /不对|错了|答错|你错/.test(r.reply) && !/老师(刚才)?(说|数|看|讲)错/.test(r.reply);
    lines.push({ tag, ...r, q, judge });
    say(`- **${tag}**${extra}(首包 ${r.firstAudio ?? '—'} ms${r.kid != null ? `,转写「${r.kid}」` : ''})→ ${r.reply.replace(/\n/g, ' ')}  ${q > 1 ? `⚠ ${q} 个问号` : ''}${judge ? ' ⚠ 像在评判孩子' : ''}`);
  };
  const facts = '[开始] 孩子点了「我要看图说话」,拍来了一幅图(就是这张)。另一位老师看过了:题目叫「课间十分钟」,一幅图;操场上有跑道,有乒乓球桌,同学们有的打乒乓球,有的跳绳,有的踢足球。现在照做法开始。';
  look('开场(1 秒静音 + 图 + 图上有什么,其中「踢足球」是故意错的)', await c.turn({ pcm: silence(1000), image, text: facts, wav: 'script-0.wav' }));
  const idx = JSON.parse(readFileSync(join(wsRoot, 'conversations', SCRIPT_THREAD.tutor, `${SCRIPT_THREAD.date}.json`), 'utf8'));
  for (const [k, job] of SCRIPT_THREAD.jobs.entries()) {
    const m = idx.messages.find((x) => x.job === job);
    const pcm = pcmOfFile(join(wsRoot, 'conversations', SCRIPT_THREAD.tutor, m.voice.audio));
    look(`Ray ${job}`, await c.turn({ pcm, wav: `script-${k + 1}.wav` }), `(当时认的「${m.text.slice(0, 30)}」)`);
    if (job === '1115-4') { c.note('[板上] 板上出了一张卡,写着孩子刚才说的:「同学们在操场上。」'); say('  - 塞:[板上] 板上出了一张卡,写着孩子刚才说的:「同学们在操场上。」'); }
    if (job === '1116-5') { c.note('[更正] 前面告诉你的「踢足球」是看错了,图上没有足球,是踢毽子。你要是说过踢足球,下一句改口。'); say('  - 塞:[更正] 前面告诉你的「踢足球」是看错了……是踢毽子'); }
  }
  c.close();
  const after = (tag) => lines[lines.findIndex((l) => l.tag === tag) + 1];
  say('');
  say(`- 问号:${lines.filter((l) => l.q <= 1).length}/${lines.length} 句不超过一个`);
  say(`- 评判的词:${lines.filter((l) => l.judge).length} 句`);
  say(`- 塞了板上的卡之后那句提没提板上:${/板上|卡/.test(after('Ray 1115-4')?.reply ?? '') ? '提了' : '没提'}`);
  const fix = lines.filter((l) => /足球/.test(l.reply)).map((l) => l.tag);
  say(`- 说过「足球」的:${fix.join('、') || '没有'};更正之后那句:${after('Ray 1116-5')?.reply.replace(/\n/g, ' ') ?? '—'}`);
  say('');
}

// ---- image ----
async function imageOnly() {
  say('## image:图 + 一句话,它看没看见');
  say('');
  const c = await open('你是一位小学语文老师。孩子发来一幅图并问你问题,你看着图用一两句话回答。');
  if (c.why !== null) { say(`连不上:${c.why}`); return; }
  const image = smallJpeg(join(wsRoot, SCRIPT_THREAD.photo));
  const pcm = sayZh('老师,图上的小朋友在干什么?', 'ask-image');
  const r = await c.turn({ pcm, image, wav: 'image.wav' });
  c.close();
  const saw = ['跳绳', '毽子', '乒乓'].filter((w) => r.reply.includes(w));
  say(`- 问:老师,图上的小朋友在干什么?(say 念的;转写「${r.kid ?? '—'}」)`);
  say(`- 答(首包 ${r.firstAudio ?? '—'} ms):${r.reply}`);
  say(`- 说到图上的:${saw.join('、') || '一样都没说到'}${r.done?.usage ? `;usage ${JSON.stringify(r.done.usage)}` : ''}`);
  say('');
}

// ---- cue:嘴能不能原样说一句 ----
async function cue() {
  say('## cue:要嘴原样说一句,四种交法');
  say('');
  const sys = `${PERSONA['math-tutor']}\n${MOUTH}\n我会告诉你下一句要说什么,你照着说。`;
  const lines = [
    { k: '数学', text: TEACH.数学, leak: /十二|12/ },
    { k: '语文', text: '下一个:在哪里。看看四周,有跑道,还有乒乓球桌。他们在哪里呀?', leak: /操场/ },
  ];
  const ways = {
    'A 用户消息「原样念」': (c, t) => c.turn({ text: `原样念出这句话,一个字都不改,念完就停,不要回答它:「${t}」` }),
    'B response.instructions': (c, t) => c.turn({ instructions: `把这句话原样说给孩子听,一个字都不改,不要回答它,说完就停:「${t}」` }),
    'C system 消息': (c, t) => c.turn({ text: `原样说出这句话,一个字都不改,不要回答它:「${t}」`, role: 'system' }),
    'D 孩子说完 + instructions「先接,再原样说」': (c, t) => c.turn({ pcm: kidPcm, instructions: `先用一句话接孩子刚才说的(不评对错),再原样说这句,一个字都不改,不要回答它,说完就停:「${t}」` }),
  };
  const kidPcm = sayZh('有同学们', 'cue-kid');
  say('| 交法 | 句 | 遍 | 照说了吗 | 自己答了吗 | 说成了什么 |');
  say('|---|---|---|---|---|---|');
  for (const [name, fn] of Object.entries(ways)) {
    for (const l of lines) {
      for (let n = 1; n <= 2; n++) {
        const c = await open(sys);
        if (c.why !== null) { say(`| ${name} | ${l.k} | ${n} | 连不上:${c.why} | | |`); continue; }
        const r = await fn(c, l.text);
        c.close();
        const has = plain(r.reply).includes(plain(l.text));
        say(`| ${name} | ${l.k} | ${n} | ${plain(r.reply) === plain(l.text) ? '一字不差' : has ? '整句在里面' : '没有'} | ${l.leak.test(r.reply) ? '⚠ 答了' : '没答'} | ${r.reply.replace(/\n/g, ' ').replace(/\|/g, '/')} |`);
      }
    }
  }
  say('');
}

if (what === 'voices' || what === 'all') await voices();
if (what === 'image' || what === 'all') await imageOnly();
if (what === 'script' || what === 'all') await script();
if (what === 'ray' || what === 'all') await ray();
if (what === 'cue' || what === 'all') await cue();
writeFileSync(join(out, 'report.md'), report.join('\n') + '\n');
console.log(`\n报告:${join(out, 'report.md')}`);
// Node 自带的 WebSocket close 后要等服务端回 close 帧,百炼那头常常不回,进程就挂着不退
process.exit(0);
