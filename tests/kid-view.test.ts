/** 孩子视图:最终文本剥段后正文即板书(段落 = 讲稿,围栏 = 卡),每句按上限截;家长尾巴不进;答案剥掉;出错什么都没有。 */
import { deriveKidView, kidConversation, kidMessageCount, kidSource, truncateReply } from '../src/lib/kid-view.ts';
import { parseTranscript } from '../src/lib/transcript.ts';
import { check, done } from './_check.ts';

const okRun = (result: string): ReturnType<typeof parseTranscript> =>
  parseTranscript(`{"type":"assistant","message":{"content":[{"type":"text","text":"我先看看账本"}]}}\n{"type":"result","subtype":"success","result":${JSON.stringify(result)},"num_turns":2}`);

{
  const v = deriveKidView(okRun('## 待裁量\nquestion: 要重拍吗?\n\n这一步是借位,个位不够先向十位借一。'), { replyMaxChars: 60 });
  check('孩子只见剥段后的最终文本', v.kidText === '这一步是借位,个位不够先向十位借一。' && v.holdup?.question === '要重拍吗?' && v.ok, JSON.stringify(v));
  check('中间说话不进孩子视图', !v.kidText?.includes('账本'));
  const multi = deriveKidView(okRun('这是问答,直接答。\n\n先想一下:9/6 那次也是借位。\n\n## 转交\nto: planner\n\n因为个位不够减,要向十位借一。'), { replyMaxChars: 60 });
  check('正文全是讲稿:三句都给孩子(一行一句),转交段剥掉', multi.kidText === '这是问答,直接答。\n先想一下:9/6 那次也是借位。\n因为个位不够减,要向十位借一。' && multi.section?.lines.length === 3 && multi.section.cards.length === 0 && multi.handoff?.to === 'planner', JSON.stringify(multi));
  const board = deriveKidView(okRun('开场。\n\n```choice\n酒是谁的?\n- [x] 他自己的\n- [ ] 平分\n```\n\n酒是谁的?\n\n## 家长\n他其实会了。'), { replyMaxChars: 60 });
  check('围栏成卡、H2 起是家长尾巴、答案还在(下发时才剥)', board.section?.cards[0].kind === 'choice' && JSON.stringify(board.section?.cards[0].props.answer) === '[0]' && board.kidText === '开场。\n酒是谁的?' && board.parentText === '## 家长\n他其实会了。' && board.warnings.length === 0, JSON.stringify(board));
  const warn = deriveKidView(okRun('```choice\n没选项\n```\n一句。'), { replyMaxChars: 60 });
  check('卡没解析成 → 文字卡 + warning,孩子照常有话', warn.section?.cards[0].kind === 'text' && warn.warnings.length === 1 && warn.kidText === '一句。');
  const tail = deriveKidView(okRun('给孩子的话。\n\n## 待裁量\nquestion: 要重拍吗?'), { replyMaxChars: 60 });
  check('固定段在末尾也不影响取最后一段正文', tail.kidText === '给孩子的话。' && tail.holdup?.question === '要重拍吗?', JSON.stringify(tail));
}
{
  // 正文来源:板书在前一段、之后用了工具、最后只补一句 → 板书留下 + 最后一句;中间闲话不进;转交段在中间也认;最后一段自己有卡不重复
  const ev = (o: unknown) => JSON.stringify(o);
  const text = (t: string, sub = false) => ev({ type: 'assistant', parent_tool_use_id: sub ? 'toolu_x' : null, message: { content: [{ type: 'text', text: t }] } });
  const tool = ev({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } });
  const board = '开场。\n\n```choice\n几个角?\n- [x] 三个\n- [ ] 四个\n```\n\n几个角?';
  const lost = parseTranscript([text('我先看看账本'), tool, text(board), tool, text('## 转交\nto: scene-maker\nwhy: 画图\nrefs: 2026-09-10-guilv'), tool, text('子代理的话', true), text('画好了,点开看。'), ev({ type: 'result', subtype: 'success', result: '画好了,点开看。' })].join('\n'));
  check('kidSource:带卡的段 + 转交段 + 最后一句;闲话与子代理不进', kidSource(lost) === `${board}\n\n## 转交\nto: scene-maker\nwhy: 画图\nrefs: 2026-09-10-guilv\n\n画好了,点开看。`, String(kidSource(lost)));
  const lv = deriveKidView(lost, { replyMaxChars: 60 });
  check('板书之后用了工具再补一句:卡还在,补的那句成最后一句讲稿,转交段认出来', lv.section?.cards[0].kind === 'choice' && lv.kidText === '开场。\n几个角?\n画好了,点开看。' && lv.handoff?.to === 'scene-maker' && lv.handoff.refs[0] === '2026-09-10-guilv', JSON.stringify(lv));
  const same = parseTranscript([text('闲话'), tool, text(board), ev({ type: 'result', subtype: 'success', result: board })].join('\n'));
  check('最后一段自己就是板书 → 不重复', kidSource(same) === board && deriveKidView(same, { replyMaxChars: 60 }).section?.cards.length === 1);
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
  const onlySections = deriveKidView(okRun('## 转交\nto: math-tutor\nwhy: 数学'), { replyMaxChars: 60 });
  check('只有转交段 → 孩子无话,转交在', onlySections.kidText === null && onlySections.handoff?.to === 'math-tutor' && onlySections.ok);
}
{
  // 孩子端条目:服务端过滤——孩子的问句 + 老师给孩子的话 + 配音;家长的问句不露;出错的运行不出现;不带 result / error / holdup / 费用
  const base = { at: 'x', artifacts: [] as string[] };
  const idx = {
    messages: [
      { ...base, job: '1', from: 'kid' as const, text: '为什么', result: 'ok' as const, kidText: '因为借位', audio: '2026-09-09.1.mp3', costUsd: 0.1, error: null, holdup: { question: 'q', options: [] } },
      { ...base, job: '2', from: 'parent' as const, text: '家长问的', result: 'ok' as const, kidText: '给孩子的话', audio: null },
      { ...base, job: '3', from: 'parent' as const, text: '记账', result: 'ok' as const, kidText: null },
      { ...base, job: '4', from: 'kid' as const, text: '又问', result: 'error' as const, kidText: null, error: 'error_max_turns' },
      { ...base, job: '5', from: 'system' as const, text: 'sys', result: 'error' as const, kidText: null, error: 'boom' },
      { ...base, job: '6', from: 'kid' as const, text: '再问', result: 'running' as const },
      { ...base, job: '7', from: 'kid' as const, text: '选择题', result: 'ok' as const, kidText: '选哪个?', section: { cards: [{ kind: 'choice', props: { question: '选哪个?', options: ['甲', '乙'], answer: [1] } }, { kind: 'fill', props: { text: '___', blanks: 1, answers: ['x'] } }], lines: [{ text: '选哪个?', audio: null, marks: [], ask: true, anchor: 1, cues: [] }] }, parentText: '## 家长\n秘密' },
    ],
  };
  const v = kidConversation(idx);
  check('条目数:家长无话的与系统出错的不出现', v.map((m) => m.job).join() === '1,2,4,6,7', JSON.stringify(v.map((m) => m.job)));
  check('板书节下发前剥答案;家长尾巴不下发', v[4].section?.cards.length === 2 && !('answer' in v[4].section.cards[0].props) && !('answers' in v[4].section.cards[1].props) && v[4].section.lines[0].ask && !JSON.stringify(v).includes('秘密'), JSON.stringify(v[4]));
  check('孩子的问句 + 回复 + 配音', v[0].question === '为什么' && v[0].reply === '因为借位' && v[0].audio === '2026-09-09.1.mp3' && !v[0].pending);
  check('家长的问句不露,只有给孩子的话', v[1].question === null && v[1].reply === '给孩子的话' && v[1].audio === null);
  check('出错:问句在、没有回复、没有原因', v[2].question === '又问' && v[2].reply === null && !('error' in v[2]) && !('result' in v[2]));
  check('还在跑 → pending', v[3].pending && v[3].reply === null);
  check('序列化后搜不到工具 / 错误 / 待裁量 / 费用 / 答案', !/工具|error|holdup|costUsd|result|answer/.test(JSON.stringify(v)), JSON.stringify(v));
  check('每日计数只算孩子的', kidMessageCount(idx) === 4);
  const withStates = kidConversation(idx, { '7': { 0: { at: 'x', turn: '7', state: { picked: [1] } } } });
  check('孩子做的状态并到卡上(答案还是剥掉),没做过的卡没有 state', JSON.stringify(withStates[4].section?.cards[0].state) === '{"picked":[1]}' && !('answer' in withStates[4].section!.cards[0].props) && !('state' in withStates[4].section!.cards[1]), JSON.stringify(withStates[4].section));
  const withAssets = kidConversation(idx, {}, { '7': { 1: ['2026-09-09.7.cards/1/1.mp3'] } });
  check('生成好的资产并到卡上;没资产的卡没有 assets', JSON.stringify(withAssets[4].section?.cards[1].assets) === '["2026-09-09.7.cards/1/1.mp3"]' && !('assets' in withAssets[4].section!.cards[0]) && !('state' in withAssets[4].section!.cards[1]));
  check('「继续」不计每日上限,交答案计', kidMessageCount({ messages: [{ ...base, job: 'a', from: 'kid' as const, text: '继续', action: 'continue' as const, result: 'ok' as const }, { ...base, job: 'b', from: 'kid' as const, text: '(交了答案,没说话)', action: 'submit' as const, result: 'ok' as const }] }) === 1);
}
done();
