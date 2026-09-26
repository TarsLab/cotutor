/**
 * 录音卡(《口播老师设计.md》§2–3):围栏解析(风险字、拼音题、focus、退化)、给老师的一行(判、原因截断、没评上、还没评完)、
 * 示范音、状态契约;页面那一半的纯函数(调号、下一张没录的、锁没锁、有状态、底色、能标注的字)。
 */
import { cardAssets, describeCard, parseCard, parseCardState, stripSecrets, type Heard } from '../src/cards/index.ts';
import { cardTexts, hasState, isHeavy, nextUnrecorded, recordLocked, recordSeconds, stateSummary, tintFor, toneMark, toneMarks, type BoardCard, type BoardSection } from '../src/lib/kid-board.ts';
import { check, done } from './_check.ts';

// ---- 解析 ----
const s1 = parseCard('record focus=sh_s,n_ng', '老师上【山】看【树】');
check('句子:【】剥掉,风险字按字记下标,focus 拆开', s1.card.kind === 'record' && s1.card.props.text === '老师上山看树' && JSON.stringify(s1.card.props.risk) === '[3,5]' && s1.card.props.mode === 'sentence' && JSON.stringify(s1.card.props.focus) === '["sh_s","n_ng"]' && !s1.warning, JSON.stringify(s1));
const s2 = parseCard('record pinyin', 'shi2 si4 shi4 shi2 si4\n【十】四【是】【十】四');
check('拼音题:第一行送评,第二行给人看,风险字记在第二行', s2.card.props.text === 'shi2 si4 shi4 shi2 si4' && s2.card.props.show === '十四是十四' && JSON.stringify(s2.card.props.risk) === '[0,2,3]' && s2.card.props.mode === 'pinyin', JSON.stringify(s2));
check('拼音题也认 mode=pinyin、v 写 ü;只写拼音不写字也行', parseCard('record mode=pinyin', 'lv4 nv3').card.props.text === 'lü4 nü3' && parseCard('record pinyin', 'shi4 si4').card.props.show === undefined);
check('一张卡两句 → 退文字卡 + warning', parseCard('record', '老师上山看树\n四是四').card.kind === 'text' && Boolean(parseCard('record', '老师上山看树\n四是四').warning));
check('超过 30 个字 → 退文字卡', parseCard('record', '一'.repeat(31)).card.kind === 'text' && parseCard('record', '一'.repeat(30)).card.kind === 'record');
check('没有汉字(英文句子)→ 退文字卡', parseCard('record', 'hello world').card.kind === 'text');
check('拼音行没调号 → 退文字卡', parseCard('record pinyin', 'shi si').card.kind === 'text');
check('答案没什么可剥:孩子端 props 原样', JSON.stringify(stripSecrets({ cards: [s1.card], lines: [] }).cards[0].props) === JSON.stringify(s1.card.props));

// ---- 示范音 ----
check('示范音:句子念原句,拼音题念第二行的字,只有拼音不配', JSON.stringify(cardAssets(s1.card)) === '[{"file":"1.mp3","text":"老师上山看树"}]' && cardAssets(s2.card)[0].text === '十四是十四' && cardAssets(parseCard('record pinyin', 'shi4 si4').card).length === 0);

// ---- 状态契约 ----
const audio = 'conversations/koubo-tutor/2026-09-26.1620-1.cards/2/rec-1.webm';
check('状态:录音路径 + 秒数', parseCardState(s1.card, { audio, seconds: 7.1 }).ok);
check('状态:路径不在卡的资产目录下、秒数超 60 → 不收', !parseCardState(s1.card, { audio: '../../etc/passwd', seconds: 3 }).ok && !parseCardState(s1.card, { audio, seconds: 99 }).ok);
const smuggled = parseCardState(s1.card, { audio, seconds: 3, verdict: '过' });
check('状态:页面塞进来的判被剥掉,存不进去', smuggled.ok && !('verdict' in (smuggled.state as object)), JSON.stringify(smuggled));

