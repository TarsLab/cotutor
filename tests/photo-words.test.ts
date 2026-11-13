/**
 * 照片板的「点字」服务端那一半:孩子在写了「认字收到什么」的 activity 里发照片 → 后台认出字词与框、流式落在照片旁边 → 孩子端轮询 /api/kid/photo-words。
 * 看图的请求是假的(一行一段 JSON 吐回来),老师是假老师。不花钱、不联网。板上怎么点在 tests/chalk-kit.test.ts。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { kidSend } from './_kid-send.ts';
import { FAKE_RUNTIMES, startFakeTeacher } from './_fake-teacher.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-photo-words-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { startWords, readWords, kidWords, wordsFile } = await import('../src/scenes/photo-words/store.ts');
const { recognizeWith, photoPromptFrom, FORMAT, FORMAT_BOXED } = await import('../src/scenes/photo-words/recognize.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
type Look = import('../src/scenes/look.ts').Look;

const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const LINES = [
  '{"lesson": "我是什么"}',
  '{"text": "变", "kind": "char", "pick": true, "box": [237, 233, 281, 267], "sure": true, "say": "变,变化的变"}',
  '{"text": "海洋", "kind": "word", "pick": true, "box": [203, 836, 300, 857], "sure": true, "say": "海洋,蓝色的海洋"}',
  '{"text": "晒", "kind": "read", "pick": false, "box": [323, 102, 360, 125], "sure": true, "say": "晒,晒太阳"}',
  '{"text": "没框", "kind": "word", "pick": true, "sure": true, "say": "没框"}',
  '{"full": "我会变。太阳一晒, 我就变成汽。升", "box": [216, 202, 912, 228]}',
  '{"full": "没给框的一行"}',
];
/** 假的看图:记下收到的提示词,一行一行吐;gate 给了就等它放行(看流式落盘) */
const asked: string[] = [];
const fakeLook = (gate?: Promise<void>): Look => async (o) => {
  asked.push(o.prompt);
  o.onDelta?.(`${LINES[0]}\n${LINES[1]}\n`);
  if (gate) await gate;
  o.onDelta?.(`${LINES.slice(2).join('\n')}\n`);
  return { ok: true, text: LINES.join('\n'), ms: 5 };
};

// ---- 存取:流式落盘、认过不再认、没认成记下、丢了的重认 ----
{
  const photo = join(home, 'a.jpg');
  writeFileSync(photo, JPG);
  check('没认过:读不到;给孩子端的是 none、没有项', (await readWords(photo)) === null && JSON.stringify(kidWords(null)) === '{"state":"none","items":[],"lines":[]}');
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const look = fakeLook(gate);
  const bg = await startWords(photo, (image, onProgress) => recognizeWith(look, image, onProgress, { text: `挑词\n\n${FORMAT}`, model: 'm' }));
  for (let i = 0; i < 100 && (await readWords(photo))?.items.length !== 1; i++) await new Promise((r) => setTimeout(r, 10));
  const mid = await readWords(photo);
  check('认到一半:文件里是 running,已经认出的那一项在(孩子端的框一个一个出来)', mid?.state === 'running' && mid.items.length === 1 && mid.items[0].text === '变' && mid.lesson === '我是什么', JSON.stringify(mid));
  check('正在认的不再起一遍', (await startWords(photo, async () => { throw new Error('不该再认'); })) === null);
  open();
  await bg?.done;
  const end = await readWords(photo);
  check('认完:done,四项、课名、全文都在,记了模型', end?.state === 'done' && end.items.length === 4 && end.full.length === 2 && end.model === 'm' && existsSync(wordsFile(photo)), JSON.stringify(end));
  check('全文带框的行另记一份:字照原样带标点、去掉空格;没给框的行不记', JSON.stringify(end?.lines) === '[{"text":"我会变。太阳一晒,我就变成汽。升","box":[216,202,912,228]}]', JSON.stringify(end?.lines));
  check('要行框的格式:只多了「full 带 box」那一条,别的和听写用的一样;不要行框时就是原来那份', FORMAT_BOXED !== FORMAT && FORMAT_BOXED.includes('"full": "冬天来啦!一场大雪过后", "box": [左, 上, 右, 下]') && FORMAT_BOXED.split('\n').slice(0, 10).join() === FORMAT.split('\n').slice(0, 10).join() && photoPromptFrom('挑词\n{{格式}}') === `挑词\n${FORMAT}` && photoPromptFrom('挑词\n{{格式}}', 'zh', { boxed: true }) === `挑词\n${FORMAT_BOXED}` && !photoPromptFrom('x\n{{格式}}', 'en', { boxed: true }).includes('左, 上, 右, 下], "pinyin"'));
  const kid = kidWords(end);
  check('给孩子端的还有正文的行(点正文里任意一个字用)', kid.lines.length === 1 && kid.lines[0].text.startsWith('我会变。') && JSON.stringify(kidWords(null).lines) === '[]');
  check('给孩子端的只有带框的项:字、框、默认选不选;念法、哪一栏不发', kid.state === 'done' && kid.items.length === 3 && JSON.stringify(kid.items[1]) === '{"text":"海洋","box":[203,836,300,857],"pick":true}' && kid.items[2].pick === false, JSON.stringify(kid));
  check('认过的不再认', (await startWords(photo, async () => { throw new Error('不该再认'); })) === null);

  const bad = join(home, 'b.jpg');
  writeFileSync(bad, JPG);
  await (await startWords(bad, (image, onProgress) => recognizeWith(async () => ({ ok: false, error: 'http_500', ms: 1 }), image, onProgress, { text: 'x', model: 'm' })))?.done;
  check('没认成:failed 带原因,不抛;孩子端拿到 failed、没有项', (await readWords(bad))?.state === 'failed' && (await readWords(bad))?.error === 'http_500' && kidWords(await readWords(bad)).state === 'failed');
  await (await startWords(join(home, 'c.jpg'), async () => { throw new Error('boom'); }))?.done;
  check('照片不在:不认、不落文件', !existsSync(wordsFile(join(home, 'c.jpg'))));

  // 服务中途重起:running 的那份过了时限就重认
  const stale = join(home, 'd.jpg');
  writeFileSync(stale, JPG);
  writeFileSync(wordsFile(stale), JSON.stringify({ at: new Date(Date.now() - 10 * 60_000).toISOString(), state: 'running', items: [], lesson: null, full: [] }));
  await (await startWords(stale, (image, onProgress) => recognizeWith(fakeLook(), image, onProgress, { text: 'x', model: 'm' })))?.done;
  check('丢了的那份(running 十分钟了)重认一遍', (await readWords(stale))?.state === 'done');
}

