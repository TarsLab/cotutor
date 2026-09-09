/** 会话索引纯函数:命名、并入运行结果、session 只记一次。 */
import { addMessage, applyRun, conversationFiles, emptyIndex, jobId, localDate, localMinute } from '../src/lib/conversation.ts';
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
const after = applyRun(idx, '1620-1', { transcript: t, kidView: deriveKidView(t, { replyMaxChars: 60 }), agent: 'claude' });
check('并入结果', after.messages[0].result === 'ok' && after.messages[0].kidText === '是借位。' && after.messages[0].costUsd === 0.12 && after.costUsd === 0.12);
check('session 记下', after.session?.id === 's-9' && after.session.agent === 'claude');
const t2 = parseTranscript('{"type":"system","subtype":"init","session_id":"s-9"}\n{"type":"result","subtype":"success","result":"再讲。","total_cost_usd":0.1}');
const again = applyRun(addMessage(after, { job: '1630-2', at: '2026-09-08T16:30', from: 'kid', text: '再', result: 'running', artifacts: [] }), '1630-2', { transcript: t2, kidView: deriveKidView(t2, { replyMaxChars: 60 }), agent: 'claude' });
check('累计费用、旧对象不动', again.costUsd === 0.22 && idx.messages[0].result === 'running');
done();
