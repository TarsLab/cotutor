/** activity 文件:出厂的过检查、各种写错都报到行、递给老师的那节怎么裁、工具人的插槽、init / upgrade 拷贝与 hash。 */
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { SAMPLE_ACTIVITY } from './_activity-sample.ts';
import type { BoardSection } from '../src/schema/index.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-activity-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { checkActivity, lintActivity, parseActivity, renderTutorSection, resolveParams } = await import('../src/runtime/activity.ts');
const { fillSlots } = await import('../src/schema/index.ts');
const { PACKAGE_AGENTS_DIR, configTemplate, shippedAgents } = await import('../src/app/cli/skeleton.ts');
const { activityFile, checkActivities, installActivities, shippedActivities, upgradeActivities } = await import('../src/app/cli/activities.ts');
const { installTutors, readManifest, sha256, writeManifest } = await import('../src/app/cli/tutors.ts');

// 样本:tests/_activity-sample.ts 的一份小 activity(参数两种、裁段、工具人),只为试解析与检查;出厂的那些在下面另查
const text = SAMPLE_ACTIVITY;
const lines = text.split('\n');
const lineOf = (needle: string): number => lines.findIndex((l) => l.includes(needle)) + 1;

/** 改一处再查,返回要改的那几条 */
function fixesAfter(from: string, to: string, opts: Parameters<typeof lintActivity>[1] = { fileName: '练词' }): { text: string; line?: number }[] {
  if (!text.includes(from)) throw new Error(`样本里没有「${from}」`);
  return lintActivity(text.replace(from, to), opts).issues.filter((i) => i.level === 'fix');
}
const has = (issues: { text: string; line?: number }[], word: string, line?: number): boolean => issues.some((i) => i.text.includes(word) && (line === undefined || i.line === line));

