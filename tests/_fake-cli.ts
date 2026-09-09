/**
 * 假 CLI:模仿 claude / qwen 的 stream-json 无头输出,给 runner 测试用(不花钱、不联网)。
 * 用法(运行时模板里):node --experimental-strip-types _fake-cli.ts [--resume <id>] [--agent <name>] [--fail] <prompt>
 * 行为:回显 prompt 的最后一行;prompt 含「拍板」就在最终文本前加一段待裁量;含「转交」就加转交段;
 * --resume 时 session_id 沿用给的 id,否则新造;--fail 出 error_max_turns。
 */
const argv = process.argv.slice(2);
let session: string | null = null;
let fail = false;
let agent = '';
let body = '';
const rest: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--resume') session = argv[++i];
  else if (argv[i] === '--agent') agent = argv[++i];
  else if (argv[i] === '--body') body = argv[++i];
  else if (argv[i] === '--fail') fail = true;
  else rest.push(argv[i]);
}
const prompt = rest.join(' ');
const sid = session ?? `fake-${process.pid}-${Date.now()}`;
const emit = (o: unknown): void => void process.stdout.write(`${JSON.stringify(o)}\n`);
const lastLine = prompt.trim().split('\n').filter(Boolean).pop() ?? '';

emit({ type: 'system', subtype: 'init', session_id: sid, cwd: process.cwd(), agent: agent || undefined, bodyLen: body.length });
emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'text', text: '我先看看上下文包' }] } });
emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '../../ledger/observations.jsonl' } }] } });
emit({ type: 'assistant', session_id: sid, parent_tool_use_id: 'toolu_sub', message: { content: [{ type: 'text', text: '子代理在干活' }] } });
if (fail) {
  emit({ type: 'result', subtype: 'error_max_turns', is_error: true, session_id: sid, num_turns: 3 });
} else {
  const parts: string[] = [];
  if (prompt.includes('拍板')) parts.push('## 待裁量\nquestion: 要不要重讲?\noptions:\n  - label: 重讲\n    recommended: true\n  - label: 先放着');
  if (prompt.includes('转交')) parts.push('## 转交\nto: planner\nwhy: 排进计划');
  parts.push(`${session ? '接着说:' : '第一次说:'}${lastLine}`);
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sid, num_turns: 2, total_cost_usd: 0.05, result: parts.join('\n\n') });
}
process.stderr.write('fake-cli done\n');
