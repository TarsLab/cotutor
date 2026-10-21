/**
 * 实时老师页那颗「头像 + 按住说话」按钮的样子:状态 → 样子(《wip/实时老师设想.md》拍板 23,《wip/实时老师页改版设计.md》§二之二)。纯函数。
 * 页面在一处(kid-page.ts 的 voiceSync)把手上的状态凑成 VoiceIn 交进来,拿到 VoiceView 交给 src/server/voice-ui.ts 的 voiceButton 画;
 * 画法(颜色、动画、快慢)都在 voice-ui.ts 开头的调参表里,这里只管「这一刻是哪种样子、写什么字、接不接按」。
 * 两种声音两种样子:老师的是头像旁三道小弧「)))」、不走,只有深浅跟老师的音量(flow out);孩子的是竖条、往头像里走(flow in);插话时两样都在、老师的淡到三成(both)。
 * 不是老师在线说话(卡在念、再听一遍、小课堂在放)不画声音:孩子看按钮就知道是不是能接话的老师在说。
 * 每种样子在 src/lib/voice-scenes.ts 有一格(例子即测试,tests/voice-view.test.ts;工作台 /dev/voice 照它摆样张)。
 * 剥类型内联进孩子端页面与 /dev/voice(同 live-board.ts):名字都带 voice 前缀,别和别的内联文件撞。
 */

/** 按钮底色:white 平时 · blue 孩子按着 · grey 老师在想 / 叫老师 / 麦关了 · cancel 上滑要取消 · light 一直听(淡蓝) */
export type VoiceTone = 'white' | 'blue' | 'grey' | 'cancel' | 'light';
/** 头像:still 不动 · talk 老师在说(只留一道淡淡的外圈,不放大)· listen 在听 · think 一段一段转 · ring 左右晃(响铃)· dim 淡 */
export type VoiceFace = 'still' | 'talk' | 'listen' | 'think' | 'ring' | 'dim';
/** 声音:out 老师的三道小弧 · in 孩子的竖条往头像里走 · both 插话(两样都在,老师的淡到三成)· none 不画 */
export type VoiceFlow = 'out' | 'in' | 'both' | 'none';
/** 大字前的小图标 */
export type VoiceIcon = '' | 'mic' | 'micOff' | 'photo' | 'up' | 'phone' | 'rec';
/** 按下去:hold 按住说话 · toggle 点一下开 / 关麦(一直听)· hint 不接、晃一下说为什么 · off 不接(录音卡在录) */
export type VoicePress = 'hold' | 'toggle' | 'hint' | 'off';
/** 刚才那一下的提示(页面留 2 秒):busy 老师在想时按了 · connecting 嘴还没连上时按了 · unclear 太短 / 麦克风没开上 · tap 点一下没按住 */
export type VoiceHint = '' | 'busy' | 'connecting' | 'unclear' | 'tap';

export interface VoiceIn {
  /** liveStep 的状态(src/lib/live-board.ts 的 LiveStatus) */
  status: 'quiet' | 'holding' | 'mouth' | 'card' | 'recording' | 'lecture' | 'ring' | 'replay';
  /** 一直听;hearing 服务端说孩子在说;ducked 嘴的声音压低着;muted 关了麦;turn 热身那拍等孩子跟 */
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
  /** 空板上等孩子先点上面一个(口语单拍好的「先热身,再打电话」、今天点过同一个按钮的「接着那个 / 重新开始」):点之前不接(《wip/实时老师设想.md》拍板 24) */
  choose: boolean;
  /** 按着:麦克风开上了没有、往上滑过门限没有、多久没声音(毫秒) */
  holdAudio: boolean;
  cancel: boolean;
  silentMs: number;
  hint: VoiceHint;
}

export interface VoiceView {
  /** 这是哪一种(按钮的 data-voice;探针、样张认它) */
  key: string;
  tone: VoiceTone;
  face: VoiceFace;
  flow: VoiceFlow;
  /** 孩子的竖条换成小点(按着但没声音、话筒还没开) */
  dots: boolean;
  /** 大字(居中那行);'' = 没有 */
  big: string;
  icon: VoiceIcon;
  /** 大字后面跳三个点(在想、在叫) */
  wait: boolean;
  /** 下沿的小字;'' = 没有 */
  small: string;
  /** 变成这种样子时左右晃一下 */
  shake: boolean;
  /** 慢慢呼吸的光(轮到你跟读) */
  breathe: boolean;
  /** 整颗淡(录音卡在录) */
  faded: boolean;
  press: VoicePress;
}

/** 按着多久没声音,小字换成「我还没听到声音」(麦克风坏了也看得出) */
export const VOICE_SILENT_MS = 3000;

export function voiceIn(p: Partial<VoiceIn> = {}): VoiceIn {
  return { status: 'quiet', open: false, hearing: false, ducked: false, muted: false, turn: false, pending: false, photo: false, ready: true, choose: false, holdAudio: false, cancel: false, silentMs: 0, hint: '', ...p };
}

