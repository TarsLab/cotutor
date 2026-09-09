/** 精简视图:只看最终文本、剥段、截断;出错什么都没有。 */
import { deriveKidView, kidConversation, kidMessageCount, truncateReply } from '../src/lib/kid-view.ts';
import { parseTranscript } from '../src/lib/transcript.ts';
import { check, done } from './_check.ts';

const okRun = (result: string): ReturnType<typeof parseTranscript> =>
  parseTranscript(`{"type":"assistant","message":{"content":[{"type":"text","text":"我先看看账本"}]}}\n{"type":"result","subtype":"success","result":${JSON.stringify(result)},"num_turns":2}`);

{
  const v = deriveKidView(okRun('## 待裁量\nquestion: 要重拍吗?\n\n这一步是借位,个位不够先向十位借一。'), { replyMaxChars: 60 });
  check('孩子只见剥段后的最终文本', v.kidText === '这一步是借位,个位不够先向十位借一。' && v.holdup?.question === '要重拍吗?' && v.ok, JSON.stringify(v));
  check('中间说话不进孩子视图', !v.kidText?.includes('账本'));
  const multi = deriveKidView(okRun('这是问答,直接答。\n\n先想一下:9/6 那次也是借位。\n\n## 转交\nto: planner\n\n因为个位不够减,要向十位借一。'), { replyMaxChars: 60 });
  check('多段只取最后一段,剥段后再取', multi.kidText === '因为个位不够减,要向十位借一。' && multi.handoff?.to === 'planner', JSON.stringify(multi));
  const tail = deriveKidView(okRun('给孩子的话。\n\n## 待裁量\nquestion: 要重拍吗?'), { replyMaxChars: 60 });
  check('固定段在末尾也不影响取最后一段正文', tail.kidText === '给孩子的话。' && tail.holdup?.question === '要重拍吗?', JSON.stringify(tail));
}
{
  const long = '第一句话讲借位。第二句话讲个位不够。第三句话讲十位退一。第四句话再说一遍很长很长很长很长很长很长的话。';
  const v = deriveKidView(okRun(long), { replyMaxChars: 30 });
  check('超长在句末截(30 字内能装三句)', v.truncated && v.kidText === '第一句话讲借位。第二句话讲个位不够。第三句话讲十位退一。', v.kidText ?? '');
  const hard = truncateReply('没有任何标点的一长串字没有任何标点的一长串字没有任何标点的一长串字', 10);
  check('没句末就硬截加省略号', hard.truncated && hard.text.endsWith('…') && Array.from(hard.text).length === 11, hard.text);
  check('不超不截', !truncateReply('短', 10).truncated);
}
{
  const err = deriveKidView(parseTranscript('{"type":"result","subtype":"error_max_turns"}'), { replyMaxChars: 60 });
  check('出错 → 什么都没有', err.kidText === null && !err.ok);
  const running = deriveKidView(parseTranscript('{"type":"system","subtype":"init"}'), { replyMaxChars: 60 });
  check('还在跑 → 没有', running.kidText === null && !running.ok);
  const onlySections = deriveKidView(okRun('## 转交\nto: math-teacher\nwhy: 数学'), { replyMaxChars: 60 });
  check('只有转交段 → 孩子无话,转交在', onlySections.kidText === null && onlySections.handoff?.to === 'math-teacher' && onlySections.ok);
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
    ],
  };
  const v = kidConversation(idx);
  check('条目数:家长无话的与系统出错的不出现', v.map((m) => m.job).join() === '1,2,4,6', JSON.stringify(v.map((m) => m.job)));
  check('孩子的问句 + 回复 + 配音', v[0].question === '为什么' && v[0].reply === '因为借位' && v[0].audio === '2026-09-09.1.mp3' && !v[0].pending);
  check('家长的问句不露,只有给孩子的话', v[1].question === null && v[1].reply === '给孩子的话' && v[1].audio === null);
  check('出错:问句在、没有回复、没有原因', v[2].question === '又问' && v[2].reply === null && !('error' in v[2]) && !('result' in v[2]));
  check('还在跑 → pending', v[3].pending && v[3].reply === null);
  check('序列化后搜不到工具 / 错误 / 待裁量 / 费用', !/工具|error|holdup|costUsd|result/.test(JSON.stringify(v)), JSON.stringify(v));
  check('每日计数只算孩子的', kidMessageCount(idx) === 3);
}
done();