// ---- 出厂的那些、样本 ----
{
  const shipped = await shippedActivities();
  check('包里出厂:语文老师的看图说话与它的例子;语文、数学、英语各一份小课堂;英语老师的口语课', 'chinese-tutor/听写 chinese-tutor/小课堂 chinese-tutor/看图说话 chinese-tutor/看图说话.例子 english-tutor/口语课 english-tutor/听写 english-tutor/小课堂 math-tutor/小课堂 math-tutor/小课堂.例子'.split(' ').every((key) => shipped.some((x) => `${x.tutor}/${x.name}` === key)), JSON.stringify(shipped));
  check('不出厂了:你说我画、写话(2026-11-15)', !shipped.some((x) => x.name.startsWith('你说我画') || x.name.startsWith('写话')));
  check('听写跟着出厂,在老师的家里(不是 activity)', shipped.filter((x) => x.home).map((x) => `${x.tutor}/${x.name}`).join() === 'chinese-tutor/听写,english-tutor/听写' && shipped.filter((x) => x.home).every((x) => x.file.endsWith(join(x.tutor, '听写.md'))));
  for (const s of shipped.filter((x) => !x.name.endsWith('.例子') && !x.home)) {
    const { issues } = lintActivity(readFileSync(s.file, 'utf8'), { fileName: s.name });
    check(`出厂的 ${s.tutor}/${s.name} 过检查`, issues.filter((i) => i.level === 'fix').length === 0, JSON.stringify(issues));
  }
  const kantu = readFileSync(join(PACKAGE_AGENTS_DIR, 'chinese-tutor', 'activities', '看图说话.md'), 'utf8');
  check('出厂的看图说话过检查,连提醒都没有', lintActivity(kantu, { fileName: '看图说话' }).issues.length === 0, JSON.stringify(lintActivity(kantu, { fileName: '看图说话' }).issues));
  check('看图说话:老师收到的那节不说「点一下能听」', !(renderTutorSection(parseActivity(kantu).activity, {}) ?? '点一下能听').includes('点一下能听'));
  // 一科通用的做法(2026-11-16 从老师文件并进 activity):这位老师每个有「老师怎么带」的 activity 里都有「<科>这一科」一节,一字不差
  for (const [tutor, subject] of [['chinese-tutor', '语文'], ['math-tutor', '数学'], ['english-tutor', '英语']] as const) {
    const dir = join(PACKAGE_AGENTS_DIR, tutor, 'activities');
    const blocks = new Map<string, string>();
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.md') && !f.includes('.例子'))) {
      const body = parseActivity(readFileSync(join(dir, f), 'utf8')).activity.tutor?.text;
      if (!body) continue;
      const m = new RegExp(`^### ${subject}这一科\\n[\\s\\S]*?(?=^### |(?![\\s\\S]))`, 'm').exec(body);
      blocks.set(f, m ? m[0].trim() : '');
    }
    const texts = [...new Set(blocks.values())];
    check(`${tutor}:每个 activity 都有「${subject}这一科」,几份一字不差`, blocks.size >= 3 && texts.length === 1 && texts[0].length > 0, JSON.stringify([...blocks].map(([f, t]) => [f, t.length])));
  }
  check('样本过检查', lintActivity(text, { fileName: '练词' }).issues.length === 0, JSON.stringify(lintActivity(text, { fileName: '练词' }).issues));
  const oldHead = lintActivity(text.replace('base: photo', 'cards: read photo'), { fileName: '练词' }).issues;
  check('旧的头 cards: 读进来就丢,提一句(不是要改),照 base: photo', oldHead.length === 1 && oldHead[0].level === 'note' && oldHead[0].text.includes('cards: read photo') && parseActivity(text.replace('base: photo', 'cards: read photo')).activity.base === undefined, JSON.stringify(oldHead));
  const { activity: a } = parseActivity(text);
  check('头:name、description、base', a.name === '练词' && a.description.length > 0 && a.base === 'photo');
  const [ci, most] = a.params;
  check('家长填的:词(词表,可空)', a.params.length === 2 && ci.name === '词' && ci.type === '词表' && ci.optional && ci.default === undefined && ci.line === lineOf('词: 词表'));
  check('家长填的:最多问(数,可空,不填不限)', most.name === '最多问' && most.type === '数' && most.optional && most.default === undefined && most.min === undefined && most.max === undefined && Boolean(most.note));
  check('老师那节从「## 老师怎么带」下一行起', a.tutor !== null && a.tutor.line > lineOf('## 老师怎么带') && !a.tutor.text.includes('## 认字收到什么'));
  const reader = a.tools.find((t) => t.tool === '认字');
  check('工具人那节:认字的模板,带插槽', !!reader && reader.prompt.includes('{{格式}}') && reader.promptLine === lineOf('挑出这一页要认的字词'));
  check('别的节(孩子看到什么)应用不读', !a.tutor?.text.includes('只给人看') && !reader?.prompt.includes('只给人看'));

  // 递给老师的那节
  const plain = renderTutorSection(a, { params: {} }) ?? '';
  const quiz = renderTutorSection(a, { params: { 词: ['播种', '羞愧'] } }) ?? '';
  check('没填词:那段裁掉,守卫行与注释都不在', !plain.includes('用上这周的词') && !plain.includes('{{') && !plain.includes('<!--') && plain.includes('第一句:') && plain.includes('收:'));
  check('填了词:那段在', quiz.includes('### 用上这周的词') && quiz.includes('第 1 步之后') && !quiz.includes('{{'));
  check('空列表、空字符串算没填', !(renderTutorSection(a, { params: { 词: [] } }) ?? '').includes('用上这周的词') && !(renderTutorSection(a, { params: { 词: ' ' } }) ?? '').includes('用上这周的词'));

  // 插槽
  const filled = fillSlots(reader!.prompt, { 格式: '一行一个词。' });
  check('填插槽:填上了,没有 {{ 留下', filled.startsWith('挑出这一页要认的字词。') && filled.endsWith('一行一个词。') && !filled.includes('{{'));
  check('没给的插槽填空,不留三个换行', !fillSlots('甲\n\n{{格式}}\n\n乙', {}).includes('\n\n\n'));
}

