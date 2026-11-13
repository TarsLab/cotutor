#!/usr/bin/env node
/**
 * 课本页上的正文,一行一行框得准吗、拼音那一行框得准吗:真连百炼,不进产品。几分钱。
 * 起因(2026-11-13,画板为主的设想):孩子在照片上圈正文里任意一个字、老师把某几个字的拼音遮住,都要知道字和拼音在照片上的哪儿。
 * 听写的拍照认词(src/scenes/photo-words/)只给挑出的字词带框,全文只有字;这里问的是它没试过的两样:
 *   行   正文一行一个框(0–1000);行里一个字多宽 = 行框按字数等分(课文正文差不多等宽),画出来看套不套得住字
 *   拼音 这一行字上面那一行拼音的框(没有拼音写 null)
 * 把框画回照片(行 = 蓝,等分出的字 = 细蓝线,拼音 = 红),人看图判断;同一页跑几遍,报每一行的框差多少。
 * 用法:node scripts/probe-photo-text.mjs [--photo <jpg>]... [--runs 2] [--model qwen3.8-max] [--out <目录>]   要 magick 画框
 * 结论(2026-11-13)写在文件最后。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { chatUrl, qianwenKeys, qianwenLine } = await import(join(repo, 'src', 'shared', 'qianwen.ts'));
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const all = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const BOOK = join(repo, 'docs', 'wip', '图片', '小学二年级', '语文-统编版', '上册');
const photos = all('--photo').length ? all('--photo') : [join(BOOK, '010.jpg'), join(BOOK, '012.jpg')];
const runs = Number(arg('--runs', '2'));
const MODEL = arg('--model', 'qwen3.8-max');
const out = arg('--out', mkdtempSync(join(tmpdir(), 'cotutor-probe-photo-text-')));
mkdirSync(out, { recursive: true });

const keys = qianwenKeys();
const line = qianwenLine(MODEL, keys);
if (!line) { console.error('没有百炼的 key'); process.exit(2); }

const PROMPT = `这是小学语文课本的一页。把照片上的正文一行一行认出来(课文、题目、课后题、词语都算;页码、水印、拼音不算正文),从上到下、从左到右。
回答的格式:一行一段 JSON,不要别的字、不要代码块:
{"text": "我会变。太阳一晒,我就变成汽。升", "box": [左, 上, 右, 下], "pinyin": [左, 上, 右, 下]}
- text:照片上这一行的字,照原样,带标点;照片上在哪儿换行就在哪儿断。
- box:这一行汉字在照片上的位置(不含上面的拼音),按照片宽、高的千分比,0 到 1000 的整数,紧贴着字。
- pinyin:这一行字正上方那一行拼音的位置,同样的千分比;这一行上面没有拼音写 null。
田字格里的字、表格里的字,一格一行。`;

async function ask(jpeg) {
  const t0 = Date.now();
  const res = await fetch(chatUrl(line.host), {
    method: 'POST',
    headers: { authorization: `Bearer ${line.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.1, enable_thinking: false, stream: true, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } }, { type: 'text', text: PROMPT }] }] }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok || !res.body) return { rows: [], ms: Date.now() - t0, first: null, error: `http_${res.status} ${(await res.text()).slice(0, 200)}` };
  const dec = new TextDecoder();
  let sse = '', text = '', first = null;
  for await (const chunk of res.body) {
    sse += dec.decode(chunk, { stream: true });
    let i;
    while ((i = sse.indexOf('\n')) >= 0) {
      const l = sse.slice(0, i).trim(); sse = sse.slice(i + 1);
      if (!l.startsWith('data:') || l.includes('[DONE]')) continue;
      try { text += JSON.parse(l.slice(5)).choices?.[0]?.delta?.content ?? ''; } catch { /* 读不懂的行跳过 */ }
      if (first === null && text.includes('}')) first = Date.now() - t0;
    }
  }
  const box = (v) => (Array.isArray(v) && v.length === 4 && v.every((x) => Number.isFinite(x)) && v[2] > v[0] && v[3] > v[1] ? v.map((x) => Math.max(0, Math.min(1000, Math.round(x)))) : null);
  const rows = [];
  for (const raw of text.split('\n')) {
    const s = raw.trim().replace(/,$/, '');
    if (!s.startsWith('{')) continue;
    try { const j = JSON.parse(s); if (typeof j.text === 'string' && box(j.box)) rows.push({ text: j.text.trim(), box: box(j.box), pinyin: box(j.pinyin) }); } catch { /* 半截的行 */ }
  }
  return { rows, ms: Date.now() - t0, first };
}

