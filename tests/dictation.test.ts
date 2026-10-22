/**
 * 听写(不花钱,《听写设计.md》):比对(照 hanzi-writer 的一笔像不像 + 写完一起配对)→ 听写卡的解析与剥字 →
 * 经 app.ts 的 route() 走一遍:首页发布 → 孩子端首页没有字 → 开始 / 接着 → 念(假配音;没音色提示叫家长)→ 一个词一个词交 →
 * 交卷前拿不到字 → 交卷:少一笔、写成别字、空着的问「再写一遍?」,笔顺只记给家长 → 再写一遍 → 对好了 → 家长看 → 首页换了 → 边界。
 * 孩子写的字用 hanzi-writer-data 的中线加抖动模拟(和真笔迹一样是 [x, y, t] 的点列,坐标 1024 见方、y 向上)。
 */
import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-dictation-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { publishHome, checkHome } = await import('../src/server/home.ts');
const { parseCard, stripSecrets } = await import('../src/cards/index.ts');
const { judgeChar, placeNote, strokeFit } = await import('../src/dictation/lib/match.ts');
const { LineReader, photoPrompt, recognizePhoto, splitWords } = await import('../src/dictation/recognize.ts');
const { dictationDeps, handleDictation, parseChars, photosIdle } = await import('../src/dictation/route.ts');
const { tianzigeData } = await import('../src/server/tianzige.ts');

type InkPoint = [number, number, number];
const medians = async (ch: string): Promise<number[][][]> => (await tianzigeData(ch))!.medians;

// ---- 模拟孩子写的字:沿中线加密、整字缩放平移、每笔偏一点、每点抖一点 ----
let seed = 7;
const rnd = (): number => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
const jit = (a: number): number => (rnd() * 2 - 1) * a;
async function write(ch: string, o: { s?: number; dx?: number; dy?: number; skip?: number[]; order?: number[] } = {}): Promise<InkPoint[][]> {
  const med = await medians(ch);
  const { s = 0.9, dx = 0, dy = 0, skip = [] } = o;
  const idx = o.order ?? med.map((_, i) => i);
  let t = 0;
  return idx.filter((i) => !skip.includes(i)).map((i) => {
    const m = med[i];
    const ox = jit(14), oy = jit(14);
    const pts: InkPoint[] = [];
    for (let k = 0; k < m.length; k++) {
      const b = m[Math.min(k + 1, m.length - 1)];
      const n = k < m.length - 1 ? 6 : 1;
      for (let q = 0; q < n; q++) {
        const x = m[k][0] + ((b[0] - m[k][0]) * q) / n, y = m[k][1] + ((b[1] - m[k][1]) * q) / n;
        pts.push([Math.round((x - 512) * s + 512 + dx + ox + jit(9)), Math.round((y - 388) * s + 388 + dy + oy + jit(9)), (t += 16)]);
      }
    }
    t += 300;
    return pts;
  });
}
const cell = (strokes: InkPoint[][]): { strokes: InkPoint[][]; undos: number } => ({ strokes, undos: 0 });

// ---- 比对 ----
{
  const med = (await medians('一'))[0].map(([x, y]) => ({ x, y }));
  check('一笔:照着中线写像;倒着写不像但认出写反了;写在别处不像', strokeFit(med, med).isMatch && strokeFit([...med].reverse(), med).backwards && !strokeFit(med.map((p) => ({ x: p.x, y: p.y - 500 })), med).isMatch);
  const ok = judgeChar(await write('鼓'), await medians('鼓'));
  check('写全了:13 笔都配上,不问', ok.judged && !ok.ask && ok.std === 13 && ok.wrote === 13 && ok.missing.length === 0 && ok.order, JSON.stringify(ok));
  const miss = judgeChar(await write('鼓', { skip: [6] }), await medians('鼓'));
  check('少一笔(豆下面的点):missing = [6],问「再写一遍」', miss.ask && miss.missing.join() === '6' && miss.extra.length === 0, JSON.stringify(miss));
  const bie = judgeChar(await write('页'), await medians('叶'));
  check('写成别字(叶写成页):大半对不上,问', bie.ask && bie.missing.length >= 3, JSON.stringify(bie));
  const ord = judgeChar(await write('天', { order: [0, 2, 1, 3] }), await medians('天'));
  check('笔顺(先撇后横):字全了不问,order = false 给家长', !ord.ask && !ord.order && ord.matched.join() === '0,2,1,3', JSON.stringify(ord));
  const small = judgeChar(await write('朵', { s: 0.6, dx: -170, dy: -80 }), await medians('朵'));
  check('写小写偏:挪进标准框照样配上,不问;占格「偏小、偏左」给家长', !small.ask && placeNote(small.place) === '偏小、偏左', JSON.stringify(small.place));
  const empty = judgeChar([], await medians('天'));
  check('空着:问,四笔都算少', empty.ask && empty.empty && empty.missing.length === 4);
  const rare = judgeChar(await write('天'), null);
  check('数据里没有的字:不判、不问', !rare.judged && !rare.ask);
}

// ---- 听写卡 ----
{
  const p = parseCard('dictation chinese-tutor', '- 春天\n鼓励 鼓励,老师鼓励我的鼓励\n\n叶 树叶的叶', 'home');
  check('听写卡:一行一个词,念法空一格写在后面,列表符号去掉', p.card.kind === 'dictation' && !p.warning && JSON.stringify(p.card.props) === JSON.stringify({ tutor: 'chinese-tutor', words: [{ chars: '春天' }, { chars: '鼓励', say: '鼓励,老师鼓励我的鼓励' }, { chars: '叶', say: '树叶的叶' }] }), JSON.stringify(p));
  check('听写卡:板书里不能用,退文字卡', parseCard('dictation', '春天', 'board').card.kind === 'text');
  check('听写卡:夹拼音、超过四个字、空的都解析不成', ['鼓励gǔlì', '画蛇添足画', ''].every((b) => parseCard('dictation', b, 'home').card.kind === 'text'));
  const kid = stripSecrets({ cards: [p.card], lines: [] }).cards[0];
  check('孩子端:字与念法都剥掉,只剩几个词', JSON.stringify(kid.props) === JSON.stringify({ tutor: 'chinese-tutor', words: [], count: 3 }));
}

