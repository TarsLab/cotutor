/** 运行规划:同运行时有会话 → resume;跨运行时 / 无会话 → 新开;{agentBody} 只给用到它的运行时;ISO 周;recent 取材。 */
import { boardPreloaded, getRuntime, planRun, runtimeUses } from '../src/lib/run-plan.ts';
import { boardGuideReads } from '../src/lib/tutor-rules.ts';
import { isoWeek } from '../src/lib/plan.ts';
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
  check('无会话 → run,缺省 claude', fresh.runtime === 'claude' && !fresh.resume && fresh.argv[0] === 'claude' && !fresh.argv.includes('--resume') && fresh.argv.includes(vars.prompt), fresh.argv.join(' '));
  const again = planRun(config, { session: { id: 's-1', runtime: 'claude' } }, vars);
  check('同运行时有会话 → resume 带 id', again.resume && again.session === 's-1' && again.argv.includes('--resume') && again.argv[again.argv.indexOf('--resume') + 1] === 's-1');
  const switched = planRun(config, { session: { id: 's-1', runtime: 'claude' } }, { ...vars, systemBody: '正文\n\n板书写法', runtime: 'qwen' });
  check('换运行时 → 新开,不带别家的会话 id', switched.runtime === 'qwen' && !switched.resume && switched.argv[0] === 'qwen' && !switched.argv.includes('s-1'));
  check('qwen 模板拿到老师正文 + 板书写法({systemBody})', switched.argv.includes('正文\n\n板书写法') && runtimeUses(config.runtimes.qwen as { run: string[]; resume: string[] }, '{systemBody}'));
  check('claude 模板不用正文', !runtimeUses(config.runtimes.claude as { run: string[]; resume: string[] }, '{agentBody}'));
  let threw = '';
  try {
    getRuntime(config, 'gemini');
  } catch (e) {
    threw = (e as Error).message;
  }
  check('不存在的运行时 → 报错列出可用的', threw.includes('gemini') && threw.includes('claude') && threw.includes('qwen'), threw);
}
{
  // 换运行时后 applyRun 要把索引里的会话换成新的(不然下一条又拿旧 id 去 resume)
  let idx = emptyIndex('math-tutor', '2026-09-08');
  idx = { ...idx, session: { id: 'c-1', runtime: 'claude' } };
  idx = addMessage(idx, { job: '1', at: 'x', from: 'parent', text: 'hi', result: 'running', artifacts: [] });
  const t = parseTranscript('{"type":"system","session_id":"q-1"}\n{"type":"result","subtype":"success","result":"好"}');
  const after = applyRun(idx, '1', { transcript: t, kidView: deriveKidView(t, { replyMaxChars: 60 }), runtime: 'qwen' });
  check('换运行时后索引会话换成新家的', after.session?.id === 'q-1' && after.session.runtime === 'qwen' && after.messages[0].runtime === 'qwen', JSON.stringify(after.session));
  // 话题第一条永远拿新会话(它本来就是新开的);同话题第二条、同运行时才保留原会话
  const idx2 = addMessage({ ...idx, sessions: { '1': { id: 'q-0', runtime: 'qwen' } } }, { job: '2', at: 'x', from: 'parent', text: '再', result: 'running', artifacts: [] });
  const same = applyRun(idx2, '2', { transcript: t, kidView: deriveKidView(t, { replyMaxChars: 60 }), runtime: 'qwen' });
  check('同话题同运行时保留原会话;话题首条拿新的', same.session?.id === 'q-0' && same.sessions['1']?.id === 'q-0' && after.sessions['1']?.id === 'q-1');
  const failed = parseTranscript('{"type":"result","subtype":"error_max_turns","is_error":true}');
  const bad = applyRun(idx, '1', { transcript: failed, kidView: deriveKidView(failed, { replyMaxChars: 60 }), runtime: 'claude' });
  check('出错写 error 原因', bad.messages[0].result === 'error' && bad.messages[0].error === 'error_max_turns');
}
{
  const rt = (run: string[]) => ({ run, resume: run });
  check('板书预载的判断:{boardFile} / {systemBody} / 头一版写死的路径算预载;什么都没有(codex 之类)不算', boardPreloaded(rt(['claude', '--append-system-prompt-file', '{boardFile}'])) && boardPreloaded(rt(['qwen', '--append-system-prompt', '{systemBody}'])) && boardPreloaded(rt(['claude', '--append-system-prompt-file', '../../.claude/skills/cotutor-board/SKILL.md'])) && !boardPreloaded(rt(['codex', 'exec', '{prompt}'])) && !boardPreloaded(rt(['qwen', '--append-system-prompt', '{agentBody}'])));
  const cfg = parseConfig(JSON.parse(configTemplate({ slug: 'x', name: 'x', tutors: [] })), 'x');
  const p1 = planRun(cfg, { session: null }, { agent: 'math-tutor', prompt: 'hi', boardFile: '/ws/.claude/skills/cotutor-board/SKILL.md', runtime: 'claude' });
  const p2 = planRun(cfg, { session: null }, { agent: 'math-tutor', prompt: 'hi', agentBody: 'A', systemBody: 'A\n\nB', runtime: 'qwen' });
  check('占位符:claude 填 {boardFile},qwen 填 {systemBody};没给值的原样留着', p1.argv.join(' ').includes('--append-system-prompt-file /ws/.claude/skills/cotutor-board/SKILL.md') && p2.argv.includes('A\n\nB') && planRun(cfg, { session: null }, { agent: 'a', prompt: 'hi', runtime: 'claude' }).argv.includes('{boardFile}'), JSON.stringify([p1.argv, p2.argv]));
  const reads = boardGuideReads([{ name: 'Skill', arg: 'cotutor-board' }, { name: 'Read', arg: '/ws/.claude/skills/cotutor-board/SKILL.md' }, { name: 'Bash', arg: 'cat ../../.claude/skills/cotutor-board/SKILL.md' }, { name: 'Read', arg: '/ws/.claude/skills/cotutor-board/references/choice.md' }, { name: 'Skill', arg: 'cotutor-vault' }]);
  check('回读检查:Skill 点名、Read / cat SKILL.md 都算;references 与别的技能不算', reads.length === 3 && !reads.join().includes('choice.md') && !reads.join().includes('cotutor-vault'), JSON.stringify(reads));
}
{
  check('ISO 周', isoWeek(new Date(2026, 8, 8)) === '2026-W37' && isoWeek(new Date(2026, 0, 1)) === '2026-W01' && isoWeek(new Date(2027, 0, 1)) === '2026-W53', isoWeek(new Date(2026, 8, 8)));
}
done();