const sizeOf = (file) => execFileSync('magick', ['identify', '-format', '%w %h', file], { encoding: 'utf8' }).trim().split(' ').map(Number);

/** 框画回照片:行蓝、拼音红、行里按字数等分的竖线细蓝 */
function paint(photo, rows, file) {
  const [W, H] = sizeOf(photo);
  const px = (b) => [b[0] * W / 1000, b[1] * H / 1000, b[2] * W / 1000, b[3] * H / 1000].map((n) => Math.round(n));
  const draw = [];
  for (const r of rows) {
    const [x1, y1, x2, y2] = px(r.box);
    draw.push('-stroke', '#1c7ed6', '-strokewidth', '3', '-draw', `rectangle ${x1},${y1} ${x2},${y2}`);
    const n = Array.from(r.text).length;
    for (let k = 1; k < n; k++) { const x = Math.round(x1 + ((x2 - x1) * k) / n); draw.push('-strokewidth', '1', '-draw', `line ${x},${y1} ${x},${y2}`); }
    if (r.pinyin) { const [a, b, c, d] = px(r.pinyin); draw.push('-stroke', '#e03131', '-strokewidth', '2', '-draw', `rectangle ${a},${b} ${c},${d}`); }
  }
  execFileSync('magick', [photo, '-fill', 'none', ...draw, file]);
}

const report = [`# 课本页:正文的行框与拼音框(${new Date().toLocaleString('zh-CN')})`, '', `模型 ${MODEL},不想,每页 ${runs} 遍;画了框的图在 \`${out}\``, ''];
const say = (...ls) => { for (const s of ls.length ? ls : ['']) { report.push(s); console.log(s); } };

for (const photo of photos) {
  const jpeg = readFileSync(photo);
  const name = basename(photo).replace(/\.\w+$/, '');
  say(`## ${photo.replace(repo, '')}`, '');
  const got = [];
  for (let r = 1; r <= runs; r++) {
    const a = await ask(jpeg);
    if (a.error) { say(`第 ${r} 遍没成:${a.error}`); continue; }
    const file = join(out, `${name}-r${r}.jpg`);
    paint(photo, a.rows, file);
    got.push(a.rows);
    const withPy = a.rows.filter((x) => x.pinyin).length;
    say(`第 ${r} 遍:${a.rows.length} 行(${withPy} 行带拼音框),第一行 ${(a.first / 1000).toFixed(1)} 秒,全部 ${(a.ms / 1000).toFixed(1)} 秒 → ${file}`);
    for (const x of a.rows) say(`- ${x.box.join(',')}${x.pinyin ? `  拼音 ${x.pinyin.join(',')}` : ''}  ${x.text}`);
    say('');
  }
  // 两遍之间:字一样的行,框差多少(千分点)
  if (got.length >= 2) {
    const diffs = [];
    for (const x of got[0]) { const y = got[1].find((q) => q.text === x.text); if (y) diffs.push(Math.max(...x.box.map((v, i) => Math.abs(v - y.box[i])))); }
    if (diffs.length) say(`两遍都认出的 ${diffs.length} 行(第 1 遍 ${got[0].length} 行、第 2 遍 ${got[1].length} 行):框最多差 ${Math.max(...diffs)} 个千分点,中位 ${diffs.sort((a, b) => a - b)[Math.floor(diffs.length / 2)]}`, '');
  }
}
writeFileSync(join(out, 'report.md'), report.join('\n') + '\n');
console.log(`报告:${join(out, 'report.md')}`);

/*
 * 结论(2026-11-13,qwen3.8-max 不想,统编版二上第 2 课《我是什么》的课文页 010 与课后页 012,各 2 遍;是扫描的平整页,不是手拍的):
 * - 行框:准,紧贴着字。课文页 12 行、课后页 30 行(识字条、田字格一格一行、课后题、词语),没漏行;两遍之间同一行的框差 0–2 个千分点。
 * - 行里按字数等分:课文正文(带拼音、字等宽、标点占一格)每个字都落在自己那一格里,能当单字的位置用;
 *   课后题那种小字(引号、逗号只占半格)越往右越偏,偏到半个字,点字要按「离哪一格的中心最近」算,不能当紧框。
 * - 拼音框:整行带拼音的,框就是那一行拼音,准;只有个别字带拼音的行(jù、yìng…báo、guàn gài),框只套住有拼音的那一段,也对。
 * - 时间:第一行 3–4.5 秒,整页 15–21 秒;和听写认词(挑字词)差不多。
 * 还没试:手拍的照片(歪、透视、反光)。行框歪了以后等分还准不准,要拿孩子拍的真照片再跑一遍(--photo)。
 */