// ---- 全流程 ----
const FAKE_TTS = fileURLToPath(new URL('./_fake-tts.ts', import.meta.url));
const node = process.execPath;
const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
cfg.tts = { say: [node, '--experimental-strip-types', '--no-warnings', FAKE_TTS, '{text}', '--voice', '{voice}', '--json', '-o', '{out}'], voices: [node, '--experimental-strip-types', '--no-warnings', FAKE_TTS, 'voices', '--json'] };
cfg.tutors['chinese-tutor'].voice = 'v-kid';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

let now = new Date(2026, 9, 10, 19, 30);
const ctx = createContext(loadWorkspace(root), { now: () => now });
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: J; html?: string; file?: string }> => {
  const r = await route(method, path, ctx, body);
  return { status: r.status, json: (r.json ?? {}) as J, html: r.html, file: r.file };
};
const parses = (html: string | undefined): boolean => {
  const js = /<script>([\s\S]*)<\/script>/.exec(html ?? '')?.[1] ?? '';
  try {
    new Function(js);
    return js.length > 1000;
  } catch (e) {
    console.error(String(e));
    return false;
  }
};
const publish = async (md: string): Promise<string> => {
  writeFileSync(join(root, 'home', 'draft.md'), md);
  const r = await publishHome(ctx.ws, { force: true, now });
  return r.home!.id;
};

