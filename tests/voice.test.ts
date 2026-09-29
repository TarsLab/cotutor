/**
 * 按住说话的原声(《家长录像设计.md》拍板 4,假老师,不花钱):孩子发消息带 {audio: data:audio/…, seconds} → 落 <日期>.<job>.voice.<ext>、消息记 voice;
 * 家长接口给、孩子接口与上下文包不给;/api/audio 能放;形状不对、太大就当没带,字照发;录像里原声排在发出去之前、开口的点挪到按下那一刻;删话题一起删。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-voice-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { readIndex, readRunFile } = await import('../src/server/store.ts');

const node = process.execPath;
const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const { root } = await initWorkspace({ slug: 'ray', name: 'Ray' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
cfg.runtimes = { default: 'fake', fake: { run: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '{prompt}'], resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] } };
cfg.policyDefaults = { post: { runtime: 'none' } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const now = new Date('2026-09-29T20:41:00');
const ctx = createContext(loadWorkspace(root), { now: () => now });
const wait = async (): Promise<void> => {
  for (let i = 0; i < 400 && ctx.runner.running('english-tutor'); i++) await new Promise((r) => setTimeout(r, 25));
};
const dir = join(root, 'conversations', 'english-tutor');
const audio = (tag: string, mime = 'audio/webm;codecs=opus') => `data:${mime};base64,` + Buffer.from(tag).toString('base64');
const send = (body: unknown) => route('POST', '/api/kid/conversations/english-tutor/messages', ctx, body);

try {
  const r1 = await send({ text: 'Apple苹', voice: { audio: audio('APPLE'), seconds: 2.34 } });
  check('带原声发:202', r1.status === 202, JSON.stringify(r1.json));
  const job = (r1.json as { job: string }).job;
  await wait();
  const idx = await readIndex(ctx.ws, 'english-tutor', '2026-09-29');
  const m = idx.messages.find((x) => x.job === job)!;
  check('落成 <日期>.<job>.voice.webm,消息记 voice(路径相对老师目录、秒数一位小数)', m.voice?.audio === `2026-09-29.${job}.voice.webm` && m.voice.seconds === 2.3 && readFileSync(join(dir, m.voice.audio), 'utf8') === 'APPLE', JSON.stringify(m.voice));
  const run = await readRunFile(ctx.ws, 'english-tutor', '2026-09-29', job);
  check('老师看不到原声:上下文包里没有 voice 的路径', run !== null && !JSON.stringify(run).includes('.voice.'), '');
  const kid = JSON.stringify((await route('GET', '/api/kid/conversations/english-tutor/today', ctx)).json);
  check('孩子接口不给原声', !kid.includes('voice'), kid.slice(0, 300));
  type PB = { messages: { job: string; voice?: { audio: string; seconds: number } }[] };
  const pb = (await route('GET', '/api/conversations/english-tutor/today/board', ctx)).json as PB;
  check('家长接口给原声', pb.messages.find((x) => x.job === job)?.voice?.audio === m.voice?.audio);
  const au = await route('GET', `/api/audio/english-tutor/${m.voice!.audio}`, ctx);
  check('/api/audio 能放原声(audio/webm);别的名字照旧 404', au.status === 200 && au.contentType === 'audio/webm' && (await route('GET', `/api/audio/english-tutor/2026-09-29.${job}.voice.exe`, ctx)).status === 404);

  // Safari 录的是 mp4 → .m4a;坏的、太大的当没带,字照发
  const r2 = await send({ text: '老师香蕉的英语怎么读', voice: { audio: audio('BANANA', 'audio/mp4'), seconds: 3 } });
  await wait();
  const j2 = (r2.json as { job: string }).job;
  const r3 = await send({ text: '不带秒数', voice: { audio: audio('X') } });
  await wait();
  const r4 = await send({ text: '不是声音', voice: { audio: 'data:image/png;base64,AAAA', seconds: 1 } });
  await wait();
  const r5 = await send({ text: '太大', voice: { audio: 'data:audio/webm;base64,' + 'A'.repeat(4_000_001), seconds: 1 } });
  await wait();
  const idx2 = await readIndex(ctx.ws, 'english-tutor', '2026-09-29');
  const by = (j: unknown) => idx2.messages.find((x) => x.job === (j as { job: string }).job);
  check('mp4 落成 .m4a', by(r2.json)?.voice?.audio === `2026-09-29.${j2}.voice.m4a` && existsSync(join(dir, `2026-09-29.${j2}.voice.m4a`)));
  check('原声形状不对 / 不是声音 / 太大:消息照发(202),只是没有 voice', [r3, r4, r5].every((r) => r.status === 202) && [r3, r4, r5].every((r) => by(r.json) && !by(r.json)!.voice), JSON.stringify([r3.status, r4.status, r5.status]));

  // 录像:原声排在发出去之前 seconds 秒,开口的点挪到按下那一刻,字幕要的「认成」字在 clip 上
  type Reel = { reel: { clips: { kind: string; job: string; from: number; to: number; audio: string; text?: string }[]; marks: { kind: string; at: number; job: string }[] } };
  const rl = (await route('GET', `/api/conversations/english-tutor/today/threads/${job}/reel`, ctx)).json as Reel;
  const v1 = rl.reel.clips.find((c) => c.job === job);
  const said1 = rl.reel.marks.find((x) => x.kind === 'said' && x.job === job);
  check('录像:原声一段,长 2.3 秒、到发出去那一刻为止,认成的字带着;开口的点在按下那一刻', v1?.kind === 'voice' && v1.to - v1.from === 2300 && v1.text === 'Apple苹' && v1.audio === m.voice?.audio && said1?.at === v1.from, JSON.stringify({ v1, said1 }));

  // 删话题:原声跟着这轮的文件一起删
  const del = await route('DELETE', `/api/conversations/english-tutor/2026-09-29/threads/${job}`, ctx);
  check('删话题:原声一起删', del.status === 200 && !existsSync(join(dir, m.voice!.audio)), JSON.stringify(del.json));
} finally {
  await ctx.runner.close?.();
}

done();
