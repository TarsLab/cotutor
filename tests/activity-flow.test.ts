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
const ctx = createContext(loadWorkspace(root), { now: () => now });
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
  check('上下文包:activity: 在 YAML 最后,参数一行一个、词表是列表', yaml.endsWith('  activity:\n    name: "你说我画"\n    params:\n      "词":\n        - "播种"\n        - "睡大觉"\n        - "羞愧"\n      "最多画": 2'), yaml.slice(-200));
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

  // ---- 渲染:没有 activity 的包不多出东西 ----
  check('没 activity 的包没有那几行', !renderContextPack({ at: 'x', plan: [], recent: [] }).includes('activity'));
} finally {
  await ctx.runner.flush();
  rmSync(home, { recursive: true, force: true });
}
done();
