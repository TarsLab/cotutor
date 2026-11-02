/** 旧轮次的 .log(2026-11-02 以前起 Qwen Code / Claude Code 的 stream-json)读成统一事件;一份 .log 里两种行混着也读得出;工具名的类别。 */
import { parseStreamJson } from '../src/brain/stream-json.ts';
import { parseEventLine, parseLogLine } from '../src/brain/log.ts';
import { toolKind } from '../src/brain/types.ts';
import { check, done } from './_check.ts';

const j = (o: unknown): string => JSON.stringify(o);

{
  check('init:会话 id 与工具表', j(parseStreamJson(j({ type: 'system', subtype: 'init', session_id: 's1', tools: ['Read', 3, 'Bash'] }))) === j([{ kind: 'session', id: 's1' }, { kind: 'init', tools: ['Read', 'Bash'] }]));
  const d = parseStreamJson(j({ type: 'stream_event', session_id: 's1', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } } }));
  check('增量正文', d.length === 2 && d[1].kind === 'delta' && d[1].text === '你好' && d[1].sub === false);
  check('在想 / 开新的一条 / 子代理标 sub', parseStreamJson(j({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } } }))[0]?.kind === 'thinking' && j(parseStreamJson(j({ type: 'stream_event', parent_tool_use_id: 'toolu_1', event: { type: 'message_start' } }))) === j([{ kind: 'start', sub: true }]));
  check('qwen 的 goal_state、空增量、坏行、空行都不出事件', parseStreamJson(j({ type: 'stream_event', event: { type: 'goal_state', goal_state: { v: 2 } } })).length === 0 && parseStreamJson(j({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } } })).length === 0 && parseStreamJson('{坏').length === 0 && parseStreamJson('  ').length === 0);
  const a = parseStreamJson(j({ type: 'assistant', message: { content: [{ type: 'text', text: '先看' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } }, { type: 'text', text: '再说' }] } }));
  check('整条回复:正文与工具按原来的先后', a[0]?.kind === 'assistant' && j(a[0].parts) === j([{ type: 'text', text: '先看' }, { type: 'tool', tool: { id: 't1', name: 'Read', input: { file_path: '/a' } } }, { type: 'text', text: '再说' }]));
  const r = parseStreamJson(j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: '没有' }, { type: 'image' }] }, { type: 'text', text: 'x' }] } }));
  check('工具结果:成没成、文字', j(r) === j([{ kind: 'results', results: [{ id: 't1', ok: false, text: '没有' }], sub: false }]));
  const f = parseStreamJson(j({ type: 'result', subtype: 'success', result: ' 好 ', total_cost_usd: 0.03, num_turns: 2, usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 }, modelUsage: { a: { outputTokens: 7 } } }));
  check('收尾:正文、轮数、token(输入含缓存读;报的钱数与 modelUsage 不读)', f[0]?.kind === 'result' && j(f[0].final) === j({ ok: true, text: '好', reason: null, numTurns: 2, outTokens: 5, inTokens: 100 }), j(f[0]?.kind === 'result' ? f[0].final : null));
  const q = parseStreamJson(j({ type: 'result', subtype: 'success', is_error: false, result: '391', usage: { input_tokens: 6808, output_tokens: 22, cache_read_input_tokens: 6509, total_tokens: 6830 } }));
  check('qwen 的收尾:没有钱数,只有 token', q[0]?.kind === 'result' && !('costUsd' in q[0].final) && q[0].final.inTokens === 13317 && q[0].final.outTokens === 22);
  const e = parseStreamJson(j({ type: 'result', subtype: 'error_max_turns', is_error: true }));
  check('出错的收尾带原因', e[0]?.kind === 'result' && !e[0].final.ok && e[0].final.reason === 'error_max_turns');
}

{
  const api = JSON.stringify({ kind: 'delta', text: '新的', sub: false });
  const old = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '旧的' } } });
  check('统一事件的行:parseEventLine 认,stream-json 的行它不认', parseEventLine(api).length === 1 && parseEventLine(old).length === 0 && parseEventLine('{"kind":').length === 0);
  check('parseLogLine:两种行都认', j(parseLogLine(api)) === j([{ kind: 'delta', text: '新的', sub: false }]) && (parseLogLine(old)[0] as { text?: string })?.text === '旧的');
  check('工具类别:API 的三样与旧轮次各家的名字都认,不认的是 other', toolKind('read_file') === 'read' && toolKind('glob') === 'search' && toolKind('grep_search') === 'search' && toolKind('Read') === 'read' && toolKind('Bash') === 'shell' && toolKind('run_shell_command') === 'shell' && toolKind('Skill') === 'skill' && toolKind('skill') === 'skill' && toolKind('Artifact') === 'other');
}

done();
