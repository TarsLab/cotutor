/** 孩子视图:最终文本剥段后正文即讲稿(一行一句,动作写在句子后面),每句按上限截;家长尾巴不进;出错什么都没有。课里的卡 2026-11-17 删了:围栏不上页。 */
import { deriveKidView, kidConversation, kidSource, parentConversation, startedThreads, truncateReply } from '../src/runtime/kid-view.ts';
import { parseBoard } from '../src/board/parse.ts';
import { parseTranscript } from '../src/brain/transcript.ts';
import { check, done } from './_check.ts';

{
  const base = { at: '2026-09-14T16:20', result: 'ok' as const, artifacts: [], kidText: '看到了', costUsd: 0 };
  const list = kidConversation({ messages: [
    { ...base, job: '1620-1', from: 'kid', text: '(拍了一张)', photos: ['captures/2026-09-14/1620-1.jpg'] },
    { ...base, job: '1620-2', from: 'system', text: '这道呢', photos: ['captures/2026-09-14/1620-2.jpg'] },
    { ...base, job: '1620-3', from: 'kid', text: '再看' },
  ] });
  check('孩子端条目:孩子自己的问句带 photos,系统消息的问句不露(照片也不露),没照片的没有 photos 字段', list[0].photos?.join() === 'captures/2026-09-14/1620-1.jpg' && list[1].question === null && list[1].photos === undefined && list[2].photos === undefined, JSON.stringify(list));
}

const okRun = (result: string): ReturnType<typeof parseTranscript> =>
  parseTranscript(`{"type":"assistant","message":{"content":[{"type":"text","text":"我先看看账本"}]}}\n{"type":"result","subtype":"success","result":${JSON.stringify(result)},"num_turns":2}`);

