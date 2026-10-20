/**
 * 一直听:一句收下还是放过(src/live/lib/listen.ts 的 judge),纯函数。
 * 空的、老师没问时只有语气词、和嘴最近 10 秒说过的字重合过六成(回声)放过;其余收下。
 */
import { check, done } from './_check.ts';

const { judge, overlap, ECHO_WINDOW_MS } = await import('../src/live/lib/listen.ts');
const now = 1_000_000;
const said = [{ text: '这幅图上是下课的时候,小朋友们都跑到操场上玩。', at: now - 2000 }];
const j = (text: string, asked = false, s = said) => judge(text, { asked, said: s, now });

check('空的、只有标点:放过 empty', !j('').take && (j('。') as { why: string }).why === 'empty' && (j('   ') as { why: string }).why === 'empty');
check('老师没问时只有「嗯」「啊」:放过 filler', (j('嗯。') as { why: string }).why === 'filler' && (j('啊啊') as { why: string }).why === 'filler' && (j('Um.') as { why: string }).why === 'filler');
check('笑声、一串语气词、server_vad 转成英文的「嗯」(And.)也放过', (j('哈哈哈。') as { why: string }).why === 'filler' && (j('嗯嗯嗯') as { why: string }).why === 'filler' && (j('And.') as { why: string }).why === 'filler' && (j('Oh, um.') as { why: string }).why === 'filler' && j('And then?').take === true && j('Red.').take);
check('老师刚问了:「嗯」「对」是回答,收下', j('嗯。', true).take && j('对。', true).take && j('好的', true).take);
check('一两个字的回答不当回声(碰巧在嘴的话里)', j('操场', false).take && j('下课', false).take);
check('嘴的话被麦克风收回来(转写是嘴说过的,哪怕只认出一截):放过 echo', (j('小朋友们都跑到操场上') as { why: string }).why === 'echo' && (j('下课的时候,小朋友们') as { why: string }).why === 'echo');
check('孩子说的和嘴说的沾一点边不算回声:收下', j('他们在操场上跳绳') .take && j('老师三明治怎么写').take, JSON.stringify(overlap('他们在操场上跳绳', said[0].text)));
check('嘴停了以后孩子照着说一遍(跟读、复述):字一样也收下,不当回声', judge('小朋友们都跑到操场上', { asked: false, said, now, mouthOn: false }).take && judge('the duck is under the bus', { asked: false, said: [{ text: 'The duck is under the bus.', at: now }], now, mouthOn: false }).take);
check(`回声只比 ${ECHO_WINDOW_MS / 1000} 秒以内嘴说过的`, j('小朋友们都跑到操场上', false, [{ text: said[0].text, at: now - ECHO_WINDOW_MS - 1 }]).take);
check('中英夹着的也比得上', (j('the duck is under the bus', false, [{ text: '你看,The duck is under the bus.', at: now }]) as { why: string }).why === 'echo' && j('I like the bus', false, [{ text: '你看,The duck is under the bus.', at: now }]).take);
done();