// ---- 全流程:预习里发照片 → 后台认 → 孩子端问得到;别的话题不认 ----
{
  const teacher = await startFakeTeacher();
  const { root } = await initWorkspace({ slug: 'words', name: '小字', dir: join(home, 'ws-words') });
  const cfgFile = join(root, 'cotutor.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as { runtimes: unknown; tutors: Record<string, { runtime?: string }> };
  cfg.runtimes = { ...FAKE_RUNTIMES };
  for (const t of Object.values(cfg.tutors)) delete t.runtime;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  const now = new Date(2026, 10, 13, 19, 5);
  asked.length = 0;
  const ctx = createContext(loadWorkspace(root), { now: () => now, look: fakeLook() });
  const wait = async (tutor: string): Promise<void> => { for (let i = 0; i < 200 && ctx.runner.running(tutor); i++) await new Promise((r) => setTimeout(r, 25)); };
  const upload = async (tutor: string): Promise<string> => ((await route('POST', `/api/kid/conversations/${tutor}/photos`, ctx, { image: `data:image/jpeg;base64,${JPG.toString('base64')}` })).json as { path: string }).path;
  const words = async (path: string): Promise<{ status: number; json: { state?: string; items?: { text: string }[]; lines?: { text: string }[] } }> => route('GET', `/api/kid/photo-words?p=${encodeURIComponent(path)}`, ctx) as never;

  // 预习:点方砖开话题(老师先请拍照),再发照片
  const h = (await route('GET', '/api/kid/home', ctx)).json as { home: string | null };
  const first = await kidSend(ctx, 'chinese-tutor', { text: '', via: { home: h.home, button: 'preview' } });
  await wait('chinese-tutor');
  const p1 = await upload('chinese-tutor');
  check('还没发给老师的照片:问得到,还没认(none)', (await words(p1)).status === 200 && (await words(p1)).json.state === 'none');
  const sent = await kidSend(ctx, 'chinese-tutor', { text: '', photos: [p1], thread: (first.json as { thread: string }).thread });
  await wait('chinese-tutor');
  await ctx.runner.flush();
  const got = await words(p1);
  check('预习里发的照片:后台认了,孩子端拿到带框的三项', sent.status === 202 && got.json.state === 'done' && got.json.items?.map((x) => x.text).join() === '变,海洋,晒' && got.json.lines?.length === 1, JSON.stringify({ first: first.json, sent: sent.json, got: got.json }));
  check('认的要求是预习 activity「认字收到什么」那段填好格式', asked.length === 1 && asked[0].includes('孩子预习时会在照片上点它们') && asked[0].includes('一行一段 JSON') && asked[0].includes('"box": [左, 上, 右, 下]};不要拼音') && !asked[0].includes('{{格式}}'), asked[0]?.slice(0, 80));
  check('认出的落在照片旁边', existsSync(wordsFile(join(root, p1))));

  // 新话题(不是 activity)里发照片:不认
  const p2 = await upload('math-tutor');
  await kidSend(ctx, 'math-tutor', { text: '看看这道题', photos: [p2] });
  await wait('math-tutor');
  await ctx.runner.flush();
  check('没有「认字收到什么」的话题里发照片:不认(不花这个钱)', asked.length === 1 && (await words(p2)).json.state === 'none');

  check('不是 captures/ 里的文件、越界的路径:404', (await words('cotutor.json')).status === 404 && (await words('../x.jpg')).status === 404 && (await words('captures/没有.jpg')).status === 404);
  await teacher.close();
}

done();
