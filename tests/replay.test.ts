/**
 * 回放(假 CLI,不花钱):原轮跑在 conversations/,回放落 evals/、不碰原索引、消息带 replayOf、不配音;
 * compare 出上下文包 / 讲稿 / 卡 / 读了什么的 diff,notes 说老师文件变没变;lib/diff 的 LCS 与 compact。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';
import { compactDiff, diffLines } from '../src/lib/diff.ts';

{
  const d = diffLines(['a', 'b', 'c', 'd'], ['a', 'c', 'x', 'd']);
  check('diffLines:LCS 对齐', d.map((r) => r.s + r.text).join(' ') === '·a -b ·c +x ·d', JSON.stringify(d));
  check('diffLines:空边', diffLines([], ['a']).map((r) => r.s).join() === '+' && diffLines(['a'], []).map((r) => r.s).join() === '-' && diffLines([], []).length === 0);
  const long = Array.from({ length: 30 }, (_, i) => `l${i}`);
  const c = compactDiff(diffLines(long, long.map((l) => (l === 'l15' ? 'L15' : l))));
  check('compactDiff:只留变处前后两行,其余「略」', c.map((r) => r.s + r.text).join(' ') === '·… 略 13 行 ·l13 ·l14 -l15 +L15 ·l16 ·l17 ·… 略 12 行', JSON.stringify(c));
  check('compactDiff:全一样就全留', compactDiff(diffLines(long, long)).length === 30);
}

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-replay-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { Runner } = await import('../src/server/runner.ts');
const { compareReplay, evalWorkspace, formatCompare, listReplays, startReplay } = await import('../src/server/replay.ts');
const { readIndex } = await import('../src/server/store.ts');

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const FAKE_TTS = fileURLToPath(new URL('./_fake-tts.ts', import.meta.url));
const node = process.execPath;
const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
cfg.runtimes = {
  default: 'fake',
  fake: { run: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '{prompt}'], resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] },
  fast: { run: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--output-format', 'json', '{prompt}'], resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--output-format', 'json', '{prompt}'] },
};
cfg.paths = { vault: 'vault' };
cfg.policyDefaults = { post: { runtime: 'fast', timeoutMs: 1500 } };
cfg.tts = { say: [node, '--experimental-strip-types', '--no-warnings', FAKE_TTS, '{text}', '--voice', '{voice}', '--json', '-o', '{out}'] };
(cfg.tutors as Record<string, Record<string, unknown>>)['math-tutor'].voice = 'v-math';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
mkdirSync(join(root, 'vault', '日记'), { recursive: true });
writeFileSync(join(root, 'vault', '孩子.md'), '---\ncotutor: profile\nschool_start: 2025-09\n---\n\n数学:人教数学一下 第 4 单元 在学\n');

let now = new Date(2026, 8, 8, 16, 20);
const ws = loadWorkspace(root);
const runner = new Runner(() => ws, { now: () => now });

try {
  // 原轮:带板书(假 CLI 见「板书」出卡)、配音
  const r1 = await runner.send('math-tutor', { from: 'kid', text: '讲讲板书' });
  await r1.done;
  await runner.flush();
  const orig = (await readIndex(ws, 'math-tutor', '2026-09-08')).messages[0];
  check('原轮 ok、有卡、配了音', orig.result === 'ok' && (orig.section?.cards.length ?? 0) > 0 && orig.section?.lines.some((l) => l.audio) === true, JSON.stringify({ result: orig.result, cards: orig.section?.cards.length, audio: orig.section?.lines.map((l) => l.audio) }));

  // 改 vault 与老师文件后回放
  writeFileSync(join(root, 'vault', '孩子.md'), '---\ncotutor: profile\nschool_start: 2025-09\n---\n\n数学:人教数学一下 第 5 单元 在学\n还没学、别用:竖式\n');
  const agentFile = join(root, '.claude', 'agents', 'math-tutor.md');
  writeFileSync(agentFile, `${readFileSync(agentFile, 'utf8')}\n改了一句。\n`);
  now = new Date(2026, 8, 8, 17, 12);
  const rp = await startReplay(ws, 'math-tutor', '2026-09-08', orig.job, { now: () => now });
  check('回放起了:evalJob 是新的、原轮 job 记着', rp.evalJob !== orig.job && rp.job === orig.job && rp.date === '2026-09-08', JSON.stringify(rp));
  await rp.done;

  const evalIndex = await readIndex(evalWorkspace(ws), 'math-tutor', '2026-09-08');
  const next = evalIndex.messages.find((m) => m.job === rp.evalJob)!;
  check('回放落 evals/:索引在、消息带 replayOf、新会话、ok', existsSync(join(root, 'evals', 'math-tutor', '2026-09-08.json')) && next?.replayOf === orig.job && next.result === 'ok' && evalIndex.sessions[next.job] !== undefined, JSON.stringify({ replayOf: next?.replayOf, result: next?.result }));
  check('回放不配音、不跑后期', next.section?.lines.every((l) => !l.audio) === true && next.post === undefined && next.audio === null, JSON.stringify({ audio: next.section?.lines.map((l) => l.audio), post: next.post }));
  check('回放的 log / run.json 落在 evals/', existsSync(join(root, 'evals', 'math-tutor', `2026-09-08.${next.job}.log`)) && existsSync(join(root, 'evals', 'math-tutor', `2026-09-08.${next.job}.run.json`)));
  const origIndex = await readIndex(ws, 'math-tutor', '2026-09-08');
  check('原索引没动:还是一条', origIndex.messages.length === 1 && origIndex.messages[0].job === orig.job && !existsSync(join(root, 'conversations', 'math-tutor', `2026-09-08.${next.job}.log`)));

  const c = (await compareReplay(ws, 'math-tutor', '2026-09-08', rp.evalJob))!;
  check('compare:状态 ok、两侧 job 对', c !== null && c.status === 'ok' && c.orig.job === orig.job && c.next.job === rp.evalJob);
  check('compare:上下文包 diff 看得到 vault 的改动(第 4 → 第 5 单元、多一行)', c.pack.some((r) => r.s === '-' && r.text.includes('第 4 单元')) && c.pack.some((r) => r.s === '+' && r.text.includes('第 5 单元')) && c.pack.some((r) => r.s === '+' && r.text.includes('竖式')), JSON.stringify(c.pack));
  check('compare:notes 说老师文件变了(hash 不同)', c.notes.some((n) => n.startsWith('老师文件变了')), JSON.stringify(c.notes));
  check('compare:讲稿与卡两边都有、读了什么两边一样', c.lines.length > 0 && c.cards.length > 0 && c.tools.every((r) => r.s === '·'), JSON.stringify({ lines: c.lines.length, cards: c.cards.length, tools: c.tools }));
  const text = formatCompare(c);
  check('formatCompare:标题、两侧一行、各段标题、show --evals 提示', text.includes(`回放 math-tutor 2026-09-08 ${orig.job}`) && text.includes('- 原轮') && text.includes('+ 回放') && text.includes('## 上下文包') && text.includes('## 讲稿') && text.includes(`cotutor show math-tutor ${rp.evalJob} 2026-09-08 --evals`), text);
  const rows = await listReplays(ws, 'math-tutor', '2026-09-08');
  check('listReplays:一条,指向原轮', rows.length === 1 && rows[0].replayOf === orig.job && rows[0].evalJob === rp.evalJob);
  check('listReplays:按 job 过滤', (await listReplays(ws, 'math-tutor', '2026-09-08', 'nope')).length === 0);

  // 记账那轮不回放
  let refused = '';
  try { await startReplay(ws, 'math-tutor', '2026-09-08', 'nope'); } catch (e) { refused = (e as Error).message; }
  check('没有的 job 报 UsageError', refused.includes('没有 nope'), refused);

  check('骨架 .gitignore 有 evals/', readFileSync(join(root, '.gitignore'), 'utf8').includes('evals/'));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
