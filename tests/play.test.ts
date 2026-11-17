/**
 * 录像的实录(假老师,不花钱):孩子端报上来的一批 → 按钟差校到服务端时刻、落在话题末条 job 的 play.jsonl;
 * 坏的、不再记的(卡的改动、弹窗、翻板书、播放位置,课里的卡 2026-11-17 删了)丢掉;录像接口带上切到后台的一段;删话题一起删。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { FAKE_RUNTIMES, startFakeTeacher } from './_fake-teacher.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-play-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
const teacher = await startFakeTeacher();
process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');

const { root } = await initWorkspace({ slug: 'ray', name: 'Ray' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
cfg.runtimes = { ...FAKE_RUNTIMES };
for (const t of Object.values((cfg as { tutors: Record<string, { runtime?: string }> }).tutors)) delete t.runtime; // 测试都走假老师
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const ctx = createContext(loadWorkspace(root));
// 话题都从 activity 开始(2026-11-16):测试开「聊」
const { chatStart, writeChat } = await import('./_chat.ts');
writeChat(root, ['math-tutor']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wait = async (): Promise<void> => {
  for (let i = 0; i < 400 && ctx.runner.running('math-tutor'); i++) await sleep(25);
};
const dir = join(root, 'conversations', 'math-tutor');
const lines = (f: string): Record<string, unknown>[] => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

try {
  const r1 = await chatStart(ctx, 'math-tutor', { text: '讲讲板书' });
  const job = (r1.json as { job: string }).job;
  const date = (r1.json as { date: string }).date;
  await wait();
  await sleep(50);
  const play = join(dir, `${date}.${job}.play.jsonl`);

  // ---- 孩子端报上来的一批:孩子的钟慢 5 秒 ----
  const kidNow = Date.now() - 5000;
  const res = await route('POST', '/api/kid/conversations/math-tutor/play', ctx, { thread: job, sentAt: kidNow, records: [
    { at: kidNow, k: 'type', e: 'focus' },
    { at: kidNow + 20, k: 'type', e: 'v', v: '三角形' },
    { at: kidNow + 100, k: 'visible', on: false },
    { at: kidNow + 400, k: 'visible', on: true },
    { at: kidNow + 30, k: 'scroll', job, card: 0, dy: 0 },
    { at: kidNow + 30, k: 'stage', job, card: 1, open: true },
    { at: kidNow + 30, k: 'play', job, line: 0, status: 'playing' },
    { at: kidNow + 30, k: 'card', job, card: 1, state: { picked: [0] } },
    { at: kidNow + 30, k: 'eval', job },
    { at: 'x', k: 'visible', on: true },
  ] });
  const got = lines(play);
  check('一批:好的 4 条收下(翻板书、弹窗、卡的改动、播放位置这种不再记的、不认识的、坏的丢掉),落在话题末条 job 的 play.jsonl', res.status === 200 && (res.json as { kept: number }).kept === 4 && got.length === 4, JSON.stringify({ res: res.json, got }));
  const skew = (got[0].at as number) - kidNow;
  check('时刻按两边的钟差校到服务端(孩子的钟慢 5 秒)', skew >= 5000 && skew < 5500 && (got[1].at as number) - (got[0].at as number) === 20, String(skew));
  check('不是今天的话题:一条都不收;形状不对 400', ((await route('POST', '/api/kid/conversations/math-tutor/play', ctx, { thread: '0000-1', sentAt: Date.now(), records: [{ at: Date.now(), k: 'visible', on: true }] })).json as { kept: number }).kept === 0 && (await route('POST', '/api/kid/conversations/math-tutor/play', ctx, { thread: job })).status === 400);

  // ---- 录像接口:切到后台一段、打字一段 ----
  type Rl = { reel: { aways: unknown[]; types: unknown[] } };
  const rl = (await route('GET', `/api/conversations/math-tutor/today/threads/${job}/reel`, ctx)).json as Rl;
  check('录像:切到后台一段、打字一段', rl.reel.aways.length === 1 && rl.reel.types.length === 1, JSON.stringify(rl.reel));
  check('孩子端接口不带实录', !JSON.stringify((await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json).includes('"visible"'));

  // ---- 删话题:实录一起删 ----
  const del = await route('DELETE', `/api/conversations/math-tutor/${date}/threads/${job}`, ctx);
  check('删话题:play.jsonl 一起删', del.status === 200 && !existsSync(play));
} finally {
  await teacher.close();
}

done();
