/**
 * 假 CLI:模仿 claude / qwen 的 stream-json 无头输出,给 runner 测试用(不花钱、不联网)。
 * 用法(运行时模板里):node --experimental-strip-types _fake-cli.ts [--resume <id>] [--agent <name>] [--fail] [--stream] <prompt>
 * --stream:最终文本先按行以 stream_event(content_block_delta)吐出来,每行歇 80ms(模仿 claude --include-partial-messages),再发 assistant 与 result。
 * 行为:回显 prompt 的最后一行;上下文包里有 cards 段就把那几行回显在前面(「看到卡:…」);prompt 含「拍板」就在最终文本前加一段待裁量;含「转交」就加转交段;含「板书」出两张卡(「坏卡」再加一张解析不出的,「点读」再加一张两段的点读卡,「图片」再加一张 vault/pic.png 的图片卡);含「家长段」加「## 家长」;
 * --resume 时 session_id 沿用给的 id,否则新造;--fail 出 error_max_turns。
 */
export {};
const argv = process.argv.slice(2);
let session: string | null = null;
let fail = false;
let stream = false;
let agent = '';
let body = '';
const rest: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--resume') session = argv[++i];
  else if (argv[i] === '--agent') agent = argv[++i];
  else if (argv[i] === '--body') body = argv[++i];
  else if (argv[i] === '--fail') fail = true;
  else if (argv[i] === '--stream') stream = true;
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
  if (prompt.includes('转交场景')) parts.push('```scene\n2026-09-09-guilv\n我去把这道题画出来。\n```\n\n等我画好。\n\n## 转交\nto: scene-maker\nwhy: 找规律填数 75、70、65,每次少 5;用交错数列分行讲\nrefs:\n  - 2026-09-09-guilv');
  else if (prompt.includes('转交')) parts.push('## 转交\nto: planner\nwhy: 排进计划');
  if (prompt.startsWith('cotutor:') && /\n---\n转交自 /.test(prompt)) parts.push('课包 2026-09-09-guilv 做好了,6 步');
  if (prompt.includes('板书')) parts.push('```text cover\n三角形\n拼一拼\n```\n\n先看[三角形]。\n\n```choice\n三角形有几个角?\n- [x] 三个\n- [ ] 四个\n```\n\n三角形有几个角?' + (prompt.includes('坏卡') ? '\n\n```choice\n没选项\n```' : '') + (prompt.includes('点读') ? '\n\n```read\napple 苹果\nbanana 香蕉\n```\n\n点一下听一下。' : '') + (prompt.includes('图片') ? '\n\n```image\nvault/pic.png\n看这张图\n```' : ''));
  const cardsAt = prompt.indexOf('\n  cards:\n');
  if (cardsAt >= 0) {
    const seen = prompt.slice(cardsAt + 10).split('\n').filter((l) => l.startsWith('    - ')).map((l) => { const v = l.slice(6); return v.startsWith('"') ? (JSON.parse(v) as string) : v; });
    parts.push(`看到卡:${seen.join(' | ')}`);
  }
  parts.push(`${session ? '接着说:' : '第一次说:'}${lastLine}`);
  if (prompt.includes('家长段')) parts.push('## 家长\n他其实会了。');
  const result = parts.join('\n\n');
  if (stream) {
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const delta = (text: string, parent: string | null = null): void => emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id: sid, parent_tool_use_id: parent });
    // 子代理的增量要被忽略
    emit({ type: 'stream_event', event: { type: 'message_start', message: { role: 'assistant', content: [] } }, session_id: sid, parent_tool_use_id: 'toolu_sub' });
    delta('子代理说的不算', 'toolu_sub');
    emit({ type: 'stream_event', event: { type: 'message_start', message: { role: 'assistant', content: [] } }, session_id: sid, parent_tool_use_id: null });
    for (const line of result.split('\n')) {
      delta(`${line}\n`);
      await sleep(80);
    }
    emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'text', text: result }] } });
    emit({ type: 'stream_event', event: { type: 'message_stop' }, session_id: sid, parent_tool_use_id: null });
  }
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sid, num_turns: 2, total_cost_usd: 0.05, result });
}
process.stderr.write('fake-cli done\n');
