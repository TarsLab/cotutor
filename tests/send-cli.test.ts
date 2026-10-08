/**
 * cotutor send(假 CLI,不花钱):--photo 拷进 captures/、随消息进上下文包 photos:;有照片时消息可以空;不认的、太大的拒;不预热。
 */
import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-send-cli-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { readIndex, readRunFile } = await import('../src/server/store.ts');
const { createContext } = await import('../src/server/app.ts');
const { localDate } = await import('../src/lib/conversation.ts');
const { main } = await import('../src/cli/main.ts');

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const node = process.execPath;
const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
cfg.runtimes = {
  default: 'fake',
  fake: { run: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '{prompt}'], resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] },
};
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

async function run(argv: string[]): Promise<{ out: string; code: number; err: string }> {
  const w = process.stdout.write;
  const e = process.stderr.write;
  let out = '';
  let err = '';
  process.stdout.write = ((c: string) => ((out += c), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string) => ((err += c), true)) as typeof process.stderr.write;
  process.exitCode = 0;
  try {
    await main([...argv, '--workspace', root]);
  } finally {
    process.stdout.write = w;
    process.stderr.write = e;
  }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { out, code, err };
}

const png = join(home, 'page.png');
writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
const date = localDate(new Date());

{
  const r = await run(['send', 'chinese-tutor', '--photo', png, '--new', '--quiet']);
  check('只带照片也能发', r.code === 0, r.out + r.err);
  const ws = loadWorkspace(root);
  const idx = await readIndex(ws, 'chinese-tutor', date);
  const m = idx?.messages.find((x) => x.from === 'kid');
  check('消息的 photos 是 captures/ 里的一张,字是「(拍了一张)」', m?.photos?.length === 1 && m.photos[0].startsWith('captures/') && m.photos[0].endsWith('.png') && m.text === '(拍了一张)', JSON.stringify(m));
  const shot = readdirSync(join(root, 'captures', date));
  check('照片原样拷进 captures/<日期>/', shot.length === 1 && readFileSync(join(root, 'captures', date, shot[0])).equals(readFileSync(png)));
  const runFile = m ? await readRunFile(ws, 'chinese-tutor', date, m.job) : null;
  check('上下文包带 photos: 与 photoFiles:', JSON.stringify(runFile).includes(m?.photos?.[0] ?? '?') && JSON.stringify(runFile).includes(join(root, m?.photos?.[0] ?? '?')));
}

{
  const r = await run(['send', 'chinese-tutor', '--photo', join(home, 'a.gif')]);
  check('不认 gif', r.code !== 0 && /只认 jpg \/ png/.test(r.out + r.err), r.out + r.err);
  const big = join(home, 'big.jpg');
  writeFileSync(big, Buffer.alloc(3_100_000));
  const r2 = await run(['send', 'chinese-tutor', '--photo', big]);
  check('太大的拒,说怎么缩', r2.code !== 0 && /太大/.test(r2.out + r2.err) && /sips/.test(r2.out + r2.err), r2.out + r2.err);
  const r3 = await run(['send', 'chinese-tutor']);
  check('没话也没照片要报用法', r3.code !== 0 && /send 需要老师名和消息/.test(r3.out + r3.err));
}

{
  // send 用 warm: false:跑完不留备用老师进程,不然进程挂到 WARM_IDLE_MS 才退
  const ctx = createContext(loadWorkspace(root), { warm: false });
  check('warm: false 不预热', (await ctx.runner.prewarm('chinese-tutor')) === false && !ctx.runner.spares.has('chinese-tutor'));
}

done();
