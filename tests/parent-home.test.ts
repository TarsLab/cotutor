/**
 * 家长端「首页」(《家长板书页设计.md》拍板 20、《首页设计.md》拍板 17–20):改首页原文的纯函数(切块、按老师换按钮、听写的词、先后)→
 * 接口(读、换按钮带讲法与留到、这周的词、调先后、开关与几项设置)→ 每改一次就发布、留历史 → 孩子端首页跟着变 → 页面能解析。
 */
import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-parent-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { readPublished } = await import('../src/server/home.ts');
const { splitHomeMd, joinHomeMd, setTutorButtons, setTutorDictation, orderTutors } = await import('../src/lib/home-edit.ts');
const { parseHome } = await import('../src/lib/home.ts');

// ---- 纯函数:改原文只动要动的块 ----
{
  const MD = `---
for: 2026-10-10
---

\`\`\`text
# 今晚
先读课文
\`\`\`

\`\`\`tutor chinese-tutor
我要看图说话
讲法: 孩子会拍一张图
\`\`\`

\`\`\`tianzige
塘脑袋
\`\`\`

\`\`\`tutor math-tutor
再练两道退位减法
\`\`\`

## 为什么这么排

- 语文:看图说话
`;
  const p = splitHomeMd(MD);
  check('切块:frontmatter、四张卡、家长段', p.front.length === 3 && p.segs.filter((s) => s.kind === 'fence').map((s) => (s.kind === 'fence' ? s.card : '')).join() === 'text,tutor,tianzige,tutor' && p.note[0] === '## 为什么这么排', JSON.stringify(p.segs.map((s) => s.kind)));
  check('切了再拼回去不变', joinHomeMd(p) === MD, joinHomeMd(p));
  const b1 = setTutorButtons(MD, 'chinese-tutor', [{ kind: 'start', label: '我要预习小蝌蚪找妈妈', brief: '第 22 课\n重点字 塘', until: '2026-10-10' }, { kind: 'lecture', label: '分一分', bundle: '2026-10-08-fenyifen' }]);
  const d1 = parseHome(b1);
  const zh = d1.cards.find((c) => c.kind === 'tutor' && c.props.tutor === 'chinese-tutor');
  check('换按钮:讲法多行、留到、小课堂都写回去,解析得回来;别的块与家长段一个字不动', JSON.stringify(zh?.props.buttons) === JSON.stringify([{ kind: 'start', label: '我要预习小蝌蚪找妈妈', brief: '第 22 课\n重点字 塘', until: '2026-10-10' }, { kind: 'lecture', label: '分一分', bundle: '2026-10-08-fenyifen' }]) && b1.includes('```tianzige\n塘脑袋\n```') && b1.includes('- 语文:看图说话') && b1.startsWith('---\nfor: 2026-10-10\n---'), b1);
  const b2 = setTutorButtons(MD, 'english-tutor', [{ kind: 'start', label: '我想说说我的小汽车' }]);
  check('没有老师卡的老师:加在最后一位老师后面、家长段前面', /```tutor math-tutor\n再练两道退位减法\n```\n\n```tutor english-tutor\n我想说说我的小汽车\n```\n\n## 为什么这么排/.test(b2), b2);
  const w1 = setTutorDictation(MD, 'chinese-tutor', [{ chars: '春天' }, { chars: '叶', say: '树叶的叶' }]);
  check('这周的词:紧跟在他的老师卡后面加一张写了他的听写卡', /```tutor chinese-tutor\n我要看图说话\n讲法: 孩子会拍一张图\n```\n\n```dictation chinese-tutor\n春天\n叶 树叶的叶\n```\n\n```tianzige/.test(w1), w1);
  const w2 = setTutorDictation(w1, 'chinese-tutor', [{ chars: '花朵' }]);
  const w3 = setTutorDictation(w2, 'chinese-tutor', []);
  check('再设是换词,清空是删卡;删了和原来一样', w2.includes('```dictation chinese-tutor\n花朵\n```') && !w2.includes('春天') && w3 === MD, w3);
  check('没词也没卡:不动', setTutorDictation(MD, 'math-tutor', []) === MD);
  const o1 = orderTutors(MD, ['math-tutor', 'chinese-tutor']);
  const kinds = parseHome(o1).cards.map((c) => (c.kind === 'tutor' ? c.props.tutor : c.kind)).join();
  check('调先后:数学在前;田字格跟着语文走;公共的一段字还在最前', kinds === 'text,math-tutor,chinese-tutor,tianzige', kinds);
  const o2 = orderTutors(MD, ['english-tutor']);
  check('排一位还没老师卡的:补一张空的排最前,别的照原来的先后', parseHome(o2).cards.filter((c) => c.kind === 'tutor').map((c) => c.props.tutor).join() === 'english-tutor,chinese-tutor,math-tutor', o2);
}

// ---- 接口 ----
const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
let now = new Date(2026, 9, 10, 20, 0);
const ctx = createContext(loadWorkspace(root), { now: () => now });
const call = (method: string, path: string, body?: unknown) => route(method, path, ctx, body);
type T = { name: string; hidden: boolean; extras: string[]; extrasSet: string[] | null; buttons: { kind: string; label: string; brief?: string; until?: string }[]; dictation: { chars: string; say?: string }[] | null };
type PH = { home: { id: string } | null; tutors: T[]; talk: { enabled: boolean; note: string; minutes: number }; listen: string; today: string };
const get = async (): Promise<PH> => (await call('GET', '/api/parent/home')).json as PH;
type KH = { cards: { kind: string; owner?: string | null; props: { tutor?: string; buttons?: { id: string | number; label: string }[]; count?: number } }[]; tutors: { name: string; extras: string[] }[] };
const kid = async (): Promise<KH> => (await call('GET', '/api/kid/home')).json as KH;
const history = (): string[] => { try { return readdirSync(join(root, 'home', 'history')); } catch { return []; } };

try {
  const g0 = await get();
  {
    const kt = ((await call('GET', '/api/kid/home')).json as { tutors: { name: string; color: string; lang: string }[] }).tutors;
    const pt = (g0 as unknown as { tutors: { name: string; color: string }[] }).tutors;
    check('学科色服务端定好随老师下发:孩子端、家长端一样;英语老师 lang en(拍板 26)', kt.length > 0 && kt.every((t) => /^#[0-9a-f]{6}$/.test(t.color) && pt.find((x) => x.name === t.name)?.color === t.color) && kt.find((t) => t.name === 'english-tutor')?.lang === 'en' && kt.find((t) => t.name === 'chinese-tutor')?.color === '#c43c74', JSON.stringify(kt.map((t) => [t.name, t.color, t.lang])));
  }
  check('没发布过:老师按 cotutor.json 的顺序,没有按钮;语文常驻听写(没写 extras 走缺省)', g0.home === null && g0.tutors.map((t) => t.name).join() === 'chinese-tutor,english-tutor,math-tutor' && g0.tutors.every((t) => !t.buttons.length) && g0.tutors[0].extras.join() === 'dictation' && g0.tutors[0].extrasSet === null && g0.today === '2026-10-10', JSON.stringify(g0.tutors.map((t) => [t.name, t.extras])));

  // 加一个开场按钮(只今天)
  const put = await call('PUT', '/api/parent/home/tutors/english-tutor/buttons', { buttons: [{ kind: 'start', label: '我想说说我的小汽车', brief: '多问他颜色', until: '2026-10-10' }] });
  const g1 = await get();
  const en = g1.tutors.find((t) => t.name === 'english-tutor')!;
  check('加按钮:发布了(没发布过也行)、留了一份历史;读回来讲法与留到都在', put.status === 200 && g1.home !== null && history().length === 1 && en.buttons[0].brief === '多问他颜色' && en.buttons[0].until === '2026-10-10', JSON.stringify([put.json, en]));
  check('排在第一个:新写的老师卡就是第一张', g1.tutors[0].name === 'english-tutor', g1.tutors.map((t) => t.name).join());
  const k1 = await kid();
  const kb = k1.cards.find((c) => c.kind === 'tutor' && c.props.tutor === 'english-tutor')!.props.buttons!;
  check('孩子端:今天看得到,讲法不下发', kb.map((b) => b.label).join() === '新话题,我想说说我的小汽车' && !JSON.stringify(k1).includes('多问他颜色'), JSON.stringify(kb));
  now = new Date(2026, 9, 11, 9, 0);
  const kb2 = (await kid()).cards.find((c) => c.kind === 'tutor' && c.props.tutor === 'english-tutor')!.props.buttons!;
  check('留到过了:第二天孩子端不出现', kb2.map((b) => b.label).join() === '新话题', JSON.stringify(kb2));

  check('按钮不对 400:字超了、五个、没这位老师 404', (await call('PUT', '/api/parent/home/tutors/english-tutor/buttons', { buttons: [{ kind: 'start', label: '一二三四五六七八九十一二三四五六七' }] })).status === 400 && (await call('PUT', '/api/parent/home/tutors/english-tutor/buttons', { buttons: Array.from({ length: 5 }, () => ({ kind: 'start', label: 'a' })) })).status === 400 && (await call('PUT', '/api/parent/home/tutors/nobody-tutor/buttons', { buttons: [] })).status === 404);
  const bad = await call('PUT', '/api/parent/home/tutors/english-tutor/buttons', { buttons: [{ kind: 'continue', label: '接着', date: '2026-09-01', thread: '0900-1' }] });
  check('检查没过(接着的话题找不到):不发,说为什么', bad.status === 400 && String((bad.json as { message: string }).message).includes('没有话题') && history().length === 1, JSON.stringify(bad.json));
  const same = await call('PUT', '/api/parent/home/tutors/english-tutor/buttons', { buttons: [{ kind: 'start', label: '我想说说我的小汽车', brief: '多问他颜色', until: '2026-10-10' }] });
  check('和原来一样:不发、不留历史', same.status === 200 && (same.json as { changed: boolean }).changed === false && history().length === 1);

  // 这周的词
  const w = await call('PUT', '/api/parent/home/tutors/chinese-tutor/dictation', { words: [{ chars: '春 天' }, { chars: '叶', say: ' 树叶的叶 ' }] });
  const g2 = await get();
  const k2 = await kid();
  const dc = k2.cards.find((c) => c.kind === 'dictation');
  check('这周的词:发布了;读回来词与念法;孩子端那张听写卡归语文、只给几个词', w.status === 200 && JSON.stringify(g2.tutors.find((t) => t.name === 'chinese-tutor')!.dictation) === JSON.stringify([{ chars: '春天' }, { chars: '叶', say: '树叶的叶' }]) && dc?.owner === 'chinese-tutor' && dc.props.count === 2 && !JSON.stringify(k2).includes('春天') && history().length === 2, JSON.stringify(dc));
  check('词不对 400:不是汉字、超过四个字', (await call('PUT', '/api/parent/home/tutors/chinese-tutor/dictation', { words: [{ chars: 'red' }] })).status === 400 && (await call('PUT', '/api/parent/home/tutors/chinese-tutor/dictation', { words: [{ chars: '画蛇添足啊' }] })).status === 400);

  // 英语老师的这周的词配 emoji(拍板 21):假千问回一段 JSON,数它被问了几次
  const { createServer } = await import('node:http');
  let asked: string[] = [];
  const fakeQw = createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)).on('end', () => { asked.push(b); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '好的:{"Grandmother": "👵", "bus": "🚌", "like": "x"}' } }] })); }); });
  await new Promise<void>((r) => fakeQw.listen(0, '127.0.0.1', () => r()));
  process.env.COTUTOR_EMOJI_ENDPOINT = `http://127.0.0.1:${(fakeQw.address() as { port: number }).port}/v1/chat/completions`;
  await call('PUT', '/api/parent/home/tutors/english-tutor/dictation', { words: [{ chars: 'grandmother' }, { chars: 'bus', say: 'a red bus' }, { chars: 'like' }] });
  const md1 = readFileSync(join(root, (await readPublished(ctx.ws)).home!.source), 'utf8');
  check('英文单词配 emoji:问一次千问,配到的写在单词前面,抽象的(假千问回了不是 emoji 的)不配', asked.length === 1 && md1.includes('👵 grandmother\n🚌 bus a red bus\nlike\n'), md1);
  await call('PUT', '/api/parent/home/tutors/english-tutor/dictation', { words: [{ chars: 'grandmother' }, { chars: 'bus', say: 'a red bus' }, { chars: 'like' }, { chars: 'sister' }] });
  check('再存:配过的照用,只问还没配的(新加的 sister、上次没配上的 like)', asked.length === 2 && asked[1].includes('单词:like, sister"') && readFileSync(join(root, (await readPublished(ctx.ws)).home!.source), 'utf8').includes('👵 grandmother'));
  await call('PUT', '/api/parent/home/tutors/english-tutor/dictation', { words: [] });
  delete process.env.COTUTOR_EMOJI_ENDPOINT; fakeQw.close();

  // 英语老师的这周的词:英文单词(学科「英语」)
  const we = await call('PUT', '/api/parent/home/tutors/english-tutor/dictation', { words: [{ chars: 'red' }, { chars: 'yellow', say: 'yellow, a yellow bus' }] });
  const ke = (await kid()).cards.find((c) => c.kind === 'dictation' && c.owner === 'english-tutor') as { props: { lang?: string; count?: number } } | undefined;
  check('英语老师的这周的词:收英文单词,孩子端那张是 lang en;汉字的 400、语文老师写英文 400', we.status === 200 && ke?.props.lang === 'en' && ke.props.count === 2 && (await call('PUT', '/api/parent/home/tutors/english-tutor/dictation', { words: [{ chars: '春天' }] })).status === 400 && (await call('PUT', '/api/parent/home/tutors/chinese-tutor/dictation', { words: [{ chars: 'red' }] })).status === 400 && (await get()).tutors.find((t) => t.name === 'english-tutor')!.dictation!.length === 2, JSON.stringify(ke));
  await call('PUT', '/api/parent/home/tutors/english-tutor/dictation', { words: [] });

  // 先后
  const o = await call('PUT', '/api/parent/home/order', { tutors: ['math-tutor', 'chinese-tutor', 'english-tutor'] });
  const k3 = await kid();
  check('调先后:孩子端老师卡照这个顺序;听写卡还归语文', o.status === 200 && k3.cards.filter((c) => c.kind === 'tutor').map((c) => c.props.tutor).join() === 'math-tutor,chinese-tutor,english-tutor' && k3.cards.find((c) => c.kind === 'dictation')?.owner === 'chinese-tutor', JSON.stringify(k3.cards.map((c) => c.props.tutor ?? c.kind)));
  check('先后不对 400', (await call('PUT', '/api/parent/home/order', { tutors: ['nobody-tutor'] })).status === 400);
  const { home: pub } = await readPublished(ctx.ws);
  check('发布件的原文在历史里,家长段等没动到的照旧', Boolean(pub) && readFileSync(join(root, pub!.source), 'utf8').includes('```dictation chinese-tutor'));

  // 开关与设置
  const s1 = await call('PATCH', '/api/parent/settings', { tutors: { 'english-tutor': { extras: ['dictation'], hidden: false }, 'math-tutor': { hidden: true } }, talk: { note: '  这周学颜色  ', minutes: 7 }, listen: 'omni', dailyMessages: 40 });
  const c1 = JSON.parse(readFileSync(cfgFile, 'utf8')) as { tutors: Record<string, { extras?: string[]; hidden?: boolean }>; talk: { note?: string; minutes: number }; kid: { listen: string; slug: string }; policyDefaults?: Record<string, unknown> };
  check('设置写回 cotutor.json:常驻、藏起来、给老师的话(去掉首尾空白)、聊几分钟、怎么听;孩子的别的字段不丢;老页面交来的每天几条不认(不限条数)', s1.status === 200 && c1.tutors['english-tutor'].extras?.join() === 'dictation' && c1.tutors['math-tutor'].hidden === true && c1.talk.note === '这周学颜色' && c1.talk.minutes === 7 && c1.kid.listen === 'omni' && c1.kid.slug === 'ming' && c1.policyDefaults?.dailyMessages === undefined, JSON.stringify(c1.talk));
  const g3 = s1.json as PH;
  check('回的是改过的样子;藏起来的老师家长端还列着', g3.listen === 'omni' && !('dailyMessages' in g3) && g3.talk.note === '这周学颜色' && g3.tutors.find((t) => t.name === 'math-tutor')!.hidden && g3.tutors.find((t) => t.name === 'english-tutor')!.extras.join() === 'dictation');
  check('孩子端:藏起来的数学不见了,英语多了听写', (await kid()).tutors.map((t) => t.name + ':' + t.extras.join('+')).join() === 'chinese-tutor:dictation,english-tutor:dictation', (await kid()).tutors.map((t) => t.name + ':' + t.extras.join('+')).join());
  await call('PATCH', '/api/parent/settings', { tutors: { 'english-tutor': { extras: null }, 'math-tutor': { hidden: false } }, talk: { note: '' } });
  const c2 = JSON.parse(readFileSync(cfgFile, 'utf8')) as { tutors: Record<string, { extras?: string[] }>; talk: { note?: string } };
  check('extras null = 回到按学科的缺省(字段删掉);给老师的话清空 = 删掉', !('extras' in c2.tutors['english-tutor']) && !('note' in c2.talk));
  check('设置不对 400:不认识的常驻、听法、老师', (await call('PATCH', '/api/parent/settings', { tutors: { 'english-tutor': { extras: ['x'] } } })).status === 400 && (await call('PATCH', '/api/parent/settings', { listen: 'ear' })).status === 400 && (await call('PATCH', '/api/parent/settings', { tutors: { 'nobody-tutor': {} } })).status === 400);

  // 一直听不再是常驻入口(《wip/实时老师常开麦设计.md》拍板 4):孩子端没有入口,家长端也开不了
  check('一直听不是常驻入口:extras 写 listen 回 400', (await call('PATCH', '/api/parent/settings', { tutors: { 'chinese-tutor': { extras: ['dictation', 'listen'] } } })).status === 400);

  // 页面
  const page = (await call('GET', '/parent/home')).html ?? '';
  const js = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
  let parses = true;
  try { new Function(js); } catch (e) { parses = false; console.error(String(e)); }
  check('家长端「首页」页:两个标签、内联脚本能解析、placeholder 的换行是真换行', page.includes('href="/parent/home">首页') && page.includes('href="/parent">记录') && parses && js.includes("'春天\\n鼓励"), String(page.length));
  const kidPage = (await call('GET', '/')).html ?? '';
  check('孩子端页面里还是没有家长端的路径', !kidPage.includes('/parent'));
  writeFileSync(join(home, 'ok'), '');
} finally {
  done();
}
