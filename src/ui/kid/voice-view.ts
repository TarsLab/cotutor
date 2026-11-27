/** 孩子端和工作台共用的老师签状态。输入方式决定手势，按钮的文字、C 环和开关麦标记由这里选定。 */
/** 按下去:hold 按住说话 · toggle 点一下开 / 关麦(一直听)· hint 不接、晃一下说为什么 */
export type VoicePress = 'hold' | 'toggle' | 'hint';
/** 刚才那一下的提示(页面留 2 秒):busy 老师在想时按了 · connecting 嘴还没连上时按了 · unclear 太短 / 麦克风没开上 · tap 点一下没按住 */
export type VoiceHint = '' | 'busy' | 'connecting' | 'unclear' | 'tap';

export interface VoiceIn {
  /** liveStep 的状态(src/runtime/delivery/player.ts 的 LiveStatus) */
  status: 'quiet' | 'holding' | 'mouth' | 'lecture' | 'replay' | 'reading';
  /** 一直听;hearing 服务端说孩子在说;ducked 嘴的声音压低着;muted 关了麦;turn 请他说的那句念完了,等他说([[请 说 …]]) */
  open: boolean;
  hearing: boolean;
  ducked: boolean;
  muted: boolean;
  turn: boolean;
  /** 脑在写(页面的 S.pending) */
  pending: boolean;
  /** 这一轮发的是照片(脑在读图) */
  photo: boolean;
  /** 嘴连上了(页面的 LV.ready) */
  ready: boolean;
  /** 在看以前的话题:只能看,不接(左栏底下一行「回到今天」) */
  readonly: boolean;
  /** 按着:麦克风开上了没有、往上滑过门限没有、多久没声音(毫秒) */
  holdAudio: boolean;
  cancel: boolean;
  silentMs: number;
  hint: VoiceHint;
}

export interface VoiceView {
  key: string;
  face: 'still' | 'talk' | 'listen' | 'think' | 'dim';
  big: string;
  small: string;
  mic: '' | '开' | '关';
  photo: boolean;
  shake: boolean;
  breathe: boolean;
  press: VoicePress;
}

/** 按着多久没声音,提示换成「没听见」(麦克风坏了也看得出) */
export const VOICE_SILENT_MS = 3000;

export function voiceIn(p: Partial<VoiceIn> = {}): VoiceIn {
  return { status: 'quiet', open: false, hearing: false, ducked: false, muted: false, turn: false, pending: false, photo: false, ready: true, readonly: false, holdAudio: false, cancel: false, silentMs: 0, hint: '', ...p };
}

const voiceLook = (key: string, big: string, o: Partial<VoiceView> = {}): VoiceView =>
  ({ key, big, small: '', face: 'still', mic: '', photo: false, shake: false, breathe: false, press: 'hold', ...o });

export function voiceView(i: VoiceIn): VoiceView {
  if (i.readonly) return voiceLook('readonly', '以前的话题', { face: 'dim', press: 'hint' });
  if (!i.ready || i.hint === 'connecting') return voiceLook('connecting', '正在叫老师', { face: 'dim', shake: !!i.hint, press: 'hint' });
  if (i.status === 'holding') {
    if (i.cancel) return voiceLook('cancel', '松手取消');
    if (!i.holdAudio) return voiceLook('hold-wait', '正在开麦', { face: 'listen' });
    if (i.silentMs >= VOICE_SILENT_MS) return voiceLook('hold-silent', '没听见', { face: 'listen' });
    return voiceLook('hold', '松手发送', { face: 'listen' });
  }
  const mic = i.open ? i.muted ? '关' : '开' : '';
  const action: Partial<VoiceView> = i.open ? { mic, small: i.muted ? '点一下开麦' : '点一下关麦', press: 'toggle' } : {};
  if (i.open && i.hearing && !i.muted) return voiceLook(i.status === 'mouth' ? 'interrupt' : 'open-kid', '我在听', { ...action, face: 'listen' });
  if (i.status === 'mouth') return voiceLook(i.open ? i.muted ? 'muted-tutor' : 'open-tutor' : 'tutor', '老师在说', { ...action, face: 'talk' });
  if (!i.open && (i.status === 'replay' || i.status === 'lecture' || i.status === 'reading')) return voiceLook(i.status, '按住说话');
  if (i.pending) {
    const busy = i.hint === 'busy' && !i.open;
    const key = busy ? 'busy' : (i.open ? 'open-' : '') + (i.photo ? 'photo' : 'think');
    return voiceLook(key, i.photo ? '正在看图' : '老师在想', { press: 'hint', ...action, photo: i.photo, face: 'think', shake: busy });
  }
  if (i.open && i.muted) return voiceLook('muted', '麦关了', { ...action, face: 'dim' });
  if (i.turn) return voiceLook(i.open ? 'turn' : 'turn-hold', '轮到你说', { small: '按住说话', ...action, breathe: true });
  if (i.open) return voiceLook('open', '直接说', action);
  if (i.hint === 'unclear') return voiceLook('unclear', '再说一次', { shake: true });
  if (i.hint === 'tap') return voiceLook('tap', '按住说话', { shake: true });
  return voiceLook(i.status === 'quiet' ? 'idle' : i.status, '按住说话');
}