// ---- 写错了报到行 ----
{
  check('类型不认得', has(fixesAfter('词: 词表,可空', '词: 词组,可空'), '类型「词组」不认得', lineOf('词: 词表')));
  check('参数写法不认得', has(fixesAfter('词: 词表,可空', '词: 词表,可以空'), '「可以空」不认得', lineOf('词: 词表')));
  check('参数那行不是「名: 类型」', has(fixesAfter('词: 词表,可空 ——', '这周的词 ——'), '参数写成', lineOf('词: 词表')));
  check('缺省超出范围', has(fixesAfter('最多问: 数,可空', '最多问: 数,缺省 9,1 到 4'), '不在 1 到 4 里', lineOf('最多问:')));
  check('缺省不是整数', has(fixesAfter('最多问: 数,可空', '最多问: 数,缺省 两'), '不是整数'));
  check('范围反了', has(fixesAfter('最多问: 数,可空', '最多问: 数,可空,4 到 1'), '反了'));
  check('参数写了两次', has(fixesAfter('最多问: 数', '词: 数'), '写了两次', lineOf('最多问:')));
  check('参数不能叫讲法', has(fixesAfter('最多问: 数', '讲法: 数'), '不能叫「讲法」'));
  check('裁段的名字不是参数', has(fixesAfter('{{有 词}}', '{{有 单词}}'), '「单词」不是这个 activity 的参数', lineOf('{{有 词}}')));
  check('守卫不配对', has(fixesAfter('{{/有}}\n', ''), '没有配对', lineOf('{{有 词}}')));
  check('多一个 {{/有}}', has(fixesAfter('### 怎么收', '{{/有}}\n### 怎么收'), '多了一个'));
  check('工具人少了插槽', has(fixesAfter('{{格式}}', ''), '少了 {{格式}}'));
  check('工具人不认得的插槽', has(fixesAfter('{{格式}}', '{{格式}}{{风格}}'), '{{风格}}'));
  check('工具人那段不能裁段', has(fixesAfter('{{格式}}\n', '{{有 词}}\n{{格式}}\n{{/有}}\n'), '不能用 {{有'));
  check('没有这个工具人(画家 2026-11-15 删了)', has(fixesAfter('## 认字收到什么', '## 魔法师收到什么'), '没有「魔法师」这个工具人') && has(fixesAfter('## 认字收到什么', '## 画家收到什么'), '没有「画家」这个工具人'));
  check('工具人那节没有围栏', has(fixesAfter('```认字\n', '```text\n'), '要有一个 ```认字 围栏'));
  const factoryTutors = (JSON.parse(configTemplate({ slug: 'x', tutors: await shippedAgents() })) as { tutors: Record<string, { runtime?: string }> }).tutors;
  check('出厂三位老师都走 api(应用直连百炼;英语 api-flash 第一轮常只出卡,2026-10-31)', ['chinese-tutor', 'math-tutor', 'english-tutor'].every((t) => factoryTutors[t].runtime === 'api'));
  check('缺第一句', has(fixesAfter('第一句: ', '先说: '), '「第一句: …」'));
  check('缺人设', has(fixesAfter('你是这个家的语文老师,今天陪孩子练词', '今天陪孩子练词'), '以「你是」开头'));
  check('缺收', has(fixesAfter('收: 问完', '最后: 问完'), '「收: …」'));
  check('name 和文件名对不上', has(lintActivity(text, { fileName: '练字' }).issues, '文件名是「练字.md」'));
  check('缺 description', has(fixesAfter(/description: .*\n/.exec(text)![0], ''), '缺 description'));
  check('没有头', has(lintActivity(text.slice(text.indexOf('\n---\n') + 5), { fileName: '练词' }).issues, '头上要有 ---'));
  check('同一节写两次', has(fixesAfter('## 孩子看到什么', '## 家长填的\n\n```参数\n别的: 字\n```\n\n## 孩子看到什么'), '写了两节'));
  check('家长填的没有围栏', has(fixesAfter('```参数\n', '```\n'), '```参数 围栏'));
  check('围栏没收口', has(lintActivity('---\nname: x\ndescription: y\n---\n## 家长填的\n```参数\n词: 字\n', { fileName: 'x' }).issues, '没有收口'));
  check('以前的「应用算的」「应用拦的」两节不读了(2026-11-15):当给人看的节,不报错', lintActivity(text.replace('## 孩子看到什么', '## 应用算的\n\n```应用算\n还能画: 数\n```\n\n## 应用拦的\n\n```应用拦\n连说过一遍\n```\n\n## 孩子看到什么'), { fileName: '练词' }).issues.length === 0);
}

