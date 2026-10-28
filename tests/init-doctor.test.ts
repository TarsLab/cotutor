/** init 幂等补缺、老师文件是拷贝;doctor 把缺文件、坏配置、坏账本摆到明面。 */
import { statSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
// 包根 skills/:不能静态 import skills.ts(它会带进 workspace.ts,HOME 得先注入再动态 import)
const PACKAGE_SKILLS_DIR = join(import.meta.dirname, '..', 'skills');

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-init-home-')));
process.env.HOME = home;
// 这台电脑配好了百炼(《产品规划.md》拍板 30:没配时 doctor 的 bailian 是红的必需项)
mkdirSync(join(home, '.config', 'cotutor'), { recursive: true });
writeFileSync(join(home, '.config', 'cotutor', 'bailian.json'), JSON.stringify({ apiKey: 'sk-test0000000000000000', workspaceId: 'llm-test' }));
delete process.env.COTUTOR_WORKSPACE;
const originalCwd = process.cwd();

const { initWorkspace } = await import('../src/cli/init.ts');
const { doctorWorkspace } = await import('../src/cli/doctor.ts');
const { PACKAGE_AGENTS_DIR } = await import('../src/cli/skeleton.ts');

try {
  const r1 = await initWorkspace({ slug: 'ming', name: '小明' });
  const ws = join(home, 'cotutor', 'ming');
  check('缺省建在 ~/cotutor/<slug>', r1.root === ws && existsSync(ws), r1.root);
  check('骨架目录齐(.qwen/ 退役,不建)', ['agents', 'ledger', 'conversations', '.claude/agents', 'bundles'].every((d) => existsSync(join(ws, d))) && !existsSync(join(ws, 'scenes')) && !existsSync(join(ws, 'snaps')) && !existsSync(join(ws, '.qwen')));
  check('老师目录齐', ['math-tutor', 'chinese-tutor', 'english-tutor'].every((n) => existsSync(join(ws, 'agents', n, '.gitkeep'))));
  const link = join(ws, '.claude', 'agents', 'math-tutor.md');
  check('老师文件是拷贝,内容同本包', !lstatSync(link).isSymbolicLink() && readFileSync(link, 'utf8') === readFileSync(join(PACKAGE_AGENTS_DIR, 'math-tutor.md'), 'utf8'));
  check('出厂 hash 记下', (JSON.parse(readFileSync(join(ws, '.cotutor', 'shipped.json'), 'utf8')) as { tutors: Record<string, { hash: string }> }).tutors['math-tutor'].hash.startsWith('sha256:'));
  check('产物账本空文件在', existsSync(join(ws, 'ledger', 'artifacts.jsonl')));
  const skillMd = readFileSync(join(ws, '.claude', 'skills', 'cotutor-board', 'SKILL.md'), 'utf8');
  check('板书技能出厂:SKILL.md 有 frontmatter 与语法表、和包里 skills/ 一致,references/ 逐张 + 索引', skillMd.startsWith('---\nname: cotutor-board\ndescription: ') && skillMd.includes('### choice') && existsSync(join(ws, '.claude', 'skills', 'cotutor-board', 'references', 'choice.md')) && readFileSync(join(ws, '.claude', 'skills', 'cotutor-board', 'references', 'README.md'), 'utf8').includes('**choice**') && skillMd === readFileSync(join(PACKAGE_SKILLS_DIR, 'cotutor-board', 'SKILL.md'), 'utf8'));
  const analyzeMd = readFileSync(join(ws, '.claude', 'skills', 'cotutor-analyze', 'SKILL.md'), 'utf8');
  check('analyze 技能出厂(2026-09-15):手写 SKILL.md + 生成的 references/命令与文件.md(命令行从 usage 取、文件名从 conversationFiles 取)', analyzeMd.startsWith('---\nname: cotutor-analyze\ndescription: ') && readFileSync(join(ws, '.claude', 'skills', 'cotutor-analyze', 'references', '命令与文件.md'), 'utf8').includes('cotutor replay <老师> <job>') && readFileSync(join(ws, '.claude', 'skills', 'cotutor-analyze', 'references', '命令与文件.md'), 'utf8').includes('<日期>.<job>.run.json'));
  const tuneRef = readFileSync(join(ws, '.claude', 'skills', 'cotutor-tune', 'references', '字段.md'), 'utf8');
  check('tune 技能出厂(2026-09-15):手写 SKILL.md + 生成的 references/字段.md(tutors 字段与政策缺省从契约取、frontmatter 键从 agent-file 取)', readFileSync(join(ws, '.claude', 'skills', 'cotutor-tune', 'SKILL.md'), 'utf8').startsWith('---\nname: cotutor-tune\ndescription: ') && tuneRef.includes('| `display` | 必需 |') && tuneRef.includes('| `contextPack.entryChars` | 必需 | 4000 |') && tuneRef.includes('`permissionMode`') && tuneRef.includes('cotutor add <老师名>'));
  const vaultMd = readFileSync(join(ws, '.claude', 'skills', 'cotutor-vault', 'SKILL.md'), 'utf8');
  check('vault 技能出厂:手写 SKILL.md + 生成的 references/记账.md,和包里一致', vaultMd.startsWith('---\nname: cotutor-vault\ndescription: ') && vaultMd === readFileSync(join(PACKAGE_SKILLS_DIR, 'cotutor-vault', 'SKILL.md'), 'utf8') && readFileSync(join(ws, '.claude', 'skills', 'cotutor-vault', 'references', '记账.md'), 'utf8').includes('## 字段'));
  check('四个领域 skill 拷进 .claude/skills/,hash 记下', existsSync(join(ws, '.claude', 'skills', 'drawtell-scene', 'SKILL.md')) && existsSync(join(ws, '.claude', 'skills', 'drawtell-teaching', 'models-index.md')) && (JSON.parse(readFileSync(join(ws, '.cotutor', 'shipped.json'), 'utf8')) as { skills: Record<string, { hash: string }> }).skills['drawtell-verify'].hash.startsWith('sha256:'));
  check('出厂主题拷进 themes/default/,hash 记下', existsSync(join(ws, 'themes', 'default', 'theme.json')) && existsSync(join(ws, 'themes', 'default', 'kid.css')) && (JSON.parse(readFileSync(join(ws, '.cotutor', 'shipped.json'), 'utf8')) as { themes: Record<string, { hash: string }> }).themes.default.hash.startsWith('sha256:'));
  check('drawtell 壳脚本在,可执行,指向本包的 drawtell', readFileSync(join(ws, '.cotutor', 'drawtell'), 'utf8').includes('drawtell.js') && (statSync(join(ws, '.cotutor', 'drawtell')).mode & 0o100) !== 0);
  check('没有画图老师(2026-10-07 删了):老师表、运行时、老师文件都没有', !('scene-maker' in (JSON.parse(readFileSync(join(ws, 'cotutor.json'), 'utf8')) as { tutors: Record<string, unknown> }).tutors) && !('claude-scene' in (JSON.parse(readFileSync(join(ws, 'cotutor.json'), 'utf8')) as { runtimes: Record<string, unknown> }).runtimes) && !existsSync(join(ws, '.claude', 'agents', 'scene-maker.md')));
  const cfg = JSON.parse(readFileSync(join(ws, 'cotutor.json'), 'utf8')) as { kid: { slug: string; name?: string } };
  check('cotutor.json 模板带 slug 与名', cfg.kid.slug === 'ming' && cfg.kid.name === '小明');
  {
    const file = join(ws, 'cotutor.json');
    const before = readFileSync(file, 'utf8');
    const legacy = JSON.parse(before);
    legacy.runtimes.old = { run: ['/no/claude', '-p', '{prompt}'], resume: ['/no/claude', '--resume', '{session}', '{prompt}'] };
    legacy.runtimes.default = 'old';
    legacy.proxy = 'http://127.0.0.1:7890';
    writeFileSync(file, JSON.stringify(legacy));
    const retired = await doctorWorkspace(ws, { probeEnv: false, env: {} });
    check('旧配置仍能读;默认运行时退役时点名迁移,不检查旧代理', retired.checks.some((c) => c.name === 'runtime.old' && !c.ok && c.required && c.detail.includes('Claude CLI 已移除')) && !retired.checks.some((c) => c.name === 'proxy'));
    legacy.runtimes.default = 'qwen';
    writeFileSync(file, JSON.stringify(legacy));
    const unused = await doctorWorkspace(ws, { probeEnv: false, env: {} });
    check('闲置的旧运行时只提醒删除,不要求安装 Claude', unused.checks.some((c) => c.name === 'runtime.old' && !c.required));
    legacy.tutors['math-tutor'].runtime = 'old';
    writeFileSync(file, JSON.stringify(legacy));
    const tutor = await doctorWorkspace(ws, { probeEnv: false, env: {} });
    check('老师单独指定了退役运行时也报必需失败', tutor.checks.some((c) => c.name === 'runtime.old' && c.required && !c.ok));
    writeFileSync(file, before);
  }
  check('家规不再出厂(老师要知道的都在老师文件与技能里)', !existsSync(join(ws, 'CLAUDE.md')) && !existsSync(join(ws, 'QWEN.md')));
  check('用户配置指过来', (JSON.parse(readFileSync(join(home, '.config', 'cotutor', 'config.json'), 'utf8')) as { workspace: string }).workspace === ws);
  check('首跑全部 created', r1.steps.every((s) => s.action === 'created'), JSON.stringify(r1.steps.filter((s) => s.action !== 'created')));

  writeFileSync(join(ws, 'QWEN.md'), '# 我家的规矩');
  const r2 = await initWorkspace({ slug: 'ming' });
  check('重跑没有 created', r2.steps.every((s) => s.action !== 'created'), JSON.stringify(r2.steps.filter((s) => s.action === 'created')));
  check('家长自建的家规,init 不动', readFileSync(join(ws, 'QWEN.md'), 'utf8') === '# 我家的规矩');
  unlinkSync(join(ws, 'QWEN.md'));
  writeFileSync(join(ws, '.claude', 'skills', 'cotutor-board', 'references', 'gone.md'), '退役的卡');
  writeFileSync(join(ws, '.claude', 'skills', 'drawtell-cli', 'SKILL.md'), '家长改过');
  const r2b = await initWorkspace({ slug: 'ming' });
  check('机器件重跑按包里覆盖(家长改了也刷);家长的 skill 不动', readFileSync(join(ws, '.claude', 'skills', 'drawtell-cli', 'SKILL.md'), 'utf8') === '家长改过' && !existsSync(join(ws, '.claude', 'skills', 'cotutor-board', 'references', 'gone.md')), JSON.stringify(r2b.steps.filter((s) => s.action === 'replaced')));

  const r3 = await initWorkspace({ slug: 'hong', dir: join(home, 'elsewhere') });
  check('--dir 覆盖缺省位置', r3.root === join(home, 'elsewhere') && existsSync(join(home, 'elsewhere', 'cotutor.json')));
  check('用户配置已指向别处 → kept', r3.steps.find((s) => s.item === 'user-config')?.action === 'kept');

  const d1 = await doctorWorkspace(ws, { probeEnv: false });
  check('健康workspace体检通过', d1.ok, JSON.stringify(d1.checks.filter((c) => c.required && !c.ok)));
  // vault(2026-09-17):档案与入口文件按属性找;init 补的档案模板带 cotutor: profile,学期没填 doctor 提醒
  check('init 补的档案带 cotutor: profile', readFileSync(join(ws, '孩子.md'), 'utf8').startsWith('---\ncotutor: profile\n'));
  const vp = d1.checks.find((c) => c.name === 'vault.profile');
  check('doctor:档案在但算不出学期 → 提醒写 school_start;入口文件先指回档案', vp?.ok === false && vp.fix?.includes('school_start') === true && d1.checks.find((c) => c.name === 'vault.entry.math-tutor')?.fix === '先让档案算得出学期(见 vault.profile)', JSON.stringify(vp));
  writeFileSync(join(ws, '孩子.md'), '---\ncotutor: profile\nsemester: 二年级上\n---\n\n小明\n');
  mkdirSync(join(ws, '课程', '二年级上'), { recursive: true });
  writeFileSync(join(ws, '课程', '二年级上', '数学.md'), '---\ncotutor: subject\nsubject: 数学\nsemester: 二年级上\n---\n\n会凑十\n');
  const dv = await doctorWorkspace(ws, { probeEnv: false });
  const zhEntry = dv.checks.find((c) => c.name === 'vault.entry.chinese-tutor');
  check('doctor:档案齐了;数学有入口文件,语文没有 → 说建哪、写什么属性', dv.checks.find((c) => c.name === 'vault.profile')?.ok === true && dv.checks.find((c) => c.name === 'vault.entry.math-tutor')?.ok === true && zhEntry?.ok === false && zhEntry.fix?.includes('课程/二年级上/语文.md') === true && zhEntry.fix.includes('subject: 语文'), JSON.stringify(zhEntry));
  check('doctor:每个 agent 查记忆文件,还没有不算错、说会建在哪', ['math-tutor', 'chinese-tutor'].every((n) => dv.checks.some((c) => c.name === `vault.memory.${n}` && c.ok)) && dv.checks.find((c) => c.name === 'vault.memory.chinese-tutor')?.detail.includes('记忆/语文老师.md') === true);
  const again = await initWorkspace({ slug: 'ming' });
  check('init 再跑:档案按属性认出来,不再补', again.steps.some((x) => x.item.endsWith('孩子.md') && x.action === 'exists'), JSON.stringify(again.steps.filter((x) => x.item.includes('孩子'))));
  check('doctor 查板书技能(机器件,必需)', d1.checks.some((c) => c.name === 'skill.cotutor-board' && c.ok && c.required));
  check('老师链都查了(三位)', d1.checks.filter((c) => c.name.startsWith('tutor.') && c.name.endsWith('.claude')).length === 3);
  check('doctor 报每位有脸的老师讲哪几种卡', d1.checks.find((c) => c.name === 'tutor.math-tutor.cards')?.detail === '板书写法讲 text choice image lecture canvas code' && d1.checks.find((c) => c.name === 'tutor.english-tutor.cards')?.detail === '板书写法讲 text read choice image word lecture', JSON.stringify(d1.checks.filter((c) => c.name.endsWith('.cards'))));
  {
    // 学科色(拍板 26):手写的颜色白字压不住,doctor 提示;压得住的不说
    const cfgPath = join(ws, 'cotutor.json'), before = readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(before); cfg.tutors['english-tutor'].color = '#d9a520'; cfg.tutors['chinese-tutor'].color = '#a33a2a';
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    const dc = await doctorWorkspace(ws, { probeEnv: false });
    const light = dc.checks.find((c) => c.name === 'tutors.english-tutor.color');
    check('doctor:学科色太浅(黄 2.25)提示、说怎么改;深的不说;不算必需', light?.ok === false && !light.required && light.detail.includes('2.25') && !dc.checks.some((c) => c.name === 'tutors.chinese-tutor.color'), JSON.stringify(light));
    writeFileSync(cfgPath, before);
  }
  {
    // 实时老师的嘴:音色写错(这个模型不认)提示,写对的报谁用什么;都没写也报(用出厂的,《产品规划.md》拍板 30)
    const cfgPath = join(ws, 'cotutor.json'), before = readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(before); cfg.live = { voices: { 'chinese-tutor': 'Serena', 'math-tutor': 'Bella' } };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    const dl = await doctorWorkspace(ws, { probeEnv: false });
    const lv = dl.checks.find((c) => c.name === 'live.voices');
    cfg.live.voices['math-tutor'] = 'Theo Calm';
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    const lv2 = (await doctorWorkspace(ws, { probeEnv: false })).checks.find((c) => c.name === 'live.voices');
    writeFileSync(cfgPath, before);
    const lv0 = d1.checks.find((c) => c.name === 'live.voices');
    check('doctor:嘴的音色写错提示(不认的点名、说去哪换、不算必需);写对了报谁用什么;都没写报出厂的', lv?.ok === false && !lv.required && lv.detail.includes('math-tutor 的「Bella」') && !lv.detail.includes('Serena」') && Boolean(lv.fix) && lv2?.ok === true && lv2.detail.includes('math-tutor 用 Theo Calm') && lv0?.ok === true && lv0.detail.includes('english-tutor 用 Theo Calm') && lv0.detail.includes('math-tutor 用 Andre'), JSON.stringify([lv, lv2, lv0]));
  }
  check('doctor 查主题:清单过契约、出厂件最新', d1.checks.some((c) => c.name === 'theme.manifest' && c.ok) && d1.checks.some((c) => c.name === 'theme.default.origin' && c.ok));
  check('doctor 查 skill 与 drawtell 壳', d1.checks.filter((c) => c.name.startsWith('skill.') && c.ok).length === 10 && d1.checks.some((c) => c.name === 'skill.cotutor-vault' && c.required) && d1.checks.some((c) => c.name === 'skill.cotutor-home' && c.required) && !d1.checks.some((c) => c.name === 'skill.cotutor-prep') && d1.checks.filter((c) => c.name.startsWith('skill.drawtell') && !c.required).length === 4 && d1.checks.some((c) => c.name === 'drawtell' && c.ok && !c.required));
  check('老师文件(.claude/agents/)必需,不管哪个 CLI;不再查 .qwen 链', d1.checks.some((c) => c.name === 'tutor.math-tutor.claude' && c.required) && !d1.checks.some((c) => c.name.endsWith('.qwen')));
  check('git 是建议', d1.checks.some((c) => c.name === 'git' && !c.ok && !c.required));

  unlinkSync(link);
  const d2 = await doctorWorkspace(ws, { probeEnv: false });
  check('文件没了 → 必需失败附 init', !d2.ok && d2.checks.some((c) => c.name === 'tutor.math-tutor.claude' && !c.ok && c.fix?.includes('init')));
  await initWorkspace({ slug: 'ming' });
  check('init 补拷', existsSync(link) && !lstatSync(link).isSymbolicLink());
  // 家长改过的文件:init 不动,doctor 标自定义
  writeFileSync(link, readFileSync(link, 'utf8') + '\n再温柔一点。\n');
  await initWorkspace({ slug: 'ming' });
  check('改过的老师文件 init 不动', readFileSync(link, 'utf8').includes('再温柔一点'));
  check('doctor 标自定义', (await doctorWorkspace(ws, { probeEnv: false })).checks.some((c) => c.name === 'tutor.math-tutor.origin' && c.ok && c.detail.includes('自定义')));

  writeFileSync(join(ws, 'ledger', 'artifacts.jsonl'), '{"id":"a-1","kind":"课包","by":"scene-maker","at":"2026-09-08T16:30","status":"ready"}\n坏行\n');
  const d3 = await doctorWorkspace(ws, { probeEnv: false });
  check('账本坏行 → 必需失败并点名行号', !d3.ok && d3.checks.some((c) => c.name === 'ledger.artifacts' && !c.ok && c.detail.includes('第 2 行')));
  writeFileSync(join(ws, 'ledger', 'artifacts.jsonl'), '');

  writeFileSync(join(ws, 'cotutor.json'), '{ 坏');
  const d4 = await doctorWorkspace(ws, { probeEnv: false });
  check('配置坏 → 必需失败,不死', !d4.ok && d4.checks.some((c) => c.name === 'cotutor.json' && !c.ok && c.required));

  process.chdir(join(ws, 'agents', 'math-tutor'));
  const d5 = await doctorWorkspace(undefined, { probeEnv: false, env: {} });
  check('老师目录里跑 doctor 找到根', d5.root === ws && d5.source === 'cwd', JSON.stringify({ root: d5.root, source: d5.source }));
} finally {
  process.chdir(originalCwd);
  rmSync(home, { recursive: true, force: true });
}
{
  const { configTemplate } = await import('../src/cli/skeleton.ts');
  const tpl = JSON.parse(configTemplate({ slug: 'x', name: 'x', tutors: [] }));
  check('只出厂 Qwen,缺省 qwen', Object.keys(tpl.runtimes).join() === 'default,qwen,qwen-flash' && tpl.runtimes.default === 'qwen');
  for (const name of ['qwen', 'qwen-flash']) {
    const rt = tpl.runtimes[name];
    check(`${name}:流式、stdin、只读工具与系统提示`, rt.stdin === 'stream-json' && ['run', 'resume'].every((k) => rt[k].includes('--include-partial-messages') && rt[k].includes('{toolArgs}') && rt[k].includes('{systemBody}')));
  }
}
// ---- 老 workspace 迁移(步 2):cotutor.json 是政策文件,机器不自动改,所以要算差异 + 只补缺 ----
{
  const { configGaps, insertMissingFlags, upgradeConfig } = await import('../src/cli/migrate.ts');

  // 旗标插的位置照出厂模板:排在它前面、我这份也有的那个旗标之后;已有的旗标与值不碰
  const factory = ['qwen', '-m', 'qwen3.8-max', '--output-format', 'stream-json', '--include-partial-messages', '--max-wall-time', '10m'];
  const mine = ['qwen', '-m', 'qwen3.8-flash', '--output-format', 'stream-json', '--max-wall-time', '5m'];
  const ins = insertMissingFlags(mine, factory);
  check('缺的旗标按出厂位置补,家长的模型与时限不动', ins.argv.join(' ') === 'qwen -m qwen3.8-flash --output-format stream-json --include-partial-messages --max-wall-time 5m' && ins.added.join() === '--include-partial-messages');
  check('已经齐了就没有 added', insertMissingFlags(factory, factory).added.length === 0);

  // 老版的 cotutor.json:还没有英语老师,qwen 模板没有流式旗标
  const home2 = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-migrate-')));
  try {
    const r = await initWorkspace({ slug: 'ming', name: '小明', dir: join(home2, 'ws') });
    const ws = r.root;
    const cfgFile = join(ws, 'cotutor.json');
    const old = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
    delete old.tutors['english-tutor'];
    for (const k of ['run', 'resume'] as const) {
      old.runtimes.qwen[k] = (old.runtimes.qwen[k] as string[]).filter((a) => a !== '--include-partial-messages');
      const model = old.runtimes.qwen[k].indexOf('-m');
      old.runtimes.qwen[k][model + 1] = 'qwen3.8-flash';
    }
    old.policyDefaults = { replyMaxChars: 40 };
    old.runtimes.default = 'qwen';
    old.tutors['chinese-tutor'].enabled = false;
    old._note = '家长自己写的说明';
    writeFileSync(cfgFile, `${JSON.stringify(old, null, 2)}\n`);
    // 那会儿英语老师还不存在:文件、家、出厂记录都没有
    unlinkSync(join(ws, '.claude', 'agents', 'english-tutor.md'));
    rmSync(join(ws, 'agents', 'english-tutor'), { recursive: true, force: true });
    const shipped = JSON.parse(readFileSync(join(ws, '.cotutor', 'shipped.json'), 'utf8')) as { tutors: Record<string, unknown> };
    delete shipped.tutors['english-tutor'];
    writeFileSync(join(ws, '.cotutor', 'shipped.json'), `${JSON.stringify(shipped, null, 2)}\n`);

    const gaps = await configGaps(old);
    check('差异三项:新老师 + run / resume 各一条', gaps.map((g) => g.path).join(' ') === 'tutors.english-tutor runtimes.qwen.run runtimes.qwen.resume', JSON.stringify(gaps.map((g) => g.path)));

    {
      // 卡的清单(2026-10-07)之前的条目:没有 cards → 补出厂的;写过的(哪怕是全部)不动
      const noCards = JSON.parse(JSON.stringify(old)) as Record<string, any>;
      delete noCards.tutors['math-tutor'].cards;
      noCards.tutors['chinese-tutor'].cards = ['text', 'read'];
      const cg = (await configGaps(noCards)).filter((g) => g.kind === 'cards');
      check('没写 cards 的出厂老师 → 补出厂清单;写过的不动', cg.length === 1 && cg[0].path === 'tutors.math-tutor.cards' && (cg[0].value as string[]).join() === 'text,choice,image,lecture,canvas,code', JSON.stringify(cg));
    }
    const d = await doctorWorkspace(ws, { probeEnv: false });
    const cap = d.checks.find((c) => c.name === 'captures');
    check('doctor:captures 还没拍过也绿(第一张时建),不是必需项', cap?.ok === true && cap.required === false && cap.detail.includes('还没有'), JSON.stringify(cap));
    const mig = d.checks.find((c) => c.name === 'config.migrate');
    check('doctor 点名 config.migrate,不是必需项(点名不拦体检)', mig !== undefined && !mig.ok && !mig.required && mig.detail.includes('english-tutor') && (mig.fix ?? '').includes('cotutor upgrade --config'), JSON.stringify(mig));

    const before = readFileSync(cfgFile, 'utf8');
    const dry = await upgradeConfig(ws, { dryRun: true });
    check('--dry-run 列差异但不动文件', dry.gaps.length === 3 && !dry.applied && readFileSync(cfgFile, 'utf8') === before);

    const applied = await upgradeConfig(ws);
    const after = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
    check('补上之后:新老师、旗标都在', applied.applied && after.tutors['english-tutor'].display === '英语老师' && ['run', 'resume'].every((k) => after.runtimes.qwen[k].includes('--include-partial-messages')));
    check('家长写过的一个都没动(每句字数、缺省运行时、关掉的老师、自己加的 --model、_note)', after.policyDefaults.replyMaxChars === 40 && after.runtimes.default === 'qwen' && after.tutors['chinese-tutor'].enabled === false && after.runtimes.qwen.run[after.runtimes.qwen.run.indexOf('-m') + 1] === 'qwen3.8-flash' && after._note === '家长自己写的说明' && after.$schema === old.$schema);
    check('新老师的文件、家跟着补上(不再建 .qwen 链)', existsSync(join(ws, '.claude', 'agents', 'english-tutor.md')) && !existsSync(join(ws, '.qwen', 'agents', 'english-tutor.md')) && existsSync(join(ws, 'agents', 'english-tutor', '.gitkeep')) && applied.installed.length > 0);

    const d2 = await doctorWorkspace(ws, { probeEnv: false });
    check('补完 doctor 的 config.migrate 与英语老师都绿(没配卡的配音音色只是提示)', d2.checks.find((c) => c.name === 'config.migrate')?.ok === true && d2.checks.filter((c) => c.name.startsWith('tutor.english-tutor') && !c.name.endsWith('.voice')).every((c) => c.ok));
    check('再补一次是空操作', (await upgradeConfig(ws)).gaps.length === 0);
  } finally {
    rmSync(home2, { recursive: true, force: true });
  }
}

done();
