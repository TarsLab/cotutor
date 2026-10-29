/**
 * 假百炼的 Chat Completions(流式,不花钱):API 运行时的测试经 COTUTOR_BRAIN_ENDPOINT 指到它。
 * 从 cotutor-api-prototype 的 fake-bailian.ts 来:SSE 帧故意按 17 字节切开写(验跨块拼接,中文的 UTF-8 也会被切开),收尾给 usage。
 * 看最后一条用户消息里的记号定怎么回(记号是大写字母,老师守则与上下文包里不会有):
 *   ZBOARD 两张卡加讲稿;ZMEM 加一段「## 记忆」;ZTOOL <路径> 先调 read_file 读它,拿到结果再回「书上说:…」;
 *   ZNOUSAGE 不回 usage(回的时候一次 100 入、其中 60 命中缓存、20 出);ZSTALL 吐一句就不动了(连接不关,等客户端断);ZHTTP401 回 401;
 *   别的回一句「收到:<孩子的话>」,话题里前面有老师的回复就先说「接着刚才的」
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export interface ChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  reasoning_content?: string;
}
export interface ChatBody {
  model: string;
  messages: ChatMessage[];
  tools?: { type: string; function: { name: string } }[];
  [key: string]: unknown;
}

const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).join('\n') : '');

export const BOARD = '```text\n# 三角形\n拼一拼\n```\n\n先看[三角形]。\n\n```choice\n三角形有几个角?\n- [x] 三个\n- [ ] 四个\n```\n\n三角形有几个角?';

export async function startFakeChat(): Promise<{ baseURL: string; requests: ChatBody[]; close(): Promise<void> }> {
  const requests: ChatBody[] = [];
  const server = createServer(async (req, res) => {
    try {
      if (req.url !== '/compatible-mode/v1/chat/completions') {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as ChatBody;
      requests.push(body);
      const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
      const said = textOf(lastUser?.content);
      const kid = said.trim().split('\n').at(-1) ?? '';
      if (said.includes('ZHTTP401')) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'invalid key', type: 'invalid_api_key', code: 'invalid_api_key' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = async (delta: object, finish: string | null = null): Promise<void> => {
        const frame = Buffer.from(`data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
        for (let at = 0; at < frame.length; at += 17) res.write(frame.subarray(at, at + 17));
        await delay(2);
      };
      const finish = async (reason = 'stop'): Promise<void> => {
        await send({}, reason);
        if (!said.includes('ZNOUSAGE')) res.write(`data: ${JSON.stringify({ id: 'fake', choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 60 } } })}\n\n`);
        res.end('data: [DONE]\n\n');
      };
      const last = body.messages.at(-1);
      // 工具结果回来了:照结果回
      if (last?.role === 'tool') {
        let text = '';
        try {
          const out = JSON.parse(textOf(last.content)) as { text?: string };
          text = out.text ?? '';
        } catch {
          text = '';
        }
        await send({ reasoning_content: '核对好了。' });
        await send({ content: text ? `书上说:${text.split('\n')[0]}\n` : '书没读到。\n' });
        await send({ content: '你看懂了吗?' });
        await finish();
        return;
      }
      const tool = /ZTOOL (\S+)/.exec(said);
      if (tool) {
        const args = JSON.stringify({ file_path: tool[1] });
        await send({ reasoning_content: '先查一下书。' });
        await send({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: args.slice(0, 7) } }] });
        await send({ tool_calls: [{ index: 0, function: { arguments: args.slice(7) } }] });
        await finish('tool_calls');
        return;
      }
      if (said.includes('ZSTALL')) {
        await send({ content: '我们先想一想。\n' });
        await new Promise<void>((r) => res.once('close', () => r()));
        return;
      }
      const before = body.messages.some((m) => m.role === 'assistant');
      if (said.includes('ZBOARD')) {
        await send({ content: BOARD.slice(0, 20) });
        await send({ content: BOARD.slice(20) });
      } else {
        await send({ content: before ? '接着刚才的。\n' : '' });
        await send({ content: `收到:${kid}` });
      }
      if (said.includes('ZMEM')) await send({ content: '\n\n## 记忆\n- 讲角用手指比划他马上懂' });
      await finish();
    } catch {
      if (!res.destroyed) res.destroy();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/compatible-mode/v1`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    },
  };
}
