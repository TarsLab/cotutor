/** activity 文件(《wip/activity设计.md》):出厂的那份过检查、各种写错都报到行、递给老师的那节怎么裁、画家那段和出厂画风一字不差、init / upgrade 拷贝与 hash。 */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-activity-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { activityCards, checkActivity, fillSlots, lintActivity, parseActivity, renderTutorSection, resolveParams, failingGate, gatePasses } = await import('../src/lib/activity.ts');
const { PAINT_PROMPT_DEFAULT } = await import('../src/schema/index.ts');
const { PAINT_NEGATIVE } = await import('../src/paint/prompt.ts');
const { PACKAGE_AGENTS_DIR, configTemplate, shippedAgents } = await import('../src/cli/skeleton.ts');
const { activityFile, checkActivities, installActivities, shippedActivities, upgradeActivities } = await import('../src/cli/activities.ts');
const { installTutors, readManifest, sha256, writeManifest } = await import('../src/cli/tutors.ts');

const SHIPPED = join(PACKAGE_AGENTS_DIR, 'chinese-tutor', 'activities', '你说我画.md');
const text = readFileSync(SHIPPED, 'utf8');
const lines = text.split('\n');
const lineOf = (needle: string): number => lines.findIndex((l) => l.includes(needle)) + 1;
const factoryCards = (JSON.parse(configTemplate({ slug: 'x', tutors: await shippedAgents() })) as { tutors: Record<string, { cards?: string[] }> }).tutors['chinese-tutor'].cards;

/** 改一处再查,返回要改的那几条 */
function fixesAfter(from: string, to: string, opts: Parameters<typeof lintActivity>[1] = { fileName: '你说我画' }): { text: string; line?: number }[] {
  if (!text.includes(from)) throw new Error(`样本里没有「${from}」`);
  return lintActivity(text.replace(from, to), opts).issues.filter((i) => i.level === 'fix');
}
const has = (issues: { text: string; line?: number }[], word: string, line?: number): boolean => issues.some((i) => i.text.includes(word) && (line === undefined || i.line === line));

