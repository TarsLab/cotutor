/**
 * 小课堂全流程(假 CLI,不花钱,《小课堂设计.md》):首页草稿写 `小课堂 <课包 id> <字>` → 检查(课包不在要改)→ 发布 →
 * 孩子端首页的小课堂按钮带课名与课长 → 没看完不能开口(400)→ 看完开口:新话题、上下文包 lecture:(每句起点与原话、看的情况)、
 * 消息记 lecture → 孩子端那一条带小课堂、家长端多看到看的情况。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-lecture-flow-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { readIndex, readRunFile } = await import('../src/server/store.ts');
const { checkHome, publishHome } = await import('../src/server/home.ts');

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const BUNDLE = '2026-09-18-po13-jian-8';
const node = process.execPath;
const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
cfg.runtimes = { default: 'fake', fake: { run: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '{prompt}'], resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
cpSync(fileURLToPath(new URL(`./fixtures/bundles/${BUNDLE}/`, import.meta.url)), join(root, 'bundles', BUNDLE), { recursive: true });

const now = new Date(2026, 9, 6, 19, 0);
const ctx = createContext(loadWorkspace(root), { now: () => now });
const wait = async (): Promise<void> => { for (let i = 0; i < 200 && ctx.runner.running('math-tutor'); i++) await new Promise((r) => setTimeout(r, 25)); };
const draft = (md: string): string => { mkdirSync(join(root, 'home'), { recursive: true }); writeFileSync(join(root, 'home', 'draft.md'), md); return md; };
const send = (body: unknown) => route('POST', '/api/kid/conversations/math-tutor/messages', ctx, body);

try {
  const bad = await checkHome(ctx.ws, draft('```tutor math-tutor\n小课堂 2026-01-01-nope 不在的课\n```\n\n## 为什么\n\n- 测试\n'), now);
  check('首页检查:小课堂的课包不在 → 要改', bad.issues.some((i) => i.level === 'fix' && i.text.includes('bundles/2026-01-01-nope/')), JSON.stringify(bad.issues));
  const good = await checkHome(ctx.ws, draft(`\`\`\`tutor math-tutor\n小课堂 ${BUNDLE} 13 减 8 怎么拆\n讲法: 他常把 13 当成 1 和 3\n\`\`\`\n\n## 为什么\n\n- 测试\n`), now);
  check('课包在、科目对得上:没有要改的', good.fixes === 0 && !good.issues.some((i) => i.text.includes('课包')), JSON.stringify(good.issues));
  const pub = await publishHome(ctx.ws, { now });
  type Btn = { id: string | number; kind: string; label: string; bundle?: string; title?: string; ms?: number; brief?: string };
  const kh = (await route('GET', '/api/kid/home', ctx)).json as { home: string; cards: { kind: string; props: { tutor?: string; buttons?: Btn[] } }[] };
  const btn = kh.cards.find((c) => c.props.tutor === 'math-tutor')?.props.buttons?.find((b) => b.kind === 'lecture');
  check('孩子端首页:小课堂按钮带课包、课名、课长;讲法不下发', pub.ok && btn?.bundle === BUNDLE && btn.title === '13 − 8 破十法' && (btn.ms ?? 0) > 40_000 && btn.label === '13 减 8 怎么拆' && !JSON.stringify(kh).includes('当成 1 和 3'), JSON.stringify(btn));

  const via = { home: kh.home, button: btn!.id };
  const watch = { bundle: BUNDLE, watchedMs: 47_000, finished: true, pauses: 2 };
  check('按小课堂按钮开口:没带看的情况 400;没看完 400;课包对不上 400;不是小课堂按钮却带了 400', (await send({ text: '问', via })).status === 400 && (await send({ text: '问', via, lecture: { ...watch, finished: false } })).status === 400 && (await send({ text: '问', via, lecture: { ...watch, bundle: 'other-one' } })).status === 400 && (await send({ text: '问', via: { home: kh.home, button: 'new' }, lecture: watch })).status === 400 && (await send({ text: '问', via, lecture: { bundle: BUNDLE } })).status === 400);
  const r = await send({ text: '为什么要拆开那一捆', via, lecture: watch });
  await wait();
  const { job, thread, date } = r.json as { job: string; thread: string; date: string };
  const idx = await readIndex(ctx.ws, 'math-tutor', date);
  const m = idx.messages.find((x) => x.job === job);
  check('看完开口:202、新话题、字是孩子说的、记 via 与 lecture(课名从课包来)', r.status === 202 && thread === job && m?.text === '为什么要拆开那一捆' && m.via?.label === '13 减 8 怎么拆' && m.lecture?.bundle === BUNDLE && m.lecture.title === '13 − 8 破十法' && m.lecture.pauses === 2 && m.lecture.finished, JSON.stringify(m));
  const run = await readRunFile(ctx.ws, 'math-tutor', date, job);
  const prompt = run?.prompt ?? '';
  check('上下文包 lecture:课名、来源、课长、每句起点与原话、看的情况;home: 带讲法', prompt.includes('  lecture:\n    title: "13 − 8 破十法"\n    source: "bundle 2026-09-18-po13-jian-8"\n    length: ') && prompt.includes('      - "0:00 先看 13 减 8。') && prompt.includes('    watched: "看完了,停过 2 次"') && prompt.includes('    brief: "他常把 13 当成 1 和 3"') && prompt.includes('---\n为什么要拆开那一捆'), prompt.slice(0, 1600));
  const lines = prompt.split('\n').filter((l) => /^ {6}- "\d+:\d\d /.test(l));
  check('每句一行,六句,起点递增', lines.length === 6, JSON.stringify(lines));
  const kd = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { job: string; lecture?: { bundle: string; title: string } }[] };
  const pb = (await route('GET', '/api/conversations/math-tutor/today/board', ctx)).json as { messages: { job: string; lecture?: unknown; lectureWatch?: { watchedMs: number; pauses: number } }[] };
  check('孩子端那一条带小课堂(课包、课名),不带看的情况;家长端多看到看了多久、停过几次', JSON.stringify(kd.messages.find((x) => x.job === job)?.lecture) === JSON.stringify({ bundle: BUNDLE, title: '13 − 8 破十法' }) && pb.messages.find((x) => x.job === job)?.lectureWatch?.pauses === 2 && !('lectureWatch' in (kd.messages.find((x) => x.job === job) ?? {})));
  const r2 = await send({ text: '还有呢', thread });
  await wait();
  const run2 = await readRunFile(ctx.ws, 'math-tutor', date, (r2.json as { job: string }).job);
  check('同一话题再问:普通的一条,不再带 lecture:', r2.status === 202 && !(run2?.prompt ?? '').includes('  lecture:'));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
