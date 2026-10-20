#!/usr/bin/env node
/**
 * 数学拍照读得准又快吗(《wip/实时老师开发计划.md》P4):真连百炼,不进产品。两种读法比一张有真相的作业照片:
 *   整张  qwen3.8-max 看整张,把孩子手写的每一处答案列出来(现在数学老师就是这样:Read 整张照片)
 *   框读  同一个模型先框出孩子手写的每一处(0–1000 的框,同听写认照片),按框裁出来放大 3 倍,每块单独读(并行)
 * 缺省是 Ray 9-18 那张小纸条(真相见 TRUTH;《2026-10-10-qwen3.8-omni调研.md》「看照片」五次五个样)。几分钱。
 * 用法:node scripts/probe-photo-crop.mjs [--photo <jpg>] [--think] [--runs 2] [--out <目录>] [--ground <模型>] [--read <模型>] [--no-whole]
 *   --think:开思考(缺省不想,同听写认照片);--ground / --read:框、读各用哪个模型(缺省 qwen3.8-max;omni 的走流式);--no-whole 不跑整张读;要 ffmpeg 裁图
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { chatUrl, qianwenKeys, qianwenLine } = await import(join(repo, 'src', 'lib', 'qianwen.ts'));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const photo = arg('--photo', join(homedir(), 'cotutor', 'ray', 'captures', '2026-09-18', '2101-1.jpg'));
const think = process.argv.includes('--think');
const runs = Number(arg('--runs', '2'));
const out = arg('--out', mkdtempSync(join(tmpdir(), 'cotutor-probe-photo-crop-')));
mkdirSync(out, { recursive: true });
const MODEL = 'qwen3.8-max';
const GROUND_MODEL = arg('--ground', MODEL);
const READ_MODEL = arg('--read', MODEL);
const whole = !process.argv.includes('--no-whole');

/** 9-18 小纸条孩子写的(Jack 10-10 核过;① 写得像 5,按 6 算):⑥ 写成 7 是他算错了,「得数是 8 的」填 1 是唯一的错 */
const TRUTH = [
  ['一 看图写算式', '15 − 7 = 8'],
  ['二 第 1 题(选几)', '2'],
  ['二 第 2 题(选几)', '2'],
  ['三 ① 14−8 上面', '6'], ['三 ② 12−3 上面', '9'], ['三 ③ 17−3 上面', '14'], ['三 ④ 11−2 上面', '9'], ['三 ⑤ 15−7 上面', '8'], ['三 ⑥ 13−5 上面', '7'],
  ['(1) 减数是 3 的', '2'], ['(1) 减数是 5 的', '1'], ['(1) 减数是 8 的', '1'],
  ['(2) 得数是 6 的', '1'], ['(2) 得数是 8 的', '1'], ['(2) 得数是 9 的', '2'],
];

const keys = qianwenKeys();
if (!qianwenLine(MODEL, keys)) { console.error('没有百炼的 key'); process.exit(2); }
const jpeg = readFileSync(photo);
const size = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', photo], { encoding: 'utf8' });
const W = Number(/pixelWidth: (\d+)/.exec(size)[1]);
const H = Number(/pixelHeight: (\d+)/.exec(size)[1]);

