/** 对话索引纯函数:命名、并入运行结果、session 只记一次。 */
import { addMessage, applyRun, cardAssetName, cardId, changedCards, conversationFiles, currentThread, emptyIndex, jobId, lastJobOf, localDate, localMinute, sessionFor, threads } from '../src/lib/conversation.ts';
import { deriveKidView } from '../src/lib/kid-view.ts';
import { parseTranscript } from '../src/lib/transcript.ts';
import { ConversationIndexSchema } from '../src/schema/index.ts';
import { check, done } from './_check.ts';

const d = new Date(2026, 8, 8, 16, 20);
check('本地日期与分钟', localDate(d) === '2026-09-08' && localMinute(d) === '2026-09-08T16:20' && jobId(d, 3) === '1620-3');
const f = conversationFiles('/ws/conversations', 'math-tutor', '2026-09-08');
check('文件命名', f.index === '/ws/conversations/math-tutor/2026-09-08.json' && f.log('1620-3') === '/ws/conversations/math-tutor/2026-09-08.1620-3.log');

let idx = emptyIndex('math-tutor', '2026-09-08');
check('空索引', idx.session === null && idx.messages.length === 0 && idx.costUsd === 0);
idx = addMessage(idx, { job: '1620-1', at: '2026-09-08T16:20', from: 'kid', text: '不懂', result: 'running', artifacts: [] });
const t = parseTranscript('{"type":"system","subtype":"init","session_id":"s-9"}\n{"type":"result","subtype":"success","result":"是借位。","total_cost_usd":0.12}');
const after = applyRun(idx, '1620-1', { transcript: t, kidView: deriveKidView(t, { replyMaxChars: 60 }), runtime: 'claude' });
check('并入结果', after.messages[0].result === 'ok' && after.messages[0].kidText === '是借位。' && after.messages[0].costUsd === 0.12 && after.costUsd === 0.12);
check('session 记下', after.session?.id === 's-9' && after.session.runtime === 'claude');
const t2 = parseTranscript('{"type":"system","subtype":"init","session_id":"s-9"}\n{"type":"result","subtype":"success","result":"再讲。","total_cost_usd":0.1}');
const again = applyRun(addMessage(after, { job: '1630-2', at: '2026-09-08T16:30', from: 'kid', text: '再', result: 'running', artifacts: [] }), '1630-2', { transcript: t2, kidView: deriveKidView(t2, { replyMaxChars: 60 }), runtime: 'claude' });
check('累计费用、旧对象不动', again.costUsd === 0.22 && idx.messages[0].result === 'running');
check('卡的资产目录与文件、孩子端的名字', f.cardAssetsDir('1620-1', 2) === '/ws/conversations/math-tutor/2026-09-08.1620-1.cards/2' && f.cardAsset('1620-1', 2, '3.mp3') === '/ws/conversations/math-tutor/2026-09-08.1620-1.cards/2/3.mp3' && cardAssetName('2026-09-08', '1620-1', 2, '3.mp3') === '2026-09-08.1620-1.cards/2/3.mp3');
check('卡的状态文件与 id', f.cardsDir('1620-1') === '/ws/conversations/math-tutor/2026-09-08.1620-1.cards' && f.card('1620-1', 2) === '/ws/conversations/math-tutor/2026-09-08.1620-1.cards/2.json' && cardId('1620-1', 2) === '1620-1/2');
{
  const idx = { messages: [{ job: '1', from: 'kid' as const }, { job: '2', from: 'kid' as const }, { job: '3', from: 'kid' as const }] };
  const st = (turn: string) => ({ at: 'x', turn, state: {} });
  const got = changedCards(idx, { '1': { 1: st('3'), 0: st('2') }, '2': { 0: st('3') }, '9': { 0: st('3') } }, '1');
  check('上一轮之后改过的卡:turn 等于话题末条 job 的才算,按 job、下标排;不在索引里的 job 不算', got.map((c) => `${c.job}/${c.n}`).join() === '1/1,2/0', JSON.stringify(got));
  check('空索引没有', changedCards({ messages: [] }, { '1': { 0: st('1') } }, '1').length === 0);
  // 话题:旧索引没有 thread 字段 → 第一条自己、system 开新、其余跟前一条;有字段照字段
  const mixed = [{ job: 'a', from: 'kid' as const }, { job: 'b', from: 'kid' as const }, { job: 'c', from: 'system' as const }, { job: 'd', from: 'kid' as const }, { job: 'e', from: 'kid' as const, thread: 'e' }, { job: 'f', from: 'kid' as const }];
  check('threads:旧索引现算,system 开新话题,带字段的照字段', threads(mixed).join() === 'a,a,c,c,e,e' && currentThread({ messages: mixed }) === 'e' && currentThread({ messages: [] }) === null);
  check('lastJobOf:话题末条;没有 → null', lastJobOf({ messages: mixed }, 'a') === 'b' && lastJobOf({ messages: mixed }, 'c') === 'd' && lastJobOf({ messages: mixed }, 'zz') === null);
  check('按话题挑卡:别的话题里改过的不算', changedCards({ messages: mixed }, { a: { 0: st('b') }, c: { 0: st('d') } }, 'a').map((c) => c.job).join() === 'a');
  const s1 = { id: 's-old', runtime: 'claude' };
  check('sessionFor:sessions 里的优先;旧索引顶层 session 只对当前话题有效', sessionFor({ session: s1, sessions: {}, messages: mixed }, 'e')?.id === 's-old' && sessionFor({ session: s1, sessions: {}, messages: mixed }, 'a') === null && sessionFor({ session: null, sessions: { a: { id: 's-a', runtime: 'claude' } }, messages: mixed }, 'a')?.id === 's-a');
}
{
  // applyRun 按话题记会话:新话题拿到新 id 记进 sessions,顶层 session = 当前话题的;接旧话题时 resume 它的
  let idx = emptyIndex('math-tutor', '2026-09-08');
  const run = (_job: string, sid: string) => parseTranscript(`{"type":"system","subtype":"init","session_id":"${sid}"}\n{"type":"result","subtype":"success","result":"好。","total_cost_usd":0.01}`);
  idx = addMessage(idx, { job: '1', thread: '1', at: 'x', from: 'kid', text: 'a', result: 'running', artifacts: [] });
  idx = applyRun(idx, '1', { transcript: run('1', 's-1'), kidView: deriveKidView(run('1', 's-1'), { replyMaxChars: 60 }), runtime: 'claude' });
  idx = addMessage(idx, { job: '2', thread: '2', at: 'x', from: 'kid', text: 'b', result: 'running', artifacts: [] });
  idx = applyRun(idx, '2', { transcript: run('2', 's-2'), kidView: deriveKidView(run('2', 's-2'), { replyMaxChars: 60 }), runtime: 'claude' });
  check('两个话题两个会话,顶层 = 当前(第二个)', idx.sessions['1']?.id === 's-1' && idx.sessions['2']?.id === 's-2' && idx.session?.id === 's-2', JSON.stringify(idx.sessions));
  idx = addMessage(idx, { job: '3', thread: '1', at: 'x', from: 'kid', text: 'c', result: 'running', artifacts: [] });
  idx = applyRun(idx, '3', { transcript: run('3', 's-1'), kidView: deriveKidView(run('3', 's-1'), { replyMaxChars: 60 }), runtime: 'claude' });
  check('接回第一个话题:sessions 不变,顶层换成它', idx.sessions['1']?.id === 's-1' && idx.sessions['2']?.id === 's-2' && idx.session?.id === 's-1' && currentThread(idx) === '1', JSON.stringify(idx.session));
  const parsed = ConversationIndexSchema.safeParse({ tutor: 'x', date: '2026-09-08', session: { id: 's', runtime: 'claude' }, messages: [] });
  check('旧索引没有 sessions 也过契约(缺省空)', parsed.success && Object.keys(parsed.data.sessions).length === 0);
}
done();
