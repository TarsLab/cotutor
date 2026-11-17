/**
 * 卡的注册表:卡只剩首页的两种——老师牌(tutor)、听写牌(dictation)。解析、剥秘密、退路、标题。
 * 课里的卡 2026-11-17 删了(《多模态教学harness-开发计划》阶段 5):首页写了别的种类,退成文字、记一句。
 */
import { CARD_KINDS, cardKind, cardLabel, parseCard, stripCard } from '../src/board/cards/index.ts';
import { check, done } from './_check.ts';

check('注册表:只有老师牌与听写牌', CARD_KINDS.map((k) => k.name).join() === 'tutor,dictation' && cardKind('tutor')?.name === 'tutor' && cardKind('choice') === undefined && cardKind('lecture') === undefined);
{
  const tut = parseCard('tutor chinese-tutor', '- activity 预习 我要预习小蝌蚪找妈妈\n范围: 第 22 课\n讲法: 先读课文\n讲法: 再认字\n小课堂 2026-09-18-po13-jian-8 13 减 8 怎么拆');
  check('老师牌:列表号去掉、参数与讲法挂上一个按钮(讲法多行拼起来)、小课堂带课包', tut.card.kind === 'tutor' && JSON.stringify(tut.card.props) === JSON.stringify({ tutor: 'chinese-tutor', buttons: [{ kind: 'activity', label: '我要预习小蝌蚪找妈妈', activity: '预习', params: { 范围: '第 22 课' }, brief: '先读课文\n再认字' }, { kind: 'lecture', label: '13 减 8 怎么拆', bundle: '2026-09-18-po13-jian-8' }] }) && !tut.warning, JSON.stringify(tut));
  check('开场按钮、接着按钮、新话题没有了(2026-11-16):写了整张牌退文字', ['我要预习', '接着 2026-09-16 1930-1 接着写', '新话题'].every((line) => parseCard('tutor chinese-tutor', line).fallback === true));
  check('老师牌下发孩子端:讲法与参数剥掉', JSON.stringify(stripCard(tut.card).props.buttons) === '[{"kind":"activity","label":"我要预习小蝌蚪找妈妈","activity":"预习","params":{}},{"kind":"lecture","label":"13 减 8 怎么拆","bundle":"2026-09-18-po13-jian-8"}]', JSON.stringify(stripCard(tut.card).props.buttons));
  const tooMany = parseCard('tutor math-tutor', 'activity a\nactivity b\nactivity c\nactivity d\nactivity e');
  check('老师牌:5 个按钮、没写老师、两位老师、坏老师名 → 文字 + fallback', tooMany.fallback === true && tooMany.warning?.includes('最多 4 个') === true && parseCard('tutor', 'activity a').fallback === true && parseCard('tutor a-tutor b-tutor', 'activity a').fallback === true && parseCard('tutor 数学', 'activity a').fallback === true, JSON.stringify(tooMany));
}
{
  const bad = parseCard('choice', '问?\n- [x] a');
  check('课里的卡写在首页:退成文字显示原文 + fallback,说清首页只放哪两种', bad.card.kind === 'text' && bad.card.props.text === '问?\n- [x] a' && bad.fallback === true && bad.warning?.includes('choice 卡放不了') === true, JSON.stringify(bad));
  check('没写种类、不认识的标签:同样退文字', parseCard('', 'x').fallback === true && parseCard('widget', 'x').card.kind === 'text');
  const dic = parseCard('dictation chinese-tutor', '春天\n鼓励 鼓励,老师鼓励我的鼓励\n叶 树叶的叶');
  check('听写牌:几个词;下发孩子端不带字(只有个数)', dic.card.kind === 'dictation' && !dic.fallback && !JSON.stringify(stripCard(dic.card).props).includes('春天'), JSON.stringify([dic, stripCard(dic.card)]));
  check('牌的标题:听写牌是词表;文字的是正文;截 40 字', cardLabel(dic.card).startsWith('春天、鼓励') && cardLabel({ kind: 'text', props: { text: '一'.repeat(50) } }).length === 41, cardLabel(dic.card));
}
done();
