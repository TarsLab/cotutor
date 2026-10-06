/**
 * 小课堂全流程(假 CLI,不花钱,《小课堂设计.md》):首页草稿写 `小课堂 <课包 id> <字>` → 检查(课包不在要改)→ 发布 →
 * 孩子端首页的小课堂按钮带课名与课长 → 没看完不能开口(400)→ 看完开口:新话题、上下文包 lecture:(每句起点与原话、看的情况)、
 * 消息记 lecture → 孩子端那一条带小课堂、家长端多看到看的情况。
 * 圈:第一条带两处圈 → 上下文包 marks:(每处一段话)、消息记圈(SVG 时刻、那段话)、孩子端不带那段话、家长端带;
 * 问过以后再看一遍又圈了 → 同一话题下一条带上(again);不是这份课包开头的话题、没带圈、没带话题都 400。
 * 视频来源(第 4 步):lectures/<id>/ 的按钮(课长从 mp4)、坏的 lecture.md 首页检查说清楚;圈带截图(先传进 captures/)→ 上下文包 source: video、
 * photos: 带截图、marks: 说「圈在截图上(photos 第 1 张)」;消息的 photos 不记截图;截图不在 captures/ 400。
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
  const ring = (cx: number, cy: number, rx: number, ry: number): [number, number][] => Array.from({ length: 20 }, (_, k) => [Math.round(cx + rx * Math.cos((k / 20) * 2 * Math.PI)), Math.round(cy + ry * Math.sin((k / 20) * 2 * Math.PI))] as [number, number]);
  const marks = [{ atMs: 26_000, path: ring(334, 120, 45, 50) }, { atMs: 46_000, path: ring(600, 214, 40, 20) }];
  check('圈的形状不对 400:点太少、坐标不是数、多过 12 处', (await send({ text: '问', via, lecture: { ...watch, marks: [{ atMs: 1, path: [[1, 1], [2, 2]] }] } })).status === 400 && (await send({ text: '问', via, lecture: { ...watch, marks: [{ atMs: 1, path: [[1, 'x'], [2, 2], [3, 3]] }] } })).status === 400 && (await send({ text: '问', via, lecture: { ...watch, marks: Array.from({ length: 13 }, () => marks[0]) } })).status === 400);
  const r = await send({ text: '为什么要拆开那一捆', via, lecture: { ...watch, marks } });
  await wait();
  const { job, thread, date } = r.json as { job: string; thread: string; date: string };
  const idx = await readIndex(ctx.ws, 'math-tutor', date);
  const m = idx.messages.find((x) => x.job === job);
  check('看完开口:202、新话题、字是孩子说的、记 via 与 lecture(课名从课包来)', r.status === 202 && thread === job && m?.text === '为什么要拆开那一捆' && m.via?.label === '13 减 8 怎么拆' && m.lecture?.bundle === BUNDLE && m.lecture.title === '13 − 8 破十法' && m.lecture.pauses === 2 && m.lecture.finished, JSON.stringify(m));
  const run = await readRunFile(ctx.ws, 'math-tutor', date, job);
  const prompt = run?.prompt ?? '';
  check('上下文包 lecture:课名、来源、课长、每句起点与原话、看的情况;home: 带讲法', prompt.includes('  lecture:\n    title: "13 − 8 破十法"\n    source: "bundle 2026-09-18-po13-jian-8"\n    length: ') && prompt.includes('      - "0:00 先看 13 减 8。') && prompt.includes('    watched: "看完了,停过 2 次,圈了 2 处"') && prompt.includes('    brief: "他常把 13 当成 1 和 3"') && prompt.includes('---\n为什么要拆开那一捆'), prompt.slice(0, 1600));
  const lines = prompt.split('\n').filter((l) => /^ {6}- "\d+:\d\d /.test(l) && !l.includes(' 圈的,'));
  check('每句一行,六句,起点递增', lines.length === 6, JSON.stringify(lines));
  check('上下文包 marks:每处一段话(时刻、那时在讲哪句、圈住了什么);watched 带圈了几处', prompt.includes('    watched: "看完了,停过 2 次,圈了 2 处"\n    marks:\n      - "0:26 圈的,那时在讲『那就拆开这一捆') && prompt.includes('第 1 步画的 3 条线(旁边写着『3』)') && prompt.includes('      - "0:46 圈的,') && prompt.includes('文字『5』'), prompt.slice(prompt.indexOf('  lecture:'), prompt.indexOf('  lecture:') + 1400));
  check('消息记圈:时刻、SVG 停在哪、路径、那段话', m?.lecture?.marks?.length === 2 && m.lecture.marks[0].atMs === 26_000 && m.lecture.marks[0].svgMs > 1000 && m.lecture.marks[0].path.length === 20 && (m.lecture.marks[0].text ?? '').startsWith('0:26 圈的'), JSON.stringify(m?.lecture?.marks?.[0]).slice(0, 300));
  const kd = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { job: string; lecture?: { bundle: string; title: string } }[] };
  const pb = (await route('GET', '/api/conversations/math-tutor/today/board', ctx)).json as { messages: { job: string; lecture?: unknown; lectureWatch?: { watchedMs: number; pauses: number } }[] };
  const kl = kd.messages.find((x) => x.job === job)?.lecture as { bundle: string; title: string; marks?: { atMs: number; svgMs: number; path: unknown[]; text?: string }[] } | undefined;
  const pl = pb.messages.find((x) => x.job === job) as { lecture?: { marks?: { text?: string }[] } } | undefined;
  check('孩子端那一条带小课堂(课包、课名、圈:时刻 / SVG 时刻 / 路径),不带看的情况、不带那段话', kl?.bundle === BUNDLE && kl.title === '13 − 8 破十法' && kl.marks?.length === 2 && kl.marks[0].svgMs > 0 && kl.marks[0].path.length === 20 && kl.marks.every((k) => !('text' in k)) && !('lectureWatch' in (kd.messages.find((x) => x.job === job) ?? {})), JSON.stringify(kl).slice(0, 300));
  check('家长端多看到看了多久、停过几次,圈带那段话', pb.messages.find((x) => x.job === job)?.lectureWatch?.pauses === 2 && (pl?.lecture?.marks?.[0]?.text ?? '').includes('第 1 步画的 3 条线'));
  const r2 = await send({ text: '还有呢', thread });
  await wait();
  const run2 = await readRunFile(ctx.ws, 'math-tutor', date, (r2.json as { job: string }).job);
  check('同一话题再问:普通的一条,不再带 lecture:', r2.status === 202 && !(run2?.prompt ?? '').includes('  lecture:'));

  // 问过以后再看一遍又圈了:同一话题下一条带上新圈的
  const again = { bundle: BUNDLE, watchedMs: 30_000, finished: false, pauses: 1, marks: [{ atMs: 40_000, path: ring(600, 160, 40, 18) }] };
  check('再看一遍的圈:没带话题 400、话题不是这份课包开头的 400、没带圈 400、课包对不上 400', (await send({ text: '这里', lecture: again })).status === 400 && (await send({ text: '这里', thread: '0800-9', lecture: again })).status === 400 && (await send({ text: '这里', thread, lecture: { ...again, marks: [] } })).status === 400 && (await send({ text: '这里', thread, lecture: { ...again, bundle: '2026-01-01-other' } })).status === 400);
  const r3 = await send({ text: '这里为什么是 2', thread, lecture: again });
  await wait();
  const j3 = (r3.json as { job: string; thread: string }).job;
  const m3 = (await readIndex(ctx.ws, 'math-tutor', date)).messages.find((x) => x.job === j3);
  const p3 = (await readRunFile(ctx.ws, 'math-tutor', date, j3))?.prompt ?? '';
  check('再看一遍的圈:同一话题、记 again 与新圈、上下文包 watched 说又看了一遍、marks 一处', r3.status === 202 && (r3.json as { thread: string }).thread === thread && m3?.lecture?.again === true && m3.lecture.marks?.length === 1 && p3.includes('    watched: "又看了一遍,看到 0:30,停过 1 次,圈了 1 处"') && p3.includes('      - "0:40 圈的,'), p3.slice(p3.indexOf('  lecture:'), p3.indexOf('  lecture:') + 900));

  // ---- 视频来源 ----
  const VID = '2026-10-06-pingjunfen';
  cpSync(fileURLToPath(new URL(`./fixtures/lectures/${VID}/`, import.meta.url)), join(root, 'lectures', VID), { recursive: true });
  mkdirSync(join(root, 'lectures', '2026-01-02-bad'), { recursive: true });
  writeFileSync(join(root, 'lectures', '2026-01-02-bad', 'lecture.md'), '0:05 没有标题\n');
  const vbad = await checkHome(ctx.ws, draft('```tutor math-tutor\n小课堂 2026-01-02-bad 坏的\n```\n\n## 为什么\n\n- 测试\n'), now);
  const vfix = vbad.issues.find((i) => i.level === 'fix')?.text ?? '';
  check('首页检查:视频小课堂坏了说清楚哪里(没有 video.mp4、lecture.md 没标题)', vfix.includes('lectures/2026-01-02-bad/ 没有 video.mp4') && vfix.includes('# 标题'), vfix);
  const vgood = await checkHome(ctx.ws, draft(`\`\`\`tutor math-tutor\n小课堂 ${VID} 平均分怎么分\n\`\`\`\n\n## 为什么\n\n- 测试\n`), now);
  await publishHome(ctx.ws, { now });
  const kh2 = (await route('GET', '/api/kid/home', ctx)).json as { home: string; cards: { kind: string; props: { tutor?: string; buttons?: (Btn & { video?: boolean })[] } }[] };
  const vbtn = kh2.cards.find((c) => c.props.tutor === 'math-tutor')?.props.buttons?.find((b) => b.kind === 'lecture');
  check('视频小课堂:首页检查没有要改;孩子端按钮带课名、课长(mp4 的 18 秒)、video', vgood.fixes === 0 && vbtn?.bundle === VID && vbtn.title === '平均分:一个一个轮着分' && vbtn.ms === 18_000 && vbtn.video === true, JSON.stringify({ issues: vgood.issues, vbtn }));
  const lj = (await route('GET', `/api/kid/lectures/${VID}/lecture.json`, ctx)).json as { total: number; segments: { start: number; line: string }[] };
  const mp4 = await route('GET', `/api/kid/lectures/${VID}/video.mp4`, ctx);
  check('舞台要的:lecture.json(课长、一句一段)与 video.mp4;课包的 id 在这里 404', lj.total === 18_000 && lj.segments.length === 3 && lj.segments[1].start === 5000 && mp4.status === 200 && (mp4 as { file?: string }).file?.endsWith('video.mp4') === true && (await route('GET', `/api/kid/lectures/${BUNDLE}/lecture.json`, ctx)).status === 404);
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await route('POST', '/api/kid/conversations/math-tutor/photos', ctx, { image: PNG });
  const shotPath = (up.json as { path: string }).path;
  const vvia = { home: kh2.home, button: vbtn!.id };
  const vmark = { atMs: 12_600, path: ring(160, 90, 48, 32), image: shotPath };
  check('视频的圈:截图不在 captures/ 400', (await send({ text: '问', via: vvia, lecture: { bundle: VID, watchedMs: 18_000, finished: true, pauses: 1, marks: [{ ...vmark, image: 'captures/nope.jpg' }] } })).status === 400);
  const r4 = await send({ text: '为什么要轮着分', via: vvia, lecture: { bundle: VID, watchedMs: 18_000, finished: true, pauses: 1, marks: [vmark] } });
  await wait();
  const j4 = (r4.json as { job: string }).job;
  const m4 = (await readIndex(ctx.ws, 'math-tutor', date)).messages.find((x) => x.job === j4);
  const p4 = (await readRunFile(ctx.ws, 'math-tutor', date, j4))?.prompt ?? '';
  check('视频的圈:上下文包 source: video、photos: 带截图、marks: 说那时在讲哪句与截图是第几张', r4.status === 202 && p4.includes(`    source: "video ${VID}"`) && p4.includes(`  photos:\n    - "${shotPath}"`) && p4.includes('      - "0:12 圈的,那时在讲『分完了,每人 4 块,一样多。这就是平均分。』;圈在截图上(photos 第 1 张)"'), p4.slice(0, 1500));
  check('消息记 lecture.video 与圈的截图;消息的 photos 不记截图', m4?.lecture?.video === true && m4.lecture.marks?.[0].image === shotPath && !m4.photos, JSON.stringify(m4?.lecture));
  const kd4 = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { job: string; lecture?: { video?: boolean; marks?: { image?: string; text?: string }[] } }[] };
  const kl4 = kd4.messages.find((x) => x.job === j4)?.lecture;
  check('孩子端那一条带 video 与截图路径(圈的卡画这张),不带那段话', kl4?.video === true && kl4.marks?.[0].image === shotPath && !kl4.marks[0].text);
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
