/** 对话索引纯函数:命名、并入运行结果、session 只记一次。 */
import { addMessage, applyRun, cardAssetName, cardId, changedCards, conversationFiles, emptyIndex, jobId, localDate, localMinute } from '../src/lib/conversation.ts';
import { deriveKidView } from '../src/lib/kid-view.ts';
import { parseTranscript } from '../src/lib/transcript.ts';
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
  const idx = { messages: [{ job: '1' }, { job: '2' }, { job: '3' }] };
  const st = (turn: string) => ({ at: 'x', turn, state: {} });
  const got = changedCards(idx, { '1': { 1: st('3'), 0: st('2') }, '2': { 0: st('3') }, '9': { 0: st('3') } });
  check('上一轮之后改过的卡:turn 等于末条 job 的才算,按 job、下标排;不在索引里的 job 不算', got.map((c) => `${c.job}/${c.n}`).join() === '1/1,2/0', JSON.stringify(got));
  check('空索引没有', changedCards({ messages: [] }, { '1': { 0: st('1') } }).length === 0);
}
done();
