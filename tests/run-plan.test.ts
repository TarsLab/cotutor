/** 运行规划:同预设有会话 → resume;跨预设 / 无会话 → 新开;{agentBody} 只给用到它的预设;ISO 周;recent 取材。 */
import { getPreset, planRun, presetUses } from '../src/lib/run-plan.ts';
import { isoWeek } from '../src/lib/plan.ts';
import { recentObservations } from '../src/lib/ledger.ts';
import { applyRun, emptyIndex, addMessage } from '../src/lib/conversation.ts';
import { deriveKidView } from '../src/lib/kid-view.ts';
import { parseTranscript } from '../src/lib/transcript.ts';
import { configTemplate, shippedAgents } from '../src/cli/skeleton.ts';
import { parseConfig } from '../src/cli/workspace.ts';
import { check, done } from './_check.ts';

const config = parseConfig(JSON.parse(configTemplate({ slug: 'ming', tutors: await shippedAgents() })), 'x');
const vars = { agent: 'math-tutor', prompt: 'cotutor:\n  from: kid\n---\n不懂\n', agentBody: '正文' };

{
  const fresh = planRun(config, { session: null }, vars);
  check('无会话 → run,缺省 claude', fresh.preset === 'claude' && !fresh.resume && fresh.argv[0] === 'claude' && !fresh.argv.includes('--resume') && fresh.argv.includes(vars.prompt), fresh.argv.join(' '));
  const again = planRun(config, { session: { id: 's-1', agent: 'claude' } }, vars);
  check('同预设有会话 → resume 带 id', again.resume && again.session === 's-1' && again.argv.includes('--resume') && again.argv[again.argv.indexOf('--resume') + 1] === 's-1');
  const switched = planRun(config, { session: { id: 's-1', agent: 'claude' } }, { ...vars, preset: 'qwen' });
  check('换预设 → 新开,不带别家的会话 id', switched.preset === 'qwen' && !switched.resume && switched.argv[0] === 'qwen' && !switched.argv.includes('s-1'));
  check('qwen 模板拿到老师正文', switched.argv.includes('正文') && presetUses(config.agents.qwen as { run: string[]; resume: string[] }, '{agentBody}'));
  check('claude 模板不用正文', !presetUses(config.agents.claude as { run: string[]; resume: string[] }, '{agentBody}'));
  let threw = '';
  try {
    getPreset(config, 'gemini');
  } catch (e) {
    threw = (e as Error).message;
  }
  check('不存在的预设 → 报错列出可用的', threw.includes('gemini') && threw.includes('claude') && threw.includes('qwen'), threw);
}
{
  // 换预设后 applyRun 要把索引里的会话换成新的(不然下一条又拿旧 id 去 resume)
  let idx = emptyIndex('math-tutor', '2026-09-08');
  idx = { ...idx, session: { id: 'c-1', agent: 'claude' } };
  idx = addMessage(idx, { job: '1', at: 'x', from: 'parent', text: 'hi', result: 'running', artifacts: [] });
  const t = parseTranscript('{"type":"system","session_id":"q-1"}\n{"type":"result","subtype":"success","result":"好"}');
  const after = applyRun(idx, '1', { transcript: t, kidView: deriveKidView(t, { replyMaxChars: 60 }), agent: 'qwen' });
  check('换预设后索引会话换成新家的', after.session?.id === 'q-1' && after.session.agent === 'qwen' && after.messages[0].agent === 'qwen', JSON.stringify(after.session));
  const same = applyRun({ ...idx, session: { id: 'q-0', agent: 'qwen' } }, '1', { transcript: t, kidView: deriveKidView(t, { replyMaxChars: 60 }), agent: 'qwen' });
  check('同预设保留原会话', same.session?.id === 'q-0');
  const failed = parseTranscript('{"type":"result","subtype":"error_max_turns","is_error":true}');
  const bad = applyRun(idx, '1', { transcript: failed, kidView: deriveKidView(failed, { replyMaxChars: 60 }), agent: 'claude' });
  check('出错写 error 原因', bad.messages[0].result === 'error' && bad.messages[0].error === 'error_max_turns');
}
{
  check('ISO 周', isoWeek(new Date(2026, 8, 8)) === '2026-W37' && isoWeek(new Date(2026, 0, 1)) === '2026-W01' && isoWeek(new Date(2027, 0, 1)) === '2026-W53', isoWeek(new Date(2026, 8, 8)));
  const obs = [
    { id: '1', date: '2026-09-06', author: 'a', subject: '数学', claim: '一', retracted: false },
    { id: '2', date: '2026-09-07', author: 'a', subject: '语文', claim: '二', retracted: false },
    { id: '3', date: '2026-09-05', author: 'a', subject: '数学', claim: '三', retracted: true },
    { id: '4', date: '2026-09-08', author: 'a', subject: '数学', claim: '四', retracted: false },
  ];
  check('recent:本学科、未撤回、按日期、取最近 n', recentObservations(obs, { subject: '数学', n: 1 }).map((o) => o.claim).join() === '四' && recentObservations(obs, { subject: '数学', n: 5 }).map((o) => o.claim).join() === '一,四');
  check('没配学科 → 全量', recentObservations(obs, { n: 5 }).length === 3);
}
done();
