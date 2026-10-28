/**
 * 按钮的各个场景:一格 = 一种状态、它该是哪种样子(voice-view.ts)、样张里放什么声音。
 * 例子即测试:tests/voice-view.test.ts 逐格查 voiceView 给的 key;工作台 /dev/voice 照这张表把每格用真的按钮摆出来,声音是模拟的。
 * 加一种场景:这里加一格 → 测试跟着过 → /dev/voice 自己就有。不进孩子端页面(那边只要 voice-view)。
 */
import type { VoiceIn } from './voice-view.ts';

export interface VoiceScene {
  /** 样张上的分组 */
  group: string;
  name: string;
  /** 什么时候是它(一句) */
  note: string;
  input: Partial<VoiceIn>;
  /** 样张里模拟的声音:tutor 老师一段一段说 · kid 孩子说说停停 · kidQuiet 按着没声音 · both 插话(两个人同时)· none 没声音 */
  sound: 'tutor' | 'kid' | 'kidQuiet' | 'both' | 'none';
  /** 样张里用哪位老师的样子:语文(按住说)/ 英语(口语课一直听) */
  tutor: 'chinese' | 'english';
  /** voiceView 该给的 key */
  expect: string;
}

export const VOICE_SCENES: VoiceScene[] = [
  { group: '老师这边', name: '安静 · 等你说', note: '老师讲完、孩子还没开口', input: {}, sound: 'none', tutor: 'chinese', expect: 'idle' },
  { group: '老师这边', name: '正在叫老师', note: '刚进老师页、换连接,嘴还没连上(一两秒);按了晃一下', input: { ready: false }, sound: 'none', tutor: 'chinese', expect: 'connecting' },
  { group: '老师这边', name: '今天点过 · 点上面开始', note: '今天点过同一个按钮:左栏先问「接着那个 / 重新开始」,点之前按钮灰着、不接', input: { choose: true }, sound: 'none', tutor: 'chinese', expect: 'choose' },
  { group: '老师这边', name: '老师在说', note: '头像旁三道小弧,深浅跟嘴的音量;不走、不放大', input: { status: 'mouth' }, sound: 'tutor', tutor: 'chinese', expect: 'tutor' },
  { group: '老师这边', name: '老师两句之间', note: '还在说这一轮,但这会儿没声音:三道弧淡到最低', input: { status: 'mouth' }, sound: 'none', tutor: 'chinese', expect: 'tutor' },
  { group: '老师这边', name: '老师在想', note: '脑在写、嘴没出声;按了晃一下「老师在想,等一下再说」', input: { pending: true }, sound: 'none', tutor: 'chinese', expect: 'think' },
  { group: '老师这边', name: '在看你的图片', note: '发了照片:「我看一看图片」之后到读完图', input: { pending: true, photo: true }, sound: 'none', tutor: 'chinese', expect: 'photo' },
  { group: '孩子这边', name: '按着在说', note: '整块变蓝,竖条从另一头往头像里走,高低跟麦克风', input: { status: 'holding', holdAudio: true }, sound: 'kid', tutor: 'chinese', expect: 'hold' },
  { group: '孩子这边', name: '话筒还没开', note: '刚按下,麦克风还在开(这时说的进不去)', input: { status: 'holding' }, sound: 'kidQuiet', tutor: 'chinese', expect: 'hold-wait' },
  { group: '孩子这边', name: '按着、没出声', note: '小点慢慢走;3 秒还没声音换成「我还没听到声音」', input: { status: 'holding', holdAudio: true, silentMs: 3200 }, sound: 'kidQuiet', tutor: 'chinese', expect: 'hold-silent' },
  { group: '孩子这边', name: '往上滑 · 松手取消', note: '手指往上滑过一个按钮高', input: { status: 'holding', holdAudio: true, cancel: true }, sound: 'none', tutor: 'chinese', expect: 'cancel' },
  { group: '孩子这边', name: '太短 / 没听清', note: '按不到 0.4 秒、麦克风没开上:晃一下,字留 2 秒', input: { hint: 'unclear' }, sound: 'none', tutor: 'chinese', expect: 'unclear' },
  { group: '孩子这边', name: '点一下没按住', note: '不到 150 毫秒就松手', input: { hint: 'tap' }, sound: 'none', tutor: 'chinese', expect: 'tap' },
  { group: '孩子这边', name: '老师在想时按了', note: '不接,晃一下', input: { pending: true, hint: 'busy' }, sound: 'none', tutor: 'chinese', expect: 'busy' },
  { group: '别的声音', name: '卡在念', note: '点读、单词卡、田字格的声音:不是老师,不画声音', input: { status: 'card' }, sound: 'none', tutor: 'chinese', expect: 'card' },
  { group: '别的声音', name: '再听一遍', note: '放的是刚才录下的老师,不是老师在说', input: { status: 'replay' }, sound: 'none', tutor: 'chinese', expect: 'replay' },
  { group: '别的声音', name: '小课堂在放', note: '课里原来的声音在舞台上放', input: { status: 'lecture' }, sound: 'none', tutor: 'chinese', expect: 'lecture' },
  { group: '口语课一直听', name: '口语单拍好 · 点上面开始', note: '左栏「先热身,再打电话」点之前:灰着、不接,麦也不开', input: { open: true, choose: true }, sound: 'none', tutor: 'english', expect: 'choose' },
  { group: '口语课一直听', name: '在听', note: '不用按,这颗是麦克风开关', input: { open: true }, sound: 'none', tutor: 'english', expect: 'open' },
  { group: '口语课一直听', name: '孩子在说', note: '服务端判出孩子开口', input: { open: true, hearing: true }, sound: 'kid', tutor: 'english', expect: 'open-kid' },
  { group: '口语课一直听', name: '老师在说', note: '同上面「老师在说」,底是淡蓝的', input: { open: true, status: 'mouth' }, sound: 'tutor', tutor: 'english', expect: 'open-tutor' },
  { group: '口语课一直听', name: '孩子插话', note: '老师的弧淡到三成,孩子的竖条照走', input: { open: true, status: 'mouth', hearing: true, ducked: true }, sound: 'both', tutor: 'english', expect: 'interrupt' },
  { group: '口语课一直听', name: '老师在想', note: '脑在写', input: { open: true, pending: true }, sound: 'none', tutor: 'english', expect: 'open-think' },
  { group: '口语课一直听', name: '麦关了', note: '孩子说话不出竖条(没在收)', input: { open: true, muted: true }, sound: 'none', tutor: 'english', expect: 'muted' },
  { group: '口语课一直听', name: '麦关了、老师在说', note: '老师的弧照出', input: { open: true, muted: true, status: 'mouth' }, sound: 'tutor', tutor: 'english', expect: 'muted-tutor' },
  { group: '口语课一直听', name: '轮到你(跟读)', note: '热身那句念完等孩子跟:按钮和那张单词卡一起慢慢呼吸', input: { open: true, turn: true }, sound: 'none', tutor: 'english', expect: 'turn' },
  { group: '口语课一直听', name: '打电话 · 响铃', note: '[[call]] 那句念完:头像晃;嘴一出声铃停', input: { open: true, status: 'ring' }, sound: 'none', tutor: 'english', expect: 'ring' },
];
