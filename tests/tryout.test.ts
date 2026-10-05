/**
 * 试用(《备课设计.md》§十二,假 CLI,不花钱):课文件页「试用」建试用话题 → 孩子端 ?try= 只看到它 → 家长扮孩子开口:
 * 消息记 from parent、老师拿到孩子的上下文包(lesson: / lessonFile: / lessonBrief:)、不写记忆、不算上限、不记账、孩子端看不到 →
 * 交给孩子不受影响 → 第二天清掉(消息、文件、照片、claude 会话),钱不减。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-tryout-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route, sweepDaily } = await import('../src/server/app.ts');
const { readIndex, readRunFile } = await import('../src/server/store.ts');
const { sweepTryouts } = await import('../src/server/tryout.ts');

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const FAKE_TTS = fileURLToPath(new URL('./_fake-tts.ts', import.meta.url));
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
mkdirSync(join(root, 'lessons'), { recursive: true });
writeFileSync(join(root, 'lessons', '分披萨.md'), `---
tutor: math-tutor
---

我们来分一个披萨。

\`\`\`choice
一个披萨平均分给 2 个人,每人几块?
- [x] 一半
- [ ] 一整个
\`\`\`

一个披萨平均分给 2 个人,每人分到多少?

## 讲法

他分不清「平均」,先让他自己说怎么分。
`);
const projects = join(home, 'claude-projects');
mkdirSync(join(projects, '-ws-agents-math-tutor'), { recursive: true });

let now = new Date(2026, 9, 2, 19, 0);
const day = '2026-10-02';
const ctx = createContext(loadWorkspace(root), { now: () => now, claudeProjects: projects });
const wait = async (tutor: string): Promise<void> => {
  for (let i = 0; i < 200 && ctx.runner.running(tutor); i++) await new Promise((r) => setTimeout(r, 25));
};
const convDir = join(root, 'conversations', 'math-tutor');
type KidDay = { messages: { job: string; thread: string; question: string | null; lessonSection?: number }[]; thread: string | null; remaining: number };
const kidToday = async (q = ''): Promise<{ status: number; json: KidDay }> => {
  const r = await route('GET', `/api/kid/conversations/math-tutor/today${q}`, ctx);
  return { status: r.status, json: r.json as KidDay };
};

try {
  const full = (await kidToday()).json.remaining;
  const tr = await route('POST', '/api/lessons/分披萨/try', ctx, {});
  const tj = tr.json as { ok: boolean; tutor: string; thread: string; url: string };
  const th = tj.thread;
  const i0 = await readIndex(ctx.ws, 'math-tutor', day);
  const first = i0.messages.find((m) => m.job === th);
  check('试用:200、给孩子端的地址;话题第一条带 tryThread 与 prepThread、记 from parent 与 lessonSection;lessons 记文件、不记 handedAt', tr.status === 200 && tj.ok && tj.url === `/?try=math-tutor/${th}` && first?.tryThread === true && first.prepThread === true && first.from === 'parent' && first.lessonSection === 0 && i0.lessons[th]?.source === 'lessons/分披萨.md' && i0.lessons[th]?.handedAt === null, JSON.stringify({ tj, first, l: i0.lessons }));
  const home0 = JSON.stringify((await route('GET', '/api/kid/home', ctx)).json);
  check('首页没多按钮', !home0.includes(th), home0);

  const plain = await kidToday();
  const hist = JSON.stringify((await route('GET', '/api/kid/conversations/math-tutor/history', ctx)).json);
  check('孩子端:今天的里没有它、当前话题不是它、以前的也不列', !plain.json.messages.some((m) => m.thread === th) && plain.json.thread !== th && !hist.includes(th), JSON.stringify(plain.json));
  const tried = await kidToday(`?thread=${th}&try=${th}`);
  check('试用页 ?try=:只有这个话题、带 lessonSection(一节一节念)、当前话题是它、不算上限', tried.status === 200 && tried.json.messages.length === 1 && tried.json.messages[0].lessonSection === 0 && tried.json.messages[0].question === null && tried.json.thread === th && tried.json.remaining === full, JSON.stringify(tried.json));
  check('?try= 不是试用话题 404', (await kidToday('?try=1800-9')).status === 404);

  const page = (await route('GET', '/api/lessons/分披萨/page', ctx)).json as { handed: unknown; fromThread: string | null };
  const ov = (await route('GET', '/api/overview/today', ctx)).json as { tutors: { name: string; threads: { thread: string; tryout: boolean; prep: boolean }[]; lessons: { name: string; handedAs: string | null; fromThread: string | null }[] }[] };
  const mt = ov.tutors.find((t) => t.name === 'math-tutor')!;
  const board = (await route('GET', '/api/conversations/math-tutor/today/board', ctx)).json as { messages: { thread: string; tryout?: true }[]; lessons: Record<string, unknown> };
  check('家长端:课文件页不算交过、不算从它写出来;清单上这个话题标试用;板书里每条带 tryout、底部「这节课」没有它', page.handed === null && page.fromThread === null && mt.threads.find((x) => x.thread === th)?.tryout === true && mt.lessons.find((l) => l.name === '分披萨')?.handedAs === null && mt.lessons.find((l) => l.name === '分披萨')?.fromThread === null && board.messages.filter((m) => m.thread === th).every((m) => m.tryout) && !(th in board.lessons), JSON.stringify({ page, mt }));

  check('孩子端(不带 try)发不进试用话题', (await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: 'x', thread: th })).status === 400);
  check('try 指的不是试用话题 404', (await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: 'x', try: '1800-9' })).status === 404);

  // 家长扮孩子开口:带上念课时攒的话与一张照片
  const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0xff, 0xd9]).toString('base64');
  const photo = ((await route('POST', '/api/kid/conversations/math-tutor/photos', ctx, { image: JPEG })).json as { path: string }).path;
  const s1 = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '记住它 我选一半', try: th, photos: [photo], lessonSaid: [{ section: 1, text: '分两块' }] });
  await wait('math-tutor');
  const i1 = await readIndex(ctx.ws, 'math-tutor', day);
  const m1 = i1.messages[i1.messages.length - 1];
  const run1 = await readRunFile(ctx.ws, 'math-tutor', day, m1.job);
  const memDir = join(root, 'vault', '记忆');
  check('家长扮孩子:202、同一话题、记 from parent;老师拿到孩子的上下文包(from: kid、lesson:、lessonFile:、lessonBrief:、lessonSaid:)', s1.status === 202 && m1.thread === th && m1.from === 'parent' && m1.result === 'ok' && run1?.prompt.includes('  from: kid') === true && run1.prompt.includes('  lesson:') && run1.prompt.includes('lessonFile:') && run1.prompt.includes('lessonBrief: "他分不清「平均」') && run1.prompt.includes('第 1 节后:分两块'), run1?.prompt.slice(0, 1500));
  check('不写记忆:没有 remembered、老师想记的在 memoryDraft、vault 里没有记忆文件', !m1.remembered?.length && (m1.memoryDraft?.length ?? 0) > 0 && (!existsSync(memDir) || readdirSync(memDir).length === 0), JSON.stringify(m1));
  const after1 = await kidToday();
  const tried1 = await kidToday(`?try=${th}`);
  check('不算上限、孩子端照样看不到;试用页上家长说的是问句', after1.json.remaining === full && !after1.json.messages.some((m) => m.thread === th) && tried1.json.messages.some((m) => m.question === '记住它 我选一半'), JSON.stringify(tried1.json.messages));

  const s2 = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '那三个人呢', try: th });
  await wait('math-tutor');
  const run2 = await readRunFile(ctx.ws, 'math-tutor', day, (s2.json as { job: string }).job);
  check('接着说:resume 同一会话、不再带 lesson:', s2.status === 202 && run2?.resume === true && !run2.prompt.includes('  lesson:') && run2.prompt.includes('  from: kid'), run2?.prompt.slice(0, 800));

  const bk = (await route('POST', `/api/conversations/math-tutor/${day}/bookkeep`, ctx, { threads: [th] })).json as { queued: string[]; skipped: { why: string }[] };
  check('记账不起试用话题', bk.queued.length === 0 && bk.skipped[0]?.why.includes('试用'), JSON.stringify(bk));
  const handFromTry = await route('POST', `/api/conversations/math-tutor/${day}/threads/${th}/lesson/hand`, ctx, { label: '试用的' });
  check('试用话题不能从板书页交给孩子(409)', handFromTry.status === 409 && (handFromTry.json as { error: string }).error === 'tryout', JSON.stringify(handFromTry.json));
  const pSend = await route('POST', '/api/conversations/math-tutor/messages', ctx, { text: '工作台随便问' });
  await wait('math-tutor');
  check('不指定话题的家长消息不落进试用话题', pSend.status === 202 && (pSend.json as { thread: string }).thread !== th, JSON.stringify(pSend.json));
  const hand = await route('POST', '/api/lessons/分披萨/hand', ctx, { label: '分披萨' });
  const hj = hand.json as { handed: boolean; thread: string };
  const i3 = await readIndex(ctx.ws, 'math-tutor', day);
  check('同一份课文件交给孩子:新话题,试用话题原样还在', hand.status === 200 && hj.handed && hj.thread !== th && i3.messages.some((m) => m.thread === th) && i3.lessons[hj.thread]?.handedAt !== null, JSON.stringify(hj));

  // 老师块的试用(try: 'new'):没备课,第一句开一个新的试用话题;老师拿孩子的上下文包、不带 lesson:;孩子端看不到
  const b1 = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '记住它 三加五等于几', try: 'new', newThread: true });
  await wait('math-tutor');
  const bj = b1.json as { job: string; thread: string };
  const ib = await readIndex(ctx.ws, 'math-tutor', day);
  const bm = ib.messages.find((m) => m.job === bj.job);
  const runB = await readRunFile(ctx.ws, 'math-tutor', day, bj.job);
  check('老师块的试用:新话题、第一条带 tryThread 与 prepThread、记 from parent;上下文包 from: kid、没有 lesson:;不写记忆', b1.status === 202 && bj.thread === bj.job && bm?.tryThread === true && bm.prepThread === true && bm.from === 'parent' && runB?.prompt.includes('  from: kid') === true && !runB.prompt.includes('  lesson:') && !bm.remembered?.length && (bm.memoryDraft?.length ?? 0) > 0, JSON.stringify(bm));
  const b2 = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '八', try: bj.thread });
  await wait('math-tutor');
  const runB2 = await readRunFile(ctx.ws, 'math-tutor', day, (b2.json as { job: string }).job);
  const kb = await kidToday(`?try=${bj.thread}`);
  check('接着说进同一个试用话题、resume;试用页上两句都是问句;孩子端照样看不到', (b2.json as { thread: string }).thread === bj.thread && runB2?.resume === true && kb.json.messages.filter((m) => m.question).length === 2 && !(await kidToday()).json.messages.some((m) => m.thread === bj.thread), JSON.stringify(kb.json.messages.map((m) => m.question)));

  // 配了音色:试用接口配完音才回(试用时听到的是老师的声,不是浏览器的)
  {
    const cfgNow = JSON.parse(readFileSync(cfgFile, 'utf8')) as { tts?: unknown; tutors: Record<string, Record<string, unknown>> };
    cfgNow.tts = { say: [node, '--experimental-strip-types', '--no-warnings', FAKE_TTS, '{text}', '--voice', '{voice}', '--json', '-o', '{out}'], voices: [node, '--experimental-strip-types', '--no-warnings', FAKE_TTS, 'voices', '--json'] };
    cfgNow.tutors['math-tutor'].voice = 'v-math';
    writeFileSync(cfgFile, JSON.stringify(cfgNow, null, 2));
    await ctx.reload();
    const tv = await route('POST', '/api/lessons/分披萨/try', ctx, {});
    const tvj = tv.json as { thread: string; dubbed: boolean; lines: number };
    const iv = await readIndex(ctx.ws, 'math-tutor', day);
    const lines = iv.messages.filter((m) => m.thread === tvj.thread).flatMap((m) => m.section?.lines ?? []).filter((l) => l.text.trim());
    check('配了音色的试用:回的时候已经配好(dubbed),索引里每句都有 mp3', tv.status === 200 && tvj.dubbed === true && lines.length === tvj.lines && lines.length > 0 && lines.every((l) => l.audio), JSON.stringify({ tvj, lines }));
  }

  // 当天不清;第二天清:消息、文件、照片、claude 会话没了;别的话题与钱不动
  check('当天不清', (await sweepTryouts(ctx.ws, now, { claudeProjects: projects })).length === 0);
  const tryJobs = i3.messages.filter((m) => m.thread === th).map((m) => m.job);
  const sid = i3.sessions[th]?.id ?? '';
  writeFileSync(join(projects, '-ws-agents-math-tutor', `${sid}.jsonl`), '{}\n');
  const costBefore = (await readIndex(ctx.ws, 'math-tutor', day)).costUsd;
  const filesBefore = readdirSync(convDir).filter((f) => tryJobs.some((j) => f.startsWith(`${day}.${j}.`))).length;
  now = new Date(2026, 9, 3, 8, 0);
  await route('GET', '/api/overview/today', ctx);
  const i4 = await readIndex(ctx.ws, 'math-tutor', day);
  const left = readdirSync(convDir).filter((f) => tryJobs.some((j) => f.startsWith(`${day}.${j}.`)));
  check('第二天打开清单就清掉:索引没有这个话题与它的会话、lessons;这几轮的文件没了;别的话题在;钱不减', filesBefore > 0 && !i4.messages.some((m) => m.thread === th) && !(th in i4.sessions) && !(th in i4.lessons) && left.length === 0 && i4.messages.some((m) => m.thread === hj.thread) && i4.costUsd === costBefore, JSON.stringify({ left, cost: [costBefore, i4.costUsd] }));
  check('老师块的试用话题也清掉了', !i4.messages.some((m) => m.thread === bj.thread));
  check('照片与 claude 会话文件没了', sid !== '' && !existsSync(join(root, photo)) && !existsSync(join(projects, '-ws-agents-math-tutor', `${sid}.jsonl`)), JSON.stringify({ photo, sid }));
  check('一天只扫一次', (await sweepDaily(ctx)).length === 0);
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
