/**
 * 首页全流程(假 CLI,不花钱):没发布 = 缺省首页 → 草稿 → check 两级 → publish 拒绝 / --force / 同一分钟再发 →
 * 孩子端首页(老师卡置顶、讲法不下发)→ 按钮发来的 via(activity 按钮 = 按钮字 + 讲法进上下文包,新话题;以前的 new / recent 不认)→
 * 点击统计 → 回放带上讲法 → 家长接口与预览页 → doctor → 发布件坏了退回缺省。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { kidSend as liveSend } from './_kid-send.ts';
import { FAKE_RUNTIMES, startFakeTeacher } from './_fake-teacher.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-home-flow-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
const teacher = await startFakeTeacher();
process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { readIndex, readRunFile } = await import('../src/runtime/journal/store.ts');
const { homeStats, publishHome, readPublished } = await import('../src/runtime/home/store.ts');
const { startReplay } = await import('../src/app/replay.ts');
const { doctorWorkspace } = await import('../src/app/cli/doctor.ts');
const { main } = await import('../src/app/cli/main.ts');
const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
cfg.runtimes = { ...FAKE_RUNTIMES };
for (const t of Object.values((cfg as { tutors: Record<string, { runtime?: string }> }).tutors)) delete t.runtime; // 测试都走假老师
cfg.paths = { vault: 'vault' };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
mkdirSync(join(root, 'vault'), { recursive: true });
// 语文有课本(只看文件在不在,首页出「课本」那块),数学没有
mkdirSync(join(root, 'vault', '教材'), { recursive: true });
writeFileSync(join(root, 'vault', '教材', '语文二年级上册.pdf'), '%PDF-1.4 假的\n');

async function run(argv: string[]): Promise<{ out: string; code: number }> {
  const w = process.stdout.write;
  let out = '';
  process.stdout.write = ((c: string) => ((out += c), true)) as typeof process.stdout.write;
  process.exitCode = 0;
  try {
    await main([...argv, '--workspace', root]);
  } finally {
    process.stdout.write = w;
  }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { out, code };
}

let now = new Date(2026, 8, 16, 19, 30);
const ctx = createContext(loadWorkspace(root), { now: () => now });
const wait = async (tutor: string): Promise<void> => {
  for (let i = 0; i < 200 && ctx.runner.running(tutor); i++) await new Promise((r) => setTimeout(r, 25));
};
const kidSend = (tutor: string, body: unknown) => liveSend(ctx, tutor, body);
type Btn = { id: string | number; kind: string; label: string; date?: string; thread?: string; brief?: string };
type KidHome = { home: string | null; cards: { kind: string; props: { tutor?: string; buttons?: Btn[]; chars?: string } }[]; figshot: { port: number } | null; today: { tutor: string; thread: string }[] };
const kidHome = async (): Promise<KidHome> => (await route('GET', '/api/kid/home', ctx)).json as KidHome;
const buttonsOf = (h: KidHome, tutor: string): Btn[] => h.cards.find((c) => c.kind === 'tutor' && c.props.tutor === tutor)?.props.buttons ?? [];
const draft = (text: string): void => {
  mkdirSync(join(root, 'home'), { recursive: true });
  writeFileSync(join(root, 'home', 'draft.md'), text);
};

try {
  now = new Date(2026, 8, 17, 21, 30);
  const h0 = await kidHome();
  check('没发布过:缺省首页,每位老师一张卡,没有按钮(只有方砖)', h0.home === null && h0.cards.map((c) => c.props.tutor).join() === 'chinese-tutor,english-tutor,math-tutor' && h0.cards.every((c) => buttonsOf(h0, c.props.tutor!).length === 0), JSON.stringify(h0.cards));
  check('孩子端页面:不是预览', ((await route('GET', '/', ctx)).html ?? '').includes('const MODE = {};'));

  // 给老师换样子(figshot):cotutor.json 没配就没有入口;配了首页带端口(缺省 8477),页面自己探它开没开
  check('没配 figshot:首页不带入口', h0.figshot === null, JSON.stringify(h0.figshot));
  const withFigshot = (patch: unknown): void => {
    const c = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
    if (patch === undefined) delete c.figshot;
    else c.figshot = patch;
    writeFileSync(cfgFile, JSON.stringify(c, null, 2));
  };
  withFigshot({});
  check('配了 figshot 没写端口:缺省 8477', (await kidHome()).figshot?.port === 8477);
  withFigshot({ port: 8490 });
  check('配了端口就用那个', (await kidHome()).figshot?.port === 8490);
  check('孩子端页面有入口卡,缺省藏着(探到 figshot 开着才露)', /<a class="c c-figshot" id="figshot" hidden>/.test((await route('GET', '/', ctx)).html ?? ''));
  withFigshot(undefined);
  check('去掉配置入口就没了', (await kidHome()).figshot === null);

  // 常驻入口:没配按学科(语文 = 听写);配了照配的;以前的 talk(口语课页)读进来就丢
  type KT = { name: string; extras: string[] };
  const extrasOf = async (): Promise<Record<string, string>> => Object.fromEntries(((await route('GET', '/api/kid/home', ctx)).json as { tutors: KT[] }).tutors.map((t) => [t.name, t.extras.join('+')]));
  const e0 = await extrasOf();
  check('常驻入口:没配时语文有听写,别的没有', e0['chinese-tutor'] === 'dictation' && e0['english-tutor'] === '' && e0['math-tutor'] === '', JSON.stringify(e0));
  const withTutor = (name: string, patch: Record<string, unknown>): void => {
    const c = JSON.parse(readFileSync(cfgFile, 'utf8')) as { tutors: Record<string, Record<string, unknown>> };
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete c.tutors[name][k]; else c.tutors[name][k] = v; }
    writeFileSync(cfgFile, JSON.stringify(c, null, 2));
    const t = new Date(Date.now() + 2000 + Math.random() * 1000);
    utimesSync(cfgFile, t, t);
  };
  withTutor('english-tutor', { extras: ['talk', 'dictation', 'talk'] });
  withTutor('chinese-tutor', { extras: [] });
  const e1 = await extrasOf();
  check('配了照配的(去重);以前的 talk 丢掉;[] = 都不要', e1['english-tutor'] === 'dictation' && e1['chinese-tutor'] === '', JSON.stringify(e1));
  withTutor('english-tutor', { extras: undefined });
  withTutor('chinese-tutor', { extras: undefined });
  const html = (await route('GET', '/', ctx)).html ?? '';
  check('孩子端页面:没有公共的「拍照听写」卡了,拍照听写在老师卡里', !html.includes('c-snap') && html.includes("'/dictation?tutor='"));

  const BAD = `---
for: 2026-09-18
---

\`\`\`tutor chinese-tutor
activity 课本 我要预习小蝌蚪找妈妈
讲法: 第 22 课,先读顺 1–3 段
activity 看图说话 我要看图说话
讲法: 先问他图上有谁
\`\`\`

\`\`\`tutor math-tutor
小课堂 2026-09-15-nope 找不到的
\`\`\`

\`\`\`choice
问?
- [x] a
\`\`\`

\`\`\`dictation
春天
\`\`\`

## 为什么这么排

- 测试
`;
  draft(BAD);
  const c1 = await run(['home', 'check']);
  check('check:要改两条(首页放不了选择题、小课堂的课包不在)带行号,exit 1;缺的老师说会补', c1.code === 1 && c1.out.includes('要改 2 条') && c1.out.includes('✗ 第 16 行 首页只放老师卡(tutor)和听写卡(dictation),choice 卡放不了') && c1.out.includes('2026-09-15-nope') && c1.out.includes('英语老师 english-tutor(没写,应用补):▦ 预习') && c1.out.includes('▶ 我要预习小蝌蚪找妈妈 → activity 课本(讲法 16 字)') && c1.out.includes('dictation「'), c1.out);
  const p1 = await run(['home', 'publish']);
  check('publish:有要改的不发,exit 1,没有 published.json', p1.code === 1 && p1.out.includes('没发布') && !existsSync(join(root, 'home', 'published.json')), p1.out);

  const f1j = await publishHome(ctx.ws, { force: true, now });
  check('--force:丢掉选择题与那个坏按钮照发', f1j.ok && f1j.home?.id === '2026-09-17-2130' && f1j.dropped.length === 2 && existsSync(join(root, 'home', 'history', '2026-09-17-2130.md')), JSON.stringify({ ok: f1j.ok, id: f1j.home?.id, dropped: f1j.dropped }));

  const GOOD = BAD.replace('小课堂 2026-09-15-nope 找不到的\n', 'activity 检查作业 再练两道退位减法\n讲法: 52−7、80−3\n').replace('```choice\n问?\n- [x] a\n```\n\n', '');
  draft(GOOD);
  const f2 = await publishHome(ctx.ws, { now });
  check('同一分钟再发:id 加序号', f2.ok && f2.home?.id === '2026-09-17-2130-2', JSON.stringify({ ok: f2.ok, id: f2.home?.id }));
  const { home: pub } = await readPublished(ctx.ws);
  check('published.json:卡照文件顺序、讲法在、家长段在、source 指历史', pub?.cards.map((c) => c.kind).join() === 'tutor,tutor,dictation' && JSON.stringify(pub.cards[0].props).includes('第 22 课') && pub.note.includes('为什么这么排') && pub.source === 'home/history/2026-09-17-2130-2.md' && pub.for === '2026-09-18', JSON.stringify(pub));

  const h1 = await kidHome();
  const zh = buttonsOf(h1, 'chinese-tutor');
  check('孩子端首页:发布的 id、老师卡置顶、英语补上、讲法不下发', h1.home === '2026-09-17-2130-2' && h1.cards.map((c) => c.props.tutor ?? c.kind).join() === 'chinese-tutor,math-tutor,english-tutor,dictation' && zh.map((b) => b.id).join() === '0,1' && zh.every((b) => b.kind === 'start') && !JSON.stringify(h1).includes('第 22 课') && !JSON.stringify(h1).includes('brief'), JSON.stringify(h1));

  // ---- 只展开一位老师:非老师卡的归属、橙点 ----
  type HC = { kind: string; owner?: string | null; props: { tutor?: string; news?: boolean } };
  const hc = h1.cards as HC[];
  const newsOf = (h: KidHome): string => (h.cards as HC[]).filter((c) => c.kind === 'tutor' && c.props.news).map((c) => c.props.tutor).join();
  check('归属:跟在数学老师卡后面、没写念的老师的听写卡归数学', hc.find((c) => c.kind === 'dictation')?.owner === 'math-tutor', JSON.stringify(hc.filter((c) => c.kind !== 'tutor')));
  check('橙点:家长排了按钮、发布以来孩子还没找过的(语文、数学)亮;补的英语不亮', newsOf(h1) === 'chinese-tutor,math-tutor', newsOf(h1));
  const ck = await run(['home', 'check', '--published']);
  check('home check 说每张卡归谁', /dictation「[^」]*」 → 数学老师的卡里/.test(ck.out), ck.out);
  {
    const { homeOwners } = await import('../src/runtime/home/home.ts');
    const T = (tutor: string) => ({ kind: 'tutor', props: { tutor, buttons: [] } });
    const owners = homeOwners([{ kind: 'text', props: {} }, T('chinese-tutor'), { kind: 'image', props: {} }, { kind: 'dictation', props: { tutor: 'english-tutor', words: [] } }, T('nobody-tutor'), { kind: 'text', props: {} }, { kind: 'dictation', props: { words: [] } }], ['chinese-tutor', 'english-tutor']);
    check('homeOwners:第一张老师卡前面的公共;跟在谁后面归谁;听写卡写了念的老师归他;不上首页的老师卡不算', owners.join() === ',,chinese-tutor,english-tutor,,chinese-tutor,chinese-tutor', owners.join());
  }

  // ---- 按钮发来的 via ----
  const bad = await kidSend('chinese-tutor', { text: '', via: { home: '2026-09-17-2130', button: 0 } });
  const bad2 = await kidSend('chinese-tutor', { text: '', via: { home: h1.home, button: 7 } });
  // 没有这位老师的连不上实时(升级被拒,live-flow.test),到不了这里
  check('via 对不上(旧的那份、越界)→ 400', bad.status === 400 && bad2.status === 400, JSON.stringify([bad.json, bad2.json]));

  const s0 = await kidSend('chinese-tutor', { text: '', via: { home: h1.home, button: 0 } });
  await wait('chinese-tutor');
  const j0 = (s0.json as { job: string; thread: string }).job;
  const idx17 = await readIndex(ctx.ws, 'chinese-tutor', '2026-09-17');
  const m0 = idx17.messages.find((m) => m.job === j0)!;
  const run0 = await readRunFile(ctx.ws, 'chinese-tutor', '2026-09-17', j0);
  check('孩子找过语文老师了:他的橙点灭,数学的还亮', newsOf(await kidHome()) === 'math-tutor', newsOf(await kidHome()));
  check('activity 按钮:发的是按钮上的字、新话题、消息记 via 与 activity', m0.text === '我要预习小蝌蚪找妈妈' && m0.thread === j0 && JSON.stringify(m0.via) === JSON.stringify({ home: h1.home, button: 0, label: '我要预习小蝌蚪找妈妈' }) && m0.activity?.name === '课本', JSON.stringify(m0));
  check('activity 按钮:上下文包带 home 段(按钮字与讲法)', run0?.prompt.includes('  home:\n    button: "我要预习小蝌蚪找妈妈"\n    brief: "第 22 课,先读顺 1–3 段"') === true, run0?.prompt);

  const s1 = await kidSend('chinese-tutor', { text: '', thread: j0, via: { home: h1.home, button: 1 } });
  await wait('chinese-tutor');
  const j1 = (s1.json as { job: string }).job;
  const m1 = (await readIndex(ctx.ws, 'chinese-tutor', '2026-09-17')).messages.find((m) => m.job === j1)!;
  check('按钮总是开新话题(带着 thread 也不接)', m1.thread === j1 && m1.text === '我要看图说话' && m1.activity?.name === '看图说话', JSON.stringify(m1));

  // 新话题、接着刚才的按钮没有了(2026-11-16):以前的 via new / recent 不认
  const s2b = await kidSend('math-tutor', { text: '我想问个别的', via: { home: h1.home, button: 'new' } });
  const s2c = await kidSend('math-tutor', { text: '我想问个别的', via: { home: h1.home, button: 'recent' } });
  check('via new / recent 不认', s2b.status === 400 && s2c.status === 400 && (await readIndex(ctx.ws, 'math-tutor', '2026-09-17')).messages.length === 0, JSON.stringify([s2b.json, s2c.json]));

  const h2 = await kidHome();
  const zh2 = buttonsOf(h2, 'chinese-tutor');
  check('今天聊过:首页的按钮照旧(今天聊过的在首页「今天」接)', zh2.map((b) => b.id).join() === '0,1' && !('resume' in zh2[0]), JSON.stringify(zh2));
  const s3 = await kidSend('chinese-tutor', { text: '小蝌蚪后来呢', thread: j1 });
  await wait('chinese-tutor');
  const m3 = (await readIndex(ctx.ws, 'chinese-tutor', '2026-09-17')).messages.find((m) => m.job === (s3.json as { job: string }).job)!;
  check('不带按钮的接着那个话题:孩子自己的话', m3.thread === j1 && m3.text === '小蝌蚪后来呢' && !m3.via);

  // 方砖:出厂的老师家里有的,不经发布常驻(语文、数学课本、检查作业;英语预习、检查作业、复习、口语课);课本要有课本;点了 = 那个 activity、发方砖上的字;关掉的不出、点了 400
  type Tile = { id: string; label: string };
  const tilesOf = (h: KidHome, tutor: string): Tile[] => (h.cards.find((c) => c.kind === 'tutor' && c.props.tutor === tutor)?.props as { tiles?: Tile[] } | undefined)?.tiles ?? [];
  const ht = await kidHome();
  check('方砖:语文有课本、检查作业;数学没放课本,只有检查作业;英语预习、检查作业、复习、口语课(一直听)', tilesOf(ht, 'chinese-tutor').map((x) => `${x.id}:${x.label}`).join() === 'textbook:课本,check:检查作业' && (tilesOf(ht, 'chinese-tutor')[0] as { base?: string }).base === 'textbook' && tilesOf(ht, 'math-tutor').map((x) => `${x.id}:${x.label}`).join() === 'check:检查作业' && tilesOf(ht, 'english-tutor').map((x) => `${x.id}:${x.label}`).join() === 'preview:预习,check:检查作业,review:复习,talk:口语课' && (tilesOf(ht, 'english-tutor')[3] as { listen?: string } | undefined)?.listen === 'open', JSON.stringify(tilesOf(ht, 'english-tutor')));
  check('没放课本的点「课本」400', (await kidSend('math-tutor', { text: '', via: { home: h1.home, button: 'textbook' } })).status === 400);
  const sTile = await kidSend('english-tutor', { text: '', via: { home: h1.home, button: 'check' } });
  await wait('english-tutor');
  const mt = (await readIndex(ctx.ws, 'english-tutor', '2026-09-17')).messages.find((m) => m.job === (sTile.json as { job: string }).job);
  check('点方砖:新话题、发方砖上的字、记 via、话题照 activity「检查作业」(参数缺省)', sTile.status < 300 && mt?.text === '检查作业' && mt.via?.button === 'check' && mt.activity?.name === '检查作业' && mt.thread === mt.job, JSON.stringify([sTile.status, sTile.json, mt]));
  const ht2 = await kidHome();
  check('方砖不带 resume(今天聊过的在首页「今天」接);只说了方砖的字、没出图的话题不上「今天」', tilesOf(ht2, 'english-tutor').every((x) => !('resume' in x)) && !ht2.today.some((x) => x.thread === mt?.thread), JSON.stringify(ht2.today));
  withTutor('english-tutor', { tiles: { check: false } });
  check('关掉的方砖不出', tilesOf(await kidHome(), 'english-tutor').map((x) => x.id).join() === 'preview,review,talk');
  check('关掉的方砖点了 400(孩子端刷新首页)', (await kidSend('english-tutor', { text: '', via: { home: h1.home, button: 'check' } })).status === 400);
  withTutor('english-tutor', { tiles: undefined });
  const themeCss = await route('GET', '/kid/theme.css', ctx);
  check('孩子端页面带方砖的图,theme.css 带竖版卡与封面的样式', ((await route('GET', '/', ctx)).html ?? '').includes('TILE_ART') && JSON.stringify(themeCss).includes('.bt-cover') && JSON.stringify(themeCss).includes('.cv-book'), JSON.stringify(themeCss).slice(0, 200));

  // ---- 册的方砖带封面:课本先是占位(学科 + 几年级几册),首页画了第 1 页交上来以后换成它;作业本还没拍过只有标签 ----
  type Cover = { kind: string; book?: string; title?: string; sub?: string; image?: string; subject?: string };
  const coverOf = (h: KidHome, tutor: string, id: string): Cover | undefined => (tilesOf(h, tutor).find((x) => x.id === id) as { cover?: Cover } | undefined)?.cover;
  const cv0 = coverOf(await kidHome(), 'chinese-tutor', 'textbook');
  check('课本的封面:还没画是占位,字从文件名认', cv0?.kind === 'book' && cv0.book === '语文二年级上册.pdf' && cv0.title === '语文' && cv0.sub === '二年级 上册' && !cv0.image, JSON.stringify(cv0));
  const hw0 = coverOf(await kidHome(), 'english-tutor', 'check');
  check('作业本的封面:还没拍过只有学科,没有图', hw0?.kind === 'homework' && hw0.subject === '英语' && !hw0.image, JSON.stringify(hw0));
  const JPG = `data:image/jpeg;base64,${Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex').toString('base64')}`;
  check('交封面:不是这里的课本、不是 jpeg 400', (await route('PUT', '/api/kid/textbook/cover', ctx, { book: '数学二年级上册.pdf', image: JPG })).status === 400 && (await route('PUT', '/api/kid/textbook/cover', ctx, { book: '语文二年级上册.pdf', image: 'data:image/png;base64,AAAA' })).status === 400);
  check('交封面:存下', (await route('PUT', '/api/kid/textbook/cover', ctx, { book: '语文二年级上册.pdf', image: JPG })).status === 200);
  const cv1 = coverOf(await kidHome(), 'chinese-tutor', 'textbook');
  const got = cv1?.image ? await route('GET', cv1.image, ctx) : null;
  check('交了以后首页课本那张带图(带指纹破缓存),取得到', Boolean(cv1?.image?.includes('&v=')) && got?.status === 200 && got.contentType === 'image/jpeg', JSON.stringify([cv1, got?.status]));

  // ---- 点击统计 ----
  const st = await homeStats(ctx.ws, now);
  const uses = (tutor: string, button: string | number): number => st.clicks.find((c) => c.tutor === tutor && c.button === button)?.uses.length ?? -1;
  check('点击统计:每个文件里的按钮一行(没点也在),加上点过的方砖', st.home?.id === h1.home && st.days === 0 && uses('chinese-tutor', 0) === 1 && uses('chinese-tutor', 1) === 1 && uses('math-tutor', 0) === 0 && uses('english-tutor', 'check') === 1, JSON.stringify(st.clicks));
  const sh = await run(['home', 'show']);
  check('cotutor home show', sh.code === 0 && sh.out.includes(`已发布 ${h1.home}`) && sh.out.includes('语文老师 · 我要预习小蝌蚪找妈妈:点了 1 次') && sh.out.includes('数学老师 · 再练两道退位减法:没点过'), sh.out);
  check('工作台 /dev 没有「首页」标签(2026-09-28 退掉:日常用的东西不进工作台);预览页与家长接口也没了', !((await route('GET', '/dev', ctx)).html ?? '').includes('data-tab="home"') && (await route('GET', '/dev/home-preview?which=draft', ctx)).status === 404 && (await route('GET', '/api/home', ctx)).status === 404);

  // ---- 回放:讲法从当时发布的那份原文取 ----
  const rp0 = await startReplay(ctx.ws, 'chinese-tutor', '2026-09-17', j0, { now: () => now });
  await rp0.done;
  const rp1 = await startReplay(ctx.ws, 'chinese-tutor', '2026-09-17', j1, { now: () => now });
  await rp1.done;
  const evalRun = (job: string): string => (JSON.parse(readFileSync(join(root, 'evals', 'chinese-tutor', `2026-09-17.${job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  check('回放按钮开的那轮:上下文包照样有讲法', evalRun(rp0.evalJob).includes('brief: "第 22 课,先读顺 1–3 段"') && evalRun(rp1.evalJob).includes('brief: "先问他图上有谁"'));

  // ---- doctor 与坏了的时候 ----
  const d1 = await doctorWorkspace(root, { probeEnv: false, now });
  check('doctor:已发布今天的、引用都在', d1.checks.some((c) => c.name === 'home.published' && c.ok && c.detail.includes(h1.home!)) && d1.checks.some((c) => c.name === 'home.refs' && c.ok), JSON.stringify(d1.checks.filter((c) => c.name.startsWith('home.'))));
  const pubFile = join(root, 'home', 'published.json');
  const good = readFileSync(pubFile, 'utf8');
  writeFileSync(pubFile, good.replace('"activity": "看图说话"', '"activity": "没有这个"'));
  const d2 = await doctorWorkspace(root, { probeEnv: false, now });
  check('doctor:引用坏了(activity 不在)报出来;孩子端那个按钮不出现', d2.checks.some((c) => c.name === 'home.refs' && !c.ok && c.detail.includes('没有这个')) && buttonsOf(await kidHome(), 'chinese-tutor').every((b) => b.id !== 1), JSON.stringify(d2.checks.filter((c) => c.name.startsWith('home.'))));
  writeFileSync(pubFile, '{坏');
  const h3 = await kidHome();
  const d3 = await doctorWorkspace(root, { probeEnv: false, now });
  check('发布件坏了:孩子端退回缺省首页,doctor 报', h3.home === null && buttonsOf(h3, 'math-tutor').every((b) => b.id !== 0) && d3.checks.some((c) => c.name === 'home.published' && !c.ok && c.detail.includes('不是合法 JSON')));
  writeFileSync(pubFile, good);

  // ---- CLI 发布(真时间):干净的草稿 exit 0,历史多一份 ----
  const p2 = await run(['home', 'publish']);
  check('cotutor home publish:发布了,历史三份', p2.code === 0 && p2.out.includes('发布了 ') && readdirSync(join(root, 'home', 'history')).length === 3, p2.out);
  const c2 = await run(['home', 'check', '--published']);
  check('cotutor home check --published:没有要改的', c2.code === 0 && !c2.out.includes('要改'), c2.out);

  // ---- 家长在孩子端试、用完删(备课删掉之后,2026-10-05):话题照孩子的算,删的时候它写进记忆、日记的一起撤 ----
  {
    const { existsSync: exists } = await import('node:fs');
    const convDir = join(root, 'conversations', 'math-tutor');
    // 话题从 activity「聊」开始(tests/_chat.ts):老师记的进那个 activity 那篇
    const { CHAT_RUN, writeChat } = await import('./_chat.ts');
    writeChat(root, ['math-tutor']);
    const memFile = join(root, 'vault', '记忆', '数学老师·聊.md');
    mkdirSync(join(root, 'vault', '记忆'), { recursive: true });
    const memBefore = '---\ncotutor: memory\nagent: math-tutor/聊\n---\n\n家长写在开头的话。\n\n- 2026-09-01 讲慢点他跟得上\n- 2026-09-01 爱用手指数\n- 2026-09-02 喜欢乐高\n';
    writeFileSync(memFile, memBefore);
    const s1 = await ctx.runner.send('math-tutor', { from: 'kid', text: '板书 记住它', newThread: true, activity: CHAT_RUN, live: {} });
    await s1.done;
    const { date: day, thread: th } = s1;
    await (await ctx.runner.send('math-tutor', { from: 'kid', text: '改记忆', thread: th, live: {} })).done;
    const i1 = await readIndex(ctx.ws, 'math-tutor', day);
    const mine = i1.messages.filter((m) => m.thread === th);
    const mem1 = readFileSync(memFile, 'utf8');
    check('孩子说的两轮:from kid、记忆真写了(加两条、改一条、删一条),每轮记下整行原文', mine.length === 2 && mine.every((m) => m.from === 'kid') && mem1.includes('讲角用手指比划他马上懂') && mem1.includes('讲慢点才跟得上') && !mem1.includes('爱用手指数') && mine[0].memoryLines?.length === 2 && mine[1].memoryLines?.length === 2 && mine[1].memoryLines?.some((l) => l.before === '- 2026-09-01 爱用手指数' && l.after === null), JSON.stringify(mine.map((m) => m.memoryLines)));
    await route('POST', `/api/conversations/math-tutor/${day}/bookkeep`, ctx, { threads: [th] });
    await ctx.runner.flush();
    const diaryFile = join(root, 'vault', '日记', `${day}.md`);
    const i2 = await readIndex(ctx.ws, 'math-tutor', day);
    const bkMsg = i2.messages.find((m) => m.thread === th && m.bookkeep);
    const diary1 = exists(diaryFile) ? readFileSync(diaryFile, 'utf8') : '';
    check('记账:日记里有这个话题一段,原文记在记账那轮的 diaryBlock', Boolean(bkMsg?.diaryBlock) && diary1.includes(bkMsg!.diaryBlock!.trim()), diary1);
    const del = await route('DELETE', `/api/conversations/math-tutor/${day}/threads/${encodeURIComponent(th)}`, ctx);
    const undo = (del.json as { undo: { memory: number; diary: number; misses: string[] } }).undo;
    const mem2 = readFileSync(memFile, 'utf8');
    const diary2 = exists(diaryFile) ? readFileSync(diaryFile, 'utf8') : '';
    const after = await readIndex(ctx.ws, 'math-tutor', day);
    const files = readdirSync(convDir).filter((f) => mine.some((m) => f.startsWith(`${day}.${m.job}.`)));
    check('删话题:撤了 4 行记忆(加的删掉、改的换回、删的接回末尾)、日记那段摘掉;家长写的与整理那轮加的不动', del.status === 200 && undo.memory === 4 && undo.diary === 1 && !mem2.includes('讲角用手指比划他马上懂') && !mem2.includes('家长说别出选择题') && mem2.includes('- 2026-09-01 讲慢点他跟得上') && mem2.includes('- 2026-09-01 爱用手指数') && mem2.includes('家长写在开头的话。') && mem2.includes('喜欢乐高') && !diary2.includes(bkMsg!.diaryBlock!.trim()), JSON.stringify({ undo, mem2, diary2 }));
    check('删话题:索引、会话、记账标记、文件都没了;再删 404', !after.messages.some((m) => m.thread === th) && !(th in after.sessions) && !(th in after.booked) && files.length === 0 && (await route('DELETE', `/api/conversations/math-tutor/${day}/threads/${encodeURIComponent(th)}`, ctx)).status === 404, JSON.stringify({ files }));
    // 工作台 / cotutor send 发的也是孩子的话(没有 from: parent 了;旧客户端带 parent 也当 kid)
    const dv = await route('POST', '/api/conversations/math-tutor/messages', ctx, { text: '工作台问一句', from: 'parent', activity: '聊' });
    await wait('math-tutor');
    const dvi = await readIndex(ctx.ws, 'math-tutor', day);
    const dvm = dvi.messages.find((m) => m.job === (dv.json as { job: string }).job);
    const dvk = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { job: string; question: string | null }[] };
    const gone = [(await route('POST', `/api/conversations/math-tutor/${day}/threads/${dvm?.thread}/lesson/hand`, ctx, { label: 'x' })).status, (await route('GET', '/api/lessons', ctx)).status];
    check('工作台发的:记 from kid,孩子端看得到问句;家长端没有备课与交给孩子的接口', dv.status === 202 && dvm?.from === 'kid' && dvk.messages.find((m) => m.job === dvm.job)?.question === '工作台问一句' && gone.every((x) => x >= 400), JSON.stringify({ dvm, gone }));
  }
} finally {
  await teacher.close();
  rmSync(home, { recursive: true, force: true });
}
done();
