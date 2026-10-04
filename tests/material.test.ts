/**
 * 素材(《备课设计.md》§十一):parseMaterial 读定本(tests/fixtures/materials/pingjunfen/material.md)与几种写坏的;
 * 临时 workspace 里 checkMaterial / listMaterials / materialsFor(段数对 mp4、老师、上下文包那几行的挑法与顺序)与 CLI。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-material-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { parseMaterial, materialIssues, materialLine } = await import('../src/lib/material.ts');
const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { checkMaterial, listMaterials, materialsFor, MATERIALS_IN_PACK } = await import('../src/server/material.ts');
const { main } = await import('../src/cli/main.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { readRunFile } = await import('../src/server/store.ts');
const { yamlScalar } = await import('../src/lib/context-pack.ts');
const { handLessonFile, checkLesson } = await import('../src/server/lesson.ts');

const FIXTURE = fileURLToPath(new URL('./fixtures/materials/pingjunfen', import.meta.url));
const md = readFileSync(join(FIXTURE, 'material.md'), 'utf8');
const tutors = { 'math-tutor': { display: '数学老师', enabled: true, hidden: false }, 'scene-maker': { display: '画图老师', enabled: true, hidden: true } };

// ---- 解析定本
{
  const d = parseMaterial(md);
  check('定本:老师、clips、标题、能讲三条、不能讲三条、三段(几秒、停在)、没有问题', d.tutor === 'math-tutor' && d.media === 'clips' && d.title === '平均分:分的人越多,每人越少' && d.can.length === 3 && d.cannot.length === 3 && d.segments.length === 3 && d.segments.every((s) => s.seconds === 7 && s.stop?.includes('站在塔边')) && d.segments[0].stop!.startsWith('两座塔各 9 块高') && d.issues.length === 0, JSON.stringify(d));
  check('给人看的注释不当正文:标题不是注释里的字、行号照原文', !d.can.some((x) => x.includes('figshot')) && d.segments[0].line === md.split('\n').findIndex((l) => l.startsWith('1. 分给 2 个人')) + 1);
  check('上下文包那一行:id · 标题 · 能讲第一条', materialLine('pingjunfen', d) === 'pingjunfen · 平均分:分的人越多,每人越少 · 能讲:平均分:一个一个轮着分,每人分到的一样多。');
  check('三个 mp4 对上:没有问题', materialIssues(d, { tutors, clips: [1, 2, 3] }).length === 0);
  const off = materialIssues(d, { tutors, clips: [1, 3, 4] });
  check('缺 2.mp4、多 4.mp4:各一条要改', off.filter((i) => i.level === 'fix').length === 2 && off.some((i) => i.text.includes('缺 2.mp4')) && off.some((i) => i.text.includes('多了 4.mp4')), JSON.stringify(off));
  check('老师不在 / 是工具人:要改', materialIssues(parseMaterial(md.replace('tutor: math-tutor', 'tutor: art-tutor')), { tutors, clips: [1, 2, 3] }).some((i) => i.level === 'fix' && i.text.includes('没有这位老师')) && materialIssues(parseMaterial(md.replace('tutor: math-tutor', 'tutor: scene-maker')), { tutors, clips: [1, 2, 3] }).some((i) => i.level === 'fix' && i.text.includes('工具人')));
}

// ---- 定本只有一份:cotutor-prep 的 references/素材.md 里「一份完整的」就是这个文件(技能教 Claude Code 照它写)
{
  const ref = readFileSync(fileURLToPath(new URL('../skills/cotutor-prep/references/素材.md', import.meta.url)), 'utf8');
  const shown = /\n````markdown\n([\s\S]*?)\n````\n/.exec(ref)?.[1];
  check('references/素材.md 的例子 = 定本 material.md(一字不差)', shown === md.replace(/\n$/, ''), shown?.slice(0, 80));
}

// ---- 写坏的
{
  const bare = parseMaterial('# 只有标题\n');
  const fixes = bare.issues.filter((i) => i.level === 'fix').map((i) => i.text);
  check('只有标题:没 tutor、没能讲、没段,三条要改;没不能讲是提醒', fixes.length === 3 && fixes.some((t) => t.includes('tutor')) && fixes.some((t) => t.includes('能讲')) && fixes.some((t) => t.includes('一段一段')) && bare.issues.some((i) => i.level === 'note' && i.text.includes('不能讲')), JSON.stringify(bare.issues));
  const skip = parseMaterial('---\ntutor: math-tutor\n---\n# 跳号\n能讲:一件事\n不能讲:别的\n\n## 一段一段\n\n1. 第一段\n   - 停在:那样\n3. 第三段\n');
  check('段号接不上要改;没写停在是提醒;能讲写在冒号后面也算', skip.segments.length === 2 && skip.issues.some((i) => i.level === 'fix' && i.text.includes('应该是 2')) && skip.issues.some((i) => i.level === 'note' && i.text.includes('第 2 段没写「停在')) && skip.can.join() === '一件事', JSON.stringify(skip.issues));
  const media = parseMaterial('---\ntutor: math-tutor\nmedia: gif\ncolor: red\n---\n# x\n');
  check('media 不认识要改;别的键是提醒', media.issues.some((i) => i.level === 'fix' && i.text.includes('media: gif')) && media.issues.some((i) => i.level === 'note' && i.text.includes('color')));
  const b = parseMaterial('---\ntutor: math-tutor\nmedia: bundle\n---\n# x\n');
  check('media: bundle 没写 bundle: 要改;bundle 三期才放得出来(提醒)', b.issues.some((i) => i.level === 'fix' && i.text.includes('bundle: <课包 id>')) && materialIssues(b, { tutors, clips: [] }).some((i) => i.level === 'note' && i.text.includes('三期')));
  check('永不抛:空串、乱码', parseMaterial('').issues.length > 0 && Array.isArray(parseMaterial('---\n\u0000\n```\n## 一段一段\n1.\n').segments));
}

// ---- 读盘:检查、清单、上下文包那几行、CLI
try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ws = loadWorkspace(root);
  const put = (id: string, text: string | null, clips: number[], mtime?: Date): void => {
    const dir = join(ws.dirs.materials, id);
    mkdirSync(dir, { recursive: true });
    if (text !== null) writeFileSync(join(dir, 'material.md'), text);
    for (const n of clips) writeFileSync(join(dir, `${n}.mp4`), 'x');
    if (mtime && text !== null) utimesSync(join(dir, 'material.md'), mtime, mtime);
  };
  cpSync(FIXTURE, join(ws.dirs.materials, 'pingjunfen'), { recursive: true });
  for (const n of [1, 2, 3]) writeFileSync(join(ws.dirs.materials, 'pingjunfen', `${n}.mp4`), 'x');
  utimesSync(join(ws.dirs.materials, 'pingjunfen', 'material.md'), new Date(2026, 9, 1), new Date(2026, 9, 1));
  const one = (title: string, tutor = 'math-tutor') => `---\ntutor: ${tutor}\n---\n# ${title}\n能讲:${title}的道理\n不能讲:别的\n\n## 一段一段\n\n1. 一段\n   - 停在:那样\n`;
  put('xiangyu', one('相遇'), [1], new Date(2026, 9, 2));
  put('qiang', one('墙'), [], new Date(2026, 9, 3));
  put('ci', one('词', 'english-tutor'), [1], new Date(2026, 9, 3));
  put('nofile', null, [1, 2]);
  mkdirSync(join(ws.dirs.materials, 'Bad_Name'), { recursive: true });

  const c = await checkMaterial(ws, 'pingjunfen');
  check('checkMaterial:定本加三个 mp4 没有问题;source 是相对路径', c?.fixes === 0 && c.issues.length === 0 && c.clips.join() === '1,2,3' && c.source === 'materials/pingjunfen/material.md', JSON.stringify(c?.issues));
  const nf = await checkMaterial(ws, 'nofile');
  check('没有 material.md:要改、mtime null;目录不在 / id 不合规 → null', nf?.fixes === 1 && nf.mtime === null && (await checkMaterial(ws, 'nope')) === null && (await checkMaterial(ws, '../x')) === null);
  const list = await listMaterials(ws);
  check('清单:合规的目录各一份、按 id 排;Bad_Name 不认', list.map((x) => x.id).join() === 'ci,nofile,pingjunfen,qiang,xiangyu', list.map((x) => x.id).join());
  const lines = await materialsFor(ws, 'math-tutor');
  check('上下文包:只要这位老师的、有要改的不要(墙缺 mp4)、新的在前', lines.length === 2 && lines[0].startsWith('xiangyu · 相遇') && lines[1].startsWith('pingjunfen · '), JSON.stringify(lines));
  check('课文件列了的排前面', (await materialsFor(ws, 'math-tutor', ['pingjunfen']))[0].startsWith('pingjunfen'));
  for (let k = 0; k < MATERIALS_IN_PACK + 3; k++) put(`m${k}`, one(`第${k}个`), [1], new Date(2026, 9, 4, 0, k));
  const many = await materialsFor(ws, 'math-tutor', ['pingjunfen']);
  check(`最多 ${MATERIALS_IN_PACK} 行;列了的那份还在`, many.length === MATERIALS_IN_PACK && many[0].startsWith('pingjunfen') && many[1].startsWith(`m${MATERIALS_IN_PACK + 2} `), JSON.stringify(many.slice(0, 3)));

  const run = async (argv: string[]): Promise<{ out: string; code: number }> => {
    const w = process.stdout.write;
    let out = '';
    process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
    process.exitCode = 0;
    try { await main([...argv, '--workspace', root]); } finally { process.stdout.write = w; }
    const code = Number(process.exitCode ?? 0);
    process.exitCode = 0;
    return { out, code };
  };
  const ok = await run(['material', 'check', 'pingjunfen']);
  const bad = await run(['material', 'check', 'qiang']);
  const ls = await run(['material', 'list']);
  check('cotutor material check:没问题 exit 0、列三段与上下文包那一行;缺 mp4 exit 1', ok.code === 0 && ok.out.includes('第 3 段:分给 6 个人') && ok.out.includes('上下文包里是:pingjunfen') && bad.code === 1 && bad.out.includes('缺 1.mp4'), ok.out + bad.out);
  check('cotutor material list:每份一行,要改的标出来', ls.out.includes('pingjunfen  math-tutor') && ls.out.includes('qiang') && ls.out.includes('✗ 1 条要改'), ls.out);

  // ---- 接进老师(假 CLI):新会话的第一条带 materials: 与 materialsDir;老师回素材卡 → 孩子端下发带快照;孩子看到第 2 段 → 下一条 cards: 里说
  const cfgFile = join(root, 'cotutor.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
  const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
  const node = process.execPath;
  cfg.runtimes = { default: 'fake', fake: { run: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '{prompt}'], resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] } };
  cfg.policyDefaults = { post: { mode: 'off' } };
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  // 只留平均分一份给数学老师(m0…、xiangyu 删掉,免得挤掉它)
  for (const d of ['xiangyu', ...Array.from({ length: MATERIALS_IN_PACK + 3 }, (_, k) => `m${k}`)]) rmSync(join(ws.dirs.materials, d), { recursive: true, force: true });
  const now = new Date(2026, 9, 2, 19, 0);
  const ctx = createContext(loadWorkspace(root), { now: () => now });
  const wait = async (): Promise<void> => { for (let i = 0; i < 200 && ctx.runner.running('math-tutor'); i++) await new Promise((r) => setTimeout(r, 25)); };
  const s1 = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '放素材 我分好了', newThread: true });
  await wait();
  const job1 = (s1.json as { job: string }).job;
  const run1 = await readRunFile(ctx.ws, 'math-tutor', '2026-10-02', job1);
  check('新会话的第一条:上下文包有 materials:(这位老师的那份)与 materialsDir(绝对路径)', run1?.prompt.includes(`  materials:\n    - ${yamlScalar('pingjunfen · 平均分:分的人越多,每人越少 · 能讲:平均分:一个一个轮着分,每人分到的一样多。')}\n  materialsDir: ${yamlScalar(ctx.ws.dirs.materials)}\n`) === true, run1?.prompt.slice(0, 1200));
  const kid = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { job: string; section?: { cards: { kind: string; props: Record<string, unknown> }[]; lines: { cues: { name: string; arg?: string }[] }[] } }[] };
  const card = kid.messages.find((m) => m.job === job1)?.section?.cards[0];
  check('老师回的素材卡:孩子端下发带快照(标题、3 段、ready);讲稿的 [[play 2]] 解析成 cue', card?.kind === 'material' && card.props.id === 'pingjunfen' && card.props.ready === true && card.props.segments === 3 && card.props.title === '平均分:分的人越多,每人越少' && kid.messages.find((m) => m.job === job1)?.section?.lines.some((l) => l.cues.some((c) => c.name === 'play' && c.arg === '2')) === true, JSON.stringify(card));
  const put1 = await route('PUT', `/api/kid/conversations/math-tutor/cards/${job1}/0`, ctx, { segment: 2, done: false });
  const s2 = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '一样高', thread: job1 });
  await wait();
  const run2 = await readRunFile(ctx.ws, 'math-tutor', '2026-10-02', (s2.json as { job: string }).job);
  check('孩子看到第 2 段 → 下一条 cards: 里说;接着聊的会话不再带 materials:', put1.status === 200 && run2?.prompt.includes('material') === true && run2.prompt.includes('看到第 2 段') && !run2.prompt.includes('  materials:'), run2?.prompt.slice(0, 900));
  const eng = await route('POST', '/api/kid/conversations/english-tutor/messages', ctx, { text: '你好', newThread: true });
  for (let i = 0; i < 200 && ctx.runner.running('english-tutor'); i++) await new Promise((r) => setTimeout(r, 25));
  const runE = await readRunFile(ctx.ws, 'english-tutor', '2026-10-02', (eng.json as { job: string }).job);
  check('别的老师只拿自己的(英语老师的那份「词」)', runE?.prompt.includes(`  materials:\n    - ${yamlScalar('ci · 词 · 能讲:词的道理')}\n`) === true, runE?.prompt.slice(0, 900));

  // ---- 课文件尾巴「## 素材」(§11.4):列了的排在 materials: 最前面,哪怕有更新的;check 认得出不在的
  put('xin', one('新的'), [1], new Date(2026, 9, 5));
  mkdirSync(join(root, 'lessons'), { recursive: true });
  const lessonMd = '---\ntutor: math-tutor\n---\n\n```choice\n18 个分给 3 人,每人几个?\n- [x] 6\n- [ ] 9\n```\n\n每人几个?\n\n## 素材\n\n- pingjunfen\n\n## 讲法\n\n先让他说怎么分的。\n';
  writeFileSync(join(root, 'lessons', '分贴纸.md'), lessonMd);
  check('课文件 check:列的素材在 → 没有要改;写个不在的 → 要改', (await checkLesson(ctx.ws, lessonMd, now)).fixes === 0 && (await checkLesson(ctx.ws, lessonMd.replace('- pingjunfen', '- nope'), now)).issues.some((i) => i.level === 'fix' && i.text.includes('nope')));
  const lp = (await route('GET', '/api/lessons/分贴纸/page', ctx)).json as { materials: { id: string; title: string | null; ok: boolean; why: string | null }[]; brief: string };
  check('课文件页接口:materials 带标题、放得出来;讲法里没有素材那段', JSON.stringify(lp.materials) === JSON.stringify([{ id: 'pingjunfen', title: '平均分:分的人越多,每人越少', ok: true, why: null }]) && !lp.brief.includes('pingjunfen'), JSON.stringify(lp.materials));
  const hand = await handLessonFile(ctx.ws, '分贴纸', { label: '分贴纸', now });
  await hand.dubbing;
  const s3 = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '每人 6 个', thread: hand.thread });
  await wait();
  const run3 = await readRunFile(ctx.ws, 'math-tutor', '2026-10-02', (s3.json as { job: string }).job);
  const mats = run3?.prompt.split('\n  materials:\n')[1]?.split('\n').filter((l) => l.startsWith('    - ')) ?? [];
  check('交出去的课,孩子第一次开口:materials: 第一行是课文件列的 pingjunfen,更新的 xin 排后面;讲法里没有素材那段', mats[0]?.includes('pingjunfen') === true && mats.some((l) => l.includes('xin')) && run3?.prompt.includes('lessonBrief: "先让他说怎么分的。"') === true, JSON.stringify(mats));
} finally {
  rmSync(home, { recursive: true, force: true });
}
// 家长手写多半是全角冒号:「能讲：」「停在：」照样认
{
  const fw = parseMaterial('---\ntutor: math-tutor\n---\n# 全角\n能讲：一件事\n不能讲：别的\n\n## 一段一段\n\n1. 一段,5 秒。\n   - 停在：那样\n');
  check('material.md 认全角冒号', fw.can.join() === '一件事' && fw.cannot.join() === '别的' && fw.segments[0]?.stop === '那样' && fw.issues.length === 0, JSON.stringify(fw.issues));
}

done();