// ---- 首页按钮下面的参数 → 值 ----
{
  const { activity: a } = parseActivity(text);
  const ok = resolveParams(a, { 词: '播种、睡大觉, 满满 羞愧' });
  check('词表:顿号、逗号、空格都分;最多问没填就没有(不限)', JSON.stringify(ok) === JSON.stringify({ values: { 词: ['播种', '睡大觉', '满满', '羞愧'] }, issues: [] }), JSON.stringify(ok));
  check('可空的没填:不出现;填了的是数', JSON.stringify(resolveParams(a, {}).values) === '{}' && resolveParams(a, { 最多问: '3' }).values.最多问 === 3 && resolveParams(a, { 词: ' ' }).issues.length === 0);
  const ranged = parseActivity(text.replace('最多问: 数,可空', '最多问: 数,可空,1 到 4')).activity;
  check('数:不是整数、超出范围都报', resolveParams(a, { 最多问: '两' }).issues[0]?.includes('整数') && resolveParams(ranged, { 最多问: '5' }).issues[0]?.includes('1 到 4'));
  check('不认得的参数报一条,列出有哪些', resolveParams(a, { 单词: 'x' }).issues[0]?.includes('有:词、最多问'));
  const must = parseActivity(text.replace('词: 词表,可空', '词: 词表')).activity;
  check('要填的没填:报', resolveParams(must, {}).issues[0]?.includes('要填「词」'));
}