// ---- 出厂的那份 ----
{
  const shipped = await shippedActivities();
  check('包里出厂:语文老师的你说我画、看图说话与它们的例子', shipped.map((x) => `${x.tutor}/${x.name}`).join(' ') === 'chinese-tutor/你说我画 chinese-tutor/你说我画.例子 chinese-tutor/看图说话 chinese-tutor/看图说话.例子', JSON.stringify(shipped));
  const kantu = readFileSync(join(PACKAGE_AGENTS_DIR, 'chinese-tutor', 'activities', '看图说话.md'), 'utf8');
  check('出厂的看图说话过检查(老师的卡照出厂 cotutor.json)', lintActivity(kantu, { fileName: '看图说话', tutorCards: factoryCards }).issues.length === 0, JSON.stringify(lintActivity(kantu, { fileName: '看图说话', tutorCards: factoryCards }).issues));
  const teacher = readFileSync(join(PACKAGE_AGENTS_DIR, 'chinese-tutor.md'), 'utf8');
  check('语文老师文件只留人设与学科功夫:没有看图说话、你说我画的流程', !/^#{2,4}\s*(看图说话|你说我画)/m.test(teacher) && !teacher.includes('这是你说的话,点一下能听') && teacher.includes('### 孩子问怎么写'));
  for (const cards of [undefined, factoryCards]) {
    const { issues } = lintActivity(text, { fileName: '你说我画', tutorCards: cards });
    check(`出厂的你说我画过检查(老师的卡 ${cards ? '照出厂 cotutor.json' : '全部'})`, issues.length === 0, JSON.stringify(issues));
  }
  const { activity: a } = parseActivity(text);
  check('头:name、description、cards', a.name === '你说我画' && a.description.length > 0 && a.cards.join(' ') === 'read paint');
  const [ci, most] = a.params;
  check('家长填的:词(词表,可空)', a.params.length === 2 && ci.name === '词' && ci.type === '词表' && ci.optional && ci.default === undefined && ci.line === lineOf('词: 词表'));
  check('家长填的:最多画(数,缺省 2,1 到 4)', most.name === '最多画' && most.type === '数' && !most.optional && most.default === '2' && most.min === 1 && most.max === 4 && Boolean(most.note));
  check('应用算的:还能画、缺', a.state.map((s) => `${s.name}:${s.type}`).join(' ') === '还能画:数 缺:字');
  check('应用拦的:连说过一遍、还能画', a.gates.map((g) => g.rule).join(' ') === '连说过一遍 还能画' && a.gates.every((g) => g.note));
  check('老师那节从「## 老师怎么带」下一行起', a.tutor !== null && a.tutor.line > lineOf('## 老师怎么带') && !a.tutor.text.includes('## 画家收到什么'));

  // 画家那节第 4 期才接管画风;在那之前和出厂的 paint.prompt / 反向提示词一字不差(《wip/activity设计.md》拍板 12)
  const painter = a.tools.find((t) => t.tool === '画家');
  const style = painter?.prompt.split('\n').filter((l) => l.trim() && !l.includes('{{')) ?? [];
  check('画家那段的画风 = 出厂 paint.prompt', JSON.stringify(style) === JSON.stringify(PAINT_PROMPT_DEFAULT), JSON.stringify(style));
  check('画家不要 = 出厂反向提示词', painter?.negative === PAINT_NEGATIVE, painter?.negative);
  check('别的节(孩子看到什么、记下什么)应用不读', !a.tutor?.text.includes('孩子端不说没画成') && !painter?.prompt.includes('paint.png'));

  // 递给老师的那节
  const cards = activityCards(a, factoryCards);
  const plain = renderTutorSection(a, { params: {}, cards }) ?? '';
  const quiz = renderTutorSection(a, { params: { 词: ['播种', '羞愧'] }, cards }) ?? '';
  check('没填词:出题那段裁掉,守卫行与注释都不在', !plain.includes('我来出题') && !plain.includes('{{') && !plain.includes('<!--') && plain.includes('第一句:') && plain.includes('收:'));
  check('填了词:出题那段在', quiz.includes('### 我来出题') && quiz.includes('第 6 步之后') && !quiz.includes('{{'));
  check('空列表、空字符串算没填', !(renderTutorSection(a, { params: { 词: [] }, cards }) ?? '').includes('我来出题') && !(renderTutorSection(a, { params: { 词: ' ' }, cards }) ?? '').includes('我来出题'));
  check('卡也能当裁段的名字', renderTutorSection({ ...a, tutor: { text: '甲\n{{有 paint}}\n乙\n{{/有}}', line: 1 } }, { cards: ['paint'] }) === '甲\n乙' && renderTutorSection({ ...a, tutor: { text: '甲\n{{有 paint}}\n乙\n{{/有}}', line: 1 } }, { cards: ['text'] }) === '甲');
  check('activity 的卡并上老师的,text 总在', activityCards(a, ['read']).join(' ') === 'text read paint' && activityCards(a).length >= 12);

  // 插槽
  const filled = fillSlots(painter!.prompt, { 版式: '一张四格连环画。', 角色: '同一个角色:\n- 小熊:棕色', 分幅: '第 1 格:小熊种瓜' });
  check('填插槽:三个都填上,没有 {{ 留下', filled.startsWith('一张四格连环画。') && filled.endsWith('第 1 格:小熊种瓜') && filled.includes('- 小熊:棕色') && !filled.includes('{{'));
  check('没给的插槽填空,不留三个换行', !fillSlots(painter!.prompt, { 版式: 'A', 分幅: 'B' }).includes('\n\n\n'));
}

// ---- 老 workspace 的 claude 模板:upgrade --config 补上 --agents {agentsFile}(activity 独立,拍板 13)----
{
  const { insertMissingFlags } = await import('../src/cli/migrate.ts');
  const { factoryRuntimes } = await import('../src/clis/index.ts');
  const factory = factoryRuntimes().claude.run;
  const old = factory.filter((a, i) => a !== '--agents' && factory[i - 1] !== '--agents');
  const r = insertMissingFlags(old, factory);
  check('旧 claude 模板补上 --agents {agentsFile},紧跟在 --agent {agent} 后面', r.added.join(' ') === '--agents {agentsFile}' && r.argv.join(' ') === factory.join(' '), JSON.stringify(r));
}

// ---- 写错了报到行 ----
{
  check('类型不认得', has(fixesAfter('词: 词表,可空', '词: 词组,可空'), '类型「词组」不认得', lineOf('词: 词表')));
  check('参数写法不认得', has(fixesAfter('词: 词表,可空', '词: 词表,可以空'), '「可以空」不认得', lineOf('词: 词表')));
  check('参数那行不是「名: 类型」', has(fixesAfter('词: 词表,可空 ——', '这周的词 ——'), '参数写成', lineOf('词: 词表')));
  check('缺省超出范围', has(fixesAfter('缺省 2,1 到 4', '缺省 9,1 到 4'), '不在 1 到 4 里', lineOf('最多画:')));
  check('缺省不是整数', has(fixesAfter('缺省 2,', '缺省 两,'), '不是整数'));
  check('范围反了', has(fixesAfter('1 到 4', '4 到 1'), '反了'));
  check('参数写了两次', has(fixesAfter('最多画: 数', '词: 数'), '写了两次', lineOf('最多画:')));
  check('参数不能叫讲法', has(fixesAfter('最多画: 数', '讲法: 数'), '不能叫「讲法」'));
  check('参数不能和卡同名', has(fixesAfter('最多画: 数', 'paint: 数'), '和卡的种类同名'));
  check('应用不会算的', has(fixesAfter('还能画: 数 ——', '今天画了: 数 ——'), '应用不会算「今天画了」', lineOf('还能画: 数')));
  check('应用算的类型不对', has(fixesAfter('缺: 字', '缺: 数'), '是字,这里写成了数'));
  check('应用不认得的拦法', has(fixesAfter('连说过一遍 ——', '说清楚了 ——'), '不认得「说清楚了」', lineOf('连说过一遍 ——')));
  check('裁段的名字既不是参数也不是卡', has(fixesAfter('{{有 词}}', '{{有 单词}}'), '「单词」既不是', lineOf('{{有 词}}')));
  check('守卫不配对', has(fixesAfter('{{/有}}\n', ''), '没有配对', lineOf('{{有 词}}')));
  check('多一个 {{/有}}', has(fixesAfter('### 画家要知道的七件事', '{{/有}}\n### 画家要知道的七件事'), '多了一个'));
  check('画家少了插槽', has(fixesAfter('{{分幅}}', ''), '少了 {{分幅}}'));
  check('画家不认得的插槽', has(fixesAfter('{{角色}}', '{{角色}}{{风格}}'), '{{风格}}'));
  check('画家那段不能裁段', has(fixesAfter('{{角色}}\n', '{{有 词}}\n{{角色}}\n{{/有}}\n'), '不能用 {{有'));
  check('没有这个工具人', has(fixesAfter('## 画家收到什么', '## 魔法师收到什么'), '没有「魔法师」这个工具人'));
  check('工具人那节没有围栏', has(fixesAfter('```画家\n', '```text\n'), '要有一个 ```画家 围栏'));
  check('头上的卡不认得', has(fixesAfter('cards: read paint', 'cards: read paintt'), '「paintt」不是板书的卡'));
  check('正文用的卡老师和 activity 都没有', has(fixesAfter('cards: read paint', 'cards: read', { fileName: '你说我画', tutorCards: ['text', 'read'] }), '`paint` 卡,老师和这个 activity 都没有'));
  check('出厂语文老师的卡里没有 paint(只跟着 activity)', !factoryCards?.includes('paint'));
  const factoryTutors = (JSON.parse(configTemplate({ slug: 'x', tutors: await shippedAgents() })) as { tutors: Record<string, { runtime?: string }> }).tutors;
  check('出厂语文老师走 qwen,别的老师照旧(缺省运行时)', factoryTutors['chinese-tutor'].runtime === 'qwen' && factoryTutors['math-tutor'].runtime === undefined);
  check('老师有这种卡就不用 activity 再写', fixesAfter('cards: read paint', 'cards: read', { fileName: '你说我画', tutorCards: ['text', 'read', 'paint'] }).length === 0);
  check('缺第一句', has(fixesAfter('第一句: ', '先说: '), '「第一句: …」'));
  check('缺人设', has(fixesAfter('你是这个家的语文老师,今天陪孩子玩', '今天陪孩子玩'), '以「你是」开头'));
  check('缺收', has(fixesAfter('收: 问完', '最后: 问完'), '「收: …」'));
  check('name 和文件名对不上', has(lintActivity(text, { fileName: '你画我说' }).issues, '文件名是「你画我说.md」'));
  check('缺 description', has(fixesAfter(/description: .*\n/.exec(text)![0], ''), '缺 description'));
  check('没有头', has(lintActivity(text.slice(text.indexOf('\n---\n') + 5), { fileName: '你说我画' }).issues, '头上要有 ---'));
  check('同一节写两次', has(fixesAfter('## 孩子看到什么', '## 家长填的\n\n```参数\n别的: 字\n```\n\n## 孩子看到什么'), '写了两节'));
  check('家长填的没有围栏', has(fixesAfter('```参数\n', '```\n'), '```参数 围栏'));
  check('围栏没收口', has(lintActivity('---\nname: x\ndescription: y\n---\n## 家长填的\n```参数\n词: 字\n', { fileName: 'x' }).issues, '没有收口'));
}

// ---- 首页按钮下面的参数 → 值 ----
{
  const { activity: a } = parseActivity(text);
  const ok = resolveParams(a, { 词: '播种、睡大觉, 满满 羞愧' });
  check('词表:顿号、逗号、空格都分;最多画补缺省 2,是数', JSON.stringify(ok) === JSON.stringify({ values: { 词: ['播种', '睡大觉', '满满', '羞愧'], 最多画: 2 }, issues: [] }), JSON.stringify(ok));
  check('可空的没填:不出现', JSON.stringify(resolveParams(a, {}).values) === JSON.stringify({ 最多画: 2 }) && resolveParams(a, { 词: ' ' }).issues.length === 0);
  check('数:不是整数、超出范围都报', resolveParams(a, { 最多画: '两' }).issues[0]?.includes('整数') && resolveParams(a, { 最多画: '5' }).issues[0]?.includes('1 到 4'));
  check('不认得的参数报一条,列出有哪些', resolveParams(a, { 单词: 'x' }).issues[0]?.includes('有:词、最多画'));
  const must = parseActivity(text.replace('词: 词表,可空', '词: 词表')).activity;
  check('要填的没填:报', resolveParams(must, {}).issues[0]?.includes('要填「词」'));
}

// ---- 应用拦的:纯判断 ----
{
  type M = { job: string; from: 'kid' | 'system'; action?: 'continue' | 'submit'; section?: { cards: { kind: string; props: Record<string, unknown> }[]; lines: never[] } };
  const story = (n: number) => ({ cards: [{ kind: 'read', props: { segments: Array.from({ length: n }, (_, i) => `第 ${i + 1} 句。`) } }], lines: [] as never[] });
  const t = (...ms: M[]) => ms as never;
  const S = { 还能画: 1 };
  check('连说过一遍:前面放过三行的整段,孩子后面开过口 → 过', gatePasses('连说过一遍', { thread: t({ job: '1', from: 'kid', section: story(3) }, { job: '2', from: 'kid' }), job: '2', state: S }));
  check('连说过一遍:整段只有两行 → 不过', !gatePasses('连说过一遍', { thread: t({ job: '1', from: 'kid', section: story(2) }, { job: '2', from: 'kid' }), job: '2', state: S }));
  check('连说过一遍:整段和画图卡在同一节 → 不过(孩子还没开口)', !gatePasses('连说过一遍', { thread: t({ job: '1', from: 'kid', section: story(4) }), job: '1', state: S }));
  check('连说过一遍:后面只按了继续 → 不过', !gatePasses('连说过一遍', { thread: t({ job: '1', from: 'kid', section: story(3) }, { job: '2', from: 'kid', action: 'continue' }), job: '2', state: S }));
  check('还能画:大于 0 才过,没算出来不过', gatePasses('还能画', { thread: t(), job: 'x', state: { 还能画: 2 } }) && !gatePasses('还能画', { thread: t(), job: 'x', state: { 还能画: 0 } }) && !gatePasses('还能画', { thread: t(), job: 'x', state: {} }));
  const { activity: a } = parseActivity(text);
  check('failingGate:照文件里的顺序报第一条没过的', failingGate(a, { thread: t(), job: 'x', state: { 还能画: 0 } }) === '连说过一遍' && failingGate({ gates: [{ rule: '还能画', line: 1 }] }, { thread: t(), job: 'x', state: { 还能画: 0 } }) === '还能画' && failingGate({ gates: [] }, { thread: t(), job: 'x', state: {} }) === null);
}

// ---- 例子与判分(activity eval)----
{
  const { gradeRun, kidPrompt, parseExamples } = await import('../src/lib/activity-eval.ts');
  const ex = parseExamples(readFileSync(join(PACKAGE_AGENTS_DIR, 'chinese-tutor', 'activities', '你说我画.例子.md'), 'utf8'));
  check('出厂例子文件:没有要改的,五个例子', ex.activity === '你说我画' && ex.issues.length === 0 && ex.examples.length === 5, JSON.stringify(ex.issues));
  const ex2 = parseExamples(readFileSync(join(PACKAGE_AGENTS_DIR, 'chinese-tutor', 'activities', '看图说话.例子.md'), 'utf8'));
  check('看图说话的例子:没有要改的;注释里的带图写法不算例子', ex2.activity === '看图说话' && ex2.issues.length === 0 && ex2.examples.map((e) => e.name).join() === '还没拍图', JSON.stringify(ex2));
  const ph = parseExamples('---\nactivity: x\n---\n## 带图\n照片: a.jpg, b.png\n孩子: 这是我的\n判:\n- 放过整段\n## 光有图\n照片: c.gif\n判:\n- 放过整段\n');
  check('照片:几张都收;没有孩子的话、不是 jpg / png 都报', JSON.stringify(ph.examples[0].photos) === '["a.jpg","b.png"]' && ph.issues.some((i) => i.text.includes('要写一句「孩子:」')) && ph.issues.some((i) => i.text.includes('只认 jpg / png')), JSON.stringify(ph.issues));
  check('出厂例子的参数都对得上 activity 文件', ex.examples.every((e) => resolveParams(parseActivity(text).activity, Object.fromEntries(e.params.split(';').filter(Boolean).map((x) => x.split('=') as [string, string]))).issues.length === 0));
  const bad = parseExamples('---\nactivity: x\n---\n## 甲\n孩子: 你好\n判:\n- 出彩虹\n## 乙\n乱写一行\n最多轮: 99\n');
  check('例子写坏:判不认得、行认不出、最多轮超了、没孩子没人设、没有判都报', ['判「出彩虹」不认得', '认不出', '最多轮要是', '孩子一句都没有', '没有判'].every((w) => bad.issues.some((i) => i.text.includes(w))), JSON.stringify(bad.issues));
  const line = (t: string) => ({ text: t, audio: null, marks: [], ask: false, anchor: null });
  const sec = (lines: string[], cards: { kind: string; props: Record<string, unknown> }[] = []) => ({ lines: lines.map(line), cards }) as never;
  const story = { kind: 'read', props: { segments: ['小熊睡大觉。', '小熊浇了水。', '西瓜熟了。'] } };
  const paint = (panels: string[]) => ({ kind: 'paint', props: { panels } });
  const turns = [
    { kid: '你说我画', section: sec(['画家想知道是谁的故事?']) },
    { kid: '小熊', section: sec(['画家画哪个?'], [story]) },
    { kid: '小熊睡大觉浇了水西瓜熟了', section: sec(['画家开始画了。', '你猜画家会怎么画?'], [paint(['小熊播种。', '小熊很高兴。'])]) },
  ];
  check('判:画图卡带题干和词', !gradeRun(['画图卡带题干和词'], turns)[0].pass && gradeRun(['画图卡带题干和词'], [{ kid: 'x', section: sec(['好?'], [{ kind: 'paint', props: { panels: ['a'], ask: '题', words: ['词'] } }]) }])[0].pass);
  check('判:分幅至少', gradeRun(['分幅至少: 2'], turns)[0].pass && !gradeRun(['分幅至少: 3'], turns)[0].pass && gradeRun(['分幅至少: 3'], turns)[0].why!.includes('2 幅'));
  check('判:放过整段', gradeRun(['放过整段'], [{ kid: 'x', section: sec(['好?'], [{ kind: 'read', props: { segments: ['一', '二', '三'] } }]) }])[0].pass && !gradeRun(['放过整段'], [{ kid: 'x', section: sec(['好?']) }])[0].pass);
  const g = Object.fromEntries(gradeRun(['出画图卡', '不出画图卡', '画图卡前放过整段', '分幅没有看不见的词', '每节末句是问句', '不说: 错了', '问到: 画家', '并排: 睡大觉 | 浇了水', '词落到幅: 1'], turns, { 词: ['播种', '羞愧'] }).map((r) => [r.check, r]));
  check('判:出画图卡 / 不出画图卡', g['出画图卡'].pass && !g['不出画图卡'].pass && g['不出画图卡'].why!.includes('第 3 轮'));
  check('判:画图卡前放过整段', g['画图卡前放过整段'].pass && !gradeRun(['画图卡前放过整段'], [turns[0], turns[2]])[0].pass);
  check('判:分幅里的「高兴」报出来', !g['分幅没有看不见的词'].pass && g['分幅没有看不见的词'].why!.includes('高兴'));
  check('判:每节末句问句、不说、问到、并排、词落到幅', g['每节末句是问句'].pass && g['不说: 错了'].pass && g['问到: 画家'].pass && g['并排: 睡大觉 | 浇了水'].pass && g['词落到幅: 1'].pass && !gradeRun(['词落到幅: 2'], turns, { 词: ['播种', '羞愧'] })[0].pass);
  check('判:有卡的节末句不是问句报哪轮;没卡的随口一句不查', !gradeRun(['每节末句是问句'], [{ kid: 'x', section: sec(['好的。'], [story]) }])[0].pass && gradeRun(['每节末句是问句'], [{ kid: 'x', section: sec(['好的。']) }])[0].pass);
  const kp = kidPrompt({ story: '小熊种瓜', persona: '问一句答一句' }, turns.slice(0, 2));
  check('模拟孩子的提示词:故事、人设、对话、板上的整段', kp.includes('小熊种瓜') && kp.includes('问一句答一句') && kp.includes('孩子:小熊') && kp.includes('板上:小熊睡大觉。 / 小熊浇了水。'));
}

// ---- 没有老师那节的(像听写):只提醒,不算错;解析永不抛 ----
{
  const dict = '---\nname: 听写\ndescription: 老师念,孩子写\ncards: \n---\n\n## 家长填的\n\n```参数\n词表: 词表 —— 一行一个\n```\n';
  const r = lintActivity(dict, { fileName: '听写' });
  check('没有老师怎么带:一条提醒,没有要改的', r.issues.length === 1 && r.issues[0].level === 'note' && r.activity.tutor === null && renderTutorSection(r.activity, { cards: [] }) === null, JSON.stringify(r.issues));
  let threw = false;
  for (const junk of ['', '---', '## 老师怎么带\n{{有', '```\n## 家长填的', '---\nname: a\n---\n## 画家收到什么\n```画家\n{{']) {
    try {
      const p = parseActivity(junk);
      checkActivity(p.activity, {});
    } catch {
      threw = true;
    }
  }
  check('解析与检查永不抛', !threw);
}

// ---- init / upgrade:拷贝、hash、改过的不动 ----
{
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-activity-ws-')));
  try {
    const steps = await installActivities(root);
    const file = activityFile(root, 'chinese-tutor', '你说我画');
    check('init 拷进老师的家(连例子文件)', steps.length === 4 && steps.every((x) => x.action === 'created') && readFileSync(file, 'utf8') === text && existsSync(activityFile(root, 'chinese-tutor', '你说我画.例子')), JSON.stringify(steps));
    check('hash 记进 shipped.json 的 activities', (await readManifest(root)).activities?.['chinese-tutor/你说我画']?.hash === sha256(text));
    await installTutors(root, []);
    check('老师那边写清单不抹掉 activities', Boolean((await readManifest(root)).activities?.['chinese-tutor/你说我画']));
    check('再 init 不动', (await installActivities(root))[0].action === 'exists');

    check('没改过:已是最新', (await upgradeActivities(root))[0].action === 'latest');
    const mine = text.replace('最多画: 数,缺省 2', '最多画: 数,缺省 1');
    writeFileSync(file, mine);
    const kept = (await upgradeActivities(root))[0];
    check('改过的:保留,报 diff', kept.action === 'kept-custom' && readFileSync(file, 'utf8') === mine && Boolean(kept.diff?.some((l) => l.includes('缺省 1'))));
    check('改过的再 init 也不动', (await installActivities(root))[0].action === 'exists' && readFileSync(file, 'utf8') === mine);
    const m = await readManifest(root);
    m.activities!['chinese-tutor/你说我画'] = { hash: sha256(mine), version: '0.0.1' };
    await writeManifest(root, m);
    check('和记录的出厂 hash 一样(没改过、包更新了):换新', (await upgradeActivities(root))[0].action === 'upgraded' && readFileSync(file, 'utf8') === text);
    writeFileSync(file, mine);
    const forced = (await upgradeActivities(root, { force: ['chinese-tutor/你说我画'] }))[0];
    check('--force 老师/名:覆盖,原文留 .bak', forced.action === 'forced' && readFileSync(file, 'utf8') === text && readFileSync(`${file}.bak`, 'utf8') === mine);
    rmSync(file);
    check('删了:upgrade 补上', (await upgradeActivities(root))[0].action === 'installed' && existsSync(file));

    const ok = await checkActivities(root, { 'chinese-tutor': { cards: factoryCards } });
    check('activity check:workspace 里两个都对得上(例子文件不当 activity)', ok.map((x) => x.name).join() === '你说我画,看图说话' && ok.every((x) => x.issues.length === 0), JSON.stringify(ok.map((x) => x.issues)));
    const orphan = await checkActivities(root, {});
    check('activity check:老师不在 cotutor.json 里报一条', has(orphan[0].issues, '没有 chinese-tutor 这位老师'));
    check('activity check:按老师、按名字筛', (await checkActivities(root, {}, { tutor: 'math-tutor' })).length === 0 && (await checkActivities(root, {}, { tutor: 'chinese-tutor', name: '别的' })).length === 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

rmSync(home, { recursive: true, force: true });
done();