try {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(root, 'home'), { recursive: true });
  const DRAFT = '```dictation\n春天\n鼓励 鼓励,老师鼓励我的鼓励\n叶 树叶的叶\n雪\n```\n\n## 为什么这么排\n\n第 5 课的生字\n';
  const homeId = await publish(DRAFT);

  const kh = (await call('GET', '/api/kid/home')).json;
  const card = kh.cards.find((c: J) => c.kind === 'dictation');
  check('孩子端首页:听写卡只有几个词,没有字', card && card.props.count === 4 && card.props.words.length === 0 && !JSON.stringify(kh).includes('鼓励'), JSON.stringify(card));

  check('GET /dictation 与 /parent/dictation:经 app.ts 的 route() 进来,内联脚本能解析', parses((await call('GET', '/dictation')).html) && parses((await call('GET', '/parent/dictation')).html));

  // ---- 开始 ----
  check('开始:要 {home, n}', (await call('POST', '/api/dictation', { n: 0 })).status === 400 && (await call('POST', '/api/dictation', { home: homeId, n: 1 })).status === 404);
  const st = await call('POST', '/api/dictation', { home: homeId, n: 0 });
  const id = st.json.id as string;
  check('开始:201,id 是日期-时分;只给几个字一个词,没有字;语文老师念', st.status === 201 && id === '2026-10-10-1930' && st.json.sizes.join() === '2,2,1,1' && st.json.tutor === '语文老师' && st.json.voice === true && !JSON.stringify(st.json).includes('春') && st.json.answers === null, JSON.stringify(st.json));
  check('dictation/ 整个不进 git', readFileSync(join(root, 'dictation', '.gitignore'), 'utf8').split('\n').includes('*'));
  const again = await call('POST', '/api/dictation', { home: homeId, n: 0 });
  check('今天这张卡开过、没对好:再点进来接着那一次', again.status === 200 && again.json.id === id);

  // ---- 念 ----
  const say = await call('GET', `/api/dictation/${id}/say/1`);
  check('念:用语文老师的音色合成,缓存在 .cotutor/dictation-say/', say.status === 200 && say.file !== undefined && readFileSync(say.file!, 'utf8') === 'fake-mp3:v-kid:鼓励,老师鼓励我的鼓励' && say.file!.includes(join('.cotutor', 'dictation-say')));
  check('念:?text=1 给要念的字;没写念法念词本身', (await call('GET', `/api/dictation/${id}/say/1?text=1`)).json.text === '鼓励,老师鼓励我的鼓励' && (await call('GET', `/api/dictation/${id}/say/0?text=1`)).json.text === '春天');

  // ---- 一个词一个词交 ----
  check('交:格数对不上 400', (await call('PUT', `/api/dictation/${id}/first/0`, { chars: [cell(await write('春'))] })).status === 400);
  check('交:点的形状不对 400', (await call('PUT', `/api/dictation/${id}/first/0`, { chars: [{ strokes: [[[1, 2]]] }, cell([])] })).status === 400);
  const put = async (i: number, chars: InkPoint[][][]): Promise<number> => (await call('PUT', `/api/dictation/${id}/first/${i}`, { chars: chars.map(cell) })).status;
  // 春天:天的笔顺反了;鼓励:鼓少一笔;叶:写成页;雪:没写
  const s1 = await put(0, [await write('春'), await write('天', { order: [0, 2, 1, 3] })]);
  const s2 = await put(1, [await write('鼓', { skip: [6] }), await write('励')]);
  const s3 = await put(2, [await write('页')]);
  check('交:三个词各 200', s1 === 200 && s2 === 200 && s3 === 200);
  const mid = (await call('GET', `/api/dictation/${id}/kid`)).json;
  check('交卷前:写了哪几个;还是没有字', mid.written.join() === 'true,true,true,false' && mid.answers === null && !JSON.stringify(mid).includes('鼓'));

  // ---- 交卷 ----
  const ck = (await call('POST', `/api/dictation/${id}/check`)).json;
  const asks = ck.answers.map((w: J) => w.ask).join();
  check('交卷:字下发;少一笔、写成别字、空着的问「再写一遍?」,笔顺反了的不问', ck.checked && ck.answers.map((w: J) => w.chars).join() === '春天,鼓励,叶,雪' && asks === 'false,true,true,true', asks);
  check('交卷:孩子端只有字、问不问、笔迹,没有判的细节', !JSON.stringify(ck).includes('missing') && !JSON.stringify(ck).includes('order') && ck.answers[1].ink[0].length === 12);
  check('交卷后第一遍不能改(409);再交一次卷照旧', (await call('PUT', `/api/dictation/${id}/first/0`, { chars: [cell([]), cell([])] })).status === 409 && (await call('POST', `/api/dictation/${id}/check`)).json.answers[1].ask === true);

  // ---- 对答案时做的事、再写一遍 ----
  check('事件:逐笔看了鼓;坏的 400', (await call('POST', `/api/dictation/${id}/events`, { kind: 'strokeOrder', word: 1, char: 0 })).status === 200 && (await call('POST', `/api/dictation/${id}/events`, { kind: 'peek', word: 1 })).status === 400 && (await call('POST', `/api/dictation/${id}/events`, { kind: 'strokeOrder', word: 9 })).status === 400);
  const rw = (await call('POST', `/api/dictation/${id}/rewrites/1`, { chars: [cell(await write('鼓')), cell(await write('励'))] })).json;
  check('再写一遍:这个词不再问,标 rewrote,笔迹换成新写的', rw.answers[1].ask === false && rw.answers[1].rewrote === true && rw.answers[1].ink[0].length === 13);
  const self = (await call('POST', `/api/dictation/${id}/rewrites/0`, { chars: [cell(await write('春')), cell(await write('天'))], self: true })).json;
  check('自己说「我想再写」:照样记下', self.answers[0].rewrote === true);
  check('对好了', (await call('POST', `/api/dictation/${id}/done`)).status === 200 && (await call('GET', `/api/dictation/${id}/kid`)).json.done === true);

  // ---- 家长 ----
  const list = (await call('GET', '/api/dictation')).json.sessions;
  check('家长列表:一次,4 个词里第一遍写全 1 个,问了 3 个', list.length === 1 && list[0].firstOk === 1 && list[0].asked === 3 && list[0].done, JSON.stringify(list));
  const ink = list[0].ink as ({ d: string[]; shown: boolean; again: boolean } | null)[];
  check('家长列表:每个词最近写的那遍,一格一条 path(鼓励是重写的那遍、标 again);没写的雪是空的;要再练的是重写过与被问了的', ink.length === 4 && ink[1]!.d.length === 2 && /^M\d+ \d+L/.test(ink[1]!.d[0]) && (ink[1]!.d[0].match(/M/g) ?? []).length === 13 && ink[1]!.again && !ink[2]!.again && (ink[3] === null || ink[3].d.every((d) => d === '')) && list[0].practice.join() === '春天,鼓励,叶,雪' && typeof list[0].doneAt === 'string', JSON.stringify(ink[1]).slice(0, 200));
  const full = (await call('GET', `/api/dictation/${id}`)).json;
  check('家长全量:天的笔顺、鼓少的第 7 笔、自己重写、逐笔看过', full.first[0].judges[1].order === false && full.first[1].judges[0].missing.join() === '6' && full.rewrites.length === 2 && full.rewrites[1].self === true && full.events.some((e: J) => e.kind === 'strokeOrder' && e.word === 1));

  // ---- 再听写一次、首页换了 ----
  const fresh = await call('POST', '/api/dictation', { home: homeId, n: 0, fresh: true });
  check('再听写一次(fresh):另开一次,同一分钟加 -2', fresh.status === 201 && fresh.json.id === '2026-10-10-1930-2');

  // ---- 不会写,给答案:看笔顺,照着描红写一遍(拍板 8);事件带孩子端的时刻,录像按它排 ----
  {
    const fid = fresh.json.id as string;
    check('孩子端样子带开始时刻与自己写过的(笔迹不是答案)', typeof fresh.json.startedAt === 'string' && fresh.json.mine.every((m: unknown) => m === null));
    check('事件:show / say 带 t 与第几遍;坏的 t、坏的种类 400;reveal 不能从 events 记', (await call('POST', `/api/dictation/${fid}/events`, { kind: 'show', word: 1, t: 120 })).status === 200 && (await call('POST', `/api/dictation/${fid}/events`, { kind: 'say', word: 1, t: 300, n: 2 })).status === 200 && (await call('POST', `/api/dictation/${fid}/events`, { kind: 'say', word: 1, t: -5 })).status === 400 && (await call('POST', `/api/dictation/${fid}/events`, { kind: 'reveal', word: 1, char: 0 })).status === 400);
    const rv = await call('POST', `/api/dictation/${fid}/reveal/1`, { char: 0, t: 9100 });
    check('给答案:回这一个字(只这一个),记一条 reveal;第几个字越界 400', rv.status === 200 && rv.json.ch === '鼓' && !JSON.stringify(rv.json).includes('励') && (await call('POST', `/api/dictation/${fid}/reveal/1`, { char: 2 })).status === 400);
    const traced = (await write('鼓', { skip: [6, 7] })).map((st) => st.map(([x, y, t]) => [x, y, t + 10_000] as InkPoint));
    await call('PUT', `/api/dictation/${fid}/first/1`, { chars: [{ strokes: traced, undos: 0, revealed: true }, cell(await write('励'))] });
    for (const k of [0, 2, 3]) await call('PUT', `/api/dictation/${fid}/first/${k}`, { chars: Array.from(['春天', '', '叶', '雪'][k] || 'x').map(() => cell([])) });
    const fck = (await call('POST', `/api/dictation/${fid}/check`)).json;
    check('看过答案的词:交卷不问「再写一遍?」(照着写过了),孩子端标 revealed;别的照问', fck.answers[1].ask === false && fck.answers[1].revealed === true && fck.answers[0].ask === true);
    check('给答案在交卷后 409', (await call('POST', `/api/dictation/${fid}/reveal/0`, { char: 0 })).status === 409);
    const ff = (await call('GET', `/api/dictation/${fid}`)).json;
    const evs = ff.events.map((e: J) => `${e.kind}:${e.word}:${e.t ?? '-'}${e.n ? ':' + e.n : ''}`).join();
    check('全量:鼓记 revealed、笔迹的 t 原样;事件 show / say(第 2 遍)/ reveal 都带 t', ff.first[1].chars[0].revealed === true && ff.first[1].chars[0].strokes[0][0][2] >= 10_000 && evs === 'show:1:120,say:1:300:2,reveal:1:9100', evs);
    const lst = (await call('GET', '/api/dictation')).json.sessions.find((x: J) => x.id === fid);
    check('家长列表:看了答案的 1 个,不算「自己写全」', lst.revealed === 1 && lst.firstOk === 0, JSON.stringify(lst));
    check('录像页:/parent/dictation/reel 内联脚本能解析', parses((await call('GET', '/parent/dictation/reel')).html));
    // 录像要的(《家长录像设计.md》拍板 13):擦掉的笔、屏幕尺寸、我来写、点格子回去改、回到对一对、切到别处 / 回来
    const pc = parseChars({ chars: [{ strokes: [[[1, 2, 3]]], undos: 2, gone: [{ t: 50, pts: [[4, 5, 6], [7, 8, 9]] }, { t: 'x', pts: [[1, 1, 1]] }, { t: 60, pts: [[1]] }] }] }, 1);
    check('擦掉的笔(gone)照收,坏的那几条丢掉、留下的笔不受影响', pc?.[0].gone?.length === 1 && pc[0].gone![0].t === 50 && pc[0].gone![0].pts.length === 2 && pc[0].strokes.length === 1, JSON.stringify(pc));
    check('没有擦掉的笔就不带 gone', parseChars({ chars: [{ strokes: [], undos: 0 }] }, 1)?.[0].gone === undefined);
    const okEv = async (b: unknown): Promise<number> => (await call('POST', `/api/dictation/${fid}/events`, b)).status;
    const st = [await okEv({ kind: 'view', word: 0, t: 10, w: 1180, h: 820 }), await okEv({ kind: 'trace', word: 1, char: 0, t: 20 }), await okEv({ kind: 'open', word: 1, char: 1, t: 30 }), await okEv({ kind: 'close', word: 1, t: 40 }), await okEv({ kind: 'away', word: 1, t: 50 }), await okEv({ kind: 'back', word: 1, t: 60 }), await okEv({ kind: 'view', word: 0, t: 70 })];
    const fv = (await call('GET', `/api/dictation/${fid}`)).json.events.find((e: J) => e.kind === 'view');
    check('事件:view 带屏幕尺寸;trace / open / close / away / back 都收;view 没尺寸 400', st.join() === '200,200,200,200,200,200,400' && fv.w === 1180 && fv.h === 820, st.join());
    // 写字格的档(《听写设计.md》拍板 30):view 顺带记,认不得的档不记
    await okEv({ kind: 'view', word: 0, t: 80, w: 1180, h: 820, pad: 's' }); await okEv({ kind: 'view', word: 0, t: 90, w: 1180, h: 820, pad: 'x' });
    const pv = (await call('GET', `/api/dictation/${fid}`)).json.events.filter((e: J) => e.kind === 'view');
    check('事件:view 带写字格的档(s),认不得的不记;老的那条没有', pv.length === 3 && pv[0].pad === undefined && pv[1].pad === 's' && pv[2].pad === undefined, JSON.stringify(pv));
    const zh = (await import('../src/dictation/page.ts')).DICTATION_PAGE;
    check('看笔顺(拍板 31):没有「我来写」;落笔、放完都换成照着写,换字也半秒保护', !zh.includes('<span>我来写</span>') && !zh.includes('l-trace') && zh.includes("pad.onDown = function () { if (S.w && S.w.pad === pad && S.w.mode === 'order') toTrace(); }") && zh.includes("w.mode === 'order') toTrace(); }, 900)") && zh.includes('renderFoot(); renderBook(); guard();'));
    check('写字屏有三档写字格(小 中 大),cookie 记 cotutor_dict_pad;再写一遍也照档封顶', ['s', 'm', 'l'].every((k) => zh.includes(`data-pad="${k}"`)) && zh.includes('cotutor_dict_pad=') && zh.includes('Math.min(PAD_CAP[S.padl], Math.floor(Math.min((w - (count - 1) * 24)'));
    const reelPage = (await call('GET', '/dictation?reel=' + fid)).html ?? '';
    check('听写页内联了录像(drBuild / drFrameAt / drClock),脚本能解析;录像外壳带录像栏', parses(reelPage) && reelPage.includes('function drBuild(') && reelPage.includes('function drFrameAt(') && reelPage.includes('function drClock(') && !reelPage.includes('/parent') && ((await call('GET', '/parent/dictation/reel')).html ?? '').includes('id="rl-seek"'));
  }
  now = new Date(2026, 9, 10, 20, 0);
  const home2 = await publish(DRAFT.replace('雪\n', '雪花\n'));
  check('首页换过了:旧首页的卡 404(页面叫孩子回首页)', home2 !== homeId && (await call('POST', '/api/dictation', { home: homeId, n: 0 })).status === 404 && (await call('POST', '/api/dictation', { home: home2, n: 0 })).status === 201);

  // ---- 没有音色 ----
  cfg.tutors['chinese-tutor'].voice = undefined;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await ctx.reload();
  check('没配音色:音频 404;会话带 voice: false(孩子端不开始、直接提示叫家长,不念浏览器合成声)', (await call('GET', `/api/dictation/${id}/say/3`)).status === 404 && (await call('GET', `/api/dictation/${id}/kid`)).json.voice === false);

  {
    const pages = readFileSync(new URL('../src/dictation/page.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/dictation/en-page.ts', import.meta.url), 'utf8');
    const unlockJs = readFileSync(new URL('../src/dictation/unlock.ts', import.meta.url), 'utf8');
    check('听写两页不念浏览器合成声(没音色、合成失败直接提示叫家长;解锁也不碰它)', !/speechSynthesis|SpeechSynthesisUtterance/.test(pages + unlockJs) && (pages.match(/叫爸爸妈妈来看一下/g) ?? []).length === 2);
  }

  // ---- 首页检查 ----
  const chk = await checkHome(ctx.ws, '```dictation nobody-tutor\n春天\n```\n\n## 为什么这么排\n\n试\n', now);
  check('首页检查:听写卡写的老师不在 cotutor.json,提醒会换人念', chk.issues.some((x) => x.level === 'note' && x.text.includes('nobody-tutor')), JSON.stringify(chk.issues));

  // ---- 拍照认词表:按行收 ----
  {
    const seen: number[] = [];
    const r = new LineReader((p) => seen.push(p.items.length + p.full.length));
    for (const piece of ['```json\n{"lesson": "堆雪', '人"}\n{"text": "当", "kind": "mark", "pick": true, "box": [400, 580, 430, 620], "sure": true, "say": "当,用胡萝卜当鼻子"}\n{"text": "雪', '白", "kind": "mark", "pick": false, "box": [650, 310, 690, 350], "sure": false}\n', '{"text": "脑袋", "kind": "word"}\n{"text": "披", "kind": "read"}\n{"text": "当", "kind": "mark"}\n{"text": "pí", "kind": "char"}\n{"text": "画蛇添足啊", "kind": "word"}\n{"text": "两", "kind": "char", "box": [700, 10, 600, 50]}\n{"full": "冬天  来 啦 !"}\n{"full": "一场 大雪 过后"}\n```']) r.push(piece);
    r.end();
    check('按行收:课名、一项一行、断在半行也接得上;代码块围栏、重复的、不是汉字的、超过四个字的丢;框反了当没给', r.lesson === '堆雪人' && r.items.map((x) => x.text).join() === '当,雪白,脑袋,披,两' && r.items[1].sure === false && r.items[1].say === null && r.items[4].box === null && JSON.stringify(r.items[0].box) === '[400,580,430,620]', JSON.stringify(r.items));
    check('默认选不选:模型说了照它(雪白 false);没说按栏(词语、写字选,识字不选)', r.items[0].pick && !r.items[1].pick && r.items[2].pick && !r.items[3].pick && r.items[4].pick);
    check('全文:一行一个字符串,重新分好词;每认出一行交一次进度', r.full.join('|') === '冬天 来 啦 !|一 场 大雪 过后' && seen.length === 8 && seen[seen.length - 1] === 7, JSON.stringify(seen));
    const sw = splitWords('冬天来啦!一场大雪过后,大地一片雪白。');
    check('全文分词:不管模型连着写还是每个字都空格,都去掉空格重新分', sw.split(' ').includes('雪白') && sw.split(' ').includes('大雪') && splitWords('一 场 大 雪 过 后') === splitWords('一场大雪过后') && splitWords('一 场 大 雪').includes('大雪'), sw);
    const pr = photoPrompt(['只挑写字栏的']);
    check('交给模型的:家长的要求在前,格式接在后面(改要求不会改坏格式)', pr.startsWith('只挑写字栏的\n') && pr.includes('{"full":') && pr.includes('"pick"') && photoPrompt().includes('课文里课本用彩色框'));
  }
  // ---- 拍照认词表:真走一遍流式(假的百炼,SSE 一块一块吐)----
  {
    const { createServer } = await import('node:http');
    const lines = ['{"lesson": null}', '{"text": "肚皮", "kind": "word", "box": [1, 2, 30, 40], "sure": true, "say": "肚皮,白白的肚皮"}', '{"text": "孩", "kind": "char", "box": [50, 2, 80, 40], "sure": true}', '{"full": "肚皮 白白 的"}'];
    let seenAuth = '';
    let seenModel = '';
    const srv = createServer((req, res) => {
      seenAuth = String(req.headers.authorization);
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        seenModel = JSON.parse(b).model;
        sentPrompt = JSON.parse(b).messages[0].content[1].text;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const text = lines.join('\n');
        // 故意在一行中间切块
        for (const part of [text.slice(0, 40), text.slice(40, 120), text.slice(120)]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as { port: number }).port;
    const seen: string[] = [];
    let sentPrompt = '';
    const rr = await recognizePhoto({ data: Buffer.from('jpg'), mime: 'image/jpeg' }, (p) => { seen.push(p.items.map((x) => x.text).join('')); }, { env: { DASHSCOPE_API_KEY: 'k-test' }, endpoint: `http://127.0.0.1:${port}/`, prompt: ['挑写字栏'] });
    const none = await recognizePhoto({ data: Buffer.from('jpg'), mime: 'image/jpeg' }, () => {}, { env: { HOME: home } });
    srv.close();
    check('流式认:边收边回调、key 只进请求头、缺省 qwen3.8-max、提示词是传进来的要求 + 格式;全文也收;没有 key 回 no_key', rr.ok && seen.includes('肚皮') && seen[seen.length - 1] === '肚皮孩' && rr.full.join() === '肚皮 白白 的' && seenAuth === 'Bearer k-test' && seenModel === 'qwen3.8-max' && sentPrompt.startsWith('挑写字栏\n') && sentPrompt.includes('{"full":') && !none.ok && none.error === 'no_key', JSON.stringify(rr));
  }
  // ---- 认词的要求在听写 activity「认字收到什么」(《activity设计.md》拍板 21)----
  {
    const { dictationTemplate } = await import('../src/dictation/route.ts');
    const { createServer } = await import('node:http');
    const { photoPromptFrom, FORMAT, FORMAT_EN } = await import('../src/dictation/recognize.ts');
    const { DICTATION_PROMPT_DEFAULT, DICTATION_PROMPT_EN_DEFAULT } = await import('../src/schema/index.ts');
    const zh = await dictationTemplate(root, 'zh');
    const en = await dictationTemplate(root, 'en');
    check('出厂:中文认字照语文老师的听写.md、英文照英语老师的;填好格式和出厂 prompt 拼的一样', !!zh && !!en && photoPromptFrom(zh, 'zh') === photoPrompt(DICTATION_PROMPT_DEFAULT, 'zh') && photoPromptFrom(en, 'en') === photoPrompt(DICTATION_PROMPT_EN_DEFAULT, 'en') && photoPromptFrom(en, 'en').endsWith(FORMAT_EN) && photoPromptFrom(zh, 'zh').endsWith(FORMAT));
    const f = join(root, 'agents', 'chinese-tutor', 'activities', '听写.md');
    const keep = readFileSync(f, 'utf8');
    writeFileSync(f, keep.replace('先把照片上的正文一行一行全认出来', '只挑写字栏'));
    const mine = await dictationTemplate(root, 'zh');
    writeFileSync(f, keep.replace('{{格式}}', '').replace('page: dictation', 'page: dictation-x'));
    const gone = await dictationTemplate(root, 'zh');
    writeFileSync(f, keep);
    check('家长改了那段:下一张照片就照它;page 不对就不认这份(退回 cotutor.json)', !!mine?.includes('只挑写字栏') && gone === null);
    let sent = '';
    const fake = createServer((req, res) => { let b = ''; req.on('data', (c: Buffer) => (b += c)); req.on('end', () => { sent = JSON.parse(b).messages[0].content[1].text; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: [DONE]\n\n'); }); });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    const { recognizePhoto: rp } = await import('../src/dictation/recognize.ts');
    await rp({ data: Buffer.from('jpg'), mime: 'image/jpeg' }, () => {}, { env: { DASHSCOPE_API_KEY: 'k' }, endpoint: `http://127.0.0.1:${(fake.address() as { port: number }).port}/`, text: '整段给的要求' });
    fake.close();
    check('recognizePhoto 给了 text 就整段用它', sent === '整段给的要求');
  }
  // ---- 拍照开始:传照片 → 后台认(假的)→ 轮询 → 点选的词开始听写 ----
  {
    const fakeItems = [
      { text: '脑袋', kind: 'word' as const, pick: true, box: [100, 650, 180, 690] as [number, number, number, number], sure: true, say: '脑袋,小蝌蚪的大脑袋' },
      { text: '宽大', kind: 'word' as const, pick: true, box: [640, 640, 720, 680] as [number, number, number, number], sure: false, say: null },
      { text: '皮', kind: 'char' as const, pick: true, box: [700, 530, 750, 570] as [number, number, number, number], sure: true, say: '皮,肚皮的皮' },
    ];
    let fail = false;
    const real = dictationDeps(ctx);
    const deps = { ...real, recognize: async (_img: { data: Buffer; mime: string }, onProgress: (p: { items: typeof fakeItems; lesson: string | null; full: string[] }) => void) => {
      const p = { items: [] as typeof fakeItems, lesson: '小蝌蚪找妈妈' as string | null, full: [] as string[] };
      for (const it of fakeItems.slice(0, fail ? 1 : 3)) { await new Promise((r) => setTimeout(r, 5)); p.items = [...p.items, it]; onProgress({ ...p }); }
      if (!fail) { p.full = ['池塘 里 有 一群 小蝌蚪']; onProgress({ ...p }); }
      return fail ? { ok: false as const, error: 'timeout', ...p, ms: 9 } : { ok: true as const, model: 'fake', ...p, ms: 9 };
    } };
    const hx = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: J; file?: string; html?: string }> => {
      const r = (await handleDictation(method, new URL(path, 'http://x'), deps, body))!;
      return { status: r.status, json: (r.json ?? {}) as J, file: r.file, html: r.html };
    };
    const jpg = Buffer.from('fake-jpeg-bytes');
    check('拍照:不是 data:image 400;太大 413', (await hx('POST', '/api/dictation/photos', { image: 'abc' })).status === 400 && (await hx('POST', '/api/dictation/photos', { image: `data:image/jpeg;base64,${Buffer.alloc(3_100_000).toString('base64')}` })).status === 413);
    const up = await hx('POST', '/api/dictation/photos', { image: `data:image/jpeg;base64,${jpg.toString('base64')}` });
    const pid = up.json.id as string;
    const running = await hx('GET', `/api/dictation/photos/${pid}`);
    await photosIdle();
    const done = await hx('GET', `/api/dictation/photos/${pid}`);
    check('拍照:201 回 id,后台认;认的时候 running,认完 done、课名、三项与全文都在', up.status === 201 && pid.length >= 15 && running.json.state === 'running' && done.json.state === 'done' && done.json.lesson === '小蝌蚪找妈妈' && done.json.items.map((i: J) => i.text).join() === '脑袋,宽大,皮' && done.json.full.join() === '池塘 里 有 一群 小蝌蚪', JSON.stringify(done.json));
    const img = await hx('GET', `/api/dictation/photos/${pid}/image`);
    check('照片原样存在 dictation/photos/,取得回来', img.status === 200 && readFileSync(img.file!).equals(jpg) && img.file!.includes(join('dictation', 'photos')));
    check('开始:词不对 400(空、不是汉字、超过四个字、超过 20 个);照片不在 404', (await hx('POST', '/api/dictation', { photo: pid, words: [] })).status === 400 && (await hx('POST', '/api/dictation', { photo: pid, words: [{ chars: 'pi' }] })).status === 400 && (await hx('POST', '/api/dictation', { photo: pid, words: [{ chars: '画蛇添足啊' }] })).status === 400 && (await hx('POST', '/api/dictation', { photo: pid, words: Array.from({ length: 21 }, () => ({ chars: '皮' })) })).status === 400 && (await hx('POST', '/api/dictation', { photo: '2020-01-01-0000', words: [{ chars: '皮' }] })).status === 404);
    const go = await hx('POST', '/api/dictation', { photo: pid, words: [{ chars: '脑袋', say: '脑袋,小蝌蚪的大脑袋' }, { chars: '宽 大' }, { chars: '皮', say: '皮,肚皮的皮' }] });
    const sx = (await hx('GET', `/api/dictation/${go.json.id}`)).json;
    check('拍照开始:201,和首页卡一样的孩子端样子(没有字);记下照片与课名,不挂首页', go.status === 201 && go.json.sizes.join() === '2,2,1' && !JSON.stringify(go.json).includes('脑') && sx.photo === pid && sx.lesson === '小蝌蚪找妈妈' && sx.home === null && sx.n === -1 && sx.words[1].chars === '宽大' && sx.words[2].say === '皮,肚皮的皮', JSON.stringify(sx).slice(0, 300));
    const viaMath = await hx('POST', '/api/dictation', { photo: pid, words: [{ chars: '皮' }], tutor: 'math-tutor' });
    const viaNone = await hx('POST', '/api/dictation', { photo: pid, words: [{ chars: '皮' }], tutor: 'nobody' });
    check('拍照开始带 tutor(从哪位老师卡上进来):用他的声音;没有这位老师退回语文老师', (await hx('GET', `/api/dictation/${viaMath.json.id}`)).json.tutor === 'math-tutor' && (await hx('GET', `/api/dictation/${viaNone.json.id}`)).json.tutor === 'chinese-tutor');
    check('拍照开始的照样能念、能交', (await hx('GET', `/api/dictation/${go.json.id}/say/0?text=1`)).json.text === '脑袋,小蝌蚪的大脑袋');
    fail = true;
    const up2 = await hx('POST', '/api/dictation/photos', { image: `data:image/jpeg;base64,${jpg.toString('base64')}` });
    await photosIdle();
    const f2 = (await hx('GET', `/api/dictation/photos/${up2.json.id}`)).json;
    check('没认完(超时):failed、带原因,已经认出的留着能用', f2.state === 'failed' && f2.error === 'timeout' && f2.items.length === 1, JSON.stringify(f2));
    check('页面:拍照那几屏在,内联脚本能解析(上面查过);不带 home 是拍照开始', ((await hx('GET', '/dictation')).html ?? '').includes('拍语文书上要写的词'));
  }

  // ---- 边界 ----
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));
  const offenders: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) { if (!f.endsWith(join('src', 'dictation'))) walk(f); continue; }
      if (f.endsWith('.ts') && /from '[./]*dictation\//.test(readFileSync(f, 'utf8')) && !f.endsWith(join('server', 'app.ts')) && !f.endsWith(join('server', 'mock.ts'))) offenders.push(f);
    }
  };
  walk(srcDir);
  check('边界:cotutor 别处不引用 src/dictation/(只有 app.ts、mock.ts 接一行)', offenders.length === 0, offenders.join());
  // ---- 英文单词听写(《听写设计.md》拍板 15):一个单词一格,不逐字母比,孩子自己对 ----
  {
    const enHome = await publish('```dictation english-tutor\nred\n🟡 yellow yellow, a yellow bus\n```\n\n## 为什么这么排\n\n英语\n');
    const kh2 = (await call('GET', '/api/kid/home')).json;
    const ec = kh2.cards.find((c: J) => c.kind === 'dictation');
    check('英文听写卡:孩子端带 lang en、几个单词、没有字;归英语老师', ec?.props.lang === 'en' && ec.props.count === 2 && ec.owner === 'english-tutor' && !JSON.stringify(kh2).includes('yellow'), JSON.stringify(ec));
    const page = (await call('GET', '/dictation?lang=en')).html;
    check('GET /dictation?lang=en 是英文那页(四线三格),内联脚本能解析;家长页、录像页也能解析', parses(page) && (page ?? '').includes('单词听写') && (page ?? '').includes('EN_LINES') && parses((await call('GET', '/parent/dictation')).html) && parses((await call('GET', '/parent/dictation/reel')).html));
    const st = await call('POST', '/api/dictation', { home: enHome, n: 0 });
    const id = st.json.id as string;
    check('开始:lang en、一个单词一格、交卷前没有字也没有 emoji(拍板 21:只在对一对出)', st.status === 201 && st.json.lang === 'en' && st.json.sizes.join() === '1,1' && !JSON.stringify(st.json).includes('red') && !JSON.stringify(st.json).includes('🟡'), JSON.stringify(st.json));
    const stroke = [[100, 300, 10], [400, 320, 50]];
    check('写:一个单词交一格;格数不对 400', (await call('PUT', `/api/dictation/${id}/first/0`, { chars: [{ strokes: [stroke], undos: 1 }] })).status === 200 && (await call('PUT', `/api/dictation/${id}/first/1`, { chars: [{ strokes: [stroke], undos: 0 }, { strokes: [], undos: 0 }] })).status === 400);
    const rv = await call('POST', `/api/dictation/${id}/reveal/1`, { char: 0, t: 500 });
    check('给答案:回整个单词;只有第 0 格', rv.json.ch === 'yellow' && (await call('POST', `/api/dictation/${id}/reveal/1`, { char: 1 })).status === 400);
    await call('PUT', `/api/dictation/${id}/first/1`, { chars: [{ strokes: [stroke], undos: 0, revealed: true }] });
    const ck = await call('POST', `/api/dictation/${id}/check`);
    check('交卷:不逐字母比,一个都不问「再写一遍?」;答案是整个单词、他写的笔、看没看答案', ck.json.answers.map((a: J) => a.chars).join() === 'red,yellow' && ck.json.answers.every((a: J) => !a.ask) && ck.json.answers[1].revealed && ck.json.answers[0].ink[0].length === 1, JSON.stringify(ck.json.answers));
    check('交了卷:配了 emoji 的单词带着它,没配的没有', ck.json.answers[1].emoji === '🟡' && ck.json.answers[0].emoji === undefined, JSON.stringify(ck.json.answers.map((a: J) => a.emoji)));
    const full = (await call('GET', `/api/dictation/${id}`)).json;
    check('存下的:lang en、不比对(judges 空)、没问', full.lang === 'en' && full.first[0].judges.length === 0 && full.asked.length === 0);
    const rw = await call('POST', `/api/dictation/${id}/rewrites/0`, { chars: [{ strokes: [stroke], undos: 0 }], self: true });
    check('自己再写一遍;念的是念法(英文)', rw.status === 200 && rw.json.answers[0].rewrote && (await call('GET', `/api/dictation/${id}/say/1?text=1`)).json.text === 'yellow, a yellow bus');
    const before = (await call('GET', `/api/dictation/${id}`)).json.events.length;
    const rs = await Promise.all([...Array.from({ length: 8 }, (_x, k) => call('POST', `/api/dictation/${id}/events`, { kind: 'say', word: 0, t: 1000 + k, n: 1 })), call('POST', `/api/dictation/${id}/rewrites/1`, { chars: [{ strokes: [stroke], undos: 0 }], self: true })]);
    const after = (await call('GET', `/api/dictation/${id}`)).json;
    check('同一次听写同时来的请求一个一个落:八个事件与一遍重写都在,不互相盖掉', rs.every((r) => r.status === 200) && after.events.length === before + 8 && after.rewrites.filter((r: J) => r.word === 1).length === 1, JSON.stringify(rs.map((r) => r.status)));
    const list = (await call('GET', '/api/dictation')).json.sessions.find((x: J) => x.id === id);
    check('列表一行带 lang 与老师', list?.lang === 'en' && list.tutor === 'english-tutor', JSON.stringify(list));
    const { parseWords } = await import('../src/dictation/route.ts');
    check('拍照开始的词:英文只收英文单词,汉字只收汉字,不混', parseWords([{ chars: 'red' }, { chars: "don't" }], 'en')?.length === 2 && parseWords([{ chars: '春天' }], 'en') === null && parseWords([{ chars: 'red' }], 'zh') === null && parseWords([{ chars: 'red apple' }], 'en') === null);
    check('拍照开始的词带 emoji:英文收、不是 emoji 的丢;汉字的不收', JSON.stringify(parseWords([{ chars: 'bus', emoji: ' 🚌 ' }, { chars: 'like', emoji: 'x' }], 'en')) === JSON.stringify([{ chars: 'bus', emoji: '🚌' }, { chars: 'like' }]) && parseWords([{ chars: '春天', emoji: '🌸' }], 'zh')?.[0].emoji === undefined);
    const { parseItem, photoPrompt: pp, splitWords: sw2, LineReader: LR } = await import('../src/dictation/recognize.ts');
    check('认英文的一项带 emoji(认词那次顺带回);汉字的、不是 emoji 的不收', parseItem({ text: 'bus', emoji: '🚌' }, 'en')?.emoji === '🚌' && parseItem({ text: 'like', emoji: 'like' }, 'en')?.emoji === undefined && parseItem({ text: '春天', emoji: '🌸' }, 'zh')?.emoji === undefined && pp(undefined, 'en').includes('emoji'));
    const r2 = new LR(() => {}, 'en');
    r2.push('{"lesson": "Unit 3"}\n{"text": "yellow", "kind": "word", "pick": true, "box": [1,2,30,40], "sure": true, "say": "yellow, a yellow bus"}\n{"text": "春天", "kind": "word"}\n{"full": "What colour is it? It\'s yellow."}\n');
    r2.end();
    check('认英文:只收英文单词、全文去掉标点按词分;提示词换英文的格式', parseItem({ text: 'red' }, 'en')?.text === 'red' && parseItem({ text: '红' }, 'en') === null && r2.items.map((x) => x.text).join() === 'yellow' && r2.full[0] === "What colour is it It's yellow" && sw2('a, b!', 'en') === 'a b' && pp(['x'], 'en').includes('一个英文单词'), JSON.stringify(r2.full));
  }
  // ---- 英文单词的样子照四线三格(《听写设计.md》拍板 29):单词卡那套字形,不用字体 ----
  {
    const { EN_BOX_JS } = await import('../src/dictation/en-box.ts');
    type El = { tag: string; attrs: Record<string, string>; kids: El[]; text: string; append: (...c: El[]) => void; setAttribute: (k: string, v: string) => void; getAttribute: (k: string) => string | null };
    const sv = (tag: string, attrs: Record<string, unknown> = {}): El => {
      const el: El = { tag, attrs: {}, kids: [], text: '', append: (...c) => { el.kids.push(...c); }, setAttribute: (k, v) => { el.attrs[k] = v; }, getAttribute: (k) => el.attrs[k] ?? null };
      for (const [k, v] of Object.entries(attrs)) el.attrs[k] = String(v);
      Object.defineProperty(el, 'textContent', { set: (v: string) => { el.text = v; } });
      return el;
    };
    const box = new Function('sv', `${EN_BOX_JS}; return { enWord: enWord, enModel: enModel };`)(sv) as { enWord: (s: typeof sv, w: string, cls?: string, maxW?: number) => El; enModel: (s: typeof sv, w: string) => El };
    const ys = (g: El): number[] => g.kids.flatMap((p) => [...(p.attrs.d ?? '').matchAll(/[ML] ?(-?[\d.]+) (-?[\d.]+)|A[\d.]+ [\d.]+ 0 0 [01] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2] ?? m[4])));
    const bike = box.enWord(sv, 'bike');
    check('bike:一笔一条 path(b 两笔、i 两笔、k 两笔、e 一笔),b 与 k 的竖顶第一线(80)、坐在基线(320)上', bike.tag === 'g' && bike.kids.length === 7 && Math.min(...ys(bike)) === 80 && Math.max(...ys(bike)) === 320 && bike.attrs['data-word'] === 'bike', `${bike.kids.length} 笔,y ${Math.min(...ys(bike))}–${Math.max(...ys(bike))}`);
    const yellow = box.enWord(sv, 'yellow');
    check('yellow:y 的尾巴到第四线(440)', Math.max(...ys(yellow)) === 440, String(Math.max(...ys(yellow))));
    const long = box.enWord(sv, 'grandmother', 'enw trace', 900);
    check('长单词横着压进给的宽(笔画不变粗细,只压坐标)', Number(long.attrs['data-w']) <= 900 && Number(long.attrs['data-w']) >= 880, long.attrs['data-w']);
    const odd = box.enWord(sv, 'No.1');
    check('字形包里没有的字(数字、点):整个词退回字体', odd.tag === 'text' && odd.text === 'No.1' && odd.attrs.class.includes('font'));
    const model = box.enModel(sv, 'red');
    check('再写一遍上面照着看的:一小条四线格,视窗框住单词', model.tag === 'svg' && model.attrs['aria-label'] === 'red' && /^\d+ 40 \d+ 440$/.test(model.attrs.viewBox), model.attrs.viewBox);
  }
  // ---- 两页的按钮同一套(《听写设计.md》拍板 28):英文页从第一版起没有图标,修了几次又漂开,这里拦着 ----
  {
    const { DICTATION_PAGE } = await import('../src/dictation/page.ts');
    const { DICTATION_EN_PAGE } = await import('../src/dictation/en-page.ts');
    const { BTN_CSS, WRITE_TOOLS } = await import('../src/dictation/ui.ts');
    for (const [name, page] of [['语文', DICTATION_PAGE], ['英文', DICTATION_EN_PAGE]] as const) {
      const bare = [...page.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].filter((m) => !m[1].includes('<svg')).map((m) => m[0].slice(0, 80));
      check(`${name}页:写死的按钮都带图标`, bare.length === 0, bare.join(' | '));
      // 脚本里现建的:class 是 x(×)、seg(全文的词)、chip(单词)、bx / ebx(照片上的框)的不算按钮样式
      const made = page.split("h('button'").slice(1).map((x) => x.slice(0, 400)).filter((x) => !/^, \{ 'class': '(x|seg|chip|e?bx)[ '"]/.test(x));
      const noIcon = made.filter((x) => !x.includes('ico('));
      check(`${name}页:脚本里现建的按钮都带图标(ico)`, made.length > 0 && noIcon.length === 0, noIcon.map((x) => x.slice(0, 90)).join(' | '));
      const missing = WRITE_TOOLS.filter((t) => !page.includes(`<span>${t}</span>`));
      check(`${name}页:写字那排是 ${WRITE_TOOLS.join(' / ')}`, missing.length === 0, missing.join(' '));
      const old = ['擦掉重写', '擦掉这一格', '这个字写好了', '放回蓝字'].filter((t) => page.includes(`<span>${t}</span>`) || page.includes(`'${t}'`));
      check(`${name}页:没有各叫各的旧字`, old.length === 0, old.join(' '));
      check(`${name}页:换屏时主按钮半秒保护(拍板 31)`, /var show = function \(name\) \{[^\n]*if \(!REEL_ID\) guard\(\); \};/.test(page) && page.includes('var guard = function'));
      check(`${name}页:按钮的样式只有 ui.ts 那一份`, page.includes(BTN_CSS) && page.split('.tool { display').length === 2 && page.split('.main { display').length === 2);
    }
  }
} finally {
  done();
}
