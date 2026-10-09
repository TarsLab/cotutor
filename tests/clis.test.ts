/** CLI 适配器(《agent层设计.md》§6):stream-json 读成统一事件、按运行时找适配器、填模板(含 {toolArgs})、工具类别、环境。 */
import { ADAPTERS, STREAM_JSON, adapterFor, controlsTools, factoryRuntimes, fillArgs, parserForRuntime, processEnv, runtimeCli, toolKind, withoutNested } from '../src/clis/index.ts';
import { parseStreamJson } from '../src/clis/stream-json.ts';
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
  check('收尾:正文、费用、轮数、token', f[0]?.kind === 'result' && j(f[0].final) === j({ ok: true, text: '好', reason: null, costUsd: 0.03, numTurns: 2, modelOut: 7, lastOut: 5, outTokens: 5, inTokens: 100 }));
  const q = parseStreamJson(j({ type: 'result', subtype: 'success', is_error: false, result: '391', usage: { input_tokens: 6808, output_tokens: 22, cache_read_input_tokens: 6509, total_tokens: 6830 } }));
  check('qwen 的收尾:没有钱数,只有 token', q[0]?.kind === 'result' && q[0].final.costUsd === undefined && q[0].final.inTokens === 13317 && q[0].final.outTokens === 22);
  const e = parseStreamJson(j({ type: 'result', subtype: 'error_max_turns', is_error: true }));
  check('出错的收尾带原因', e[0]?.kind === 'result' && !e[0].final.ok && e[0].final.reason === 'error_max_turns');
}

{
  check('按 run[0] 的文件名认;cli 字段优先;认不出按 stream-json', adapterFor({ run: ['/opt/bin/claude', '-p'] }).name === 'claude' && adapterFor({ run: ['qwen'] }).name === 'qwen' && adapterFor({ run: ['.cotutor/qwen-wrap'], cli: 'qwen' }).name === 'qwen' && adapterFor({ run: ['node', 'fake.ts'] }) === STREAM_JSON && runtimeCli({ run: ['x/y/z'] }) === 'z');
  check('工具类别:各家的名字都认,不认的是 other', toolKind('Read') === 'read' && toolKind('read_file') === 'read' && toolKind('Bash') === 'shell' && toolKind('run_shell_command') === 'shell' && toolKind('Skill') === 'skill' && toolKind('skill') === 'skill' && toolKind('grep_search') === 'search' && toolKind('Artifact') === 'other');
  const claude = adapterFor({ run: ['claude'] });
  const filled = fillArgs(claude, ['claude', '--tools', '{tools}', '{toolArgs}', '--effort', '{effort}'], { agent: 'a', prompt: 'p', tools: 'off' });
  check('{tools} 填工具名单,{toolArgs} 展开成几个参数,{effort} 没给用缺省', j(filled) === j(['claude', '--tools', '', '--tools', '', '--effort', 'low']), j(filled));
  check('不给 tools = 带', fillArgs(claude, ['{tools}'], { agent: 'a', prompt: 'p' })[0] === 'Bash,Read,Grep,Glob');
  check('{toolArgs} 展开成零个参数也行', j(fillArgs({ ...STREAM_JSON, toolArgs: () => [] }, ['x', '{toolArgs}', 'y'], { agent: 'a', prompt: 'p' })) === j(['x', 'y']));
  check('模板管得了工具:{tools} 或独占参数的 {toolArgs}', controlsTools({ run: ['a', '--tools', '{tools}'], resume: ['a'] }) && controlsTools({ run: ['a'], resume: ['a', '{toolArgs}'] }) && !controlsTools({ run: ['a'], resume: ['a'] }));
}

{
  const base = { PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' };
  check('claude 注代理(大小写都给);没设、false 不注', processEnv({ cli: 'claude', env: {} }, base, { proxy: 'http://p:1' }).https_proxy === 'http://p:1' && processEnv({ cli: 'claude', env: {} }, base, { proxy: false }).HTTPS_PROXY === undefined);
  check('认不出的 CLI 不注代理;计划里的环境变量盖上去', processEnv({ cli: 'stream-json', env: { X: '1' } }, base, { proxy: 'http://p:1' }).HTTPS_PROXY === undefined && processEnv({ cli: 'stream-json', env: { X: '1' } }, base, {}).X === '1');
  check('去掉各 CLI 认作嵌套的变量', withoutNested(base).CLAUDECODE === undefined && withoutNested(base).CLAUDE_CODE_ENTRYPOINT === undefined && withoutNested(base).PATH === '/bin');
  check('按运行时名找读法;没这个运行时按 stream-json', parserForRuntime({ claude: { run: ['claude'], resume: ['claude'] } }, 'claude') === adapterFor({ run: ['claude'] }).parse && parserForRuntime({}, 'gone') === STREAM_JSON.parse && parserForRuntime({ default: 'claude' }, 'default') === STREAM_JSON.parse);
  const rt = factoryRuntimes();
  check('出厂运行时由各适配器给,每个都能找回自己的适配器', ADAPTERS.every((a) => Object.values(a.runtimes()).every((r) => adapterFor(r) === a)) && 'claude' in rt && 'qwen' in rt);
}

done();
