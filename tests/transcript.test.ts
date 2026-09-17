/** 转录解析:实测事件流、子代理标记、最终文本、出错、旧格式、qwen 容差;折叠。 */
import { type TranscriptItem, foldRuns, parseTranscript } from '../src/lib/transcript.ts';
import { check, done } from './_check.ts';

const STREAM = [
  '{"type":"system","subtype":"init","session_id":"s-1","model":"claude-fable-5"}',
  '{"type":"assistant","session_id":"s-1","parent_tool_use_id":null,"message":{"content":[{"type":"thinking","thinking":"内心戏"}]}}',
  '{"type":"assistant","session_id":"s-1","parent_tool_use_id":null,"message":{"content":[{"type":"text","text":"先看账本。"},{"type":"tool_use","name":"Read","input":{"file_path":"ledger/observations.jsonl"}}]}}',
  '{"type":"user","session_id":"s-1","parent_tool_use_id":null,"message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}',
  '{"type":"assistant","session_id":"s-1","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","name":"Agent","input":{"description":"出课包"}}]}}',
  '{"type":"assistant","session_id":"s-1","parent_tool_use_id":"t2","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"drawtell check x"}}]}}',
  '{"type":"user","session_id":"s-1","parent_tool_use_id":"t2","message":{"content":[{"type":"tool_result","tool_use_id":"t3","is_error":true,"content":[{"type":"text","text":"exit 1"}]}]}}',
  '{"type":"rate_limit_event","session_id":"s-1"}',
  '{"type":"result","subtype":"success","is_error":false,"num_turns":6,"total_cost_usd":0.34,"session_id":"s-1","result":"## 家长\\n他会了。\\n\\n这一步是借位。"}',
].join('\n');

{
  const t = parseTranscript(STREAM);
  check('session', t.sessionId === 's-1');
  check('条目序列', t.items.map((i) => i.kind).join(',') === 'text,tool,tool,tool,tool-error,done', t.items.map((i) => i.kind).join(','));
  check('子代理事件标 sub', t.items[3].sub === true && t.items[4].sub === true && t.items[2].sub === undefined);
  check('最终文本单独取出', t.final?.ok === true && t.final.text?.startsWith('## 家长') && t.final.costUsd === 0.34 && t.final.numTurns === 6);
  check('已有主线说话则 result 不重复上墙', t.items.filter((i) => i.kind === 'text').length === 1);
  check('收尾行', t.items[5].text === '本轮结束 · 6 轮 · $0.34', t.items[5].text);
}
{
  const t = parseTranscript('{"type":"result","subtype":"error_max_turns","num_turns":5,"session_id":"e"}');
  check('出错收尾', t.final?.ok === false && t.final.reason === 'error_max_turns' && t.final.text === null);
  const auth = parseTranscript('{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error","num_turns":1}');
  check('is_error 且 subtype=success → terminal_reason', auth.final?.ok === false && auth.final.reason === 'api_error');
  const running = parseTranscript('{"type":"system","subtype":"init","session_id":"r"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"在想"}]}}');
  check('没收尾 → final null', running.final === null && running.items.length === 1);
  const old = parseTranscript('{"type":"result","subtype":"success","session_id":"old","result":"只有结果。"}');
  check('旧格式补上说话', old.items[0]?.kind === 'text' && old.final?.text === '只有结果。');
  const qwen = parseTranscript('{"type":"system","subtype":"session_start","session_id":"q"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"好。"}]},"parent_tool_use_id":null}\n{"type":"result","subtype":"success","result":"好。","session_id":"q"}');
  check('qwen 容差', qwen.sessionId === 'q' && qwen.final?.text === '好。');
  check('空日志', parseTranscript('').final === null);
}
{
  const T = (k: TranscriptItem['kind'], t = k): TranscriptItem => ({ kind: k, text: t });
  const kinds = (rows: ReturnType<typeof foldRuns>): string => rows.map((r) => (r.kind === 'fold' ? `fold${r.tools.length}` : r.kind)).join(',');
  check('短段不折', kinds(foldRuns([T('text'), T('tool'), T('tool'), T('text')])) === 'text,tool,tool,text');
  check('中间长段整段折', kinds(foldRuns([T('text'), T('tool'), T('tool'), T('tool'), T('tool'), T('text')])) === 'text,fold4,text');
  check('末尾留 2 条直播', kinds(foldRuns([T('text'), T('tool'), T('tool'), T('tool'), T('tool'), T('tool')])) === 'text,fold3,tool,tool');
  check('报错行永不折', kinds(foldRuns([T('tool'), T('tool'), T('tool'), T('tool-error'), T('tool'), T('done')])) === 'fold3,tool-error,tool,done');
}
{
  const { toolCalls } = await import('../src/lib/transcript.ts');
  const log = [
    JSON.stringify({ type: 'assistant', session_id: 's', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '../../vault/孩子.md' } }] } }),
    JSON.stringify({ type: 'user', session_id: 's', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '# 小明\n> 现在' }] }] } }),
    JSON.stringify({ type: 'assistant', session_id: 's', parent_tool_use_id: 'toolu_sub', message: { content: [{ type: 'tool_use', id: 't2', name: 'Grep', input: { pattern: '退位', path: '../../vault/日记' } }] } }),
    JSON.stringify({ type: 'user', session_id: 's', parent_tool_use_id: 'toolu_sub', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'no such dir' }] } }),
    JSON.stringify({ type: 'assistant', session_id: 's', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'ls ../../captures', description: '看看照片' } }] } }),
    '{"type":"result","subtype":"success","result":"好"}',
  ].join('\n');
  const calls = toolCalls(log);
  check('toolCalls:三次调用按序', calls.map((c) => c.name).join() === 'Read,Grep,Bash', JSON.stringify(calls));
  check('toolCalls:Read 配上结果(成功、字数)', calls[0].arg === '../../vault/孩子.md' && calls[0].ok === true && calls[0].chars === '# 小明\n> 现在'.length);
  check('toolCalls:Grep 带 pattern in path、报错、子代理', calls[1].arg === '退位 in ../../vault/日记' && calls[1].ok === false && calls[1].sub === true);
  check('toolCalls:Bash 取 command 不取 description;没结果 ok=null', calls[2].arg === 'ls ../../captures' && calls[2].ok === null && calls[2].chars === 0);
  check('toolCalls:空日志', toolCalls('').length === 0);
}
done();
