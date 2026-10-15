/**
 * 打电话的提示卡(《口语课设计.md》拍板 16,src/talk/hint.ts),不花钱:
 * 模型回的 → 卡(只收口语单上的词、最多一个空;有空没词可填也收,他自己说);不是问话 → 不出;兜底只在问话时、从口语单挑有词重合的一句;
 * 对一个假的千问:不想、提示词带老师这句与口语单;回坏的、超时、没 key → 兜底。
 */
import { createServer } from 'node:http';
import { check, done } from './_check.ts';
import { BLANK, fallbackHint, hintPrompt, makeHint, parseHint } from '../src/talk/hint.ts';

const list = {
  words: [{ en: 'red', zh: '红色' }, { en: 'yellow', zh: '黄色' }, { en: 'bus', zh: '公共汽车' }],
  sentences: [{ en: 'What colour is it?', zh: '它是什么颜色的?' }, { en: 'I can see a red bus.', zh: '我看见一辆红色的公共汽车。' }],
};

// ---- 解析 ----
{
  const ok = parseHint('```json\n{"zh":"说一说:公共汽车是什么颜色的?","en":"It\'s __.","opts":["Red","yellow","blue","red"]}\n```', list);
  check('模型回的 → 卡:空统一成三个下划线、opts 只收口语单上的词(大小写照口语单、去重,blue 不在单上丢掉)', ok !== null && ok !== 'skip' && ok.en === `It's ${BLANK}.` && JSON.stringify(ok.opts) === '["red","yellow"]' && ok.zh.startsWith('说一说'), JSON.stringify(ok));
  check('不是问话 → skip', parseHint('{"skip": true}', list) === 'skip');
  check('整句、没有空 → opts 清空', JSON.stringify(parseHint('{"zh":"说一说:你好","en":"Hello!","opts":["red"]}', list)) === JSON.stringify({ zh: '说一说:你好', en: 'Hello!', opts: [] }));
  check('有空、口语单上没有能填的词 → 收下(他自己说:I am ___ years old.),opts 空', JSON.stringify(parseHint('{"zh":"说一说:你几岁?","en":"I am ___ years old.","opts":["seven"]}', list)) === JSON.stringify({ zh: '说一说:你几岁?', en: 'I am ___ years old.', opts: [] }));
  check('两个空 → 不出;不是 JSON、缺字段、英文里没有字母 → 不出',
    parseHint('{"zh":"说一说","en":"___ and ___.","opts":["red"]}', list) === null
    && parseHint('看不懂', list) === null && parseHint('{"en":"Hi"}', list) === null && parseHint('{"zh":"说一说","en":"___","opts":["red"]}', list) === null);
  const p = hintPrompt("What colour is the bus?", list);
  check('提示词:老师这句、口语单的单词与中文、句子、skip 与 JSON 的样子', p.includes('What colour is the bus?') && p.includes('red(红色)') && p.includes('I can see a red bus.') && p.includes('"skip": true') && p.includes(BLANK));
}

// ---- 兜底 ----
{
  const fb = fallbackHint('Can you see a bus?', list);
  check('兜底:口语单上和老师这句最沾的一句,中文写成「说一说:…」', fb !== null && fb.en === 'I can see a red bus.' && fb.zh === '说一说:我看见一辆红色的公共汽车。' && fb.opts.length === 0, JSON.stringify(fb));
  check('兜底:一个实词都不沾、没有句子、不是问话(没有问号)都不出(How old are you? 不配 It is a red car.)', fallbackHint('How old are you?', list) === null && fallbackHint('What is it?', list) === null && fallbackHint('Hi?', { words: list.words, sentences: [] }) === null && fallbackHint('Great job! Red is a bright color.', list) === null && fallbackHint('Is the bus red?', list)?.en === 'I can see a red bus.');
}

// ---- 问一次 ----
const seen: Record<string, any>[] = [];
let reply: string | null = '{"zh":"说一说:公共汽车是什么颜色的?","en":"It\'s ___.","opts":["red","yellow"]}';
let slow = false;
const server = createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  seen.push(JSON.parse(raw) as Record<string, any>);
  if (slow) await new Promise((r) => setTimeout(r, 400));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`;
const env = { DASHSCOPE_API_KEY: 'sk-t' };
{
  const r = await makeHint('What colour is the bus?', list, { env, endpoint });
  const b = seen[0];
  check('问模型:qwen3.8-flash、不想、提示词带老师这句;回卡(by model)', r?.by === 'model' && r.hint.en === "It's ___." && b.model === 'qwen3.8-flash' && b.reasoning_effort === 'none' && String(b.messages[0].content).includes('What colour is the bus?'), JSON.stringify({ r, model: b?.model }));
  reply = '{"skip": true}';
  check('模型说不是问话 → 不出卡(不兜底)', (await makeHint('Great job!', list, { env, endpoint })) === null);
  reply = '乱七八糟';
  check('模型回坏的 → 兜底(by list)', (await makeHint('Can you see a bus?', list, { env, endpoint }))?.by === 'list');
  reply = '{"zh":"说一说","en":"Hi.","opts":[]}'; slow = true;
  check('超时 → 兜底', (await makeHint('Can you see a bus?', list, { env, endpoint, timeoutMs: 100 }))?.by === 'list');
  slow = false;
  check('没 key → 兜底,不发请求', (await makeHint('Can you see a bus?', list, { env: { HOME: '/nonexistent' } }))?.by === 'list');
  check('口语单是空的、老师这句是空的 → 不出', (await makeHint('Hi', { words: [], sentences: [] }, { env, endpoint })) === null && (await makeHint('  ', list, { env, endpoint })) === null);
}
server.close();
done();