const voiceLook = (o: Partial<VoiceView> & { key: string }): VoiceView => ({ tone: 'white', face: 'still', flow: 'none', dots: false, big: '', icon: '', wait: false, small: '', shake: false, breathe: false, faded: false, press: 'hold', ...o });

export function voiceView(i: VoiceIn): VoiceView {
  // 先点上面一个:按钮灰着写「点上面开始」,不接(按了晃一下);嘴连没连上、一直听不一直听都一样
  if (i.choose) return voiceLook({ key: 'choose', tone: 'grey', big: '点上面开始', press: 'hint' });
  // 刚才那一下的提示:晃一下、字留 2 秒(页面管时长)
  if (i.hint === 'busy') return voiceLook({ key: 'busy', tone: 'grey', face: 'think', big: '老师在想,等一下再说', shake: true, press: 'hint' });
  if (i.hint === 'connecting' || !i.ready) return voiceLook({ key: 'connecting', tone: 'grey', face: 'dim', big: '正在叫老师', wait: true, shake: i.hint === 'connecting', press: 'hint' });
  if (i.status === 'holding') {
    if (i.cancel) return voiceLook({ key: 'cancel', tone: 'cancel', face: 'dim', icon: 'up', big: '松手取消' });
    if (!i.holdAudio) return voiceLook({ key: 'hold-wait', tone: 'blue', face: 'listen', flow: 'in', dots: true, small: '等一下…' });
    if (i.silentMs >= VOICE_SILENT_MS) return voiceLook({ key: 'hold-silent', tone: 'blue', face: 'listen', flow: 'in', dots: true, small: '我还没听到声音' });
    return voiceLook({ key: 'hold', tone: 'blue', face: 'listen', flow: 'in', small: '松手发送 · 往上滑取消' });
  }
  if (i.status === 'recording') return voiceLook({ key: 'recording', face: 'dim', icon: 'rec', big: '在录音', faded: true, press: 'off' });
  if (i.open) {
    // 一直听:不用按,这颗是麦克风开关
    const small = i.muted ? '点一下开麦' : '点一下关麦';
    if (i.status === 'ring') return voiceLook({ key: 'ring', tone: 'light', face: 'ring', icon: 'phone', big: '老师打电话来了', small: '铃响完老师就开口', press: 'toggle' });
    if (i.muted) return i.status === 'mouth'
      ? voiceLook({ key: 'muted-tutor', tone: 'grey', face: 'talk', flow: 'out', small: '麦关了 · 点一下开麦', press: 'toggle' })
      : voiceLook({ key: 'muted', tone: 'grey', face: 'dim', icon: 'micOff', big: '麦关了', small, press: 'toggle' });
    if (i.hearing && i.status === 'mouth') return voiceLook({ key: 'interrupt', tone: 'light', face: 'listen', flow: 'both', small, press: 'toggle' });
    if (i.hearing) return voiceLook({ key: 'open-kid', tone: 'light', face: 'listen', flow: 'in', small, press: 'toggle' });
    if (i.status === 'mouth') return voiceLook({ key: 'open-tutor', tone: 'light', face: 'talk', flow: 'out', small, press: 'toggle' });
    if (i.turn) return voiceLook({ key: 'turn', tone: 'light', big: '轮到你说', small, breathe: true, press: 'toggle' });
    if (i.pending) return voiceLook({ key: 'open-think', tone: 'light', face: 'think', big: '老师在想', wait: true, small, press: 'toggle' });
    return voiceLook({ key: 'open', tone: 'light', big: '我在听,直接说', small, press: 'toggle' });
  }
  // 提示里剩下的两种(一直听时点一下是开关麦,不会有)
  if (i.hint === 'unclear') return voiceLook({ key: 'unclear', big: '没听清,再按住说一次', shake: true });
  if (i.hint === 'tap') return voiceLook({ key: 'tap', big: '按住不放,说完再松手', shake: true });
  if (i.status === 'mouth') return voiceLook({ key: 'tutor', face: 'talk', flow: 'out', small: '按住说话' });
  if (i.status === 'ring') return voiceLook({ key: 'ring', face: 'ring', icon: 'phone', big: '老师打电话来了' });
  // 卡的声音、重放、小课堂:不是老师在线说话,按钮照安静的样子(按住照样打断它们)
  if (i.status === 'card' || i.status === 'replay' || i.status === 'lecture') return voiceLook({ key: i.status, icon: 'mic', big: '按住说话' });
  if (i.pending) return i.photo
    ? voiceLook({ key: 'photo', tone: 'grey', face: 'think', icon: 'photo', big: '在看你的图片', wait: true, press: 'hint' })
    : voiceLook({ key: 'think', tone: 'grey', face: 'think', big: '老师在想', wait: true, press: 'hint' });
  return voiceLook({ key: 'idle', icon: 'mic', big: '按住说话' });
}
