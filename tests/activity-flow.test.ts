/**
 * activity 全流程(假 CLI,不花钱,《activity设计.md》第 2 期):init 拷进出厂的你说我画 → 首页 activity 按钮的检查(文件不在、参数不对)→
 * 孩子端是开场按钮、参数不下发 → 点了:新话题、按钮字、参数补了缺省记在第一条 → 上下文包 activity: 在最后、<cotutor-activity> 按参数裁过、
 * 老师没有的 paint 卡写法跟在后面 → 同一话题下一条:activity: 还在、原文「未变」→ 家长改了参数,旧话题照旧 → pack / send --activity → 回放带上。
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
const { publishHome, checkHome, resolveVia } = await import('../src/server/home.ts');
const { deleteThread } = await import('../src/server/store.ts');
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
for (const t of Object.values((cfg as { tutors: Record<string, { runtime?: string }> }).tutors)) delete t.runtime; // 出厂语文老师走 qwen;测试都走假 CLI
// activity 独立(拍板 13):一个像 qwen 的({systemBody}),一个像 claude 的(--agents {agentsFile})
const fakeArgs = [node, '--experimental-strip-types', '--no-warnings', FAKE];
(cfg.runtimes as Record<string, unknown>).fakesys = { run: [...fakeArgs, '--agent', '{agent}', '--system-prompt', '{systemBody}', '{prompt}'], resume: [...fakeArgs, '--agent', '{agent}', '--resume', '{session}', '--system-prompt', '{systemBody}', '{prompt}'] };
(cfg.runtimes as Record<string, unknown>).fakeagents = { run: [...fakeArgs, '--agent', '{agent}', '--agents', '{agentsFile}', '--append-system-prompt-file', '{boardFile}', '{prompt}'], resume: [...fakeArgs, '--agent', '{agent}', '--agents', '{agentsFile}', '--resume', '{session}', '--append-system-prompt-file', '{boardFile}', '{prompt}'] };
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
    const c2 = await checkHome(ctx.ws, HOME('activity 你说我画\n单词: 春风\n最多画: 两'), now);
    check('参数不对:不认得的、不是整数的都报', c2.issues.some((i) => i.text.includes('「单词」不是 你说我画 的参数')) && c2.issues.some((i) => i.text.includes('整数')), JSON.stringify(c2.issues));
    const c3 = await checkHome(ctx.ws, HOME('activity 你说我画\nactivity 你说我画 我来出题\n词: 播种、睡大觉、羞愧\n讲法: 羞愧要落到一幅上'), now);
    check('写对了:没有要改的', c3.fixes === 0, JSON.stringify(c3.issues));
    const { out } = await run(['home', 'check']).catch(() => ({ out: '', code: 1 }));
    void out;
  }

  // 你说我画那颗家长设了最多画 2(第 3 期拿它试拦法);我来出题没设 = 不限
  draft(HOME('activity 你说我画\n最多画: 2\nactivity 你说我画 我来出题\n词: 播种、睡大觉、羞愧\n讲法: 羞愧要落到一幅上'));
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
  check('第一条记下 activity:参数是解析好的;没设最多画就没有(不限)', JSON.stringify(m1.activity) === JSON.stringify({ name: '你说我画', params: { 词: ['播种', '睡大觉', '羞愧'] } }), JSON.stringify(m1.activity));
  const p1 = (await readRunFile(ctx.ws, 'chinese-tutor', DATE, j1))!.prompt;
  const yaml = p1.slice(0, p1.indexOf('\n<'));
  check('上下文包:activity: 在 YAML 最后,参数一行一个、词表是列表,state 跟在后面;不限张数就没有还能画', yaml.endsWith('  activity:\n    name: "你说我画"\n    params:\n      "词":\n        - "播种"\n        - "睡大觉"\n        - "羞愧"\n    state:\n      "缺": ""'), yaml.slice(-200));
  check('上下文包:activityGuide 指到文件', p1.includes('  activityGuide: "agents/chinese-tutor/activities/你说我画.md"\n'));
  check('上下文包:home: 照旧带按钮字与讲法', p1.includes('  home:\n    button: "我来出题"\n    brief: "羞愧要落到一幅上"'));
  const guide = p1.slice(p1.indexOf('<cotutor-activity path='), p1.indexOf('</cotutor-activity>'));
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
  check('续话题:原文不再带,写「未变」', !p2.includes('<cotutor-activity path=') && /activityGuide: .*未变/.test(p2), p2.slice(0, 600));
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
  check('你说我画(没填词):没有出题那段,参数只有家长设的最多画', !p5.includes('### 我来出题') && p5.includes('    params:\n      "最多画": 2\n') && !p5.includes('      "词":'));

  // ---- 发布后 activity 文件写坏了:那个按钮点不了(400,孩子端刷新首页)----
  const file = join(root, 'agents', 'chinese-tutor', 'activities', '你说我画.md');
  const good = readFileSync(file, 'utf8');
  writeFileSync(file, good.replace('词: 词表,可空', '词: 词表'));
  const bad = await kidSend('chinese-tutor', { text: '', via: { home: pub2.home!.id, button: 0 } });
  check('文件改成词必填、按钮没填:400 bad_via', bad.status === 400 && (bad.json as { error: string }).error === 'bad_via', JSON.stringify(bad.json));
  writeFileSync(file, good);

  // ---- 终端:pack / send --activity ----
  const pk = await run(['pack', 'chinese-tutor', '--activity', '你说我画', '--param', '词=春风、柳树;最多画=1']);
  check('pack --activity:看得到 activity 那两段', pk.code === 0 && pk.out.includes('name: "你说我画"') && pk.out.includes('"最多画": 1') && pk.out.includes('<cotutor-activity path='), pk.out.slice(0, 300));
  const pkBad = await run(['pack', 'chinese-tutor', '--activity', '你说我画', '--param', '最多画=两']).catch((e: Error) => ({ out: e.message, code: 2 }));
  check('pack --activity 参数不对:用法错误退出', pkBad.code === 2, String(pkBad.code));
  const sd = await run(['send', 'chinese-tutor', '--activity', '你说我画', '--quiet']);
  index = await readIndex(ctx.ws, 'chinese-tutor', DATE);
  const last = index.messages[index.messages.length - 1];
  check('send --activity:新话题,发 activity 名,记下 activity', sd.code === 0 && last.text === '你说我画' && last.activity?.name === '你说我画' && last.thread === last.job, JSON.stringify(last).slice(0, 300));

  // ---- 回放:续话题那一轮也带上 activity ----
  const rp = await startReplay(ctx.ws, 'chinese-tutor', DATE, j2, { now: () => now });
  await rp.done;
  const ev = (await readRunFile({ ...ctx.ws, dirs: { ...ctx.ws.dirs, conversations: join(root, 'evals') } }, 'chinese-tutor', DATE, rp.evalJob))!.prompt;
  check('回放:新会话,activity 那段整篇带', ev.includes('<cotutor-activity path=') && ev.includes('    name: "你说我画"'));

  // ---- 第 3 期:应用算的、应用拦的(你说我画,家长设了最多画 2)----
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
    check('第一条:state 有还能画 2(最多画 2、还没画)、缺是空的', stateOf(p0.prompt).includes('"还能画": 2') && stateOf(p0.prompt).includes('"缺": ""'), stateOf(p0.prompt));
    const a1 = await send({ text: '画图', thread: th });
    const rec1 = await recOf(a1.job);
    check('没放过整段、孩子没连着说:拦下,不交给画家', rec1?.state === 'none' && rec1.error === 'gate:连说过一遍' && drew === 0, JSON.stringify(rec1));
    index = await readIndex(ctx.ws, 'chinese-tutor', DATE);
    check('activity 话题里的 paint 不报「清单外的卡」', !(index.messages.find((m) => m.job === a1.job)?.warnings ?? []).some((w) => w.includes('清单外')));
    const a2 = await send({ text: '整段', thread: th });
    check('下一条:cards 说没画、为什么;缺 = 连说过一遍;拦下的不占张数', a2.prompt.includes('没画:孩子还没看着整段连着说一遍') && stateOf(a2.prompt).includes('"缺": "连说过一遍"') && stateOf(a2.prompt).includes('"还能画": 2'), stateOf(a2.prompt));
    // 画风照 workspace 里这份 activity 文件的「画家收到什么」(拍板 12):家长改了那一行,下一张就照它
    const actFile = join(root, 'agents', 'chinese-tutor', 'activities', '你说我画.md');
    const actText = readFileSync(actFile, 'utf8');
    writeFileSync(actFile, actText.replace('儿童绘本插画,水彩加干净的线条', '剪纸风格插画,红纸黑线'));
    const a3 = await send({ text: '画图', thread: th });
    const rec3 = (await recOf(a3.job)) as { state: string; prompt?: string } | null;
    writeFileSync(actFile, actText);
    check('放过整段、孩子后面开过口:交给画家', rec3?.state === 'done' && drew === 1);
    check('画风照 activity 文件「画家收到什么」(家长改的那一行进了提示词)', !!rec3?.prompt?.includes('剪纸风格插画,红纸黑线') && !rec3.prompt.includes('水彩'), rec3?.prompt?.slice(0, 200));
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
    const evalMsgs = (await readIndex({ ...ctx.ws, dirs: { ...ctx.ws.dirs, conversations: join(root, 'evals') } }, 'chinese-tutor', a.runs[0].date)).messages.filter((m) => m.thread === a.runs[0].thread);
    check('eval:每轮记着 eval,不写记忆', evalMsgs.length === 3 && evalMsgs.every((m) => m.eval === true));
    check('eval:每轮回调,画图卡那轮标出来', lines[0] === '写死的#1:1:你说我画' && lines.includes('写死的#1:3:画图:画'), lines.join(' '));
    check('eval:落在 evals/,不进孩子的对话;报告写了', readFileSync(join(root, r.file), 'utf8').includes('"activity": "你说我画"') && !(await readIndex(ctx.ws, 'chinese-tutor', DATE)).messages.some((m) => m.thread === a.runs[0].thread && m.text === '整段' && m.job === a.runs[0].thread));
    writeFileSync(exFile, '---\nactivity: 你说我画\n---\n\n## 记\n孩子: 记住它\n最多轮: 2\n判:\n- 不出画图卡\n');
    const vaultBefore = JSON.stringify(readdirSync(join(root, 'vault'), { recursive: true }));
    const rm = await evalActivity(ctx.ws, 'chinese-tutor', '你说我画', { runs: 1, kid });
    const memMsg = (await readIndex({ ...ctx.ws, dirs: { ...ctx.ws.dirs, conversations: join(root, 'evals') } }, 'chinese-tutor', rm.examples[0].runs[0].date)).messages.find((m) => m.thread === rm.examples[0].runs[0].thread && m.text === '记住它');
    check('eval:老师回了「## 记忆」也不写进 vault', Boolean(memMsg?.warnings?.includes('eval 不写记忆')) && JSON.stringify(readdirSync(join(root, 'vault'), { recursive: true })) === vaultBefore, JSON.stringify(memMsg?.warnings));
    writeFileSync(exFile, '---\nactivity: 你说我画\n---\n\n## 写死的\n孩子: 整段\n判:\n- 放过整段\n\n## 模拟的\n人设: 乖\n判:\n- 放过整段\n');
    let threw = '';
    await evalActivity(ctx.ws, 'chinese-tutor', '你说我画', { only: '没有这个', kid }).catch((e: Error) => { threw = e.message; });
    check('eval:--only 不认得报有哪些', threw.includes('写死的、模拟的'), threw);
    writeFileSync(exFile, shipped);
  }

  // ---- 小课堂按钮下面挂 activity(看图说话)----
  {
    const pubFile = join(root, 'home', 'published.json');
    const keep = readFileSync(pubFile, 'utf8');
    const lec = (activity?: string) => JSON.stringify({ id: '2026-10-12-0900', publishedAt: now.toISOString(), source: 'home/history/x.md', cards: [{ kind: 'tutor', props: { tutor: 'chinese-tutor', buttons: [{ kind: 'lecture', label: '看图说话怎么说', bundle: '2026-10-08-kantu', ...(activity ? { activity } : {}) }] } }], note: '', warnings: [] });
    writeFileSync(pubFile, lec('看图说话'));
    const v = await resolveVia(ctx.ws, 'chinese-tutor', { home: '2026-10-12-0900', button: 0 });
    check('小课堂挂 activity:resolveVia 带上 activity(参数用缺省)', v?.kind === 'lecture' && JSON.stringify((v as { activity?: unknown }).activity) === JSON.stringify({ name: '看图说话', params: {} }), JSON.stringify(v));
    writeFileSync(pubFile, lec('没有这个'));
    check('挂的 activity 不在:按钮点不了(null)', (await resolveVia(ctx.ws, 'chinese-tutor', { home: '2026-10-12-0900', button: 0 })) === null);
    writeFileSync(pubFile, lec());
    const plain = await resolveVia(ctx.ws, 'chinese-tutor', { home: '2026-10-12-0900', button: 0 });
    check('不挂:看完照这位老师的「小课堂」activity(拍板 17、18)', plain?.kind === 'lecture' && JSON.stringify((plain as { activity?: unknown }).activity) === JSON.stringify({ name: '小课堂', params: {} }), JSON.stringify(plain));
    const lecFile = join(root, 'agents', 'chinese-tutor', 'activities', '小课堂.md');
    const lecText = readFileSync(lecFile, 'utf8');
    rmSync(lecFile);
    check('没有小课堂.md:按钮点不了(null)', (await resolveVia(ctx.ws, 'chinese-tutor', { home: '2026-10-12-0900', button: 0 })) === null);
    const noLec = await checkHome(ctx.ws, HOME('小课堂 2026-10-08-kantu 看图说话怎么说'), now);
    check('没有小课堂.md:首页检查报要改,说看完怎么聊写在哪', noLec.issues.some((i) => i.level === 'fix' && i.text.includes('看完怎么聊写在 agents/chinese-tutor/activities/小课堂.md')), JSON.stringify(noLec.issues));
    writeFileSync(lecFile, lecText);
    writeFileSync(pubFile, keep);
    const c = await checkHome(ctx.ws, HOME('小课堂 2026-10-08-kantu 看图说话怎么说\nactivity: 看图说说'), now);
    check('首页检查:挂的 activity 不在,要改', c.issues.some((i) => i.level === 'fix' && i.text.includes('看图说说.md 不在')), JSON.stringify(c.issues));
  }

  // ---- eval 带照片:随第一句写死的孩子的话发 ----
  {
    const dir = join(root, 'agents', 'chinese-tutor', 'activities');
    const exFile = join(dir, '看图说话.例子.md');
    const shipped = readFileSync(exFile, 'utf8');
    writeFileSync(join(dir, '小狗.png'), PNG);
    writeFileSync(exFile, '---\nactivity: 看图说话\n---\n\n## 一幅图\n照片: 小狗.png\n孩子: 这是我的看图说话\n最多轮: 2\n判:\n- 每节末句是问句\n');
    const r = await evalActivity(ctx.ws, 'chinese-tutor', '看图说话', { runs: 1, kid: async () => null });
    const run = r.examples[0].runs[0];
    const evalIndex = await readIndex({ ...ctx.ws, dirs: { ...ctx.ws.dirs, conversations: join(root, 'evals') } }, 'chinese-tutor', run.date);
    const second = evalIndex.messages.find((m) => m.thread === run.thread && m.text === '这是我的看图说话');
    check('eval 带照片:第二轮(第一句写死的话)带着照片,拷进了 captures/', run.turns.length === 2 && second?.photos?.length === 1 && second.photos[0].startsWith('captures/'), JSON.stringify({ turns: run.turns.length, photos: second?.photos, err: run.error }));
    check('eval 带照片:看图说话的话题挂着 activity', evalIndex.messages.find((m) => m.job === run.thread)?.activity?.name === '看图说话');
    // 出厂例子的图在包里(例子图/),不拷进 workspace:workspace 里没有就找包里的
    writeFileSync(exFile, '---\nactivity: 看图说话\n---\n\n## 包里的图\n照片: 例子图/借伞.jpg\n孩子: 这是我的看图说话\n最多轮: 2\n判:\n- 每节末句是问句\n');
    const r2 = await evalActivity(ctx.ws, 'chinese-tutor', '看图说话', { runs: 1, kid: async () => null });
    const run2 = r2.examples[0].runs[0];
    const idx2 = await readIndex({ ...ctx.ws, dirs: { ...ctx.ws.dirs, conversations: join(root, 'evals') } }, 'chinese-tutor', run2.date);
    check('eval 带照片:workspace 里没有那张图,用包里 例子图/ 的', !existsSync(join(dir, '例子图')) && idx2.messages.find((m) => m.thread === run2.thread && m.text === '这是我的看图说话')?.photos?.length === 1, JSON.stringify({ err: run2.error }));
    writeFileSync(exFile, shipped);
  }

  // ---- eval 先看小课堂(数学老师的小课堂):第一句带着 lecture 发,画的地方盖着什么照写的、前面接上那时在讲哪句 ----
  {
    const B = '2026-09-18-po13-jian-8';
    cpSync(fileURLToPath(new URL(`./fixtures/bundles/${B}/`, import.meta.url)), join(root, 'bundles', B), { recursive: true });
    const r = await evalActivity(ctx.ws, 'math-tutor', '小课堂', { runs: 1, only: '画了不够拿那里', kid: async () => null });
    const run = r.examples[0].runs[0];
    const idx = await readIndex({ ...ctx.ws, dirs: { ...ctx.ws.dirs, conversations: join(root, 'evals') } }, 'math-tutor', run.date);
    const first = idx.messages.find((m) => m.job === run.thread);
    const mark = first?.lecture?.marks?.[0]?.text ?? '';
    check('eval 先看小课堂:第一句是孩子看完问的,带着 lecture;话题是小课堂 activity', run.turns[0]?.kid === '为什么要拆开那一捆呀?' && first?.lecture?.bundle === B && first.lecture.pauses === 1 && first.activity?.name === '小课堂', JSON.stringify({ kid: run.turns[0]?.kid, lec: first?.lecture, err: run.error }));
    check('eval 先看小课堂:画的地方盖着什么照例子写的,前面接上时刻与那句讲稿', mark.startsWith('0:14 画的,那时在讲『要拿走 8 根') && mark.endsWith(';画的地方盖着:散的 3 根小棒;文字『3』'), mark);
    rmSync(join(root, 'bundles', B), { recursive: true, force: true });
    let msg = '';
    try { await evalActivity(ctx.ws, 'math-tutor', '小课堂', { runs: 1, kid: async () => null }); } catch (err) { msg = String(err); }
    check('eval 先看小课堂:课不在 workspace 里,一轮都不跑,说换成自己的课', msg.includes('不在 bundles/ 或 lectures/'), msg);
  }

  // ---- activity 独立:系统提示、卡、记忆都是 activity 的(拍板 13–14)----
  {
    const run = { name: '你说我画', params: { 最多画: 2 } };
    const go = async (body: { text: string; runtime: string; thread?: string }) => {
      const st = await ctx.runner.send('chinese-tutor', { from: 'kid', text: body.text, runtime: body.runtime, ...(body.thread ? { thread: body.thread } : { newThread: true, activity: run }) });
      await st.done;
      await ctx.runner.flush();
      return { ...st, file: (await readRunFile(ctx.ws, 'chinese-tutor', DATE, st.job))! };
    };
    const s1 = await go({ text: '你说我画', runtime: 'fakesys' });
    const argv = s1.file.argv as string[];
    const sys = argv[argv.indexOf('--system-prompt') + 1];
    check('qwen 那种:系统提示是 activity 的人设与做法,不是老师文件', sys.startsWith('你是这个家的语文老师,今天陪孩子玩「你说我画」') && !sys.includes('### 孩子问怎么写'), sys.slice(0, 80));
    check('qwen 那种:板书写法只讲 activity 的卡(read、paint、text)', sys.includes('### paint') && sys.includes('### read') && !sys.includes('### choice') && !sys.includes('### tianzige'));
    check('qwen 那种:第一条不再带 <cotutor-activity>,写「已在系统提示里」;activity: 照带', !s1.file.prompt.includes('<cotutor-activity path=') && s1.file.prompt.includes('activityGuide: "已在你的系统提示里') && s1.file.prompt.includes('  activity:\n    name: "你说我画"'), JSON.stringify({ tag: s1.file.prompt.includes('<cotutor-activity'), g: /activityGuide: .*/.exec(s1.file.prompt)?.[0], a: s1.file.prompt.includes('  activity:') }));
    check('守则按 activity 的卡裁:没有 lecture 卡就没有小课堂那段', !s1.file.prompt.includes('孩子刚看完小课堂'));
    // 记忆:activity 自己一篇
    const s2 = await go({ text: '记住它', runtime: 'fakesys', thread: s1.thread });
    const memDir = join(root, 'vault', '记忆');
    const actMem = join(memDir, '语文老师·你说我画.md');
    const memText = readFileSync(actMem, 'utf8');
    check('记忆写进 activity 自己那篇(agent: chinese-tutor/你说我画)', memText.includes('agent: chinese-tutor/你说我画') && memText.split('\n').some((l) => l.startsWith('- ')) && !readdirSync(memDir).includes('语文老师.md'), readdirSync(memDir).join());
    const s3 = await go({ text: '后来呢', runtime: 'fakesys', thread: s1.thread });
    check('续话题:上下文包的记忆是 activity 那篇', /memory: "记忆\/语文老师·你说我画\.md/.test(s3.file.prompt), s3.file.prompt.slice(0, 600));
    // 隔天「接着」:新话题、只带 continues,沿用被接话题的 activity
    const cont = await ctx.runner.send('chinese-tutor', { from: 'kid', text: '接着刚才的', runtime: 'fakesys', newThread: true, continues: { date: DATE, thread: s1.thread } });
    await cont.done;
    await ctx.runner.flush();
    const contRun = (await readRunFile(ctx.ws, 'chinese-tutor', DATE, cont.job))!;
    const contSys = (contRun.argv as string[])[(contRun.argv as string[]).indexOf('--system-prompt') + 1];
    const contMsg = (await readIndex(ctx.ws, 'chinese-tutor', DATE)).messages.find((m) => m.job === cont.job);
    check('接着以前的 activity 话题:新话题照旧是那个 activity(系统提示、记在第一条)', contSys.startsWith('你是这个家的语文老师,今天陪孩子玩「你说我画」') && contMsg?.activity?.name === '你说我画' && contMsg.activity.params.最多画 === 2 && !!contMsg.continues, JSON.stringify({ sys: contSys.slice(0, 40), act: contMsg?.activity, cont: contMsg?.continues }));
    const free = await ctx.runner.send('chinese-tutor', { from: 'kid', text: '随便聊聊', runtime: 'fakesys', newThread: true });
    await free.done;
    const freeRun = (await readRunFile(ctx.ws, 'chinese-tutor', DATE, free.job))!;
    const freeSys = (freeRun.argv as string[])[(freeRun.argv as string[]).indexOf('--system-prompt') + 1];
    check('自由话题:照旧是老师文件,记忆是老师的(还没有)', freeSys.includes('### 孩子问怎么写') && freeRun.prompt.includes('memory: "还没有"'), freeRun.prompt.slice(0, 400));
    await deleteThread(ctx.ws, 'chinese-tutor', DATE, s1.thread);
    check('删话题:从 activity 那篇记忆里撤', !readFileSync(actMem, 'utf8').split('\n').some((l) => l.startsWith('- ')));
    void s2;
    // claude 那种:--agents 现生成的定义,--agent 换成它的名字
    const c1 = await go({ text: '你说我画', runtime: 'fakeagents' });
    const av = c1.file.argv as string[];
    const agentName = av[av.indexOf('--agent') + 1];
    const def = JSON.parse(readFileSync(av[av.indexOf('--agents') + 1], 'utf8')) as Record<string, { prompt: string }>;
    const boardFile = readFileSync(av[av.indexOf('--append-system-prompt-file') + 1], 'utf8');
    check('claude 那种:--agent 是现生成的名字,--agents 里它的 prompt 是 activity 那节', /^chinese-tutor-a[0-9a-f]{8}$/.test(agentName) && def[agentName]?.prompt.startsWith('你是这个家的语文老师,今天陪孩子玩'), `${agentName} ${JSON.stringify(Object.keys(def))}`);
    check('claude 那种:追加的板书写法只讲 activity 的卡', boardFile.includes('### paint') && !boardFile.includes('### choice'));
    const cfree = await ctx.runner.send('chinese-tutor', { from: 'kid', text: '随便聊聊', runtime: 'fakeagents', newThread: true });
    await cfree.done;
    const cfreeArgv = (await readRunFile(ctx.ws, 'chinese-tutor', DATE, cfree.job))!.argv as string[];
    check('claude 那种,自由话题:--agent 老师,--agents 指空定义', cfreeArgv[cfreeArgv.indexOf('--agent') + 1] === 'chinese-tutor' && cfreeArgv[cfreeArgv.indexOf('--agents') + 1].endsWith('.cotutor/activity/none.json'));
  }

  // ---- 渲染:没有 activity 的包不多出东西 ----
  check('没 activity 的包没有那几行', !renderContextPack({ at: 'x', plan: [], recent: [] }).includes('activity'));
} finally {
  await ctx.runner.flush();
  rmSync(home, { recursive: true, force: true });
}
done();