// ---- 例子与判分(activity eval)----
{
  const { gradeRun, kidPrompt, parseExamples } = await import('../src/app/activity-eval-rules.ts');
  const ex2 = parseExamples(readFileSync(join(PACKAGE_AGENTS_DIR, 'chinese-tutor', 'activities', '看图说话.例子.md'), 'utf8'));
  check('看图说话的例子:没有要改的;带图的三个,图在包里的 例子图/', ex2.activity === '看图说话' && ex2.issues.length === 0 && ex2.examples.map((e) => e.name).join() === '还没拍图,一幅图,四幅图一口气说,说不出就给两个挑' && ex2.examples.flatMap((e) => e.photos).every((p) => existsSync(join(PACKAGE_AGENTS_DIR, 'chinese-tutor', 'activities', p))), JSON.stringify(ex2.examples.map((e) => [e.name, e.photos])));
  const ph = parseExamples('---\nactivity: x\n---\n## 带图\n照片: a.jpg, b.png\n孩子: 这是我的\n判:\n- 放过整段\n## 光有图\n照片: c.gif\n判:\n- 放过整段\n');
  check('照片:几张都收;没有孩子的话、不是 jpg / png 都报', JSON.stringify(ph.examples[0].photos) === '["a.jpg","b.png"]' && ph.issues.some((i) => i.text.includes('要写一句「孩子:」')) && ph.issues.some((i) => i.text.includes('只认 jpg / png')), JSON.stringify(ph.issues));
  const lx = parseExamples('---\nactivity: 小课堂\n---\n## 画了\n课: b1\n看: 看完了,停过 2 次\n画: 0:14 画的地方盖着:散的 3 根\n圈: 1:05\n孩子: 为什么\n判:\n- 放课里一段\n## 坏的\n圈: 十四秒\n看: 停过 1 次\n判:\n- 说到: 圈\n');
  check('先看小课堂的例子:课、停过几次、画(时刻 + 画的地方盖着什么;以前的「圈:」照认);没时刻、没写课、没孩子的话都报', JSON.stringify(lx.examples[0].lecture) === JSON.stringify({ bundle: 'b1', pauses: 2, marks: [{ atMs: 14000, text: '画的地方盖着:散的 3 根' }, { atMs: 65000, text: '' }] }) && ['先写时刻', '要先写「课: <课包 id>」', '看完课第一句是孩子问的'].every((w) => lx.issues.some((i) => i.text.includes(w))), JSON.stringify(lx));
  const mx = parseExamples(readFileSync(join(PACKAGE_AGENTS_DIR, 'math-tutor', 'activities', '小课堂.例子.md'), 'utf8'));
  check('数学小课堂的例子:没有要改的,三个都先看课', mx.activity === '小课堂' && mx.issues.length === 0 && mx.examples.length === 3 && mx.examples.every((e) => e.lecture?.bundle === '2026-09-18-po13-jian-8' && e.kid.length === 1), JSON.stringify(mx.issues));
  const bad = parseExamples('---\nactivity: x\n---\n## 甲\n孩子: 你好\n判:\n- 出彩虹\n## 乙\n乱写一行\n最多轮: 99\n');
  check('例子写坏:判不认得、行认不出、最多轮超了、没孩子没人设、没有判都报', ['判「出彩虹」不认得', '认不出', '最多轮要是', '孩子一句都没有', '没有判'].every((w) => bad.issues.some((i) => i.text.includes(w))), JSON.stringify(bad.issues));
  const line = (t: string) => ({ text: t, ask: false });
  // 写在页上的([[写 …]]):看图说话把孩子的话写在图下面
  const wrote = (text: string, writes: string[]) => ({ text, ask: /[??]$/.test(text), acts: writes.map((w) => ({ name: '写', arg: w })) });
  const sec = (lines: string[]) => ({ lines: lines.map(line) }) as never;
  const story = ['小熊睡大觉。', '小熊浇了水。', '西瓜熟了。'];
  const said = (lines: string[], writes: string[]) => ({ lines: lines.map((t, i) => (i === 0 ? wrote(t, writes) : line(t))) }) as never;
  const turns = [
    { kid: '看图说话', section: sec(['图上有谁呀?']) },
    { kid: '小熊', section: said(['小熊在哪里?'], story) },
    { kid: '小熊睡大觉浇了水西瓜熟了', section: said(['你说得真清楚。', '你自己连起来说一遍,好吗?'], story) },
  ];
  check('判:每节有讲稿拒绝只出卡、空白和空轮次', gradeRun(['每节有讲稿'], turns)[0].pass && !gradeRun(['每节有讲稿'], [{ kid: 'x', section: said([], story) }])[0].pass && !gradeRun(['每节有讲稿'], [{ kid: 'x', section: sec(['  ']) }])[0].pass && !gradeRun(['每节有讲稿'], [{ kid: 'x', section: null }])[0].pass && !gradeRun(['每节有讲稿'], [])[0].pass);
  {
    // 讲稿里的动作:[[请 …]] 就是开放(没写沿用上一次);[[摆 …]] 算摆了图形;问了带动作就算上页
    const actSec = (lines: [string, { name: string; arg: string }[]][]): BoardSection => ({ lines: lines.map(([text, acts]) => ({ text, ask: /[??]$/.test(text), ...(acts.length ? { acts } : {}) })) } as unknown as BoardSection);
    const ok1 = [{ kid: 'a', section: actSec([['哪个字不认识,就点一点它。', [{ name: '请', arg: '点' }]]]) }, { kid: 'b', section: actSec([['你把傍晚圈出来。', []]]) }];
    const r1 = gradeRun(['请动手就开放'], ok1)[0];
    check('判:请动手就开放——末句请他动手,页上(这一轮的 [[请 …]],没写就沿用上一次)要开放那个操作', !r1.pass && r1.why === '第 2 轮请他圈,页上开放的是点' && gradeRun(['请动手就开放'], [ok1[0], { kid: 'b', section: actSec([['你把傍晚圈出来。', [{ name: '请', arg: '点、圈' }]]]) }])[0].pass && gradeRun(['请动手就开放'], [{ kid: 'c', section: actSec([['你读一读。', []]]) }])[0].pass, JSON.stringify(r1));
    const asked = [{ kid: 'a', section: actSec([['你把 6 个圈成一串。', [{ name: '摆', arg: '点阵 6 行 6 个' }, { name: '请', arg: '圈' }]]]) }];
    check('判:摆图形(写了名字就要是那一种)、在页上讲、不在页上讲', gradeRun(['请动手就开放'], asked)[0].pass && gradeRun(['摆图形'], asked)[0].pass && gradeRun(['摆图形: 点阵'], asked)[0].pass && !gradeRun(['摆图形: 方向盘'], asked)[0].pass && gradeRun(['在页上讲'], [{ kid: 'a', section: actSec([['看例 4。', [{ name: '看', arg: '例 4' }]]]) }])[0].pass && !gradeRun(['在页上讲'], asked)[0].pass && !gradeRun(['不在页上讲'], asked)[0].pass && gradeRun(['不在页上讲'], [{ kid: 'x', section: sec(['都对了。']) }])[0].pass);
    check('判:问就上页(只用嘴问的那一轮不过;带动作的、请拍照的、没问的都过)', !gradeRun(['问就上页'], [{ kid: 'x', section: sec(['小箭头朝哪个方向?']) }])[0].pass && gradeRun(['问就上页'], [{ kid: 'x', section: sec(['拍给我看看,好吗?']) }, { kid: 'y', section: actSec([['东面有哪两间?圈出来。', [{ name: '请', arg: '圈' }]]]) }, { kid: 'z', section: sec(['都对了。']) }])[0].pass);
    check('判:页上有看动作的参数([[写 …]])', gradeRun(['页上有: 17'], [{ kid: 'x', section: actSec([['你看。', [{ name: '写', arg: '17 + 3 = 20' }]]]) }])[0].pass);
  }
  check('判:放过整段(一轮写过三行)', gradeRun(['放过整段'], [{ kid: 'x', section: said(['好?'], ['一', '二', '三']) }])[0].pass && !gradeRun(['放过整段'], [{ kid: 'x', section: said(['好?'], ['一', '二']) }])[0].pass);
  const g = Object.fromEntries(gradeRun(['每节末句是问句', '不说: 错了', '问到: 在哪里', '并排: 睡大觉 | 浇了水'], turns).map((r) => [r.check, r]));
  check('判:每节末句问句、不说、问到、并排;删掉的判(出画图卡)不认得', g['每节末句是问句'].pass && g['不说: 错了'].pass && g['问到: 在哪里'].pass && g['并排: 睡大觉 | 浇了水'].pass && parseExamples('---\nactivity: x\n---\n## 甲\n孩子: 你好\n判:\n- 出画图卡\n').issues.some((i) => i.text.includes('判「出画图卡」不认得')));
  check('判:收尾不问——只看最后一轮的末句', gradeRun(['收尾不问'], [{ kid: 'x', section: said(['你来数数?'], story) }, { kid: 'y', section: sec(['对,就是 5 个。']) }])[0].pass && !gradeRun(['收尾不问'], [{ kid: 'x', section: sec(['好的。']) }, { kid: 'y', section: sec(['你教教我?']) }])[0].pass);
  check('判:在页上动过的那轮末句不是问句报哪轮;只说话的不查', !gradeRun(['每节末句是问句'], [{ kid: 'x', section: said(['好的。'], story) }])[0].pass && gradeRun(['每节末句是问句'], [{ kid: 'x', section: sec(['好的。']) }])[0].pass);
  check('判:一节一问(在页上动过的那轮最多一个问号;只说话的不查)', gradeRun(['一节一问'], [{ kid: 'x', section: said(['这是你说的话。', '他们在哪里呀?'], story) }])[0].pass && !gradeRun(['一节一问'], [{ kid: 'x', section: said(['在哪里?', '什么时候?'], story) }])[0].pass && gradeRun(['一节一问'], [{ kid: 'x', section: sec(['在哪里?什么时候?']) }])[0].pass);
  check('判:页上有', gradeRun(['页上有: 浇了水、西瓜'], turns)[0].pass && !gradeRun(['页上有: 先看清'], turns)[0].pass);
  // 放小课堂一段:「看」落在小课堂上(带 at);没落上的看参数是不是时间
  const play = (text: string, n: number) => ({ lines: [{ text, ask: true, acts: Array.from({ length: n }, () => ({ name: '看', arg: '0:19–0:30', do: { k: '看', label: '0:19–0:30', box: [0, 0, 0, 0], at: [19000, 30000] } })) }], cards: [] }) as never;
  check('判:放课里一段、一节最多一段、说到', gradeRun(['放课里一段'], [{ kid: 'x', section: play('你圈的这 3 根?', 1) }])[0].pass && !gradeRun(['放课里一段'], turns)[0].pass && !gradeRun(['一节最多一段'], [{ kid: 'x', section: play('看?', 2) }])[0].pass && gradeRun(['一节最多一段'], [{ kid: 'x', section: play('看?', 1) }])[0].pass && gradeRun(['说到: 圈'], [{ kid: 'x', section: sec(['你圈的这 3 根?']) }])[0].pass);
  const kp = kidPrompt({ story: '小熊种瓜', persona: '问一句答一句' }, turns.slice(0, 2));
  check('模拟孩子的提示词:故事、人设、对话、页上写着的整段', kp.includes('小熊种瓜') && kp.includes('问一句答一句') && kp.includes('孩子:小熊') && kp.includes('页上写着:小熊睡大觉。 / 小熊浇了水。'));
}

