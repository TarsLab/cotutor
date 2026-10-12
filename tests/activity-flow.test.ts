/**
 * activity 全流程(假 CLI,不花钱,《wip/activity设计.md》第 2 期):init 拷进出厂的你说我画 → 首页 activity 按钮的检查(文件不在、参数不对)→
 * 孩子端是开场按钮、参数不下发 → 点了:新话题、按钮字、参数补了缺省记在第一条 → 上下文包 activity: 在最后、<cotutor-activity> 按参数裁过、
 * 老师没有的 paint 卡写法跟在后面 → 同一话题下一条:activity: 还在、原文「未变」→ 家长改了参数,旧话题照旧 → pack / send --activity → 回放带上。
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-activity-flow-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { readIndex, readRunFile } = await import('../src/server/store.ts');
const { publishHome, checkHome } = await import('../src/server/home.ts');
const { startReplay } = await import('../src/server/replay.ts');
const { main } = await import('../src/cli/main.ts');
const { parseHome } = await import('../src/lib/home.ts');
const { setTutorButtons } = await import('../src/lib/home-edit.ts');
const { renderContextPack } = await import('../src/lib/context-pack.ts');
const { evalActivity } = await import('../src/server/activity-eval.ts');

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

const now = new Date(2026, 9, 12, 16, 20);
const DATE = '2026-10-12';
// 画家是假的:不花钱,记下画了几张
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
let drew = 0;
const ctx = createContext(loadWorkspace(root), { now: () => now, draw: async ({ model }) => { drew++; return { ok: true, data: PNG, model, ms: 5 }; } });
const wait = async (tutor: string): Promise<void> => {
  for (let i = 0; i < 200 && ctx.runner.running(tutor); i++) await new Promise((r) => setTimeout(r, 25));
};
const kidSend = (tutor: string, body: unknown) => route('POST', `/api/kid/conversations/${tutor}/messages`, ctx, body);
const draft = (text: string): void => {
  mkdirSync(join(root, 'home'), { recursive: true });
  writeFileSync(join(root, 'home', 'draft.md'), text);
};
const HOME = (buttons: string): string => `\`\`\`tutor chinese-tutor\n${buttons}\n\`\`\`\n\n## 为什么这么排\n\n试 activity\n`;

try {
  check('init 拷进你说我画', readFileSync(join(root, 'agents', 'chinese-tutor', 'activities', '你说我画.md'), 'utf8').includes('name: 你说我画'));

  // ---- 首页检查 ----
  {
    const c1 = await checkHome(ctx.ws, HOME('activity 你画我说'), now);
    check('activity 文件不在:要改', c1.issues.some((i) => i.level === 'fix' && i.text.includes('你画我说.md 不在')), JSON.stringify(c1.issues));
    const c2 = await checkHome(ctx.ws, HOME('activity 你说我画\n单词: 春风\n最多画: 9'), now);
    check('参数不对:不认得的、超出范围的都报', c2.issues.some((i) => i.text.includes('「单词」不是 你说我画 的参数')) && c2.issues.some((i) => i.text.includes('1 到 4 之间')), JSON.stringify(c2.issues));
    const c3 = await checkHome(ctx.ws, HOME('activity 你说我画\nactivity 你说我画 我来出题\n词: 播种、睡大觉、羞愧\n讲法: 羞愧要落到一幅上'), now);
    check('写对了:没有要改的', c3.fixes === 0, JSON.stringify(c3.issues));
    const { out } = await run(['home', 'check']).catch(() => ({ out: '', code: 1 }));
    void out;
  }

  draft(HOME('activity 你说我画\nactivity 你说我画 我来出题\n词: 播种、睡大觉、羞愧\n讲法: 羞愧要落到一幅上'));
  const pub = await publishHome(ctx.ws, { now });
  check('发布了', pub.ok, JSON.stringify(pub.check.issues));
  const homeId = pub.home!.id;
  const kid = (await route('GET', '/api/kid/home', ctx)).json as { cards: { kind: string; props: { tutor?: string; buttons?: { id: unknown; kind: string; label: string; params?: unknown; brief?: unknown }[] } }[] };
  const btns = kid.cards.find((c) => c.props.tutor === 'chinese-tutor')?.props.buttons ?? [];
  check('孩子端:activity 按钮就是开场按钮,参数与讲法不下发', btns.map((b) => `${b.id}:${b.kind}:${b.label}`).join(' ') === 'new:new:新话题 0:start:你说我画 1:start:我来出题' && btns.every((b) => b.params === undefined && b.brief === undefined), JSON.stringify(btns));
  check('孩子端 JSON 里没有参数原文', !JSON.stringify(kid).includes('睡大觉'));

  // ---- 点「我来出题」----
  const r1 = await kidSend('chinese-tutor', { text: '', via: { home: homeId, button: 1 } });
  check('点了:202', r1.status === 202, JSON.stringify(r1.json));
  await wait('chinese-tutor');
  const j1 = (r1.json as { job: string; thread: string }).job;
  const t1 = (r1.json as { thread: string }).thread;
  let index = await readIndex(ctx.ws, 'chinese-tutor', DATE);
  const m1 = index.messages.find((m) => m.job === j1)!;
  check('新话题,发的是按钮上的字', t1 === j1 && m1.text === '我来出题');
  check('第一条记下 activity:参数是解析好的,补了缺省', JSON.stringify(m1.activity) === JSON.stringify({ name: '你说我画', params: { 词: ['播种', '睡大觉', '羞愧'], 最多画: 2 } }), JSON.stringify(m1.activity));
  const p1 = (await readRunFile(ctx.ws, 'chinese-tutor', DATE, j1))!.prompt;
  const yaml = p1.slice(0, p1.indexOf('\n<'));
  check('上下文包:activity: 在 YAML 最后,参数一行一个、词表是列表,state 跟在后面', yaml.endsWith('  activity:\n    name: "你说我画"\n    params:\n      "词":\n        - "播种"\n        - "睡大觉"\n        - "羞愧"\n      "最多画": 2\n    state:\n      "还能画": 2\n      "缺": ""'), yaml.slice(-200));
  check('上下文包:activityGuide 指到文件', p1.includes('  activityGuide: "agents/chinese-tutor/activities/你说我画.md"\n'));
  check('上下文包:home: 照旧带按钮字与讲法', p1.includes('  home:\n    button: "我来出题"\n    brief: "羞愧要落到一幅上"'));
  const guide = p1.slice(p1.indexOf('<cotutor-activity'), p1.indexOf('</cotutor-activity>'));
  check('<cotutor-activity>:填了词,出题那段在;注释与守卫行不在', guide.includes('### 我来出题') && guide.includes('第一句:') && !guide.includes('<!--') && !guide.includes('{{'));
  check('<cotutor-activity>:老师没有的 paint 卡,写法跟在后面', guide.includes('## 这个 activity 多用的卡') && guide.includes('paint'));
  check('<cotutor-activity>:不带给人看的节、不带画家那段', !guide.includes('## 画家收到什么') && !guide.includes('儿童绘本插画') && !guide.includes('## 家长填的'));
  check('守则说以 activity 为准', p1.includes('有 `<cotutor-activity>`,照它带'));

  // ---- 同一话题下一条:activity 还在,原文未变 ----
  const r2 = await kidSend('chinese-tutor', { text: '小熊和小猴种西瓜', thread: t1 });
  await wait('chinese-tutor');
  const j2 = (r2.json as { job: string }).job;
  const p2 = (await readRunFile(ctx.ws, 'chinese-tutor', DATE, j2))!.prompt;
  check('续话题:activity: 每条都带', p2.includes('  activity:\n    name: "你说我画"\n    params:\n      "词":'));
  check('续话题:原文不再带,写「未变」', !p2.includes('<cotutor-activity') && /activityGuide: .*未变/.test(p2), p2.slice(0, 600));
  index = await readIndex(ctx.ws, 'chinese-tutor', DATE);
  check('续话题那条不再记 activity(只记在第一条)', index.messages.find((m) => m.job === j2)?.activity === undefined);

  // ---- 家长改了参数:旧话题照旧,新点的用新的 ----
  const md = readFileSync(join(root, pub.home!.source), 'utf8');
  const doc = parseHome(md);
  const tutorCard = doc.cards.find((c) => c.kind === 'tutor')!;
  const buttons = (tutorCard.props.buttons as { kind: string; params?: Record<string, string> }[]).map((b, k) => (k === 1 ? { ...b, params: { 词: '春风、柳树' } } : b));
  draft(setTutorButtons(md, 'chinese-tutor', buttons as never));
  check('家长端改按钮:activity 按钮写回去还是 activity 与参数行', readFileSync(join(root, 'home', 'draft.md'), 'utf8').includes('activity 你说我画 我来出题\n词: 春风、柳树\n讲法: 羞愧要落到一幅上'));
  const pub2 = await publishHome(ctx.ws, { now: new Date(now.getTime() + 60_000) });
  const r3 = await kidSend('chinese-tutor', { text: '后来西瓜熟了', thread: t1 });
  await wait('chinese-tutor');
  const p3 = (await readRunFile(ctx.ws, 'chinese-tutor', DATE, (r3.json as { job: string }).job))!.prompt;
  const act3 = p3.slice(p3.indexOf('  activity:'), p3.indexOf('\n<') > 0 ? p3.indexOf('\n<') : p3.indexOf('\n---'));
  check('旧话题照点的那一刻的词', act3.includes('- "播种"') && !act3.includes('春风'), act3);
  const r4 = await kidSend('chinese-tutor', { text: '', via: { home: pub2.home!.id, button: 1 } });
  await wait('chinese-tutor');
  const p4 = (await readRunFile(ctx.ws, 'chinese-tutor', DATE, (r4.json as { job: string }).job))!.prompt;
  const act4 = p4.slice(p4.indexOf('  activity:'), p4.indexOf('\n<'));
  check('新点的用新的词', act4.includes('- "春风"') && !act4.includes('播种'), act4);

  // ---- 没填词:出题那段裁掉 ----
  const r5 = await kidSend('chinese-tutor', { text: '', via: { home: pub2.home!.id, button: 0 } });
  await wait('chinese-tutor');
  const p5 = (await readRunFile(ctx.ws, 'chinese-tutor', DATE, (r5.json as { job: string }).job))!.prompt;
  check('你说我画(没填词):没有出题那段,参数只有缺省的最多画', !p5.includes('### 我来出题') && p5.includes('    params:\n      "最多画": 2\n') && !p5.includes('      "词":'));

  // ---- 发布后 activity 文件写坏了:那个按钮点不了(400,孩子端刷新首页)----
  const file = join(root, 'agents', 'chinese-tutor', 'activities', '你说我画.md');
  const good = readFileSync(file, 'utf8');
  writeFileSync(file, good.replace('词: 词表,可空', '词: 词表'));
  const bad = await kidSend('chinese-tutor', { text: '', via: { home: pub2.home!.id, button: 0 } });
  check('文件改成词必填、按钮没填:400 bad_via', bad.status === 400 && (bad.json as { error: string }).error === 'bad_via', JSON.stringify(bad.json));
  writeFileSync(file, good);

  // ---- 终端:pack / send --activity ----
  const pk = await run(['pack', 'chinese-tutor', '--activity', '你说我画', '--param', '词=春风、柳树;最多画=1']);
  check('pack --activity:看得到 activity 那两段', pk.code === 0 && pk.out.includes('name: "你说我画"') && pk.out.includes('"最多画": 1') && pk.out.includes('<cotutor-activity'), pk.out.slice(0, 300));
  const pkBad = await run(['pack', 'chinese-tutor', '--activity', '你说我画', '--param', '最多画=7']).catch((e: Error) => ({ out: e.message, code: 2 }));
  check('pack --activity 参数不对:用法错误退出', pkBad.code === 2, String(pkBad.code));
  const sd = await run(['send', 'chinese-tutor', '--activity', '你说我画', '--quiet']);
  index = await readIndex(ctx.ws, 'chinese-tutor', DATE);
  const last = index.messages[index.messages.length - 1];
  check('send --activity:新话题,发 activity 名,记下 activity', sd.code === 0 && last.text === '你说我画' && last.activity?.name === '你说我画' && last.thread === last.job, JSON.stringify(last).slice(0, 300));

  // ---- 回放:续话题那一轮也带上 activity ----
  const rp = await startReplay(ctx.ws, 'chinese-tutor', DATE, j2, { now: () => now });
  await rp.done;
  const ev = (await readRunFile({ ...ctx.ws, dirs: { ...ctx.ws.dirs, conversations: join(root, 'evals') } }, 'chinese-tutor', DATE, rp.evalJob))!.prompt;
  check('回放:新会话,activity 那段整篇带', ev.includes('<cotutor-activity') && ev.includes('    name: "你说我画"'));

  // ---- 第 3 期:应用算的、应用拦的(你说我画,最多画 2;一天 2 张)----
  {
    const send = async (body: unknown): Promise<{ job: string; prompt: string }> => {
      const r = await kidSend('chinese-tutor', body);
      await wait('chinese-tutor');
      await ctx.runner.flush();
      const job = (r.json as { job: string }).job;
      return { job, prompt: (await readRunFile(ctx.ws, 'chinese-tutor', DATE, job))!.prompt };
    };
    const stateOf = (prompt: string): string => prompt.slice(prompt.indexOf('    state:'), prompt.indexOf('\n<') > 0 && prompt.indexOf('\n<') > prompt.indexOf('    state:') ? prompt.indexOf('\n<') : prompt.indexOf('\n---'));
    const recOf = async (job: string): Promise<{ state: string; error?: string } | null> => {
      try { return JSON.parse(readFileSync(join(root, 'conversations', 'chinese-tutor', `${DATE}.${job}.cards`, '0', 'paint.json'), 'utf8')); } catch { return null; }
    };
    const p0 = await send({ text: '', via: { home: pub2.home!.id, button: 0 } });
    const th = p0.job;
    check('第一条:state 有还能画 2(最多画 2、今天还没画)、缺是空的', stateOf(p0.prompt).includes('"还能画": 2') && stateOf(p0.prompt).includes('"缺": ""'), stateOf(p0.prompt));
    const a1 = await send({ text: '画图', thread: th });
    const rec1 = await recOf(a1.job);
    check('没放过整段、孩子没连着说:拦下,不交给画家', rec1?.state === 'none' && rec1.error === 'gate:连说过一遍' && drew === 0, JSON.stringify(rec1));
    index = await readIndex(ctx.ws, 'chinese-tutor', DATE);
    check('activity 话题里的 paint 不报「清单外的卡」', !(index.messages.find((m) => m.job === a1.job)?.warnings ?? []).some((w) => w.includes('清单外')));
    const a2 = await send({ text: '整段', thread: th });
    check('下一条:cards 说没画、为什么;缺 = 连说过一遍;拦下的不占张数', a2.prompt.includes('没画:孩子还没看着整段连着说一遍') && stateOf(a2.prompt).includes('"缺": "连说过一遍"') && stateOf(a2.prompt).includes('"还能画": 2'), stateOf(a2.prompt));
    const a3 = await send({ text: '画图', thread: th });
    check('放过整段、孩子后面开过口:交给画家', (await recOf(a3.job))?.state === 'done' && drew === 1);
    const a4 = await send({ text: '画图', thread: th });
    check('还能画 1:再画一张', stateOf(a4.prompt).includes('"还能画": 1') && stateOf(a4.prompt).includes('"缺": ""') && (await recOf(a4.job))?.state === 'done' && drew === 2, stateOf(a4.prompt));
    const a5 = await send({ text: '画图', thread: th });
    check('还能画 0:拦下(还能画),不交给画家', stateOf(a5.prompt).includes('"还能画": 0') && (await recOf(a5.job))?.error === 'gate:还能画' && drew === 2, stateOf(a5.prompt));
    const a6 = await send({ text: '好吧', thread: th });
    check('下一条:cards 说张数到头了', a6.prompt.includes('没画:这个话题能画的张数到头了') && stateOf(a6.prompt).includes('"缺": "还能画"'));
  }

  // ---- activity eval:假老师 + 假孩子,不花钱 ----
  {
    const exFile = join(root, 'agents', 'chinese-tutor', 'activities', '你说我画.例子.md');
    const shipped = readFileSync(exFile, 'utf8');
    writeFileSync(exFile, '---\nactivity: 你说我画\n---\n\n## 写死的\n孩子: 整段\n孩子: 画图\n判:\n- 出画图卡\n- 画图卡前放过整段\n\n## 模拟的\n人设: 乖\n故事: 小熊种瓜\n最多轮: 4\n判:\n- 不出画图卡\n');
    const said: string[] = [];
    const kid = async (prompt: string): Promise<string | null> => { said.push(prompt); return said.length === 1 ? '整段' : '画图'; };
    const lines: string[] = [];
    const r = await evalActivity(ctx.ws, 'chinese-tutor', '你说我画', { runs: 2, kid, onTurn: (e) => lines.push(`${e.example}#${e.run}:${e.turn}:${e.kid}${e.paint ? ':画' : ''}`) });
    const [a, b] = r.examples;
    check('eval:写死的那个,两次都走到画图卡、都过', a.name === '写死的' && a.pass && a.runs.length === 2 && a.runs.every((x) => x.turns.map((t) => t.kid).join('/') === '你说我画/整段/画图'), JSON.stringify(a.runs.map((x) => ({ k: x.turns.map((t) => t.kid), g: x.grades, e: x.error }))));
    check('eval:模拟的那个,孩子的话来自模拟孩子,画了 → 「不出画图卡」不过,报出来', b.name === '模拟的' && !b.pass && b.runs[0].grades[0].why?.includes('画图卡') === true && said[0].includes('小熊种瓜'), JSON.stringify(b.runs[0]));
    check('eval:每轮回调,画图卡那轮标出来', lines[0] === '写死的#1:1:你说我画' && lines.includes('写死的#1:3:画图:画'), lines.join(' '));
    check('eval:落在 evals/,不进孩子的对话;报告写了', readFileSync(join(root, r.file), 'utf8').includes('"activity": "你说我画"') && !(await readIndex(ctx.ws, 'chinese-tutor', DATE)).messages.some((m) => m.thread === a.runs[0].thread && m.text === '整段' && m.job === a.runs[0].thread));
    let threw = '';
    await evalActivity(ctx.ws, 'chinese-tutor', '你说我画', { only: '没有这个', kid }).catch((e: Error) => { threw = e.message; });
    check('eval:--only 不认得报有哪些', threw.includes('写死的、模拟的'), threw);
    writeFileSync(exFile, shipped);
  }

  // ---- 渲染:没有 activity 的包不多出东西 ----
  check('没 activity 的包没有那几行', !renderContextPack({ at: 'x', plan: [], recent: [] }).includes('activity'));
} finally {
  await ctx.runner.flush();
  rmSync(home, { recursive: true, force: true });
}
done();
