/**
 * 按钮的样子(src/ui/kid/voice-view.ts):src/ui/dev/voice-scenes.ts 每一格是一条用例(例子即测试),再查几条不变式。
 */
import { check, done } from './_check.ts';
import { voiceIn, voiceView, VOICE_SILENT_MS, type VoiceIn } from '../src/ui/kid/voice-view.ts';
import { VOICE_SCENES } from '../src/ui/dev/voice-scenes.ts';

for (const s of VOICE_SCENES) {
  const v = voiceView(voiceIn(s.input));
  check(`${s.group} · ${s.name} → ${s.expect}`, v.key === s.expect, v.key);
}
check('每一格的名字不重', new Set(VOICE_SCENES.map((s) => s.group + s.name)).size === VOICE_SCENES.length);

const V = (p: Partial<VoiceIn>) => voiceView(voiceIn(p));

check('老师说话可以打断，头像处于讲解态', V({ status:'mouth' }).face === 'talk' && V({ status:'mouth' }).press === 'hold');
check('按着时提示松手发送', V({ status:'holding', holdAudio:true }).big === '松手发送');
check('直接说时保留开麦标记', V({ open:true, hearing:true }).mic === '开');
check('重放、小课堂头像静止', ['replay','lecture'].every(status => V({ status:status as VoiceIn['status'] }).face === 'still'));
check('看图途中关麦，等待和开麦入口都在', V({ open:true, pending:true, photo:true, muted:true }).photo && V({ open:true, pending:true, photo:true, muted:true }).mic === '关');
check('看图时再按一次，仍能看到眼睛', V({ pending:true, photo:true, hint:'busy' }).photo);
check('下一句出声立即结束等待', V({ status:'mouth', pending:true, hint:'busy' }).face === 'talk');
check('嘴在说时脑还在写:照「老师在说」(嘴的声音优先)', V({ status: 'mouth', pending: true }).key === 'tutor');

// 按着没声音:3 秒后给出文字提示
check('按着没声音不满 3 秒:还是「按着在说」', V({ status: 'holding', holdAudio: true, silentMs: VOICE_SILENT_MS - 1 }).key === 'hold');
check('按着没声音满 3 秒:提示「我还没听到声音」', (() => { const v = V({ status: 'holding', holdAudio: true, silentMs: VOICE_SILENT_MS }); return v.big === '我还没听到声音'; })());
check('上滑优先于没声音', V({ status: 'holding', holdAudio: true, silentMs: 9999, cancel: true }).key === 'cancel');

// 接不接按
check('老师在想:不接、按了说为什么', V({ pending: true }).press === 'hint');
check('嘴还没连上:不接(不掉进板书的识别)', V({ ready: false }).press === 'hint' && V({ ready: false, status: 'mouth' }).key === 'connecting');
check('一直听:都是开关麦', VOICE_SCENES.filter((s) => s.input.open).every((s) => V(s.input).press === 'toggle'));
check('一直听时点一下没按住的提示不出(点一下就是开关麦)', V({ open: true, hint: 'tap' }).key === 'open');

// 提示:晃一下;平时不晃
check('提示都晃一下', (['busy', 'connecting', 'unclear', 'tap'] as const).every((h) => V({ hint: h, pending: h === 'busy' }).shake));
check('没提示时不晃', VOICE_SCENES.filter((s) => !s.input.hint).every((s) => !V(s.input).shake));
check('老师在想时按了:提示压过「老师在想」', V({ pending: true, hint: 'busy' }).small === '等老师一下');

// 穷举:每种状态 × 开关组合都给得出一种样子,不抛
const statuses: VoiceIn['status'][] = ['quiet', 'holding', 'mouth', 'lecture', 'replay'];
let n = 0, bad = 0;
for (const status of statuses) for (let bits = 0; bits < 1 << 9; bits++) {
  const b = (k: number) => Boolean(bits & (1 << k));
  const v = V({ status, open: b(0), hearing: b(1), ducked: b(2), muted: b(3), turn: b(4), pending: b(5), photo: b(6), ready: !b(7), holdAudio: b(8) });
  n++;
  if (!v.key || !v.big || !['hold', 'hint', 'toggle'].includes(v.press)) bad++;
}
check(`穷举 ${n} 种组合都有样子`, bad === 0, String(bad));

done();