async function ask(image, text, model = MODEL) {
  const t0 = Date.now();
  const line = qianwenLine(model, keys);
  const stream = model.includes('omni');
  const res = await fetch(chatUrl(line.host), {
    method: 'POST',
    headers: { authorization: `Bearer ${line.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.1, enable_thinking: think, ...(stream ? { stream: true, stream_options: { include_usage: true }, modalities: ['text'] } : {}), messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } }, { type: 'text', text }] }] }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!stream) {
    const j = await res.json();
    return { text: j.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 300), ms: Date.now() - t0, tokens: j.usage?.prompt_tokens };
  }
  // 流式(omni):把 delta 拼起来
  const raw = await res.text();
  let got = '', tokens;
  for (const l of raw.split('\n')) {
    if (!l.startsWith('data:') || l.includes('[DONE]')) continue;
    try { const j = JSON.parse(l.slice(5)); got += j.choices?.[0]?.delta?.content ?? ''; tokens = j.usage?.prompt_tokens ?? tokens; } catch {}
  }
  return { text: got || raw.slice(0, 300), ms: Date.now() - t0, tokens };
}

const WHOLE = '这是一年级孩子的数学作业照片。把孩子用笔手写的每一处读出来(算式上面、旁边随手写的小字也算;印刷的字不算),一行一处,写成「哪道题哪个空:写的是什么」。看不清的写「?」。只回这些行。';
const GROUND = '这是一年级孩子的数学作业照片。框出孩子用笔手写的每一处(数字、圈的选项,算式上面、旁边随手写的小字也算;印刷的字不算)。只回一个 JSON 数组,一处一个:[{"label":"哪道题哪个空","bbox":[x1,y1,x2,y2]}]。bbox 是左上、右下角,按照片宽、高各自换算到 0–1000,不是像素。框紧贴着手写的字。';
const READ = '这是一年级孩子作业上手写的一处答案,裁出来放大了。只回他写的是什么(数字或圈的序号),看不清回「?」。';

const report = [`# 拍照读图:整张 vs 框了再读(${new Date().toLocaleString('zh-CN')})`, '', `照片 \`${photo}\`(${W}×${H}),整张 ${whole ? MODEL : '不跑'}、框 ${GROUND_MODEL}、读 ${READ_MODEL},${think ? '开思考' : '不想'},各 ${runs} 遍;裁的图在 \`${out}\``, '', '真相:', ...TRUTH.map(([k, v]) => `- ${k}:${v}`), ''];
const say = (...ls) => { for (const s of ls.length ? ls : ['']) { report.push(s); console.log(s); } };

for (let r = 1; r <= runs; r++) {
  const [wholeR, ground] = await Promise.all([whole ? ask(jpeg, WHOLE) : null, ask(jpeg, GROUND, GROUND_MODEL)]);
  say(`## 第 ${r} 遍`, '');
  if (wholeR) {
    say(`### 整张(${(wholeR.ms / 1000).toFixed(1)} 秒,图 ${wholeR.tokens} token)`);
    say('', ...wholeR.text.trim().split('\n').map((l) => `- ${l}`), '');
  }
  let boxes = [];
  try { boxes = JSON.parse(/\[[\s\S]*\]/.exec(ground.text)[0]); } catch { say(`框没回 JSON:${ground.text.slice(0, 200)}`); }
  const t1 = Date.now();
  const crops = boxes.map((b, i) => {
    const [x1, y1, x2, y2] = b.bbox.map(Number);
    // 0–1000 换成像素;四边各放宽三成(至少 24 像素;放宽一半时会裁进旁边那一处),再放大 3 倍
    const px = [x1 * W / 1000, y1 * H / 1000, x2 * W / 1000, y2 * H / 1000];
    const padX = Math.max(24, (px[2] - px[0]) * 0.3), padY = Math.max(24, (px[3] - px[1]) * 0.3);
    const L = Math.max(0, Math.round(px[0] - padX)), T = Math.max(0, Math.round(px[1] - padY));
    const R = Math.min(W, Math.round(px[2] + padX)), B = Math.min(H, Math.round(px[3] + padY));
    const file = join(out, `r${r}-${String(i + 1).padStart(2, '0')}.jpg`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', photo, '-vf', `crop=${R - L}:${B - T}:${L}:${T},scale=iw*3:ih*3:flags=lanczos`, file]);
    return { label: b.label, file };
  });
  const reads = await Promise.all(crops.map((c) => ask(readFileSync(c.file), READ, READ_MODEL)));
  const readMs = Date.now() - t1;
  say(`### 框读(框 ${(ground.ms / 1000).toFixed(1)} 秒 + 裁、并行读 ${crops.length} 块 ${(readMs / 1000).toFixed(1)} 秒 = ${((ground.ms + readMs) / 1000).toFixed(1)} 秒)`, '');
  crops.forEach((c, i) => say(`- ${c.label}:${reads[i].text.trim().replace(/\n/g, ' ')}(${c.file.split('/').pop()})`));
  say('');
}
writeFileSync(join(out, 'report.md'), report.join('\n') + '\n');
console.log(`\n报告:${join(out, 'report.md')}`);
