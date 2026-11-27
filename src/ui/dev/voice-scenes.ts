/** 工作台可预览的老师签状态，也是 voice-view.test.ts 的状态用例。 */
import type { VoiceIn } from '../kid/voice-view.ts';

export interface VoiceScene {
  /** 样张上的分组 */
  group: string;
  name: string;
  /** 什么时候是它(一句) */
  note: string;
  input: Partial<VoiceIn>;
  /** 样张里用哪位老师的样子:语文(按住说)/ 英语(口语课一直听) */
  tutor: 'chinese' | 'english';
  /** voiceView 该给的 key */
  expect: string;
}

export const VOICE_SCENES: VoiceScene[] = [
  { group: '老师这边', name: '安静 · 等你说', note: '老师讲完、孩子还没开口', input: {}, tutor: 'chinese', expect: 'idle' },
  { group: '老师这边', name: '正在叫老师', note: '刚进老师页、换连接,嘴还没连上(一两秒);按了晃一下', input: { ready: false }, tutor: 'chinese', expect: 'connecting' },
  { group: '老师这边', name: '以前的话题 · 只能看', note: '看以前的话题:灰着、不接(按了晃一下),底下一行「回到今天」', input: { readonly: true }, tutor: 'chinese', expect: 'readonly' },
  { group: '老师这边', name: '老师在说', note: '老师讲解时头像静止，字幕留在页底', input: { status: 'mouth' }, tutor: 'chinese', expect: 'tutor' },
  { group: '老师这边', name: '老师两句之间', note: '两句话之间，老师签保持静止', input: { status: 'mouth' }, tutor: 'chinese', expect: 'tutor' },
  { group: '老师这边', name: '老师在想', note: '立即显示「老师在想」，等满两秒 C 环才转', input: { pending: true }, tutor: 'chinese', expect: 'think' },
  { group: '老师这边', name: '在看你的图片', note: '正在看图，头像旁的小眼睛保持静止', input: { pending: true, photo: true }, tutor: 'chinese', expect: 'photo' },
  { group: '孩子这边', name: '按着在说', note: '手指压住纸面，松手后纸页回平', input: { status: 'holding', holdAudio: true }, tutor: 'chinese', expect: 'hold' },
  { group: '孩子这边', name: '话筒还没开', note: '刚按下,麦克风还在开(这时说的进不去)', input: { status: 'holding' }, tutor: 'chinese', expect: 'hold-wait' },
  { group: '孩子这边', name: '按着、没出声', note: '按住 3 秒还没声音时提醒孩子', input: { status: 'holding', holdAudio: true, silentMs: 3200 }, tutor: 'chinese', expect: 'hold-silent' },
  { group: '孩子这边', name: '往上滑 · 松手取消', note: '手指往上滑过一个按钮高', input: { status: 'holding', holdAudio: true, cancel: true }, tutor: 'chinese', expect: 'cancel' },
  { group: '孩子这边', name: '太短 / 没听清', note: '按不到 0.4 秒、麦克风没开上:晃一下,字留 2 秒', input: { hint: 'unclear' }, tutor: 'chinese', expect: 'unclear' },
  { group: '孩子这边', name: '点一下没按住', note: '不到 150 毫秒就松手', input: { hint: 'tap' }, tutor: 'chinese', expect: 'tap' },
  { group: '孩子这边', name: '老师在想时按了', note: '不接,晃一下', input: { pending: true, hint: 'busy' }, tutor: 'chinese', expect: 'busy' },
  { group: '别的声音', name: '再听一遍', note: '放的是刚才录下的老师,不是老师在说', input: { status: 'replay' }, tutor: 'chinese', expect: 'replay' },
  { group: '别的声音', name: '小课堂在放', note: '课里原来的声音在舞台上放', input: { status: 'lecture' }, tutor: 'chinese', expect: 'lecture' },
  { group: '别的声音', name: '轮到你说(按住说)', note: '老师请他说的那句([[请 说 …]])念完:C 环轻轻亮两次', input: { turn: true }, tutor: 'english', expect: 'turn-hold' },
  { group: '一直听', name: '在听', note: '不用按,这颗是麦克风开关', input: { open: true }, tutor: 'english', expect: 'open' },
  { group: '一直听', name: '孩子在说', note: '服务端判出孩子开口', input: { open: true, hearing: true }, tutor: 'english', expect: 'open-kid' },
  { group: '一直听', name: '老师在说', note: '头像静止，保留开麦标记', input: { open: true, status: 'mouth' }, tutor: 'english', expect: 'open-tutor' },
  { group: '一直听', name: '孩子插话', note: '孩子直接开口，签上写「我在听」', input: { open: true, status: 'mouth', hearing: true, ducked: true }, tutor: 'english', expect: 'interrupt' },
  { group: '一直听', name: '老师在想', note: '脑在写', input: { open: true, pending: true }, tutor: 'english', expect: 'open-think' },
  { group: '一直听', name: '正在看图', note: '看图时也显示麦克风状态', input: { open: true, pending: true, photo: true }, tutor: 'english', expect: 'open-photo' },
  { group: '一直听', name: '麦关了', note: '标记显示麦克风已关', input: { open: true, muted: true }, tutor: 'english', expect: 'muted' },
  { group: '一直听', name: '麦关了、老师在说', note: '老师签安静地显示关麦标记', input: { open: true, muted: true, status: 'mouth' }, tutor: 'english', expect: 'muted-tutor' },
  { group: '一直听', name: '轮到你(跟读)', note: '请他说的那句([[请 说 …]])念完等他说:C 环轻轻亮两次', input: { open: true, turn: true }, tutor: 'english', expect: 'turn' },
];