// ---- 听写:不是 activity(2026-11-17),在老师的家里 agents/<老师>/听写.md;认字那段和出厂的要求(DICTATION_PROMPT_DEFAULT)拼出来一字不差 ----
{
  const { photoPrompt, photoPromptFrom } = await import('../src/app/dictation/recognize.ts');
  const { DICTATION_PROMPT_DEFAULT, DICTATION_PROMPT_EN_DEFAULT } = await import('../src/schema/index.ts');
  for (const [t, lang, def] of [['chinese-tutor', 'zh', DICTATION_PROMPT_DEFAULT], ['english-tutor', 'en', DICTATION_PROMPT_EN_DEFAULT]] as const) {
    const text = readFileSync(join(PACKAGE_AGENTS_DIR, t, '听写.md'), 'utf8');
    const tool = parseActivity(text).activity.tools.find((x) => x.tool === '认字');
    check(`${t} 的听写:不在 activities/ 下,头上 lang: ${lang}`, !existsSync(join(PACKAGE_AGENTS_DIR, t, 'activities', '听写.md')) && text.includes(`\nlang: ${lang}\n`) && !text.includes('\npage:'));
    check(`${t} 的听写:认字那段填好格式 = 照出厂的要求拼的`, !!tool && photoPromptFrom(tool.prompt, lang) === photoPrompt(def, lang));
  }
  const miss = lintActivity('---\nname: 练\ndescription: x\nbase: photo\n---\n\n## 老师怎么带\n\n你是老师。\n第一句: 好\n收: 好\n\n## 认字收到什么\n\n```认字\n挑词\n```\n', { fileName: '练' });
  check('认字少了 {{格式}}:报', has(miss.issues, '少了 {{格式}}'), JSON.stringify(miss.issues));
}