// ---- 给老师的一行 ----
const st = { audio, seconds: 7.1 };
const heard = (over: Partial<Extract<Heard, { ok: true }>>): Heard => ({ ok: true, take: '20260926-162203-b7a1c2', verdict: '重录', reasons: ['句准确度 36 < 80', '山 的 sh 19 < 65,读成 s', '树 的 sh 20 < 65'], chars: [], costYuan: 0.02, ...over });
check('没评测:只有秒数', describeCard(s1.card, st) === 'record「老师上山看树」 已录 7.1 秒');
check('重录:判 + 原因 + take', describeCard(s1.card, st, heard({})) === 'record「老师上山看树」 已录 7.1 秒;判 重录:句准确度 36 < 80;山 的 sh 19 < 65,读成 s;树 的 sh 20 < 65;take=20260926-162203-b7a1c2');
check('过:不带原因', describeCard(s1.card, st, heard({ verdict: '过', reasons: ['全部过线'] })) === 'record「老师上山看树」 已录 7.1 秒;判 过;take=20260926-162203-b7a1c2');
const many = describeCard(s1.card, st, heard({ reasons: Array.from({ length: 9 }, (_x, i) => `第 ${i} 条`) }));
check('原因最多 6 条,多了写还有几条', many.includes('第 5 条') && !many.includes('第 6 条') && many.includes('…还有 3 条'), many);
const long = describeCard(s1.card, st, heard({ reasons: Array.from({ length: 6 }, () => '很长'.repeat(40)) }));
check('整行不超过 300 字(卡的标题另算)', Array.from(long.slice(long.indexOf(' ') + 1)).length <= 300, String(long.length));
check('没评上:写原因', describeCard(s1.card, st, { ok: false, error: 'timeout' }) === 'record「老师上山看树」 已录 7.1 秒;没评上(timeout)');
check('还没评完', describeCard(s1.card, st, 'pending').endsWith(';还没评完'));
check('拼音题的标题是给人看的字', describeCard(s2.card, st).startsWith('record「十四是十四」'));

// ---- 页面那一半 ----
check('调号:a / e 优先,ou 标 o,否则最后一个元音;ü;轻声不标', toneMark('shi4') === 'shì' && toneMark('hao3') === 'hǎo' && toneMark('gou3') === 'gǒu' && toneMark('xiu1') === 'xiū' && toneMark('hui4') === 'huì' && toneMark('lv4') === 'lǜ' && toneMark('ma5') === 'ma' && toneMark('abc') === 'abc');
check('一串拼音', toneMarks('shi2 si4  shi4') === 'shí sì shì');
const rec = (seconds = 0): BoardCard => ({ ...s1.card, ...(seconds ? { state: { audio, seconds } } : {}) });
const text: BoardCard = { kind: 'text', props: { text: '今天练 sh' } };
const sec: BoardSection = { cards: [text, rec(2.4), rec(), rec()], lines: [] };
check('下一张没录的:往后找,转一圈;都录了 → -1', nextUnrecorded(sec, 1) === 2 && nextUnrecorded(sec, 3) === 2 && nextUnrecorded({ cards: [text, rec(1), rec(2)], lines: [] }, 1) === -1);
const secs = [{ ...sec, job: '1620-1' }, { ...sec, job: '1624-1' }] as unknown as BoardSection[]; // 页面的节带 job(sectionsFromMessages)
check('锁:后面老师又出了一节就锁;最后一节交了才锁', recordLocked(secs, 0, new Set()) && !recordLocked(secs, 1, new Set()) && recordLocked(secs, 1, new Set(['1624-1'])));
check('有状态、轻卡(不开 iframe)、底色紫', hasState(rec()) && !isHeavy(rec()) && tintFor(rec()) === 'plum');
check('录了几秒;交给老师钮看它', recordSeconds(rec(2.4)) === 2.4 && recordSeconds(rec()) === 0 && stateSummary(rec(2.4))[0] === '录了 2.4 秒' && stateSummary(rec()).length === 0);
check('能标注的字:句子 / 拼音题给人看的字;只有拼音的没有', cardTexts(s1.card)[0] === '老师上山看树' && cardTexts(s2.card)[0] === '十四是十四' && cardTexts(parseCard('record pinyin', 'shi4 si4').card)[0] === '');

done();
