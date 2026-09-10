/** 流式:从 stream-json 增量事件里拼当前顶层回复;子代理跳过;message_start 清零;整条 assistant 也认;半行先攒着。 */
import { createPartialReader } from '../src/lib/stream.ts';
import { check, done } from './_check.ts';

const ev = (o: unknown): string => `${JSON.stringify(o)}\n`;
const delta = (text: string, parent: string | null = null): string => ev({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, parent_tool_use_id: parent });
const start = (parent: string | null = null): string => ev({ type: 'stream_event', event: { type: 'message_start', message: { role: 'assistant' } }, parent_tool_use_id: parent });

{
  const r = createPartialReader();
  check('空的', r.text() === '' && !r.feed(ev({ type: 'system', subtype: 'init' })));
  check('增量追加', r.feed(start() + delta('先看') + delta('[三角形]。')) && r.text() === '先看[三角形]。');
  check('半行先攒着,补齐了再算', !r.feed(delta('\n\n下一句').slice(0, 20)) && r.text() === '先看[三角形]。' && r.feed(delta('\n\n下一句').slice(20)) && r.text() === '先看[三角形]。\n\n下一句');
  check('子代理的增量与消息头不算', !r.feed(start('toolu_1') + delta('子代理说的', 'toolu_1')) && r.text() === '先看[三角形]。\n\n下一句');
  check('非文本 delta / 别的事件不算', !r.feed(ev({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } }, parent_tool_use_id: null }) + ev({ type: 'user', message: {} }) + 'not json\n'));
  check('整条 assistant(qwen 没增量)直接当当前文本;与拼出来的一样时不算变', r.feed(ev({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '先看[三角形]。\n\n下一句' }] } })) === false && r.feed(ev({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Read' }, { type: 'text', text: '换了' }] } })) && r.text() === '换了');
  check('新消息开头:上一段没卡没段就丢(工具之后老师重新说)', r.feed(start()) && r.text() === '' && r.feed(delta('重说')) && r.text() === '重说');
  check('子代理的 assistant 不算', !r.feed(ev({ type: 'assistant', parent_tool_use_id: 'toolu_2', message: { content: [{ type: 'text', text: 'x' }] } })) && r.text() === '重说');
  check('上一段带围栏就留下,新段接在后面(板书完再用工具,卡不丢)', r.feed(start() + delta('看卡。\n\n```text\n卡\n```\n') + start() + delta('补一句。')) && r.text() === '看卡。\n\n```text\n卡\n```\n\n补一句。', r.text());
}
done();
