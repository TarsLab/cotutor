/** cotutor.json 契约:模板可解析、缺省与政策合并、错误即修复指南、预设占位填充。 */
import { CotutorConfigSchema, explainIssues, fillPreset, listTeachers, resolvePolicy } from '../src/schema/index.ts';
import { configTemplate, shippedAgents } from '../src/cli/skeleton.ts';
import { check, done } from './_check.ts';

const agents = await shippedAgents();
check('本包带 5 位老师', agents.length === 5, agents.map((a) => a.name).join(','));

const raw = JSON.parse(configTemplate({ slug: 'ming', name: '小明', port: 5181, teachers: agents }));
const cfg = CotutorConfigSchema.parse(raw);
check('模板可解析', cfg.kid.slug === 'ming' && cfg.title === '小明的书房' && cfg.server.port === 5181);
check('老师表齐', Object.keys(cfg.teachers).length === 5 && cfg.teachers.planner.hidden === true);
check('enabled 缺省 true', cfg.teachers['math-teacher'].enabled === true);
check('预设 claude/qwen 都在', 'claude' in cfg.agents && 'qwen' in cfg.agents && cfg.agents.default === 'claude');

const pol = resolvePolicy(cfg, 'math-teacher');
check('政策缺省 60/30/3/关/10/10', pol.replyMaxChars === 60 && pol.dailyMessages === 30 && pol.dailyRegen === 3 && pol.reviewGate === false && pol.contextPack.recent === 10 && pol.contextPack.planLines === 10);

const layered = CotutorConfigSchema.parse({
  ...raw,
  policyDefaults: { replyMaxChars: 80, contextPack: { recent: 3 } },
  teachers: { ...raw.teachers, 'math-teacher': { ...raw.teachers['math-teacher'], policy: { reviewGate: true, forms: ['L1'] } } },
});
const p2 = resolvePolicy(layered, 'math-teacher');
check('政策逐层覆盖', p2.replyMaxChars === 80 && p2.contextPack.recent === 3 && p2.contextPack.planLines === 10 && p2.reviewGate === true && p2.forms.join() === 'L1');
check('别的老师不受影响', resolvePolicy(layered, 'planner').reviewGate === false && resolvePolicy(layered, 'planner').replyMaxChars === 80);

const kidOnly = listTeachers(cfg, { kidOnly: true });
check('孩子端不见 hidden', kidOnly.length === 4 && !kidOnly.some((t) => t.name === 'planner'));
check('列表带有效政策', listTeachers(cfg)[0].policy.replyMaxChars === 60);

const bad = CotutorConfigSchema.safeParse({ version: 2, kid: { slug: 'Bad Slug' }, teachers: { x: { display: '' } }, agents: { default: 'nope' } });
check('坏配置不过', !bad.success);
const lines = bad.success ? [] : explainIssues(bad.error.issues);
check('指南点名 version', lines.some((l) => l.startsWith('version:')), lines.join(' | '));
check('指南点名 slug 格式', lines.some((l) => l.startsWith('kid.slug:')), lines.join(' | '));
check('指南点名空 display', lines.some((l) => l.startsWith('teachers.x.display:') && l.includes('不能为空')), lines.join(' | '));
const bad2 = CotutorConfigSchema.safeParse({ ...raw, agents: { default: 'nope', claude: raw.agents.claude } });
check('预设 default 不存在 → 指南', !bad2.success && explainIssues(bad2.error.issues).some((l) => l.includes('agents.default') && l.includes('nope')));

const filled = fillPreset(cfg.agents.claude.resume, { agent: 'math-teacher', prompt: 'hi', session: 's-1' });
check('占位填充', filled.includes('math-teacher') && filled.includes('s-1') && filled.includes('hi') && !filled.some((a) => a.includes('{')));
const q = fillPreset(cfg.agents.qwen.run, { agent: 'x', prompt: 'p' });
check('没给 agentBody 就原样留着(doctor 会报)', q.includes('{agentBody}'));

done();