{
  const v = deriveKidView(okRun('## 记账\nthread: 1620-1\nname: 退位\n\n这一步是借位,个位不够先向十位借一。'), { replyMaxChars: 60 });
  check('孩子只见剥段后的最终文本', v.kidText === '这一步是借位,个位不够先向十位借一。' && v.bookkeeping?.entries[0].name === '退位' && v.ok, JSON.stringify(v));
  check('中间说话不进孩子视图', !v.kidText?.includes('账本'));
  const multi = deriveKidView(okRun('这是问答,直接答。\n\n先想一下:9/6 那次也是借位。\n\n## 记账\nthread: 1620-1\nname: 退位\n\n因为个位不够减,要向十位借一。'), { replyMaxChars: 60 });
  check('正文全是讲稿:三句都给孩子(一行一句),记账段剥掉', multi.kidText === '这是问答,直接答。\n先想一下:9/6 那次也是借位。\n因为个位不够减,要向十位借一。' && multi.section?.lines.length === 3 && multi.bookkeeping?.entries[0].name === '退位', JSON.stringify(multi));
  const board = deriveKidView(okRun('开场。\n\n```choice\n酒是谁的?\n- [x] 他自己的\n- [ ] 平分\n```\n\n酒是谁的?\n\n## 家长\n他其实会了。'), { replyMaxChars: 60 });
  check('围栏不上页(记一句)、H2 起是家长尾巴', !('cards' in (board.section ?? {})) && board.kidText === '开场。\n酒是谁的?' && board.parentText === '## 家长\n他其实会了。' && board.warnings.some((w) => w.includes('不上页')), JSON.stringify(board));
  const warn = deriveKidView(okRun('```choice\n没选项\n```\n一句。'), { replyMaxChars: 60 });
  check('只有围栏的那一块不念,孩子照常有话', warn.warnings.length === 1 && warn.kidText === '一句。');
  const tail = deriveKidView(okRun('给孩子的话。\n\n## 记账\nthread: 1620-1\nname: 退位'), { replyMaxChars: 60 });
  check('固定段在末尾也不影响取最后一段正文', tail.kidText === '给孩子的话。' && tail.bookkeeping?.entries[0].name === '退位', JSON.stringify(tail));
}
{
  // 正文来源:讲稿在前一段、之后用了工具、最后只补一句 → 带围栏的那段留下 + 最后一句;中间闲话不进;固定段在中间也认;最后一段自己就是不重复
  const ev = (o: unknown) => JSON.stringify(o);
  const text = (t: string, sub = false) => ev({ type: 'assistant', parent_tool_use_id: sub ? 'toolu_x' : null, message: { content: [{ type: 'text', text: t }] } });
  const tool = ev({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } });
  const board = '开场。\n\n```choice\n几个角?\n- [x] 三个\n- [ ] 四个\n```\n\n几个角?';
  const lost = parseTranscript([text('我先看看账本'), tool, text(board), tool, text('## 记账\nthread: 1620-1\nname: 退位'), tool, text('子代理的话', true), text('画好了,点开看。'), ev({ type: 'result', subtype: 'success', result: '画好了,点开看。' })].join('\n'));
  check('kidSource:带卡的段 + 固定段 + 最后一句;闲话与子代理不进', kidSource(lost) === `${board}\n\n## 记账\nthread: 1620-1\nname: 退位\n\n画好了,点开看。`, String(kidSource(lost)));
  const lv = deriveKidView(lost, { replyMaxChars: 60 });
  check('讲稿之后用了工具再补一句:补的那句成最后一句讲稿,记账段认出来', lv.kidText === '开场。\n几个角?\n画好了,点开看。' && lv.bookkeeping?.entries[0].name === '退位', JSON.stringify(lv));
  const same = parseTranscript([text('闲话'), tool, text(board), ev({ type: 'result', subtype: 'success', result: board })].join('\n'));
  check('最后一段自己就是板书 → 不重复', kidSource(same) === board && deriveKidView(same, { replyMaxChars: 60 }).section?.lines.length === 2);
  const plain = parseTranscript([text('闲话'), tool, text('只是答一句。'), ev({ type: 'result', subtype: 'success', result: '只是答一句。' })].join('\n'));
  check('没卡没段 → 只有最后一句', kidSource(plain) === '只是答一句。');
}
{
  const long = '第一句话讲借位。第二句话讲个位不够。第三句话讲十位退一。第四句话再说一遍很长很长很长很长很长很长的话。';
  const v = deriveKidView(okRun(long), { replyMaxChars: 30 });
  check('超长在句末截(30 字内能装三句);节里的句子同步截', v.truncated && v.kidText === '第一句话讲借位。第二句话讲个位不够。第三句话讲十位退一。' && v.section?.lines[0].text === v.kidText, v.kidText ?? '');
  const hard = truncateReply('没有任何标点的一长串字没有任何标点的一长串字没有任何标点的一长串字', 10);
  check('没句末就硬截加省略号', hard.truncated && hard.text.endsWith('…') && Array.from(hard.text).length === 11, hard.text);
  check('不超不截', !truncateReply('短', 10).truncated);
}
{
  const err = deriveKidView(parseTranscript('{"type":"result","subtype":"error_max_turns"}'), { replyMaxChars: 60 });
  check('出错 → 什么都没有', err.kidText === null && !err.ok);
  const running = deriveKidView(parseTranscript('{"type":"system","subtype":"init"}'), { replyMaxChars: 60 });
  check('还在跑 → 没有', running.kidText === null && !running.ok);
  const onlySections = deriveKidView(okRun('## 记账\nthread: 1620-1\nname: 退位'), { replyMaxChars: 60 });
  check('只有固定段 → 孩子无话,记账在', onlySections.kidText === null && onlySections.bookkeeping?.entries[0].name === '退位' && onlySections.ok);
}
{
  // 孩子端条目:服务端过滤——孩子的问句 + 老师给孩子的话 + 配音;系统消息的问句不露;出错的运行不出现;不带 result / error / 费用
  const base = { at: 'x', artifacts: [] as string[] };
  const idx = {
    messages: [
      { ...base, job: '1', from: 'kid' as const, text: '为什么', result: 'ok' as const, kidText: '因为借位', costUsd: 0.1, tokens: { in: 2500, out: 120 }, error: null, parentText: '## 家长\n家长的话' },
      { ...base, job: '2', from: 'system' as const, text: '系统派的', result: 'ok' as const, kidText: '给孩子的话' },
      { ...base, job: '3', from: 'system' as const, text: '记账', result: 'ok' as const, kidText: null },
      { ...base, job: '4', from: 'kid' as const, text: '又问', result: 'error' as const, kidText: null, error: 'error_max_turns' },
      { ...base, job: '5', from: 'system' as const, text: 'sys', result: 'error' as const, kidText: null, error: 'boom' },
      { ...base, job: '6', from: 'kid' as const, text: '再问', result: 'running' as const },
      { ...base, job: '7', from: 'kid' as const, text: '看例 4', result: 'ok' as const, kidText: '看这里?', section: { lines: [{ text: '看这里?', ask: true }] } },
    ],
  };
  const v = kidConversation(idx);
  check('条目数:系统无话的与系统出错的不出现', v.map((m) => m.job).join() === '1,2,4,6,7', JSON.stringify(v.map((m) => m.job)));
  check('讲稿节下发;家长尾巴不下发', v[4].section?.lines[0].ask === true && !JSON.stringify(v).includes('家长的话'));
  check('孩子的问句 + 回复,消息层不带配音', v[0].question === '为什么' && v[0].reply === '因为借位' && !('audio' in v[0]) && !v[0].pending);
  check('系统消息的问句不露,只有给孩子的话', v[1].question === null && v[1].reply === '给孩子的话');
  check('出错:问句在、没有回复、没有原因', v[2].question === '又问' && v[2].reply === null && !('error' in v[2]) && !('result' in v[2]));
  check('还在跑 → pending', v[3].pending && v[3].reply === null);
  check('序列化后搜不到工具 / 错误 / 家长尾巴 / 费用与 token / 答案', !/工具|error|家长的话|costUsd|tokens|result|answer/.test(JSON.stringify(v)), JSON.stringify(v));
}
{
  // 首页「今天」:开了头的话题(有孩子参与的图出现过)才列;只说话的、只铺了目录的、系统起的不列;新的在前
  const base = { artifacts: [] as string[], result: 'ok' as const };
  // 课本做底:讲稿里的 [[翻 …]](落到页上的样子)
  const fan = (title: string) => ({ lines: [{ text: '好。', ask: false, acts: [{ name: '翻', arg: title, do: { k: '翻', page: { id: `b#${title}`, kind: 'book', src: 'b', title, pages: [1], cut: 0, layout: 'prose', pick: true } } }] }] });
  const msgs = [
    // 1:只说话
    { ...base, job: '1', thread: '1', at: '2026-09-09T10:00', from: 'kid' as const, text: '我想问个问题', via: { home: 'h', button: 'new' as const, label: '新话题' }, kidText: '好', section: { lines: [{ text: '好', ask: false }] } },
    // 2:预习,先铺目录(不算),再翻到一课(算)
    { ...base, job: '2', thread: '2', at: '2026-09-09T10:10', from: 'kid' as const, text: '预习', via: { home: 'h', button: 'preview', label: '预习' }, kidText: '看目录', section: fan('目录') },
    { ...base, job: '3', thread: '2', at: '2026-09-09T10:12', from: 'kid' as const, text: '坐井观天', kidText: '翻到了', section: fan('坐井观天') },
    // 4:检查作业,孩子发了照片
    { ...base, job: '4', thread: '4', at: '2026-09-09T10:20', from: 'kid' as const, text: '检查作业', via: { home: 'h', button: 'check', label: '检查作业' }, photos: ['captures/2026-09-09/1020-1.jpg'], kidText: '看看' },
    // 5:新话题,老师在白纸条上摆了图形
    { ...base, job: '5', thread: '5', at: '2026-09-09T10:30', from: 'kid' as const, text: '三乘五等于多少呀老师你帮我看看', via: { home: 'h', button: 'new' as const, label: '新话题' }, kidText: '看一看', section: { lines: [{ text: '摆出来。', ask: false, acts: [{ name: '摆', arg: '点阵 3 行 5 个', do: { k: '摆', kit: '点阵', params: { 行: '3', 个: '5' }, size: 'm' } }] }] } },
    // 6:只铺了目录
    { ...base, job: '6', thread: '6', at: '2026-09-09T10:40', from: 'kid' as const, text: '预习', via: { home: 'h', button: 'preview', label: '预习' }, kidText: '看目录', section: { lines: [] } },
    // 7:记账(系统起的)
    { ...base, job: '7', thread: '7', at: '2026-09-09T21:00', from: 'system' as const, text: '记账', kidText: '记好了', photos: ['captures/x.jpg'] },
  ];
  const list = startedThreads(msgs as never);
  check('只列开了头的:翻到一课的预习、发了照片的检查作业、摆了图形的新话题;新的在前', list.map((t) => t.thread).join() === '5,4,2', JSON.stringify(list));
  check('名字:方砖的字;新话题用孩子的第一句(截 12 字)', list.find((t) => t.thread === '2')?.label === '预习' && list.find((t) => t.thread === '4')?.label === '检查作业' && list.find((t) => t.thread === '5')?.label === '三乘五等于多少呀老师你帮…', JSON.stringify(list));
  check('课本翻到的那一课、孩子最后发的照片、最后一条的时间', list.find((t) => t.thread === '2')?.lesson === '坐井观天' && list.find((t) => t.thread === '2')?.at === '2026-09-09T10:12' && list.find((t) => t.thread === '4')?.photo === 'captures/2026-09-09/1020-1.jpg', JSON.stringify(list));
}

