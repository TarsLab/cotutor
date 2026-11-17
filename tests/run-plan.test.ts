/** 运行时:按名字找、不存在的报可用的;旧的命令行运行时读得进来、用不了;换运行时后的会话;守则正文;ISO 周。 */
import { getRuntime, runtimeIssue } from '../src/brain/runtime.ts';
import { tutorRulesBody } from '../src/runtime/context/tutor-rules.ts';
import { isoWeek } from '../src/memory/plan.ts';
import { applyRun, emptyIndex, addMessage } from '../src/runtime/journal/conversation.ts';
import { deriveKidView } from '../src/runtime/kid-view.ts';
import { parseTranscript } from '../src/brain/transcript.ts';
import { configTemplate, shippedAgents } from '../src/app/cli/skeleton.ts';
import { parseConfig } from '../src/app/workspace.ts';
import { check, done } from './_check.ts';

const tpl = JSON.parse(configTemplate({ slug: 'ming', tutors: await shippedAgents() })) as { runtimes: Record<string, unknown> };
const qwenRt = { run: ['qwen', '-m', 'qwen3.8-max'], resume: ['qwen', '--resume', '{session}'] };
const config = parseConfig({ ...tpl, runtimes: { ...tpl.runtimes, qwen: qwenRt } }, 'x');

{
  check('出厂只有 API 运行时:缺省 api,还有 api-flash', JSON.stringify(Object.keys(tpl.runtimes)) === JSON.stringify(['default', 'api', 'api-flash']) && tpl.runtimes.default === 'api', JSON.stringify(Object.keys(tpl.runtimes)));
  check('按名字找;缺省 runtimes.default', getRuntime(config).name === 'api' && getRuntime(config, 'api-flash').runtime.model === 'qwen3.8-flash');
  const err = (name: string): string => { try { getRuntime(config, name); return ''; } catch (e) { return (e as Error).message; } };
  check('不存在的运行时 → 报错列出可用的', err('gemini').includes('gemini') && err('gemini').includes('api-flash'), err('gemini'));
  check('旧的命令行运行时:配置读得进来,用不了,说改成 api', config.runtimes.qwen !== undefined && err('qwen').includes('不再支持') && err('qwen').includes('api') && runtimeIssue(qwenRt) === runtimeIssue({ run: ['claude'], resume: ['claude'] }) && runtimeIssue({ api: 'bailian', model: 'm' }) === null, err('qwen'));
}
{
  // 换运行时后 applyRun 要把索引里的会话换成新的(不然下一条又拿旧 id 去 resume)
  let idx = emptyIndex('math-tutor', '2026-09-08');
  idx = { ...idx, session: { id: 'c-1', runtime: 'qwen-flash' } };
  idx = addMessage(idx, { job: '1', at: 'x', from: 'kid', text: 'hi', result: 'running', artifacts: [] });
  const t = parseTranscript('{"type":"system","session_id":"q-1"}\n{"type":"result","subtype":"success","result":"好"}');
  const after = applyRun(idx, '1', { transcript: t, kidView: deriveKidView(t, { replyMaxChars: 60 }), runtime: 'qwen' });
  check('换运行时后索引会话换成新家的', after.session?.id === 'q-1' && after.session.runtime === 'qwen' && after.messages[0].runtime === 'qwen', JSON.stringify(after.session));
  // 话题第一条永远拿新会话(它本来就是新开的);同话题第二条、同运行时才保留原会话
  const idx2 = addMessage({ ...idx, sessions: { '1': { id: 'q-0', runtime: 'qwen' } } }, { job: '2', at: 'x', from: 'kid', text: '再', result: 'running', artifacts: [] });
  const same = applyRun(idx2, '2', { transcript: t, kidView: deriveKidView(t, { replyMaxChars: 60 }), runtime: 'qwen' });
  check('同话题同运行时保留原会话;话题首条拿新的', same.session?.id === 'q-0' && same.sessions['1']?.id === 'q-0' && after.sessions['1']?.id === 'q-1');
  const failed = parseTranscript('{"type":"result","subtype":"error_max_turns","is_error":true}');
  const bad = applyRun(idx, '1', { transcript: failed, kidView: deriveKidView(failed, { replyMaxChars: 60 }), runtime: 'qwen-flash' });
  check('出错写 error 原因', bad.messages[0].result === 'error' && bad.messages[0].error === 'error_max_turns');
}
{
  const rules = tutorRulesBody('---\nname: x\n---\n\n<!-- 给人看\n谁读:老师\n-->\n\n# 守则\n\n- 一条\n<!-- 为什么:因为 -->\n- 两条 <!-- 行内的留着 -->\n\n<!--\n  多行\n-->\n## 尾\n');
  check('守则正文:剥掉独占行的注释(连同前面的换行),行内的留着;以标题开头', rules === '# 守则\n\n- 一条\n- 两条 <!-- 行内的留着 -->\n\n## 尾', JSON.stringify(rules));
}
{
  check('ISO 周', isoWeek(new Date(2026, 8, 8)) === '2026-W37' && isoWeek(new Date(2026, 0, 1)) === '2026-W01' && isoWeek(new Date(2027, 0, 1)) === '2026-W53', isoWeek(new Date(2026, 8, 8)));
}
done();
