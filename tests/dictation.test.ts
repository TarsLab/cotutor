/**
 * 听写(不花钱,《wip/听写设想.md》):比对(照 hanzi-writer 的一笔像不像 + 写完一起配对)→ 听写卡的解析与剥字 →
 * 经 app.ts 的 route() 走一遍:首页发布 → 孩子端首页没有字 → 开始 / 接着 → 念(假配音、退合成声)→ 一个词一个词交 →
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
const { LineReader, recognizePhoto } = await import('../src/dictation/recognize.ts');
const { dictationDeps, handleDictation, photosIdle } = await import('../src/dictation/route.ts');
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

  check('GET /dictation 与 /dictation/parent:经 app.ts 的 route() 进来,内联脚本能解析', parses((await call('GET', '/dictation')).html) && parses((await call('GET', '/dictation/parent')).html));

  // ---- 开始 ----
  check('开始:要 {home, n}', (await call('POST', '/api/dictation', { n: 0 })).status === 400 && (await call('POST', '/api/dictation', { home: homeId, n: 1 })).status === 404);
  const st = await call('POST', '/api/dictation', { home: homeId, n: 0 });
  const id = st.json.id as string;
  check('开始:201,id 是日期-时分;只给几个字一个词,没有字;语文老师念', st.status === 201 && id === '2026-10-10-1930' && st.json.sizes.join() === '2,2,1,1' && st.json.tutor === '语文老师' && !JSON.stringify(st.json).includes('春') && st.json.reveal === null, JSON.stringify(st.json));
  check('dictation/ 整个不进 git', readFileSync(join(root, 'dictation', '.gitignore'), 'utf8').split('\n').includes('*'));
  const again = await call('POST', '/api/dictation', { home: homeId, n: 0 });
  check('今天这张卡开过、没对好:再点进来接着那一次', again.status === 200 && again.json.id === id);

  // ---- 念 ----
  const say = await call('GET', `/api/dictation/${id}/say/1`);
  check('念:用语文老师的音色合成,缓存在 .cotutor/dictation-say/', say.status === 200 && say.file !== undefined && readFileSync(say.file!, 'utf8') === 'fake-mp3:v-kid:鼓励,老师鼓励我的鼓励' && say.file!.includes(join('.cotutor', 'dictation-say')));
  check('念:?text=1 给要念的字(退浏览器合成声用);没写念法念词本身', (await call('GET', `/api/dictation/${id}/say/1?text=1`)).json.text === '鼓励,老师鼓励我的鼓励' && (await call('GET', `/api/dictation/${id}/say/0?text=1`)).json.text === '春天');

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
  check('交卷前:写了哪几个;还是没有字', mid.written.join() === 'true,true,true,false' && mid.reveal === null && !JSON.stringify(mid).includes('鼓'));

  // ---- 交卷 ----
  const ck = (await call('POST', `/api/dictation/${id}/check`)).json;
  const asks = ck.reveal.map((w: J) => w.ask).join();
  check('交卷:字下发;少一笔、写成别字、空着的问「再写一遍?」,笔顺反了的不问', ck.checked && ck.reveal.map((w: J) => w.chars).join() === '春天,鼓励,叶,雪' && asks === 'false,true,true,true', asks);
  check('交卷:孩子端只有字、问不问、笔迹,没有判的细节', !JSON.stringify(ck).includes('missing') && !JSON.stringify(ck).includes('order') && ck.reveal[1].ink[0].length === 12);
  check('交卷后第一遍不能改(409);再交一次卷照旧', (await call('PUT', `/api/dictation/${id}/first/0`, { chars: [cell([]), cell([])] })).status === 409 && (await call('POST', `/api/dictation/${id}/check`)).json.reveal[1].ask === true);

  // ---- 对答案时做的事、再写一遍 ----
  check('事件:逐笔看了鼓;坏的 400', (await call('POST', `/api/dictation/${id}/events`, { kind: 'strokeOrder', word: 1, char: 0 })).status === 200 && (await call('POST', `/api/dictation/${id}/events`, { kind: 'peek', word: 1 })).status === 400 && (await call('POST', `/api/dictation/${id}/events`, { kind: 'strokeOrder', word: 9 })).status === 400);
  const rw = (await call('POST', `/api/dictation/${id}/rewrites/1`, { chars: [cell(await write('鼓')), cell(await write('励'))] })).json;
  check('再写一遍:这个词不再问,标 rewrote,笔迹换成新写的', rw.reveal[1].ask === false && rw.reveal[1].rewrote === true && rw.reveal[1].ink[0].length === 13);
  const self = (await call('POST', `/api/dictation/${id}/rewrites/0`, { chars: [cell(await write('春')), cell(await write('天'))], self: true })).json;
  check('自己说「我想再写」:照样记下', self.reveal[0].rewrote === true);
  check('对好了', (await call('POST', `/api/dictation/${id}/done`)).status === 200 && (await call('GET', `/api/dictation/${id}/kid`)).json.done === true);

  // ---- 家长 ----
  const list = (await call('GET', '/api/dictation')).json.sessions;
  check('家长列表:一次,4 个词里第一遍写全 1 个,问了 3 个', list.length === 1 && list[0].firstOk === 1 && list[0].asked === 3 && list[0].done, JSON.stringify(list));
  const full = (await call('GET', `/api/dictation/${id}`)).json;
  check('家长全量:天的笔顺、鼓少的第 7 笔、自己重写、逐笔看过', full.first[0].judges[1].order === false && full.first[1].judges[0].missing.join() === '6' && full.rewrites.length === 2 && full.rewrites[1].self === true && full.events.some((e: J) => e.kind === 'strokeOrder' && e.word === 1));

  // ---- 再听写一次、首页换了 ----
  const fresh = await call('POST', '/api/dictation', { home: homeId, n: 0, fresh: true });
  check('再听写一次(fresh):另开一次,同一分钟加 -2', fresh.status === 201 && fresh.json.id === '2026-10-10-1930-2');
  now = new Date(2026, 9, 10, 20, 0);
  const home2 = await publish(DRAFT.replace('雪\n', '雪花\n'));
  check('首页换过了:旧首页的卡 404(页面叫孩子回首页)', home2 !== homeId && (await call('POST', '/api/dictation', { home: homeId, n: 0 })).status === 404 && (await call('POST', '/api/dictation', { home: home2, n: 0 })).status === 201);

  // ---- 没有音色 ----
  cfg.tutors['chinese-tutor'].voice = undefined;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await ctx.reload();
  check('没配音色:音频 404,页面退浏览器合成声', (await call('GET', `/api/dictation/${id}/say/3`)).status === 404);

  // ---- 首页检查 ----
  const chk = await checkHome(ctx.ws, '```dictation nobody-tutor\n春天\n```\n\n## 为什么这么排\n\n试\n', now);
  check('首页检查:听写卡写的老师不在 cotutor.json,提醒会换人念', chk.issues.some((x) => x.level === 'note' && x.text.includes('nobody-tutor')), JSON.stringify(chk.issues));

  // ---- 拍照认词表:按行收 ----
  {
    const r = new LineReader();
    const got: string[] = [];
    const on = (it: { text: string } | null, lesson: string | null): void => { got.push(it ? it.text : `课:${lesson}`); };
    for (const piece of ['```json\n{"lesson": "小蝌蚪找', '妈妈"}\n{"text": "脑袋", "kind": "word", "box": [100, 650, 180, 690], "sure": true, "say": "脑袋,小蝌蚪的大脑袋"}\n{"text": "宽', '大", "kind": "word", "box": [640, 640, 720, 680], "sure": false}\n', '{"text": "脑袋", "kind": "word"}\n{"text": "pí", "kind": "char"}\n{"text": "画蛇添足啊", "kind": "word"}\n{"text": "两", "kind": "char", "box": [700, 10, 600, 50]}\n```']) r.push(piece, on);
    r.end(on);
    check('按行收:一行一项、断在半行也接得上;代码块的围栏、重复的、不是汉字的、超过四个字的都丢;框反了当没给', got.join() === '课:小蝌蚪找妈妈,脑袋,宽大,两' && r.items[1].sure === false && r.items[1].say === null && r.items[2].box === null && JSON.stringify(r.items[0].box) === '[100,650,180,690]', got.join());
  }
  // ---- 拍照认词表:真走一遍流式(假的百炼,SSE 一块一块吐)----
  {
    const { createServer } = await import('node:http');
    const lines = ['{"lesson": null}', '{"text": "肚皮", "kind": "word", "box": [1, 2, 30, 40], "sure": true, "say": "肚皮,白白的肚皮"}', '{"text": "孩", "kind": "char", "box": [50, 2, 80, 40], "sure": true}'];
    let seenAuth = '';
    let seenModel = '';
    const srv = createServer((req, res) => {
      seenAuth = String(req.headers.authorization);
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        seenModel = JSON.parse(b).model;
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
    const rr = await recognizePhoto({ data: Buffer.from('jpg'), mime: 'image/jpeg' }, (it) => { if (it) seen.push(it.text); }, { env: { DASHSCOPE_API_KEY: 'k-test' }, endpoint: `http://127.0.0.1:${port}/` });
    const none = await recognizePhoto({ data: Buffer.from('jpg'), mime: 'image/jpeg' }, () => {}, { env: { HOME: home } });
    srv.close();
    check('流式认:边收边回调、key 只进请求头、缺省 qwen3.8-max;没有 key 回 no_key', rr.ok && seen.join() === '肚皮,孩' && seenAuth === 'Bearer k-test' && seenModel === 'qwen3.8-max' && !none.ok && none.error === 'no_key', JSON.stringify(rr));
  }
  // ---- 拍照开始:传照片 → 后台认(假的)→ 轮询 → 点选的词开始听写 ----
  {
    const fakeItems = [
      { text: '脑袋', kind: 'word' as const, box: [100, 650, 180, 690] as [number, number, number, number], sure: true, say: '脑袋,小蝌蚪的大脑袋' },
      { text: '宽大', kind: 'word' as const, box: [640, 640, 720, 680] as [number, number, number, number], sure: false, say: null },
      { text: '皮', kind: 'char' as const, box: [700, 530, 750, 570] as [number, number, number, number], sure: true, say: '皮,肚皮的皮' },
    ];
    let fail = false;
    const deps = { ...dictationDeps(ctx), recognize: async (_img: { data: Buffer; mime: string }, onItem: (it: (typeof fakeItems)[number] | null, lesson: string | null) => void) => {
      onItem(null, '小蝌蚪找妈妈');
      for (const it of fakeItems.slice(0, fail ? 1 : 3)) { await new Promise((r) => setTimeout(r, 5)); onItem(it, '小蝌蚪找妈妈'); }
      return fail ? { ok: false as const, error: 'timeout', items: fakeItems.slice(0, 1), lesson: '小蝌蚪找妈妈', ms: 9 } : { ok: true as const, items: fakeItems, lesson: '小蝌蚪找妈妈', model: 'fake', ms: 9 };
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
    check('拍照:201 回 id,后台认;认的时候 running,认完 done、课名与三项都在', up.status === 201 && /^\d{4}-\d{2}-\d{2}-\d{4}/.test(pid) && running.json.state === 'running' && done.json.state === 'done' && done.json.lesson === '小蝌蚪找妈妈' && done.json.items.map((i: J) => i.text).join() === '脑袋,宽大,皮', JSON.stringify(done.json));
    const img = await hx('GET', `/api/dictation/photos/${pid}/image`);
    check('照片原样存在 dictation/photos/,取得回来', img.status === 200 && readFileSync(img.file!).equals(jpg) && img.file!.includes(join('dictation', 'photos')));
    check('开始:词不对 400(空、不是汉字、超过四个字、超过 20 个);照片不在 404', (await hx('POST', '/api/dictation', { photo: pid, words: [] })).status === 400 && (await hx('POST', '/api/dictation', { photo: pid, words: [{ chars: 'pi' }] })).status === 400 && (await hx('POST', '/api/dictation', { photo: pid, words: [{ chars: '画蛇添足啊' }] })).status === 400 && (await hx('POST', '/api/dictation', { photo: pid, words: Array.from({ length: 21 }, () => ({ chars: '皮' })) })).status === 400 && (await hx('POST', '/api/dictation', { photo: '2020-01-01-0000', words: [{ chars: '皮' }] })).status === 404);
    const go = await hx('POST', '/api/dictation', { photo: pid, words: [{ chars: '脑袋', say: '脑袋,小蝌蚪的大脑袋' }, { chars: '宽 大' }, { chars: '皮', say: '皮,肚皮的皮' }] });
    const sx = (await hx('GET', `/api/dictation/${go.json.id}`)).json;
    check('拍照开始:201,和首页卡一样的孩子端样子(没有字);记下照片与课名,不挂首页', go.status === 201 && go.json.sizes.join() === '2,2,1' && !JSON.stringify(go.json).includes('脑') && sx.photo === pid && sx.lesson === '小蝌蚪找妈妈' && sx.home === null && sx.n === -1 && sx.words[1].chars === '宽大' && sx.words[2].say === '皮,肚皮的皮', JSON.stringify(sx).slice(0, 300));
    check('拍照开始的照样能念、能交', (await hx('GET', `/api/dictation/${go.json.id}/say/0?text=1`)).json.text === '脑袋,小蝌蚪的大脑袋');
    fail = true;
    const up2 = await hx('POST', '/api/dictation/photos', { image: `data:image/jpeg;base64,${jpg.toString('base64')}` });
    await photosIdle();
    const f2 = (await hx('GET', `/api/dictation/photos/${up2.json.id}`)).json;
    check('没认完(超时):failed、带原因,已经认出的留着能用', f2.state === 'failed' && f2.error === 'timeout' && f2.items.length === 1);
    check('页面:拍照那几屏在,内联脚本能解析(上面查过);不带 home 是拍照开始', ((await hx('GET', '/dictation')).html ?? '').includes('拍今天要听写的'));
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
} finally {
  done();
}
