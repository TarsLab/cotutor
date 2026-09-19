/** init 幂等补缺、老师文件是拷贝;doctor 把缺文件、坏配置、坏账本摆到明面。 */
import { statSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
// 包根 skills/:不能静态 import skills.ts(它会带进 workspace.ts,HOME 得先注入再动态 import)
const PACKAGE_SKILLS_DIR = join(import.meta.dirname, '..', 'skills');

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-init-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
const originalCwd = process.cwd();

const { initWorkspace } = await import('../src/cli/init.ts');
const { doctorWorkspace } = await import('../src/cli/doctor.ts');
const { PACKAGE_AGENTS_DIR } = await import('../src/cli/skeleton.ts');

try {
  const r1 = await initWorkspace({ slug: 'ming', name: '小明' });
  const ws = join(home, 'cotutor', 'ming');
  check('缺省建在 ~/cotutor/<slug>', r1.root === ws && existsSync(ws), r1.root);
  check('骨架目录齐', ['agents', 'ledger', 'conversations', '.claude/agents', '.qwen/agents', 'scenes', 'bundles', 'snaps'].every((d) => existsSync(join(ws, d))));
  check('老师目录齐', ['math-tutor', 'chinese-tutor', 'english-tutor', 'scene-maker'].every((n) => existsSync(join(ws, 'agents', n, '.gitkeep'))));
  const link = join(ws, '.claude', 'agents', 'math-tutor.md');
  check('老师文件是拷贝,内容同本包', !lstatSync(link).isSymbolicLink() && readFileSync(link, 'utf8') === readFileSync(join(PACKAGE_AGENTS_DIR, 'math-tutor.md'), 'utf8'));
  check('.qwen 是指向 .claude 的相对链', lstatSync(join(ws, '.qwen', 'agents', 'scene-maker.md')).isSymbolicLink() && readlinkSync(join(ws, '.qwen', 'agents', 'scene-maker.md')) === '../../.claude/agents/scene-maker.md');
  check('出厂 hash 记下', (JSON.parse(readFileSync(join(ws, '.cotutor', 'shipped.json'), 'utf8')) as { tutors: Record<string, { hash: string }> }).tutors['math-tutor'].hash.startsWith('sha256:'));
  check('产物账本空文件在', existsSync(join(ws, 'ledger', 'artifacts.jsonl')));
  const skillMd = readFileSync(join(ws, '.claude', 'skills', 'cotutor-board', 'SKILL.md'), 'utf8');
  check('板书技能出厂:SKILL.md 有 frontmatter 与语法表、和包里 skills/ 一致,references/ 逐张 + 索引,.qwen 相对链', skillMd.startsWith('---\nname: cotutor-board\ndescription: ') && skillMd.includes('### choice') && existsSync(join(ws, '.claude', 'skills', 'cotutor-board', 'references', 'choice.md')) && readFileSync(join(ws, '.claude', 'skills', 'cotutor-board', 'references', 'README.md'), 'utf8').includes('**choice**') && readlinkSync(join(ws, '.qwen', 'skills', 'cotutor-board')) === '../../.claude/skills/cotutor-board' && skillMd === readFileSync(join(PACKAGE_SKILLS_DIR, 'cotutor-board', 'SKILL.md'), 'utf8'));
  const analyzeMd = readFileSync(join(ws, '.claude', 'skills', 'cotutor-analyze', 'SKILL.md'), 'utf8');
  check('analyze 技能出厂(2026-09-15):手写 SKILL.md + 生成的 references/命令与文件.md(命令行从 usage 取、文件名从 conversationFiles 取)', analyzeMd.startsWith('---\nname: cotutor-analyze\ndescription: ') && readFileSync(join(ws, '.claude', 'skills', 'cotutor-analyze', 'references', '命令与文件.md'), 'utf8').includes('cotutor replay <老师> <job>') && readFileSync(join(ws, '.claude', 'skills', 'cotutor-analyze', 'references', '命令与文件.md'), 'utf8').includes('<日期>.<job>.run.json'));
  const tuneRef = readFileSync(join(ws, '.claude', 'skills', 'cotutor-tune', 'references', '字段.md'), 'utf8');
  check('tune 技能出厂(2026-09-15):手写 SKILL.md + 生成的 references/字段.md(tutors 字段与政策缺省从契约取、frontmatter 键从 agent-file 取)', readFileSync(join(ws, '.claude', 'skills', 'cotutor-tune', 'SKILL.md'), 'utf8').startsWith('---\nname: cotutor-tune\ndescription: ') && tuneRef.includes('| `display` | 必需 |') && tuneRef.includes('| `contextPack.entryChars` | 必需 | 4000 |') && tuneRef.includes('`permissionMode`') && tuneRef.includes('cotutor add <老师名>'));
  const vaultMd = readFileSync(join(ws, '.claude', 'skills', 'cotutor-vault', 'SKILL.md'), 'utf8');
  check('vault 技能出厂:手写 SKILL.md + 生成的 references/记账.md,和包里一致,.qwen 相对链', vaultMd.startsWith('---\nname: cotutor-vault\ndescription: ') && vaultMd === readFileSync(join(PACKAGE_SKILLS_DIR, 'cotutor-vault', 'SKILL.md'), 'utf8') && readFileSync(join(ws, '.claude', 'skills', 'cotutor-vault', 'references', '记账.md'), 'utf8').includes('## 字段') && readlinkSync(join(ws, '.qwen', 'skills', 'cotutor-vault')) === '../../.claude/skills/cotutor-vault');
  check('四个领域 skill 拷进 .claude/skills/,.qwen/skills/ 是相对链,hash 记下', existsSync(join(ws, '.claude', 'skills', 'drawtell-scene', 'SKILL.md')) && existsSync(join(ws, '.claude', 'skills', 'drawtell-teaching', 'models-index.md')) && lstatSync(join(ws, '.qwen', 'skills', 'drawtell-cli')).isSymbolicLink() && readlinkSync(join(ws, '.qwen', 'skills', 'drawtell-cli')) === '../../.claude/skills/drawtell-cli' && (JSON.parse(readFileSync(join(ws, '.cotutor', 'shipped.json'), 'utf8')) as { skills: Record<string, { hash: string }> }).skills['drawtell-verify'].hash.startsWith('sha256:'));
  check('出厂主题拷进 themes/default/,hash 记下', existsSync(join(ws, 'themes', 'default', 'theme.json')) && existsSync(join(ws, 'themes', 'default', 'kid.css')) && (JSON.parse(readFileSync(join(ws, '.cotutor', 'shipped.json'), 'utf8')) as { themes: Record<string, { hash: string }> }).themes.default.hash.startsWith('sha256:'));
  check('drawtell 壳脚本在,可执行,指向本包的 drawtell', readFileSync(join(ws, '.cotutor', 'drawtell'), 'utf8').includes('drawtell.js') && (statSync(join(ws, '.cotutor', 'drawtell')).mode & 0o100) !== 0);
  check('scene-maker 在老师表里:hidden、runtime claude-scene;模板有 claude-scene 运行时', (JSON.parse(readFileSync(join(ws, 'cotutor.json'), 'utf8')) as { tutors: Record<string, { hidden?: boolean; runtime?: string }>; runtimes: Record<string, unknown> }).tutors['scene-maker'].runtime === 'claude-scene' && 'claude-scene' in (JSON.parse(readFileSync(join(ws, 'cotutor.json'), 'utf8')) as { runtimes: Record<string, unknown> }).runtimes);
  const cfg = JSON.parse(readFileSync(join(ws, 'cotutor.json'), 'utf8')) as { kid: { slug: string; name?: string } };
  check('cotutor.json 模板带 slug 与名', cfg.kid.slug === 'ming' && cfg.kid.name === '小明');
  check('家规不再出厂(老师要知道的都在老师文件与技能里)', !existsSync(join(ws, 'CLAUDE.md')) && !existsSync(join(ws, 'QWEN.md')));
  check('用户配置指过来', (JSON.parse(readFileSync(join(home, '.config', 'cotutor', 'config.json'), 'utf8')) as { workspace: string }).workspace === ws);
  check('首跑全部 created', r1.steps.every((s) => s.action === 'created'), JSON.stringify(r1.steps.filter((s) => s.action !== 'created')));

  writeFileSync(join(ws, 'CLAUDE.md'), '# 我家的规矩');
  const r2 = await initWorkspace({ slug: 'ming' });
  check('重跑没有 created', r2.steps.every((s) => s.action !== 'created'), JSON.stringify(r2.steps.filter((s) => s.action === 'created')));
  check('家长自建的家规,init 不动', readFileSync(join(ws, 'CLAUDE.md'), 'utf8') === '# 我家的规矩');
  unlinkSync(join(ws, 'CLAUDE.md'));
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
  check('doctor:档案齐了;数学有入口文件,语文没有 → 说建哪、写什么属性;工具人不查', dv.checks.find((c) => c.name === 'vault.profile')?.ok === true && dv.checks.find((c) => c.name === 'vault.entry.math-tutor')?.ok === true && zhEntry?.ok === false && zhEntry.fix?.includes('课程/二年级上/语文.md') === true && zhEntry.fix.includes('subject: 语文') && !dv.checks.some((c) => c.name === 'vault.entry.scene-maker'), JSON.stringify(zhEntry));
  check('doctor:每个 agent 查记忆文件,还没有不算错、说会建在哪', ['math-tutor', 'scene-maker'].every((n) => dv.checks.some((c) => c.name === `vault.memory.${n}` && c.ok)) && dv.checks.find((c) => c.name === 'vault.memory.scene-maker')?.detail.includes('记忆/画图老师.md') === true);
  const again = await initWorkspace({ slug: 'ming' });
  check('init 再跑:档案按属性认出来,不再补', again.steps.some((x) => x.item.endsWith('孩子.md') && x.action === 'exists'), JSON.stringify(again.steps.filter((x) => x.item.includes('孩子'))));
  check('doctor 查板书技能(机器件,必需)', d1.checks.some((c) => c.name === 'skill.cotutor-board' && c.ok && c.required));
  check('老师链都查了(四位:含 scene-maker)', d1.checks.filter((c) => c.name.startsWith('tutor.') && c.name.endsWith('.claude')).length === 4);
  check('doctor 查板书后期的运行时:出厂 claude-fast 在模板里', d1.checks.some((c) => c.name === 'post.runtime.claude-fast' && c.ok && !c.required));
  check('doctor 查主题:清单过契约、出厂件最新', d1.checks.some((c) => c.name === 'theme.manifest' && c.ok) && d1.checks.some((c) => c.name === 'theme.default.origin' && c.ok));
  check('doctor 查 skill 与 drawtell 壳', d1.checks.filter((c) => c.name.startsWith('skill.') && c.ok).length === 10 && d1.checks.some((c) => c.name === 'skill.cotutor-vault' && c.required) && d1.checks.some((c) => c.name === 'skill.cotutor-home' && c.required) && d1.checks.filter((c) => c.name.startsWith('skill.drawtell') && !c.required).length === 4 && d1.checks.some((c) => c.name === 'drawtell' && c.ok && !c.required));
  check('默认运行时是 claude → .claude 链必需、.qwen 链非必需', d1.checks.some((c) => c.name === 'tutor.math-tutor.claude' && c.required) && d1.checks.some((c) => c.name === 'tutor.math-tutor.qwen' && !c.required));
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

  process.chdir(join(ws, 'agents', 'scene-maker'));
  const d5 = await doctorWorkspace(undefined, { probeEnv: false, env: {} });
  check('老师目录里跑 doctor 找到根', d5.root === ws && d5.source === 'cwd', JSON.stringify({ root: d5.root, source: d5.source }));
} finally {
  process.chdir(originalCwd);
  rmSync(home, { recursive: true, force: true });
}
{
  const { configTemplate } = await import('../src/cli/skeleton.ts');
  const tpl = JSON.parse(configTemplate({ slug: 'x', name: 'x', tutors: [] })) as { runtimes: { claude: { run: string[]; resume: string[] }; qwen: { run: string[] } } };
  check('claude 模板带 --include-partial-messages(流式),qwen 没有这个开关', tpl.runtimes.claude.run.includes('--include-partial-messages') && tpl.runtimes.claude.resume.includes('--include-partial-messages') && !tpl.runtimes.qwen.run.includes('--include-partial-messages'));
  const tplS = JSON.parse(configTemplate({ slug: 'x', name: 'x', tutors: [] })) as { runtimes: Record<string, { run: string[] }> };
  check('普通老师的 claude 模板禁掉 Agent(不派子代理);claude-scene 不禁(scene-maker 要派检验)', tplS.runtimes.claude.run.join(' ').includes('--disallowedTools Agent') && !tplS.runtimes['claude-scene'].run.includes('--disallowedTools'));
  {
    const { BOARD_SKILL_FROM_CWD } = await import('../src/cli/skeleton.ts');
    const want = `--append-system-prompt-file ${BOARD_SKILL_FROM_CWD}`;
    const c = tplS.runtimes.claude as { run: string[]; resume?: string[] };
    check('普通老师的 claude 模板把板书技能追加进系统提示(run / resume 一致,缓存前缀才对得上);claude-scene 不带(画图老师不写板书)', c.run.join(' ').includes(want) && (c.resume ?? []).join(' ').includes(want) && !tplS.runtimes['claude-scene'].run.includes('--append-system-prompt-file'));
  }
  const tplR = JSON.parse(configTemplate({ slug: 'x', name: 'x', tutors: [] })) as { runtimes: Record<string, string | { run: string[]; resume: string[] }> };
  const claudeOnes = Object.entries(tplR.runtimes).filter((e): e is [string, { run: string[]; resume: string[] }] => typeof e[1] !== 'string' && e[1].run[0] === 'claude');
  const fast = tplR.runtimes['claude-fast'] as { run: string[] };
  check('claude-fast 不发工具定义 / 技能索引 / claude 的系统提示(--tools "" + --disable-slash-commands + --system-prompt),不再用 --disallowedTools', fast.run.includes('--tools') && fast.run[fast.run.indexOf('--tools') + 1] === '' && fast.run.includes('--disable-slash-commands') && fast.run.includes('--system-prompt') && !fast.run.includes('--disallowedTools'));
  check('claude 的三个模板 run / resume 都带 --setting-sources project(只读 workspace 的 .claude/,用户级技能 / hooks / 额外目录不进老师);qwen 没有', claudeOnes.length === 3 && claudeOnes.every(([, r]) => r.run.join(' ').includes('--setting-sources project') && r.resume.join(' ').includes('--setting-sources project')) && !(tplR.runtimes.qwen as { run: string[] }).run.includes('--setting-sources'));
}
// ---- 老 workspace 迁移(步 2):cotutor.json 是政策文件,机器不自动改,所以要算差异 + 只补缺 ----
{
  const { configGaps, insertMissingFlags, upgradeConfig } = await import('../src/cli/migrate.ts');

  // 旗标插的位置照出厂模板:排在它前面、我这份也有的那个旗标之后;已有的旗标与值不碰
  const factory = ['claude', '--agent', '{agent}', '-p', '{prompt}', '--dangerously-skip-permissions', '--disallowedTools', 'Agent', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--max-budget-usd', '2'];
  const mine = ['claude', '--agent', '{agent}', '-p', '{prompt}', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '5', '--model', 'sonnet'];
  const ins = insertMissingFlags(mine, factory);
  check('缺的旗标插到出厂模板里的位置,家长改过的预算与自己加的 --model 都留着',
    ins.argv.join(' ') === 'claude --agent {agent} -p {prompt} --dangerously-skip-permissions --disallowedTools Agent --output-format stream-json --verbose --include-partial-messages --max-budget-usd 5 --model sonnet' && ins.added.join(' ') === '--disallowedTools Agent --include-partial-messages',
    ins.argv.join(' '));
  check('已经齐了就没有 added', insertMissingFlags(factory, factory).added.length === 0);

  // 2026-09-09 那版的 cotutor.json:五位老师、两个运行时、claude 模板没有那两个旗标
  const home2 = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-migrate-')));
  try {
    const r = await initWorkspace({ slug: 'ming', name: '小明', dir: join(home2, 'ws') });
    const ws = r.root;
    const cfgFile = join(ws, 'cotutor.json');
    const old = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
    delete old.tutors['scene-maker'];
    delete old.runtimes['claude-scene'];
    delete old.runtimes['qwen-scene'];
    for (const k of ['run', 'resume'] as const) {
      old.runtimes.claude[k] = (old.runtimes.claude[k] as string[]).filter((a: string, i: number, arr: string[]) => a !== '--disallowedTools' && a !== '--include-partial-messages' && !(a === 'Agent' && arr[i - 1] === '--disallowedTools'));
      old.runtimes.claude[k].push('--model', 'sonnet');
    }
    old.policyDefaults = { replyMaxChars: 40 };
    old.runtimes.default = 'qwen';
    old.tutors['english-tutor'].enabled = false;
    old._note = '家长自己写的说明';
    writeFileSync(cfgFile, `${JSON.stringify(old, null, 2)}\n`);
    // 那会儿画图老师还不存在:文件、链、家、出厂记录都没有
    unlinkSync(join(ws, '.claude', 'agents', 'scene-maker.md'));
    unlinkSync(join(ws, '.qwen', 'agents', 'scene-maker.md'));
    rmSync(join(ws, 'agents', 'scene-maker'), { recursive: true, force: true });
    const shipped = JSON.parse(readFileSync(join(ws, '.cotutor', 'shipped.json'), 'utf8')) as { tutors: Record<string, unknown> };
    delete shipped.tutors['scene-maker'];
    writeFileSync(join(ws, '.cotutor', 'shipped.json'), `${JSON.stringify(shipped, null, 2)}\n`);

    const gaps = await configGaps(old);
    check('差异五项:新老师 + 两个运行时 + run / resume 各一条', gaps.map((g) => g.path).join(' ') === 'tutors.scene-maker runtimes.claude-scene runtimes.qwen-scene runtimes.claude.run runtimes.claude.resume', JSON.stringify(gaps.map((g) => g.path)));

    const d = await doctorWorkspace(ws, { probeEnv: false });
    const cap = d.checks.find((c) => c.name === 'captures');
    check('doctor:captures 还没拍过也绿(第一张时建),不是必需项', cap?.ok === true && cap.required === false && cap.detail.includes('还没有'), JSON.stringify(cap));
    const mig = d.checks.find((c) => c.name === 'config.migrate');
    check('doctor 点名 config.migrate,不是必需项(点名不拦体检)', mig !== undefined && !mig.ok && !mig.required && mig.detail.includes('scene-maker') && (mig.fix ?? '').includes('cotutor upgrade --config'), JSON.stringify(mig));

    const before = readFileSync(cfgFile, 'utf8');
    const dry = await upgradeConfig(ws, { dryRun: true });
    check('--dry-run 列差异但不动文件', dry.gaps.length === 5 && !dry.applied && readFileSync(cfgFile, 'utf8') === before);

    const applied = await upgradeConfig(ws);
    const after = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
    check('补上之后:新老师、新运行时、旗标都在', applied.applied && after.tutors['scene-maker'].runtime === 'claude-scene' && 'qwen-scene' in after.runtimes && (after.runtimes.claude.run as string[]).join(' ').includes('--disallowedTools Agent') && (after.runtimes.claude.resume as string[]).includes('--include-partial-messages'));
    check('家长写过的一个都没动(每句字数、缺省运行时、关掉的老师、自己加的 --model、_note)', after.policyDefaults.replyMaxChars === 40 && after.runtimes.default === 'qwen' && after.tutors['english-tutor'].enabled === false && (after.runtimes.claude.run as string[]).slice(-2).join(' ') === '--model sonnet' && after._note === '家长自己写的说明' && after.$schema === old.$schema);
    check('新老师的文件、.qwen 链、家跟着补上', existsSync(join(ws, '.claude', 'agents', 'scene-maker.md')) && lstatSync(join(ws, '.qwen', 'agents', 'scene-maker.md')).isSymbolicLink() && existsSync(join(ws, 'agents', 'scene-maker', '.gitkeep')) && applied.installed.length > 0);

    const d2 = await doctorWorkspace(ws, { probeEnv: false });
    check('补完 doctor 的 config.migrate 与 scene-maker 都绿', d2.checks.find((c) => c.name === 'config.migrate')?.ok === true && d2.checks.filter((c) => c.name.startsWith('tutor.scene-maker')).every((c) => c.ok));
    check('再补一次是空操作', (await upgradeConfig(ws)).gaps.length === 0);
  } finally {
    rmSync(home2, { recursive: true, force: true });
  }
}

done();
