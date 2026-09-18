/**
 * 首页全流程(假 CLI,不花钱,《首页设计.md》):没发布 = 缺省首页 → 草稿 → check 两级 → publish 拒绝 / --force / 同一分钟再发 →
 * 孩子端首页(老师卡置顶、讲法不下发、接着刚才的)→ 按钮发来的 via(开场 = 按钮字 + 讲法进上下文包;接着以前 = 新话题 + continue 段)→
 * 点击统计 → 回放带上讲法与 continue → 家长接口与预览页 → doctor → 发布件坏了退回缺省。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-home-flow-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { readIndex, readRunFile } = await import('../src/server/store.ts');
const { homeStats, readPublished } = await import('../src/server/home.ts');
const { startReplay } = await import('../src/server/replay.ts');
const { doctorWorkspace } = await import('../src/cli/doctor.ts');
const { main } = await import('../src/cli/main.ts');

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const node = process.execPath;
const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
cfg.runtimes = {
  default: 'fake',
  fake: { run: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '{prompt}'], resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] },
};
cfg.paths = { vault: 'vault' };
cfg.policyDefaults = { post: { mode: 'off' } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
mkdirSync(join(root, 'vault'), { recursive: true });

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
const kidSend = (tutor: string, body: unknown) => route('POST', `/api/kid/conversations/${tutor}/messages`, ctx, body);
type Btn = { id: string | number; kind: string; label: string; date?: string; thread?: string; brief?: string };
type KidHome = { home: string | null; cards: { kind: string; props: { tutor?: string; buttons?: Btn[]; chars?: string } }[] };
const kidHome = async (): Promise<KidHome> => (await route('GET', '/api/kid/home', ctx)).json as KidHome;
const buttonsOf = (h: KidHome, tutor: string): Btn[] => h.cards.find((c) => c.kind === 'tutor' && c.props.tutor === tutor)?.props.buttons ?? [];
const draft = (text: string): void => {
  mkdirSync(join(root, 'home'), { recursive: true });
  writeFileSync(join(root, 'home', 'draft.md'), text);
};

try {
  // 16 号:语文老师讲了一节(带卡),这是后面「接着」指的话题
  const r16 = await kidSend('chinese-tutor', { text: '讲讲板书', newThread: true });
  await wait('chinese-tutor');
  const t16 = (r16.json as { thread: string }).thread;
  check('16 号的话题有板书', (await readIndex(ctx.ws, 'chinese-tutor', '2026-09-16')).messages[0].section?.cards.length === 2);

  now = new Date(2026, 8, 17, 21, 30);
  const h0 = await kidHome();
  check('没发布过:缺省首页,每位老师一张只有「新话题」的卡', h0.home === null && h0.cards.map((c) => c.props.tutor).join() === 'chinese-tutor,english-tutor,math-tutor' && h0.cards.every((c) => buttonsOf(h0, c.props.tutor!).map((b) => b.id).join() === 'new'), JSON.stringify(h0.cards));
  check('孩子端页面:不是预览', ((await route('GET', '/', ctx)).html ?? '').includes('const PREVIEW = null;'));

  const BAD = `---
for: 2026-09-18
---

\`\`\`tutor chinese-tutor
我要预习小蝌蚪找妈妈
讲法: 第 22 课,先读顺 1–3 段
接着 2026-09-16 ${t16} 接着讲昨天的
讲法: 先问他还记不记得
\`\`\`

\`\`\`tutor math-tutor
接着 2026-09-15 0900-1 找不到的
\`\`\`

\`\`\`choice
问?
- [x] a
\`\`\`

\`\`\`tianzige
塘脑袋
\`\`\`

## 为什么这么排

- 测试
`;
  draft(BAD);
  const c1 = await run(['home', 'check']);
  check('check:要改两条(首页放不了选择题、接着的话题找不到)带行号,exit 1;缺的老师说会补', c1.code === 1 && c1.out.includes('要改 2 条') && c1.out.includes('✗ 第 16 行 首页放不了 choice') && c1.out.includes('2026-09-15 没有话题 0900-1') && c1.out.includes('英语老师 english-tutor(没写,应用补):✨ 新话题') && c1.out.includes('▶ 我要预习小蝌蚪找妈妈(讲法 16 字)') && c1.out.includes('tianzige「塘脑袋」'), c1.out);
  const p1 = await run(['home', 'publish']);
  check('publish:有要改的不发,exit 1,没有 published.json', p1.code === 1 && p1.out.includes('没发布') && !existsSync(join(root, 'home', 'published.json')), p1.out);

  const api0 = (await route('GET', '/api/home', ctx)).json as { draft: { exists: boolean; fixes: number; cards: unknown[] }; published: unknown };
  check('家长接口:草稿两条要改、还没发布', api0.draft.exists && api0.draft.fixes === 2 && api0.published === null);
  const pv = (await route('GET', '/api/home/preview?which=draft', ctx)).json as KidHome & { preview: string };
  check('预览草稿:讲法留着(家长看的)、坏卡按文字卡显示', pv.preview === 'draft' && buttonsOf(pv, 'chinese-tutor').find((b) => b.id === 0)?.brief === '第 22 课,先读顺 1–3 段' && pv.cards.some((c) => c.kind === 'text'), JSON.stringify(pv.cards));
  check('预览页是孩子端页面带预览标记', ((await route('GET', '/parent/home-preview?which=draft', ctx)).html ?? '').includes('const PREVIEW = "draft";'));

  const f1 = await route('POST', '/api/home/publish', ctx, { force: true });
  const f1j = f1.json as { ok: boolean; id: string; dropped: string[] };
  check('--force:丢掉选择题与那个坏按钮照发', f1.status === 200 && f1j.ok && f1j.id === '2026-09-17-2130' && f1j.dropped.length === 2 && existsSync(join(root, 'home', 'history', '2026-09-17-2130.md')), JSON.stringify(f1j));

  const GOOD = BAD.replace('接着 2026-09-15 0900-1 找不到的\n', '再练两道退位减法\n讲法: 52−7、80−3\n').replace('```choice\n问?\n- [x] a\n```\n\n', '');
  draft(GOOD);
  const r409 = await route('POST', '/api/home/publish', ctx, { from: '../../etc' });
  check('家长接口的 from 只认历史 id', r409.status === 400);
  const f2 = (await route('POST', '/api/home/publish', ctx, {})).json as { ok: boolean; id: string };
  check('同一分钟再发:id 加序号', f2.ok && f2.id === '2026-09-17-2130-2', JSON.stringify(f2));
  const { home: pub } = await readPublished(ctx.ws);
  check('published.json:卡照文件顺序、讲法在、家长段在、source 指历史', pub?.cards.map((c) => c.kind).join() === 'tutor,tutor,tianzige' && JSON.stringify(pub.cards[0].props).includes('第 22 课') && pub.note.includes('为什么这么排') && pub.source === 'home/history/2026-09-17-2130-2.md' && pub.for === '2026-09-18', JSON.stringify(pub));

  const h1 = await kidHome();
  const zh = buttonsOf(h1, 'chinese-tutor');
  check('孩子端首页:发布的 id、老师卡置顶、英语补上、讲法不下发', h1.home === '2026-09-17-2130-2' && h1.cards.map((c) => c.props.tutor ?? c.kind).join() === 'chinese-tutor,math-tutor,english-tutor,tianzige' && zh.map((b) => b.id).join() === 'new,0,1' && zh[2].kind === 'continue' && zh[2].thread === t16 && !JSON.stringify(h1).includes('第 22 课') && !JSON.stringify(h1).includes('brief'), JSON.stringify(h1));

  // ---- 按钮发来的 via ----
  const bad = await kidSend('chinese-tutor', { text: '', via: { home: '2026-09-17-2130', button: 0 } });
  const bad2 = await kidSend('chinese-tutor', { text: '', via: { home: h1.home, button: 7 } });
  const bad3 = await kidSend('scene-maker', { text: '', via: { home: h1.home, button: 0 } });
  check('via 对不上(旧的那份、越界、藏着的老师)→ 400 / 404', bad.status === 400 && bad2.status === 400 && bad3.status === 404, JSON.stringify([bad.json, bad2.json]));

  const s0 = await kidSend('chinese-tutor', { text: '', newThread: true, via: { home: h1.home, button: 0 } });
  await wait('chinese-tutor');
  const j0 = (s0.json as { job: string; thread: string }).job;
  const idx17 = await readIndex(ctx.ws, 'chinese-tutor', '2026-09-17');
  const m0 = idx17.messages.find((m) => m.job === j0)!;
  const run0 = await readRunFile(ctx.ws, 'chinese-tutor', '2026-09-17', j0);
  check('开场按钮:发的是按钮上的字、新话题、消息记 via', m0.text === '我要预习小蝌蚪找妈妈' && m0.thread === j0 && JSON.stringify(m0.via) === JSON.stringify({ home: h1.home, button: 0, label: '我要预习小蝌蚪找妈妈' }) && !m0.continues, JSON.stringify(m0));
  check('开场按钮:上下文包带 home 段(按钮字与讲法),不带 continue', run0?.prompt.includes('  home:\n    button: "我要预习小蝌蚪找妈妈"\n    brief: "第 22 课,先读顺 1–3 段"') === true && !run0.prompt.includes('\n  continue:'), run0?.prompt);

  const s1 = await kidSend('chinese-tutor', { text: '', thread: j0, via: { home: h1.home, button: 1 } });
  await wait('chinese-tutor');
  const j1 = (s1.json as { job: string }).job;
  const m1 = (await readIndex(ctx.ws, 'chinese-tutor', '2026-09-17')).messages.find((m) => m.job === j1)!;
  const run1 = await readRunFile(ctx.ws, 'chinese-tutor', '2026-09-17', j1);
  const sec16 = (await readIndex(ctx.ws, 'chinese-tutor', '2026-09-16')).messages[0].section!;
  check('接着以前的话题:新话题(不接今天的)、按钮上的字、消息记 continues', m1.thread === j1 && m1.text === '接着讲昨天的' && JSON.stringify(m1.continues) === JSON.stringify({ date: '2026-09-16', thread: t16 }), JSON.stringify(m1));
  check('接着以前的话题:上下文包带 continue 段(哪天哪个、话题名、那一节的讲稿与卡、索引路径)+ 讲法', run1?.prompt.includes(`  continue:\n    from: "2026-09-16 ${t16}"\n    title: "讲讲板书"`) === true && run1.prompt.includes(`      - ${JSON.stringify(sec16.lines[0].text)}`) && run1.prompt.includes(`${t16}/0 ${sec16.cards[0].kind}`) && run1.prompt.includes(join('conversations', 'chinese-tutor', '2026-09-16.json')) && run1.prompt.includes('brief: "先问他还记不记得"'), run1?.prompt);

  const s2 = await kidSend('math-tutor', { text: '我想问个别的', newThread: true, via: { home: h1.home, button: 'new' } });
  await wait('math-tutor');
  const m2 = (await readIndex(ctx.ws, 'math-tutor', '2026-09-17')).messages[0];
  const run2 = await readRunFile(ctx.ws, 'math-tutor', '2026-09-17', (s2.json as { job: string }).job);
  check('新话题按钮:孩子自己的话、记 via、上下文包没有 home 段', m2.text === '我想问个别的' && m2.via?.button === 'new' && !run2?.prompt.includes('\n  home:'), JSON.stringify(m2));

  const h2 = await kidHome();
  const zh2 = buttonsOf(h2, 'chinese-tutor');
  check('今天聊过:老师卡第二个是「接着刚才的」,指今天当前的话题', zh2.map((b) => b.id).join() === 'new,recent,0,1' && zh2[1].thread === j1 && zh2[1].label === '接着刚才的:接着讲昨天的', JSON.stringify(zh2));
  const s3 = await kidSend('chinese-tutor', { text: '小蝌蚪后来呢', thread: j1, via: { home: h1.home, button: 'recent' } });
  await wait('chinese-tutor');
  const m3 = (await readIndex(ctx.ws, 'chinese-tutor', '2026-09-17')).messages.find((m) => m.job === (s3.json as { job: string }).job)!;
  check('接着刚才的:接今天那个话题,孩子自己的话', m3.thread === j1 && m3.text === '小蝌蚪后来呢' && m3.via?.button === 'recent');

  // ---- 点击统计 ----
  const st = await homeStats(ctx.ws, now);
  const uses = (tutor: string, button: string | number): number => st.clicks.find((c) => c.tutor === tutor && c.button === button)?.uses.length ?? -1;
  check('点击统计:每个文件里的按钮一行(没点也在),加上点过的新话题 / 接着刚才的', st.home?.id === h1.home && st.days === 0 && uses('chinese-tutor', 0) === 1 && uses('chinese-tutor', 1) === 1 && uses('math-tutor', 0) === 0 && uses('math-tutor', 'new') === 1 && uses('chinese-tutor', 'recent') === 1, JSON.stringify(st.clicks));
  const sh = await run(['home', 'show']);
  check('cotutor home show', sh.code === 0 && sh.out.includes(`已发布 ${h1.home}`) && sh.out.includes('语文老师 · 我要预习小蝌蚪找妈妈:点了 1 次') && sh.out.includes('数学老师 · 再练两道退位减法:没点过'), sh.out);
  const api1 = (await route('GET', '/api/home', ctx)).json as { published: { id: string; broken: unknown[] }; clicks: unknown[] };
  check('家长接口:已发布、引用都在、点击', api1.published.id === h1.home && api1.published.broken.length === 0 && api1.clicks.length === 5);
  check('家长页有「首页」标签', ((await route('GET', '/parent', ctx)).html ?? '').includes('data-tab="home"'));

  // ---- 回放:讲法从当时发布的那份原文取,continue 从原 workspace 读 ----
  const rp0 = await startReplay(ctx.ws, 'chinese-tutor', '2026-09-17', j0, { now: () => now });
  await rp0.done;
  const rp1 = await startReplay(ctx.ws, 'chinese-tutor', '2026-09-17', j1, { now: () => now });
  await rp1.done;
  const evalRun = (job: string): string => (JSON.parse(readFileSync(join(root, 'evals', 'chinese-tutor', `2026-09-17.${job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  check('回放开场那轮:上下文包照样有讲法', evalRun(rp0.evalJob).includes('brief: "第 22 课,先读顺 1–3 段"'));
  check('回放接着那轮:上下文包照样有 continue 段', evalRun(rp1.evalJob).includes(`from: "2026-09-16 ${t16}"`));

  // ---- doctor 与坏了的时候 ----
  const d1 = await doctorWorkspace(root, { probeEnv: false });
  check('doctor:已发布今天的、引用都在', d1.checks.some((c) => c.name === 'home.published' && c.ok && c.detail.includes(h1.home!)) && d1.checks.some((c) => c.name === 'home.refs' && c.ok), JSON.stringify(d1.checks.filter((c) => c.name.startsWith('home.'))));
  const pubFile = join(root, 'home', 'published.json');
  const good = readFileSync(pubFile, 'utf8');
  writeFileSync(pubFile, good.replace(`"thread": "${t16}"`, '"thread": "0000-9"'));
  const d2 = await doctorWorkspace(root, { probeEnv: false });
  check('doctor:引用坏了报出来;孩子端那个按钮不出现', d2.checks.some((c) => c.name === 'home.refs' && !c.ok && c.detail.includes('0000-9')) && buttonsOf(await kidHome(), 'chinese-tutor').every((b) => b.id !== 1));
  writeFileSync(pubFile, '{坏');
  const h3 = await kidHome();
  const d3 = await doctorWorkspace(root, { probeEnv: false });
  check('发布件坏了:孩子端退回缺省首页,doctor 报', h3.home === null && buttonsOf(h3, 'math-tutor').every((b) => b.id !== 0) && d3.checks.some((c) => c.name === 'home.published' && !c.ok && c.detail.includes('不是合法 JSON')));
  writeFileSync(pubFile, good);

  // ---- CLI 发布(真时间):干净的草稿 exit 0,历史多一份 ----
  const p2 = await run(['home', 'publish']);
  check('cotutor home publish:发布了,历史三份', p2.code === 0 && p2.out.includes('发布了 ') && readdirSync(join(root, 'home', 'history')).length === 3, p2.out);
  const c2 = await run(['home', 'check', '--published']);
  check('cotutor home check --published:没有要改的', c2.code === 0 && !c2.out.includes('要改'), c2.out);
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
