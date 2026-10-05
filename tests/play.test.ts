/**
 * 录像的实录(《家长录像设计.md》§4、§4.7,假老师,不花钱):孩子端报上来的一批 → 按钟差校到服务端时刻、落在话题末条 job 的 play.jsonl;
 * 坏的、别的话题的、孩子端自己发的卡改动丢掉;孩子存卡服务端自己记一条;录像接口带上弹窗与每一次改动;
 * 「做了」旁注带想了多久、改过几次;孩子端接口不带这些;删话题一起删。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-play-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');

const node = process.execPath;
const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const { root } = await initWorkspace({ slug: 'ray', name: 'Ray' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
cfg.runtimes = { default: 'fake', fake: { run: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '{prompt}'], resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const ctx = createContext(loadWorkspace(root));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wait = async (): Promise<void> => {
  for (let i = 0; i < 400 && ctx.runner.running('math-tutor'); i++) await sleep(25);
};
const dir = join(root, 'conversations', 'math-tutor');
const lines = (f: string): Record<string, unknown>[] => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// 真时钟:老师进程的 startedAt 用的是真钟,弹窗与改卡要落在两轮开口之间。精确的算术在 reel.test 里用固定时刻测
try {
  const r1 = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '讲讲板书' });
  const job = (r1.json as { job: string }).job;
  const date = (r1.json as { date: string }).date;
  await wait();
  await sleep(50);
  const play = join(dir, `${date}.${job}.play.jsonl`);

  // ---- 孩子端报上来的一批:孩子的钟慢 5 秒 ----
  const kidNow = Date.now() - 5000;
  const res = await route('POST', '/api/kid/conversations/math-tutor/play', ctx, { thread: job, sentAt: kidNow, records: [
    { at: kidNow, k: 'play', job, line: 0, status: 'playing' },
    { at: kidNow + 10, k: 'play', job, line: 1, status: 'waiting' },
    { at: kidNow + 20, k: 'stage', job, card: 1, open: true },
    { at: kidNow + 100, k: 'visible', on: false },
    { at: kidNow + 400, k: 'visible', on: true },
    { at: kidNow + 30, k: 'play', job: '9999-9', line: 0, status: 'playing' },
    { at: kidNow + 30, k: 'card', job, card: 1, state: { picked: [0] } },
    { at: kidNow + 30, k: 'eval', job },
    { at: 'x', k: 'visible', on: true },
  ] });
  const got = lines(play);
  check('一批:好的 5 条收下(别的话题的 job、孩子端发的卡改动、不认识的、坏的丢掉),落在话题末条 job 的 play.jsonl', res.status === 200 && (res.json as { kept: number }).kept === 5 && got.length === 5, JSON.stringify({ res: res.json, got }));
  const skew = (got[0].at as number) - kidNow;
  check('时刻按两边的钟差校到服务端(孩子的钟慢 5 秒)', skew >= 5000 && skew < 5500 && (got[2].at as number) - (got[0].at as number) === 20, String(skew));
  check('不是今天的话题:一条都不收;形状不对 400', ((await route('POST', '/api/kid/conversations/math-tutor/play', ctx, { thread: '0000-1', sentAt: Date.now(), records: [{ at: Date.now(), k: 'visible', on: true }] })).json as { kept: number }).kept === 0 && (await route('POST', '/api/kid/conversations/math-tutor/play', ctx, { thread: job })).status === 400);

  // ---- 孩子在弹窗里选了 A 又改 B(服务端存卡时自己记),关弹窗、交给老师 ----
  await sleep(600);
  await route('PUT', `/api/kid/conversations/math-tutor/cards/${job}/1`, ctx, { picked: [0] });
  await sleep(50);
  await route('PUT', `/api/kid/conversations/math-tutor/cards/${job}/1`, ctx, { picked: [1] });
  const cards = lines(play).filter((r) => r.k === 'card');
  check('孩子每存一次卡,服务端记一条(选了 A 又改 B 两条都在)', cards.length === 2 && JSON.stringify(cards.map((c) => c.state)) === '[{"picked":[0]},{"picked":[1]}]', JSON.stringify(cards));
  const openAt = got[2].at as number;
  const think = (cards[0].at as number) - openAt - 300;
  await route('POST', '/api/kid/conversations/math-tutor/play', ctx, { thread: job, sentAt: Date.now(), records: [{ at: Date.now(), k: 'stage', job, card: 1, open: false }] });
  await sleep(50);
  const r2 = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '', action: 'submit', focus: { card: `${job}/1` } });
  const job2 = (r2.json as { job: string }).job;
  await wait();

  // ---- 家长板书页:「做了」带想了多久、改过几次 ----
  type PB = { messages: { job: string; cards?: { card: string; text: string; took?: { think: number | null; changes: number } }[] }[] };
  const pb = (await route('GET', '/api/conversations/math-tutor/today/board', ctx)).json as PB;
  const did = pb.messages.find((m) => m.job === job2)?.cards?.[0];
  check('「做了」带上:弹窗打开到第一次改动、减去切到后台的 300 毫秒;改了两次', did?.card === `${job}/1` && did.took?.think === think && think > 0 && did.took.changes === 2, JSON.stringify({ did, think }));
  check('孩子端接口不带这些', !JSON.stringify((await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json).includes('took'));

  // ---- 录像接口:弹窗一段、两次改动、切到后台一段;第二轮没有记录,不算全程实录 ----
  type Rl = { reel: { stages: { job: string; card: number; from: number; to: number }[]; cards: { state: unknown }[]; aways: unknown[]; precise: boolean; says: { job: string; from: number }[] } };
  const rl = (await route('GET', `/api/conversations/math-tutor/today/threads/${job}/reel`, ctx)).json as Rl;
  check('录像:弹窗开着的一段(开到关)、选了又改两次、切到后台一段、第一节的念句照记录', rl.reel.stages.length === 1 && rl.reel.stages[0].from === openAt && rl.reel.stages[0].to > (cards[1].at as number) && rl.reel.cards.length === 2 && rl.reel.aways.length === 1 && rl.reel.says.filter((x) => x.job === job)[0]?.from === got[0].at, JSON.stringify(rl.reel.stages));
  check('第二轮没有记录:不是全程实录', !rl.reel.precise);

  // ---- 删话题:实录一起删 ----
  const del = await route('DELETE', `/api/conversations/math-tutor/${date}/threads/${job}`, ctx);
  check('删话题:play.jsonl 一起删', del.status === 200 && !existsSync(play));
} finally {
  await ctx.runner.close?.();
}

done();
