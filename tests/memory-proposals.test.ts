/**
 * 记忆的建议、证据与提交(《vault重构方案》§3,2026-10-30):拆 `孩子:` 与 `证据:「…」`;证据只认孩子说过的话;
 * 这轮里家长改过记忆文件就只认一字不差的原话;写之前文件变了不写;写到一半断了,对照文件补记或丢掉。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkEvidence, childItem, kidSaid, parseProposal, proposalsOf } from '../src/memory/proposals.ts';
import { applyMemoryOps, clipNote, parseMemoryOp, textHash } from '../src/memory/vault-notes.ts';
import { planVaultMemory, writeVaultMemory, type Vault } from '../src/memory/vault.ts';
import { memoryLanded, planMemory, recoverPending } from '../src/memory/commit.ts';
import { emptyIndex } from '../src/runtime/journal/conversation.ts';
import type { ConversationIndex, ConversationMessage } from '../src/schema/index.ts';
import { check, done } from './_check.ts';

// ---- 拆一条 ----
const p1 = parseProposal('阵列题先伸手指定行数,再一行点一个。证据:「我数成35了」');
check('证据拆出来,item 里没有它;句号留着', p1.item === '阵列题先伸手指定行数,再一行点一个。' && p1.quote === '我数成35了' && p1.target === 'tutor', JSON.stringify(p1));
const p2 = parseProposal('孩子:卡住时会先说我不会, 证据:“我不会”');
check('行首 孩子: → target child,前缀留在 item;中文引号也认;末尾逗号去掉', p2.target === 'child' && p2.item === '孩子:卡住时会先说我不会' && p2.quote === '我不会', JSON.stringify(p2));
const p3 = parseProposal('孩子:读题慢 证据:"I don\'t know"');
check('全角冒号、英文引号', p3.target === 'child' && p3.item === '孩子:读题慢' && p3.quote === "I don't know", JSON.stringify(p3));
const p4 = parseProposal('改:讲慢点他跟得上 → 讲慢点才跟得上 证据:「慢一点」');
check('改、删的写法照旧,证据拆在最后', parseMemoryOp(p4.item).op === 'change' && p4.quote === '慢一点', JSON.stringify(p4));
const p5 = parseProposal('讲角用手指比划他马上懂');
const p6 = parseProposal('讲角用手指比划。证据:「」');
check('没写证据、证据是空的 → 没有 quote;句中提到「证据」不算', !('quote' in p5) && !('quote' in p6) && p6.item === '讲角用手指比划。' && parseProposal('他会拿证据说话').item === '他会拿证据说话');

// ---- 证据对孩子说过的话 ----
const said = ['我数成 35 了!', 'I DON\'T know', '嗯'];
check('对上:不管空格、标点、英文大小写', checkEvidence('我数成35了', said) === 'verified' && checkEvidence('i don\'t KNOW', said) === 'verified' && checkEvidence('数成35', said) === 'verified');
check('孩子没说过 → rejected;没写或太短(去掉标点不到两个字)→ unverified', checkEvidence('我会竖式', said) === 'rejected' && checkEvidence(undefined, said) === 'unverified' && checkEvidence('嗯。', said) === 'unverified');

const msg = (m: Partial<ConversationMessage> & Pick<ConversationMessage, 'job' | 'from' | 'text'>): ConversationMessage => ({ at: '2026-10-30T16:00', result: 'ok', artifacts: [], ...m }) as ConversationMessage;
const messages = [
  msg({ job: '1600-1', thread: '1600-1', from: 'kid', text: '我数成35了', kidText: '我们一起数一数,一共有三十五个。' }),
  msg({ job: '1601-2', thread: '1600-1', from: 'kid', text: '交给老师', action: 'submit' }),
  msg({ job: '1602-3', thread: '1600-1', from: 'kid', text: '看图写话', via: { home: null, button: 0, label: '看图写话' } }),
  msg({ job: '1603-4', thread: '1603-4', from: 'kid', text: '另一个话题里说的' }),
  msg({ job: '1604-5', thread: '1604-5', from: 'system', text: '把你的记忆整理一遍,孩子说过我会竖式' }),
];
const s1 = kidSaid(messages, '1600-1');
check('孩子说过的话:只有这个话题里孩子发的;老师的回复、交卡、首页按钮上的字、应用派的任务都不算', s1.join('|') === '我数成35了', JSON.stringify(s1));
check('老师自己讲的当证据 → rejected', checkEvidence('我们一起数一数', s1) === 'rejected' && checkEvidence('我会竖式', kidSaid(messages, null)) === 'rejected');
check('整理轮(thread = null):这一天所有话题里孩子说的', kidSaid(messages, null).join('|') === '我数成35了|另一个话题里说的');
const ps = proposalsOf(['阵列题先伸手指定行数。证据:「我数成35了」', '他会竖式了。证据:「我会竖式」', '讲慢点'], s1);
check('一批建议各自带 check', ps.map((p) => p.check).join() === 'verified,rejected,unverified' && ps[0].item === '阵列题先伸手指定行数。', JSON.stringify(ps));

// ---- 这轮里家长改过:改、删只认一字不差的原话 ----
const mem = '---\ncotutor: memory\nagent: math-tutor\n---\n\n- 2026-09-01 讲慢点他跟得上,周末例外\n- 2026-09-01 爱用手指数\n';
const ops = ['改:讲慢点他跟得上 → 讲慢点才跟得上', '删:爱用手指数'].map(parseMemoryOp);
const loose = applyMemoryOps(mem, ops, '2026-10-30');
const strict = applyMemoryOps(mem, ops, '2026-10-30', { strict: true });
check('平时按包含找:家长补的半句被盖掉(所以要 strict)', loose.text.includes('- 2026-10-30 讲慢点才跟得上\n') && !loose.text.includes('周末例外'));
check('strict:包含的不算,改不了进 misses;一字不差的照删', strict.text.includes('讲慢点他跟得上,周末例外') && !strict.text.includes('爱用手指数') && strict.misses.join() === '改:讲慢点他跟得上' && strict.lines.length === 1, JSON.stringify(strict));

// ---- 落盘:算、写分开 ----
const root = mkdtempSync(join(tmpdir(), 'cotutor-proposals-'));
try {
  const v = { paths: { vault: root, diary: join(root, '日记'), plans: join(root, '计划'), textbooks: join(root, '教材') } } as unknown as Vault;
  mkdirSync(join(root, '记忆'), { recursive: true });
  const memFile = join(root, '记忆', '数学老师.md');
  writeFileSync(memFile, mem);
  const seenNow = { path: '记忆/数学老师.md', hash: textHash(clipNote(mem, 2000, 'tail').text), clip: 2000 };
  const same = await planVaultMemory(v, { agent: 'math-tutor', display: '数学老师', items: ['改:讲慢点他跟得上 → 讲慢点才跟得上'], date: '2026-10-30', seen: seenNow });
  check('老师看到的就是现在这版:照常按包含找', same.plan?.changes.join() === '改:讲慢点他跟得上,周末例外 → 讲慢点才跟得上' && same.warnings.length === 0, JSON.stringify(same));
  const changed = await planVaultMemory(v, { agent: 'math-tutor', display: '数学老师', items: ['改:讲慢点他跟得上 → 讲慢点才跟得上', '删:爱用手指数'], date: '2026-10-30', seen: { ...seenNow, hash: 'deadbeef' } });
  check('老师看到的那版和文件对不上(家长这轮里改过):改不了的报出来,不盖掉家长改的;删照删', changed.plan?.changes.join() === '删:爱用手指数' && changed.warnings.some((w) => w.includes('家长改过记忆文件') && w.includes('改:讲慢点他跟得上')), JSON.stringify(changed));
  writeFileSync(memFile, `${mem}家长刚加的一行\n`);
  const late = await writeVaultMemory(v, changed.plan!);
  check('写之前文件又变了:不写,回为什么', late?.includes('刚被改过') === true && readFileSync(memFile, 'utf8').includes('爱用手指数') && readFileSync(memFile, 'utf8').includes('家长刚加的一行'), String(late));
  const fresh = await planVaultMemory(v, { agent: 'math-tutor', display: '数学老师', items: ['删:爱用手指数'], date: '2026-10-30' });
  check('没变就写', (await writeVaultMemory(v, fresh.plan!)) === null && !readFileSync(memFile, 'utf8').includes('爱用手指数'));

  // ---- 写到一半断了:对照文件补记或丢掉 ----
  const plan = fresh.plan!;
  const landedP = { base: textHash(plan.base!), hash: textHash(plan.text), lines: plan.lines };
  check('写成了没有:就是写成之后那版 → 是;还是写之前那版 → 否;后来又被改过 → 看每一行', memoryLanded(plan.text, landedP) && !memoryLanded(plan.base!, landedP) && memoryLanded(`${plan.text}后来又加的\n`, landedP) && !memoryLanded(`${plan.base!}后来又加的\n`, landedP));
  mkdirSync(join(root, '日记'), { recursive: true });
  const block = '## 数学 · 三角形的角\n\n- 观察:角和边会混\n';
  writeFileSync(join(root, '日记', '2026-10-30.md'), `家长写的开头\n\n${block}`);
  const idx: ConversationIndex = {
    ...emptyIndex('math-tutor', '2026-10-30'),
    messages: [
      msg({ job: '1700-1', thread: '1700-1', from: 'kid', text: '讲一讲', pending: { memory: { file: plan.file, ...landedP, changes: plan.changes } } }),
      msg({ job: '1710-2', thread: '1700-1', from: 'system', text: '记账', bookkeep: { thread: '1700-1' }, pending: { diary: { file: '2026-10-30.md', block, thread: '1700-1' } } }),
      msg({ job: '1720-3', thread: '1720-3', from: 'kid', text: '另一个', pending: { memory: { file: plan.file, base: textHash(plan.text), hash: 'deadbeef', changes: ['- 2026-10-30 没写成的'], lines: [{ before: null, after: '- 2026-10-30 没写成的' }] } } }),
      msg({ job: '1730-4', thread: '1720-3', from: 'system', text: '记账', bookkeep: { thread: '1720-3' }, pending: { diary: { file: '2026-10-30.md', block: '## 数学 · 没写成\n', thread: '1720-3' } } }),
    ],
  };
  const r = await recoverPending(v, idx);
  const [a, b, c, d] = r.index.messages;
  check('写成了的补记:记忆补 memoryLines / remembered,日记补 diaryBlock 与 booked', r.changed && JSON.stringify(a.memoryLines) === JSON.stringify(plan.lines) && a.remembered?.join() === plan.changes.join() && b.diaryBlock === block && r.index.booked['1700-1'] === '1710-2', JSON.stringify(r.index));
  check('没写成的丢掉,不补 booked(再点记账会重记);pending 都清掉,各自进提醒', !c.memoryLines && !d.diaryBlock && !('1720-3' in r.index.booked) && r.index.messages.every((m) => !m.pending && m.warnings?.length === 1) && d.warnings![0].includes('再点一次记账'), JSON.stringify(r.index.messages.map((m) => m.warnings)));
  const again = await recoverPending(v, r.index);
  check('没有 pending:原样', !again.changed && again.index === r.index);

  // ---- 孩子的记忆(2026-10-30):有脸的老师写的 孩子: 分到 agent: all 那篇,前缀去掉;工具人写的照旧进自己的 ----
  const split = await planMemory(v, { agent: 'math-tutor', display: '数学老师', items: ['孩子:卡住先说我不会。证据:「我不会」', '讲角用手指比划'], max: 2, date: '2026-10-30', said: ['我不会'], shared: true });
  check('有脸的老师:孩子: 那条进 记忆/孩子.md(去掉前缀),另一条进自己的', split.child?.file === '记忆/孩子.md' && split.child.base === null && split.child.text.includes('agent: all') && split.child.changes.join() === '- 2026-10-30 卡住先说我不会。' && split.plan?.file === '记忆/数学老师.md' && split.plan.changes.join() === '- 2026-10-30 讲角用手指比划', JSON.stringify(split));
  const tool = await planMemory(v, { agent: 'helper', display: '小帮手', items: ['孩子:卡住先说我不会'], max: 2, date: '2026-10-30', said: [], shared: false });
  check('工具人:孩子: 照旧进自己的,前缀留着', tool.child === null && tool.plan?.changes.join() === '- 2026-10-30 孩子:卡住先说我不会', JSON.stringify(tool));
  check('改、删也能分过去:孩子:删:原话', childItem('孩子:删:卡住先说我不会') === '删:卡住先说我不会' && childItem('孩子: 读题慢') === '读题慢');
  await writeVaultMemory(v, split.child!);
  const cr = await recoverPending(v, { ...emptyIndex('math-tutor', '2026-10-30'), messages: [msg({ job: '1800-1', thread: '1800-1', from: 'kid', text: '我不会', pending: { child: { file: split.child!.file, base: null, hash: textHash(split.child!.text), changes: split.child!.changes, lines: split.child!.lines } } })] });
  check('孩子的记忆写到一半断了:补 childLines,remembered 里标着孩子的记忆', JSON.stringify(cr.index.messages[0].childLines) === JSON.stringify(split.child!.lines) && cr.index.messages[0].remembered?.join() === '孩子的记忆:- 2026-10-30 卡住先说我不会。' && !cr.index.messages[0].memoryLines, JSON.stringify(cr.index.messages[0]));
} finally {
  rmSync(root, { recursive: true, force: true });
}

done();
