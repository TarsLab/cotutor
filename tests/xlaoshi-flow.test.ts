/**
 * 小老师全流程(不花钱,《wip/小老师设想.md》):经 app.ts 的 route() 进 /xlaoshi(页面的内联脚本能解析)→ 出题 → 传原声 → 讲完了
 * (浏览器那份够:不叫 paraformer;timeline.md、frames/ 生成)→ 家长改字 → 浏览器不够又拿不到 key:记 nokey →
 * 换假的 paraformer:自动补转、家长重转(改过的行留着)、补转失败 → Claude Code 写 notes.md → 改勾 → 追问的回答(录音、笔迹)进 timeline.md →
 * 家长记一句、列表的样子、帧;边界:cotutor 别处不引用 src/xlaoshi/。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-xlaoshi-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.DASHSCOPE_API_KEY;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { xlaoshiRoute, xlaoshiIdle } = await import('../src/xlaoshi/route.ts');
const { GUIDE } = await import('../src/xlaoshi/guide.ts');

const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
let now = new Date(2026, 9, 9, 19, 30);
const ctx = createContext(loadWorkspace(root), { now: () => now });
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: J; html?: string; file?: string; body?: Uint8Array }> => {
  const r = await route(method, path, ctx, body);
  return { status: r.status, json: (r.json ?? {}) as J, html: r.html, file: r.file, body: r.body };
};
const dir = (id: string): string => join(root, 'xlaoshi', id);
const audio = `data:audio/webm;codecs=opus;base64,${Buffer.from('fake-opus-bytes').toString('base64')}`;
const lv = (spec: [number, number][]): number[] => spec.flatMap(([n, v]) => new Array(n).fill(v));
const strokes = { size: { w: 1000, h: 600 }, strokes: [
  { c: '#2b2b2b', w: 4, pts: [[100, 100, 1200], [200, 100, 1800]] },
  { c: '#2b2b2b', w: 4, pts: [[100, 200, 4000], [200, 200, 4600]] },
  { c: '#d23f1f', w: 4, pts: [[90, 90, 9500], [210, 110, 9900]] },
] };
const talk = (segs: { at: number; end: number; text: string }[], extra: J = {}): J => ({ ms: 12_000, sr: true, levels: lv([[10, 0], [80, 40], [30, 0]]), segs, strokes, audio: 'audio.webm', ...extra });
const GOOD = [{ at: 1000, end: 4500, text: '我要讲十八张贴纸分给三个人' }, { at: 5000, end: 8800, text: '我先画三个人再画十八个圈' }];

try {
  // ---- 页面 ----
  const page = await call('GET', '/xlaoshi');
  const js = /<script>([\s\S]*)<\/script>/.exec(page.html ?? '')?.[1] ?? '';
  let parses = true;
  try { new Function(js); } catch (e) { parses = false; console.error(String(e)); }
  check('GET /xlaoshi:经 app.ts 的 route() 进来,页面的内联脚本能解析', page.status === 200 && js.length > 1000 && parses);

  // ---- 出题 ----
  const empty = await call('GET', '/api/xlaoshi');
  check('列表:一开始是空的;给 Claude Code 的说明写进 xlaoshi/怎么看.md', empty.status === 200 && empty.json.sessions.length === 0 && empty.json.hasKey === false && readFileSync(join(root, 'xlaoshi', '怎么看.md'), 'utf8') === GUIDE);
  check('xlaoshi/ 整个不进 git:自己放一份 .gitignore(*)', readFileSync(join(root, 'xlaoshi', '.gitignore'), 'utf8').split('\n').includes('*'));
  check('出题:没写题目 400', (await call('POST', '/api/xlaoshi', { topic: '  ' })).status === 400);
  const a = (await call('POST', '/api/xlaoshi', { topic: '18 张贴纸平均分给 3 个人,每人几张?' })).json.id as string;
  const a2 = (await call('POST', '/api/xlaoshi', { topic: '同一分钟又一题' })).json.id as string;
  check('出题:id 是日期-时分,同一分钟加 -2;topic.md、session.json 落盘', a === '2026-10-09-1930' && a2 === '2026-10-09-1930-2' && readFileSync(join(dir(a), 'topic.md'), 'utf8').startsWith('# 18 张贴纸'));

  // ---- 讲完了:浏览器那份够 ----
  check('讲完了:原声还没传就交 talk → 400', (await call('PUT', `/api/xlaoshi/${a}/talk`, talk(GOOD))).status === 400);
  const up = await call('PUT', `/api/xlaoshi/${a}/audio`, { data: audio });
  check('传原声:落成 audio.webm', up.status === 200 && up.json.audio === 'audio.webm' && readFileSync(join(dir(a), 'audio.webm'), 'utf8') === 'fake-opus-bytes');
  check('传原声:不是音频 400', (await call('PUT', `/api/xlaoshi/${a}/audio`, { data: 'data:image/png;base64,AAAA' })).status === 400);
  const t1 = await call('PUT', `/api/xlaoshi/${a}/talk`, talk(GOOD));
  check('讲完了:浏览器那份够 → 不叫 paraformer', t1.status === 200 && t1.json.need === false && t1.json.asr === null, JSON.stringify(t1.json));
  const tr1 = JSON.parse(readFileSync(join(dir(a), 'transcript.json'), 'utf8'));
  check('讲完了:transcript.json 是浏览器的,一段一行', tr1.source === 'browser' && tr1.lines.length === 2 && tr1.lines[1].at === 5000);
  const tl = readFileSync(join(dir(a), 'timeline.md'), 'utf8');
  const frames = readdirSync(join(dir(a), 'frames'));
  check('讲完了:timeline.md 一句一行、frames/ 每段结束时一张', tl.includes('| 0:01–0:05 | 我要讲十八张贴纸分给三个人 | 2 笔 | frames/0005.png |') && frames.includes('0005.png') && frames.includes('0012.png'), `${tl}\n${frames}`);
  check('讲完了:再交一次 409,原声也不能再传', (await call('PUT', `/api/xlaoshi/${a}/talk`, talk(GOOD))).status === 409 && (await call('PUT', `/api/xlaoshi/${a}/audio`, { data: audio })).status === 409);
  check('讲完了:形状不对 400', (await call('PUT', `/api/xlaoshi/${a2}/talk`, { ms: 1, sr: true, levels: [999], segs: [], strokes, audio: null })).status === 400);
  const au = await call('GET', `/api/xlaoshi/${a}/audio`);
  check('原声能取回(发文件)', au.status === 200 && au.file === join(dir(a), 'audio.webm'));

  // ---- 家长改字 ----
  const ed = await call('PUT', `/api/xlaoshi/${a}/transcript`, { lines: ['我要讲十八张贴纸分给三个人', '我先画三个人,再画十八个圈'] });
  check('改字:那行标 edited;timeline.md 说家长改了 1 处', ed.status === 200 && ed.json.lines[1].edited === true && readFileSync(join(dir(a), 'timeline.md'), 'utf8').includes('家长改了 1 处'));
  check('改字:行数不对 400', (await call('PUT', `/api/xlaoshi/${a}/transcript`, { lines: ['一行'] })).status === 400);

  // ---- 浏览器不够,拿不到 key ----
  now = new Date(2026, 9, 9, 19, 40);
  const b = (await call('POST', '/api/xlaoshi', { topic: '13 − 8 怎么算' })).json.id as string;
  await call('PUT', `/api/xlaoshi/${b}/audio`, { data: audio });
  const t2 = await call('PUT', `/api/xlaoshi/${b}/talk`, talk([{ at: 1000, end: 3000, text: '十三减八' }]));
  check('浏览器不够(有声没字)、拿不到 key → 记 nokey,浏览器那份留着', t2.json.need === true && t2.json.why === '有声没字 0:03–0:09' && t2.json.asr === 'nokey' && JSON.parse(readFileSync(join(dir(b), 'talk.json'), 'utf8')).asr.state === 'nokey' && JSON.parse(readFileSync(join(dir(b), 'transcript.json'), 'utf8')).source === 'browser', JSON.stringify(t2.json));
  check('拿不到 key 时家长重转 → 400 nokey', (await call('POST', `/api/xlaoshi/${b}/transcribe`)).json.error === 'nokey');

  // ---- 假的 paraformer ----
  let calls = 0;
  let fail = false;
  const deps = {
    hasKey: () => true,
    transcribe: async (file: string) => {
      calls++;
      if (fail) throw new Error('paraformer 出错:InvalidParameter');
      if (!existsSync(file)) throw new Error('没有文件');
      return [{ begin: 900, end: 4000, text: '我要讲十八张贴纸分给三个人。' }, { begin: 4200, end: 9000, text: '我先画三个人,然后再画十八个圈。' }];
    },
  };
  const xr = (method: string, path: string, body?: unknown) => xlaoshiRoute(method, new URL(path, 'http://x'), ctx, body, deps);
  now = new Date(2026, 9, 9, 19, 50);
  const c = (((await xr('POST', '/api/xlaoshi', { topic: '静夜思在说什么' }))!.json) as J).id as string;
  await xr('PUT', `/api/xlaoshi/${c}/audio`, { data: audio });
  const t3 = (await xr('PUT', `/api/xlaoshi/${c}/talk`, talk([], { sr: false })))!.json as J;
  check('这台没有识别 → 自动叫 paraformer(后台)', t3.need === true && t3.why === '这台没有浏览器识别' && t3.asr === 'started', JSON.stringify(t3));
  check('补转在跑时再叫 → 409', (await xr('POST', `/api/xlaoshi/${c}/transcribe`))!.status === 409);
  await xlaoshiIdle();
  const tr3 = JSON.parse(readFileSync(join(dir(c), 'transcript.json'), 'utf8'));
  const talk3 = JSON.parse(readFileSync(join(dir(c), 'talk.json'), 'utf8'));
  check('补转完:transcript.json 换成 paraformer 的、带原因;talk.json 记 done;timeline.md 跟着变', tr3.source === 'paraformer' && tr3.why === '这台没有浏览器识别' && tr3.lines.length === 2 && talk3.asr.state === 'done' && readFileSync(join(dir(c), 'timeline.md'), 'utf8').includes('转写:paraformer(这台没有浏览器识别)'), JSON.stringify(tr3));
  await xr('PUT', `/api/xlaoshi/${c}/transcript`, { lines: ['我要讲十八张贴纸分给三个人。', '我先画三个人,再画十八个圈。'] });
  const re = await xr('POST', `/api/xlaoshi/${c}/transcribe`);
  await xlaoshiIdle();
  const tr4 = JSON.parse(readFileSync(join(dir(c), 'transcript.json'), 'utf8'));
  check('家长重转:202;改过的那行留着,原因写「家长重转」', re!.status === 202 && calls === 2 && tr4.why === '家长重转' && tr4.lines.length === 2 && tr4.lines[1].text === '我先画三个人,再画十八个圈。' && tr4.lines[1].edited === true, JSON.stringify(tr4));
  fail = true;
  await xr('POST', `/api/xlaoshi/${c}/transcribe`);
  await xlaoshiIdle();
  const talk5 = JSON.parse(readFileSync(join(dir(c), 'talk.json'), 'utf8'));
  check('补转失败:talk.json 记 failed 和原因,转写不动', talk5.asr.state === 'failed' && talk5.asr.error.includes('InvalidParameter') && JSON.parse(readFileSync(join(dir(c), 'transcript.json'), 'utf8')).why === '家长重转');

  fail = false;
  await xr('POST', `/api/xlaoshi/${c}/asks`, { q: '再讲讲?', heard: '', note: '', ms: 3000, audio });
  await xlaoshiIdle();
  const askC = JSON.parse(readFileSync(join(dir(c), 'asks.json'), 'utf8'));
  check('追问的回答浏览器没认出字 → paraformer 补上,timeline.md 注明', askC[0].heard.startsWith('我要讲十八张贴纸') && askC[0].heardBy === 'paraformer' && readFileSync(join(dir(c), 'timeline.md'), 'utf8').includes('他说(paraformer 转的):我要讲'), JSON.stringify(askC));

  // ---- Claude Code 写 notes.md,家长改勾 ----
  writeFileSync(join(dir(a), 'notes.md'), '# 初步理解\n\n## 讲到了\n- 三个人、十八个 @0:05\n\n## 追问\n- [x] 你说先画三个人,再讲讲为什么? @0:05-0:09\n  放他那段\n- [ ] 18 ÷ 3 的 3 是哪个?\n');
  const s1 = (await call('GET', `/api/xlaoshi/${a}`)).json;
  check('GET 一次讲课:带解析好的 notes、要问的有 1 个', s1.notes === true && s1.questions === 1 && s1.notesParsed.sections[1].ask === true && s1.notesParsed.sections[1].items[0].from === 5000, JSON.stringify(s1.notesParsed));
  const chk = await call('PUT', `/api/xlaoshi/${a}/check`, { line: s1.notesParsed.sections[1].items[1].line, on: true });
  check('改勾:写回 notes.md;不是一条追问的行 400', chk.status === 200 && readFileSync(join(dir(a), 'notes.md'), 'utf8').includes('- [x] 18 ÷ 3') && (await call('PUT', `/api/xlaoshi/${a}/check`, { line: 0, on: true })).status === 400);

  // ---- 追问的回答 ----
  const ask = await call('POST', `/api/xlaoshi/${a}/asks`, { q: '你说先画三个人,再讲讲为什么?', heard: '因为要分给三个人', note: '这次说清楚了', ms: 4000, strokes: { size: { w: 500, h: 300 }, strokes: [{ c: '#2f6fd6', w: 4, pts: [[10, 10, 100], [50, 50, 300]] }] }, audio });
  check('追问的回答:存下录音和笔迹;timeline.md 末尾多一节;有它的帧', ask.status === 201 && existsSync(join(dir(a), 'asks', '1.webm')) && readFileSync(join(dir(a), 'timeline.md'), 'utf8').includes('## 追问的回答') && existsSync(join(dir(a), 'frames', 'ask-1.png')));
  check('追问的回答:录音能取回;缺字段 400', (await call('GET', `/api/xlaoshi/${a}/asks/1`)).file === join(dir(a), 'asks', '1.webm') && (await call('POST', `/api/xlaoshi/${a}/asks`, { q: '' })).status === 400);

  // ---- 家长记一句、列表、帧 ----
  check('家长记一句', (await call('PUT', `/api/xlaoshi/${a2}/memo`, { memo: '他说不想录' })).status === 200);
  const list = (await call('GET', '/api/xlaoshi')).json.sessions as J[];
  const la = list.find((s) => s.id === a)!;
  const la2 = list.find((s) => s.id === a2)!;
  check('列表:新的在前;每行走到哪一步', list[0].id === c && la.ms === 12_000 && la.strokes === 3 && la.transcript.edited === 1 && la.notes && la.asks === 1 && la.questions === 2 && la2.ms === null && la2.memo === '他说不想录', JSON.stringify(list));
  const fr = await call('GET', `/api/xlaoshi/${a}/frame.png?t=2000&w=200`);
  check('帧:那一刻的 PNG', fr.status === 200 && Buffer.from(fr.body!).subarray(1, 4).toString() === 'PNG' && Buffer.from(fr.body!).readUInt32BE(16) === 200);
  check('不认的 id 404、不认的动作 405', (await call('GET', '/api/xlaoshi/../../etc')).status === 404 && (await call('GET', '/api/xlaoshi/2026-01-01-0000')).status === 404 && (await call('DELETE', `/api/xlaoshi/${a}`)).status === 405);

  // ---- 边界 ----
  const SRC = fileURLToPath(new URL('../src/', import.meta.url));
  const offenders: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'xlaoshi') walk(f); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const hits = readFileSync(f, 'utf8').split('\n').filter((l) => /from ['"][^'"]*xlaoshi\//.test(l));
      if (hits.length && !(f.endsWith(join('server', 'app.ts')) && hits.length === 1 && hits[0].includes("'../xlaoshi/route.ts'"))) offenders.push(f);
    }
  };
  walk(SRC);
  check('边界:cotutor 别处不引用 src/xlaoshi/,只有 app.ts 一处引 route.ts', offenders.length === 0, offenders.join(', '));
} finally {
  await xlaoshiIdle();
}
done();
