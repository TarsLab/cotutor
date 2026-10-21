/**
 * 按钮的样子(src/lib/voice-view.ts):src/lib/voice-scenes.ts 每一格是一条用例(例子即测试),再查几条不变式。
 */
import { check, done } from './_check.ts';
import { voiceIn, voiceView, VOICE_SILENT_MS, type VoiceIn } from '../src/lib/voice-view.ts';
import { VOICE_SCENES } from '../src/lib/voice-scenes.ts';

for (const s of VOICE_SCENES) {
  const v = voiceView(voiceIn(s.input));
  check(`${s.group} · ${s.name} → ${s.expect}`, v.key === s.expect, v.key);
}
check('每一格的名字不重', new Set(VOICE_SCENES.map((s) => s.group + s.name)).size === VOICE_SCENES.length);

const V = (p: Partial<VoiceIn>) => voiceView(voiceIn(p));

// 两种声音:老师的是 out(三道小弧),孩子的是 in(竖条),插话两样都在
check('老师在说(按住说):老师的弧、头像是 talk、底是白的、按住能打断', (() => { const v = V({ status: 'mouth' }); return v.flow === 'out' && v.face === 'talk' && v.tone === 'white' && v.press === 'hold'; })());
check('孩子按着:蓝底、竖条往里、头像在听', (() => { const v = V({ status: 'holding', holdAudio: true }); return v.tone === 'blue' && v.flow === 'in' && v.face === 'listen' && !v.dots; })());
check('插话:两样都在', V({ open: true, status: 'mouth', hearing: true }).flow === 'both');
check('不是老师在线说话不画声音:卡、重放、小课堂', ['card', 'replay', 'lecture'].every((st) => { const v = V({ status: st as VoiceIn['status'] }); return v.flow === 'none' && v.face === 'still' && v.press === 'hold'; }));
check('嘴在说时脑还在写:照「老师在说」(嘴的声音优先)', V({ status: 'mouth', pending: true }).key === 'tutor');

// 按着没声音:3 秒前是竖条(页面按音量画小点),3 秒起小字换掉
check('按着没声音不满 3 秒:还是「按着在说」', V({ status: 'holding', holdAudio: true, silentMs: VOICE_SILENT_MS - 1 }).key === 'hold');
check('按着没声音满 3 秒:小点 +「我还没听到声音」', (() => { const v = V({ status: 'holding', holdAudio: true, silentMs: VOICE_SILENT_MS }); return v.dots && v.small === '我还没听到声音'; })());
check('上滑优先于没声音', V({ status: 'holding', holdAudio: true, silentMs: 9999, cancel: true }).key === 'cancel');

// 接不接按
check('老师在想:不接、按了说为什么', V({ pending: true }).press === 'hint');
check('嘴还没连上:不接(不掉进板书的识别)', V({ ready: false }).press === 'hint' && V({ ready: false, status: 'mouth' }).key === 'connecting');
check('录音卡在录:不接、整颗淡', (() => { const v = V({ status: 'recording' }); return v.press === 'off' && v.faded; })());
check('一直听:都是开关麦', VOICE_SCENES.filter((s) => s.input.open).every((s) => V(s.input).press === 'toggle'));
check('一直听时点一下没按住的提示不出(点一下就是开关麦)', V({ open: true, hint: 'tap' }).key === 'open');

// 提示:晃一下;平时不晃
check('提示都晃一下', (['busy', 'connecting', 'unclear', 'tap'] as const).every((h) => V({ hint: h, pending: h === 'busy' }).shake));
check('没提示时不晃', VOICE_SCENES.filter((s) => !s.input.hint).every((s) => !V(s.input).shake));
check('老师在想时按了:提示压过「老师在想」', V({ pending: true, hint: 'busy' }).big === '老师在想,等一下再说');

// 穷举:每种状态 × 开关组合都给得出一种样子,不抛
const statuses: VoiceIn['status'][] = ['quiet', 'holding', 'mouth', 'card', 'recording', 'lecture', 'ring', 'replay'];
let n = 0, bad = 0;
for (const status of statuses) for (let bits = 0; bits < 1 << 9; bits++) {
  const b = (k: number) => Boolean(bits & (1 << k));
  const v = V({ status, open: b(0), hearing: b(1), ducked: b(2), muted: b(3), turn: b(4), pending: b(5), photo: b(6), ready: !b(7), holdAudio: b(8) });
  n++;
  if (!v.key || !['white', 'blue', 'grey', 'cancel', 'light'].includes(v.tone) || !['out', 'in', 'both', 'none'].includes(v.flow)) bad++;
}
check(`穷举 ${n} 种组合都有样子`, bad === 0, String(bad));

done();
