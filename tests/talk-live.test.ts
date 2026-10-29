/**
 * 口语课交给英语老师的实时页(src/runtime/talk-run.ts、app.ts 的 kidSendInput):
 * 口语课页拍好的那份口语单 → 新话题跑 activity「口语课」(口语单、打电话几分钟、家长的话是参数),消息记 talk。
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-talklive-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, kidSendInput } = await import('../src/app/http/app.ts');
const { talkListText } = await import('../src/runtime/talk-run.ts');

const ws = join(home, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: ws });
const cfgFile = join(ws, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
cfg.talk = { ...(cfg.talk ?? {}), enabled: true, minutes: 4, note: '这周学方位词' };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(ws), { warm: false });
await ctx.reload();

const id = '2026-10-17-1106';
mkdirSync(join(ws, 'talk', id), { recursive: true });
const list = { words: [{ en: 'duck', zh: '鸭子', emoji: '🦆', chunks: ['d', 'u', 'c', 'k'] }, { en: 'under', zh: '在……下面', chunks: ['u', 'n', 'd', 'e', 'r'] }, { en: ' ', zh: '' }], sentences: [{ en: 'The ducks are under the bus.', zh: '鸭子们在公交车下面。' }] };
writeFileSync(join(ws, 'talk', id, 'talk.json'), JSON.stringify({ id, createdAt: '2026-10-17T03:06:13.381Z', status: 'ready', list }));

check('口语单写成一段:单词一行(emoji、英文、中文、分段),句子一行;空的丢', talkListText(list) === '单词:\n🦆 duck 鸭子 d-u-c-k\nunder 在……下面 u-n-d-e-r\n句子:\nThe ducks are under the bus. 鸭子们在公交车下面。', talkListText(list));

const date = '2026-10-20';
const r = await kidSendInput(ctx, 'english-tutor', { text: '口语课', talk: { id }, device: 'tablet-landscape' }, date);
const input = 'input' in r ? r.input : null;
check('开课那条:新话题、activity 口语课(口语单、几分钟照 talk.minutes、家长的话照 talk.note)、记 talk', input !== null && input.newThread && input.activity?.name === '口语课' && String(input.activity.params.口语单).startsWith('单词:\n🦆 duck') && input.activity.params.打电话几分钟 === 4 && input.activity.params.家长的话 === '这周学方位词' && input.talk === id, JSON.stringify(r).slice(0, 400));
const bad = await Promise.all([kidSendInput(ctx, 'english-tutor', { text: '口语课', talk: { id: '2026-10-01-0000' } }, date), kidSendInput(ctx, 'english-tutor', { text: '口语课', talk: { id: '../x' } }, date), kidSendInput(ctx, 'chinese-tutor', { text: '口语课', talk: { id } }, date)]);
check('口语单不在、id 不对、这位老师没有口语课 activity:400', bad.every((x) => 'error' in x && x.error.status === 400 && (x.error.json as { error: string }).error === 'bad_talk'), JSON.stringify(bad.map((x) => ('error' in x ? x.error.json : 'ok'))));

done();