// ---- 没有老师那节的:要改(activity 都起老师);解析永不抛 ----
{
  const dict = '---\nname: 听写\ndescription: 老师念,孩子写\ncards: \n---\n\n## 家长填的\n\n```参数\n词表: 词表 —— 一行一个\n```\n';
  const r = lintActivity(dict, { fileName: '听写' });
  check('没有老师怎么带:要改', r.issues.filter((i) => i.level === 'fix').length === 1 && r.issues.find((i) => i.level === 'fix')!.level === 'fix' && r.issues.some((i) => i.level === 'fix' && i.text.includes('老师怎么带')) && r.activity.tutor === null && renderTutorSection(r.activity, {}) === null, JSON.stringify(r.issues));
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
    const kantu = readFileSync(join(PACKAGE_AGENTS_DIR, 'chinese-tutor', 'activities', '看图说话.md'), 'utf8');
    const KEY = 'chinese-tutor/看图说话';
    const ITEM = 'agents/chinese-tutor/activities/看图说话.md';
    const up = async (opts?: Parameters<typeof upgradeActivities>[1]) => (await upgradeActivities(root, opts)).find((x) => x.key === KEY)!;
    const steps = await installActivities(root);
    const file = activityFile(root, 'chinese-tutor', '看图说话');
    check('init 拷进老师的家(连例子文件)', steps.length === (await shippedActivities()).length && steps.every((x) => x.action === 'created') && readFileSync(file, 'utf8') === kantu && existsSync(activityFile(root, 'chinese-tutor', '看图说话.例子')), JSON.stringify(steps));
    check('hash 记进 shipped.json 的 activities', (await readManifest(root)).activities?.['chinese-tutor/看图说话']?.hash === sha256(kantu));
    await installTutors(root, []);
    check('老师那边写清单不抹掉 activities', Boolean((await readManifest(root)).activities?.['chinese-tutor/看图说话']));
    check('再 init 不动', (await installActivities(root)).find((x) => x.item === ITEM)!.action === 'exists');

    check('没改过:已是最新', (await up()).action === 'latest');
    const mine = kantu.replace('说话慢,一次只问一个问题', '说话慢,一次只问一件事');
    writeFileSync(file, mine);
    const kept = (await up());
    check('改过的:保留,报 diff', kept.action === 'kept-custom' && readFileSync(file, 'utf8') === mine && Boolean(kept.diff?.some((l) => l.includes('一次只问一件事'))));
    check('改过的再 init 也不动', (await installActivities(root)).find((x) => x.item === ITEM)!.action === 'exists' && readFileSync(file, 'utf8') === mine);
    const m = await readManifest(root);
    m.activities!['chinese-tutor/看图说话'] = { hash: sha256(mine), version: '0.0.1' };
    await writeManifest(root, m);
    check('和记录的出厂 hash 一样(没改过、包更新了):换新', (await up()).action === 'upgraded' && readFileSync(file, 'utf8') === kantu);
    writeFileSync(file, mine);
    const forced = (await up({ force: [KEY] }));
    check('--force 老师/名:覆盖,原文留 .bak', forced.action === 'forced' && readFileSync(file, 'utf8') === kantu && readFileSync(`${file}.bak`, 'utf8') === mine);
    rmSync(file);
    check('删了:upgrade 补上', (await up()).action === 'installed' && existsSync(file));

    const ok = await checkActivities(root, { 'chinese-tutor': {}, 'math-tutor': {}, 'english-tutor': {} });
    check('activity check:workspace 里出厂的都对得上(例子文件不当 activity)', ok.length === (await shippedActivities()).filter((x) => !x.name.endsWith('.例子') && !x.home).length && ok.every((x) => x.issues.length === 0), JSON.stringify(ok.map((x) => x.issues)));
    const orphan = await checkActivities(root, {});
    check('activity check:老师不在 cotutor.json 里报一条', has(orphan[0].issues, '没有 chinese-tutor 这位老师'));
    check('activity check:按老师、按名字筛', (await checkActivities(root, {}, { tutor: 'math-tutor' })).map((x) => x.name).sort().join() === ['小课堂', '预习', '检查作业', '复习', '做练习册'].sort().join() && (await checkActivities(root, {}, { tutor: 'nobody-tutor' })).length === 0 && (await checkActivities(root, {}, { tutor: 'chinese-tutor', name: '别的' })).length === 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

rmSync(home, { recursive: true, force: true });
done();