// 家长板书页的条目:和 kidConversation 对同一份索引,差集恰好是那几个字段与「答案不剥」
{
  const board = parseBoard('开场。\n\n酒是谁的?').section;
  const base = { at: '2026-09-14T16:20', artifacts: [] as string[] };
  const index = { messages: [
    { ...base, job: '1', thread: '1', from: 'kid' as const, text: '讲讲', result: 'ok' as const, kidText: '开场。\n酒是谁的?', section: board, parentText: '## 家长\n他会了。', remembered: ['2026-09-14 爱抢答'], warnings: ['一句太长'], via: { home: 'h', button: 0, label: '我要预习' } },
    { ...base, job: '2', thread: '1', from: 'kid' as const, text: '换个说法', result: 'ok' as const, kidText: '好。', section: parseBoard('好。').section },
    { ...base, job: '3', thread: '3', from: 'kid' as const, text: '再来', result: 'error' as const, error: 'timeout' },
    { ...base, job: '4', thread: '1', from: 'system' as const, text: '记账', result: 'ok' as const, kidText: '记好了', bookkeep: { thread: '1' } },
    { ...base, job: '5', thread: '5', from: 'system' as const, text: '整理', result: 'ok' as const, kidText: null, tidy: true as const, remembered: ['改:爱抢答 → 会先想'] },
  ] };
  const kid = kidConversation(index);
  const par = parentConversation(index);
  check('家长条目:五条都在(记账、整理也在);孩子端三条(记账、整理不进)', par.length === 5 && kid.length === 3, `${par.length} ${kid.length}`);
  check('多出的字段:from、via、parentText、remembered、warnings、error、bookkeep、tidy', par[0].from === 'kid' && par[0].via?.label === '我要预习' && par[0].parentText === '## 家长\n他会了。' && par[0].remembered?.join() === '2026-09-14 爱抢答' && par[0].warnings?.join() === '一句太长' && par[1].from === 'kid' && par[1].question === '换个说法' && par[2].error === 'timeout' && par[3].bookkeep?.thread === '1' && par[4].tidy === true && par[4].remembered?.length === 1, JSON.stringify(par));
  check('孩子端那份没有这些字段', !('from' in kid[0]) && !('parentText' in kid[0]) && !('remembered' in kid[0]) && !('warnings' in kid[0]) && kid[1].question === '换个说法' && !('error' in kid[2]));
  const strip = (m: object) => { const { from: _f, via: _v, parentText: _p, remembered: _r, warnings: _w, error: _e, action: _a, bookkeep: _b, tidy: _t, ...rest } = m as Record<string, unknown>; return rest; };
  const kidOf = (m: ReturnType<typeof parentConversation>[number]) => ({ ...strip(m), question: m.from === 'kid' ? m.question : null });
  check('剥掉多出的字段之后,孩子端能看到的那三条与 kidConversation 一字不差', JSON.stringify([par[0], par[1], par[2]].map(kidOf)) === JSON.stringify(kid), JSON.stringify([par[0], par[1], par[2]].map(kidOf)));
}
done();
