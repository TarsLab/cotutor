/**
 * 模拟接口(`cotutor mock`):不经真实老师与百炼,用固定的板书 JSON 把孩子端页面喂起来,
 * 专门测前端的交互逻辑与渲染效果(卡一张张铺、停下等、追问追加)。老师都走实时老师页,假嘴念静音的声音、字幕照走。
 * 不需要 workspace。老师的每一轮从各自的脚本里按顺序取(脚本就是老师会写的正文,过真解析器);脚本用完给一句收尾话。
 * 卡没有配音文件(/api/audio 一律 404),点读、单词卡退回浏览器自带的合成声(页面模式 synth,只有这里给;真服务的孩子端不用合成声)。
 * 老师「想」的期间按流式模拟:卡在 delay 里一张张出现(pending 条目带 partial 板书),想完才有讲稿与声音。
 * 卡的状态 PUT 假存在内存里(过真的 state 契约),today 里并回卡上;发消息接 {text, action, focus},「交给老师」后照常追加下一节。
 * 场景:normal(缺省)/ nokey(没配百炼,孩子端只出「老师们还没到」)。
 * 首页是一份写死的「已发布」(mockHomeMd,过真解析器与真排法):语文老师有开场与接着昨天的按钮,数学老师有开场,英语老师没写(补一张);
 * 发消息带 via 时照真服务的规则换成按钮上的字、定话题。
 * 老师都走实时老师页,那条 WebSocket 是 mock-live.ts 的假嘴(照脚本「念」静音的声音,不花钱)。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createServer as createHttp, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBoard } from '../lib/board.ts';
import { parseCardState, stripSecrets, DictationPropsSchema } from '../cards/index.ts';
import { fileURLToPath } from 'node:url';
import { bundleAsset, stageAsset, stageIndex, stageVersion } from './stage.ts';
import { sendFile } from './send-file.ts';
import { subjectLang, tutorExtras, type ConversationMessage } from '../schema/index.ts';
import { NEUTRAL_COLOR, tutorColors } from '../lib/tutor-color.ts';
import { boardMarkOf } from './board-mark.ts';
import { backTutorOf } from './tutor-face.ts';
import { enrichLectures, ensureBaked, lectureFrameSvg, parseRing, parseSvgMs, readLecture, storedMarks, type Lecture } from './lecture.ts';
import { tianzigeData } from './tianzige.ts';
import { handleDictation, type DictationDeps } from '../dictation/route.ts';
import type { PhotoItem, PhotoProgress, Recognize } from '../dictation/recognize.ts';
import { lettersData } from './letters.ts';
import { mockLiveUpgrade } from './mock-live.ts';
import { DRAW_ONLY_TEXT, PAPER_KEY_RE, paperDrawing, type PaperState } from './paper.ts';
import { CanvasStateSchema } from '../cards/canvas.ts';
// 回给页面的形状直接用真服务的(app.ts):真接口加字段、改字段,这里不跟就红(2026-10-17;以前 mock 自己拼对象,motto 这种真服务没有的字段只在 mock 下显示)
import type { KidDay, KidHistory, KidHome, KidTutor, Overview, OverviewThread, OverviewTutor } from './app.ts';

/** 看完小课堂的第一问,mock 老师这样答:对着画的地方说,放课里拆开那一捆的那一段;视频的放轮着分那一段 */
const MOCK_VIDEO_LECTURE_REPLY = [
  '你画的是轮着分的那一下。',
  '',
  '```lecture',
  '2026-10-06-pingjunfen 0:05-0:11',
  '再看一遍怎么轮着分。',
  '```',
  '',
  '我们回到轮着分的地方,再看一遍。[[play]]',
  '',
  '每人分到几块?',
].join('\n');
const MOCK_LECTURE_REPLY = [
  '你画的是右边散的 3 根。8 根要从哪儿拿?',
  '',
  '```lecture',
  '2026-09-18-po13-jian-8 0:19-0:30',
  '再看一遍拆开那一捆。',
  '```',
  '',
  '我们回到拆开那一捆的地方,再看一遍。[[play]]',
  '',
  '拿走 8 根,这一捆还剩几根?',
].join('\n');

/** mock 的课包目录:仓库里的样本(tests/fixtures/bundles/),小课堂从这里放 */
export const MOCK_BUNDLES_DIR = fileURLToPath(new URL('../../tests/fixtures/bundles/', import.meta.url));
/** mock 的视频小课堂目录:仓库里的样本(tests/fixtures/lectures/) */
export const MOCK_LECTURES_DIR = fileURLToPath(new URL('../../tests/fixtures/lectures/', import.meta.url));
const MOCK_LECTURE_DIRS = { dirs: { bundles: MOCK_BUNDLES_DIR, lectures: MOCK_LECTURES_DIR } };
import { lineDurationMs, plainLine, readyBeats, type BoardSection, type KidLecture, type PenName } from '../lib/kid-board.ts';
import { wavOfPcm } from '../live/lib/wav.ts';
import { buildReel, playRecordOk, reelHolds, reelMissRuns, type PlayRecord } from '../lib/reel.ts';
import { weekOf, type CardStates } from '../lib/conversation.ts';
import { lanAddresses, listenInfo } from '../cli/serve.ts';
import { qrPage, type ListenInfo } from './qr-page.ts';
import { USER_CERT_DIR } from '../cli/workspace.ts';
import { kidThreads, type KidMessage } from '../lib/kid-view.ts';
import { ICON_SIZES, appIconPng, webManifest } from '../lib/icon.ts';
import { faviconResponse } from '../lib/favicon.ts';
import { kidPage } from './kid-page.ts';
import { parentPage } from './parent-page.ts';
import { arrangeHome, homeOwners, kidButtons, parseHome } from '../lib/home.ts';
import type { TutorButton } from '../cards/index.ts';
import { packageTheme } from '../cli/themes.ts';
import { cardsCss } from '../cards/docs.ts';
import { VOICE_GALLERY_PAGE } from './voice-gallery-page.ts';

export type MockScenario = 'normal' | 'nokey';

export interface MockTutor {
  name: string;
  display: string;
  subject: string;
  avatar: string;
  /** 每轮一节:老师会写的那种正文(段落 = 讲稿,围栏 = 卡),与真老师的样本同一种写法(tests/fixtures/board/) */
  script: string[];
  /** 打开页面时已经讲过的轮数(取脚本前几节) */
  preloaded: number;
  /** 首轮的那句问题(孩子问的;不上板,只进索引) */
  firstQuestion: string;
}

/** 脚本 → 板书节:走真解析器(mock 也是解析器的一次演练) */
export function sectionFromScript(md: string): BoardSection {
  return parseBoard(md).section;
}

/**
 * 写死的样子:几节预装板书的底色 / emoji 与带笔的标注(真老师是写在围栏行与讲稿的 [词] 里的),直接套到解析出来的节上,
 * 页面走的是同一条渲染路(look 的槽、带 pen 的标注;行由页面按卡的宽度排)。键 = 老师名:脚本序号。
 */
export const MOCK_LOOKS: Record<string, { marks: { line: number; card: number; phrase: string; pen: PenName }[]; look: Record<string, { tint?: string; look?: string; emoji?: string }> }> = {
  // 勾股定理:验证是方法卡(moss),封面的「三条边」画圈(讲到第一句时)、16 下划线(老师自己标的 直角边 / 斜边 / 25 保留,不重复)
  'math-tutor:0': {
    marks: [{ line: 0, card: 0, phrase: '三条边', pen: 'circle' }, { line: 3, card: 3, phrase: '16', pen: 'underline' }],
    look: { '3': { tint: 'moss' }, '4': { emoji: '💡' } },
  },
  'math-tutor:1': { marks: [], look: { '0': { tint: 'moss' } } },
  'chinese-tutor:0': { marks: [{ line: 1, card: 1, phrase: '多做一步', pen: 'marker' }], look: { '1': { emoji: '💡' } } },
};

function withMockLooks(section: BoardSection, tutor: string, i: number): BoardSection {
  const out = MOCK_LOOKS[`${tutor}:${i}`];
  if (!out) return section;
  const cards = section.cards.map((c, n) => (out.look[String(n)] ? { ...c, look: { ...(c.look ?? {}), ...out.look[String(n)] } } : c));
  const lines = section.lines.map((l, n) => ({ ...l, marks: [...l.marks, ...out.marks.filter((m) => m.line === n).map(({ card, phrase, pen }) => ({ card, phrase, pen }))] }));
  return { ...section, cards, lines };
}

/** 孩子发出后几毫秒内画图卡算「画家在画」(含老师想的那几秒;真的 qwen-image-2.0-pro 约 15 秒) */
const MOCK_PAINT_MS = 20000;
/** 画图卡的占位图:方的 2×2 四格,每格一个圆圈数字 */
const MOCK_PAINT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#fbfaf6"/>${[[24, 24, '#dcecf7'], [524, 24, '#fdeccb'], [24, 524, '#e3f1d8'], [524, 524, '#f6dde4']].map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="476" height="476" rx="24" fill="${c}" stroke="#8a8781" stroke-width="3"/><rect x="${x}" y="${Number(y) + 300}" width="476" height="176" fill="#a9d18e"/><circle cx="${Number(x) + 238}" cy="${Number(y) + 250}" r="70" fill="#9a6235"/><circle cx="${Number(x) + 62}" cy="${Number(y) + 62}" r="34" fill="#fff" stroke="#1f8a4c" stroke-width="6"/><text x="${Number(x) + 62}" y="${Number(y) + 76}" font-size="40" text-anchor="middle" fill="#1f8a4c" font-family="sans-serif" font-weight="700">${i + 1}</text>`).join('')}</svg>`;

export const MOCK_TUTORS: MockTutor[] = [
  {
    name: 'chinese-tutor',
    display: '语文老师',
    subject: '语文',
    avatar: '语',
    preloaded: 1,
    firstQuestion: '画蛇添足是什么意思?',
    script: [
      `你有没有过这种事:本来做得好好的,又多加了一点,结果反而糟了?

~~~text
# 画蛇添足
一个成语,一杯酒的故事
~~~

这个成语说的是:[多做一步,反而坏事]。

~~~text
画蛇添足 = 多做一步,反而坏事
~~~

它出自《战国策》,原文是这样的。

~~~read
楚有祠者,赐其舍人卮酒。
舍人相谓曰:数人饮之不足,一人饮之有余。
请画地为蛇,先成者饮酒。
~~~

几个人分一壶酒,酒不够大家喝,一个人喝正好,就比赛画蛇,[先成者饮酒],谁先画完谁喝。

~~~choice
如果第一个画完蛇的人,不去给蛇添上脚,酒是谁的?
- [x] 他自己的
- [ ] 第二个画完的
- [ ] 大家平分
~~~

我想问你:如果第一个画完蛇的人,不给蛇添脚,酒本来是谁的?`,
      `你是这么想的:酒是他自己的。

~~~text
先画完的人本来就赢了
~~~

他多画了脚,蛇就[不是蛇]了,第二个画完的说,你画的不是蛇。

~~~text
为蛇足者,终亡其酒。
~~~

古人把这件事记成一句话:[为蛇足者,终亡其酒]。

~~~choice
画蛇添足,就是做到了还要怎样,反而把事情弄糟?
- [x] 多做一步
- [ ] 少做一步
- [ ] 马上停下
~~~

你来选一选:画蛇添足,就是做到了还要怎样?`,
      `~~~text
做到了,就停下来
~~~

说得好,这就是画蛇添足要提醒我们的:[做到了,就停下来]。

~~~canvas
画一条蛇,不要给它添脚。
~~~

你来画一条蛇,画好了给我看看。`,
      `~~~tianzige
鼓励
gǔ lì
~~~

你说的是加油打气的那个鼓励吧,看,鼓先写,励后写。

~~~text
鼓励:给人加油、打气
~~~

鼓是敲鼓的鼓,励是[努力]的力多一个厂字头,一个人在厂下面使劲。

你想再看一遍哪个字?点一下它就再写一遍。`,
      // 你说我画:出题版的画图卡;mock 不真画,刚出来几秒是「画家在画」,之后给一张占位的四格
      `你说得清清楚楚,四个词都放好了。

~~~read
春天的早上,小熊和小猴在地里种西瓜。
小熊把种子埋进土里,小猴坐在树下吃桃子。
中午太阳很大,小熊给小苗浇水,小猴躺在树下睡大觉。
过了一个夏天,小熊的地里结满了大西瓜,小猴的地里只长了草。
小熊推着满满一车西瓜,送给小猴一个,小猴低着头,脸红红的。
~~~

这是你出的题,画家开始画了。

~~~paint
题: 图上画了谁?他们分别在干什么?结果又是怎样的?用上词语宝库里的词,写几句话。
词: 播种、睡大觉、满满、羞愧
角色: 小熊:棕色,戴黄色草帽,穿绿色背带裤
角色: 小猴:黄褐色,穿红背心
1. 春天的早上,地里。小熊弯着腰把西瓜种子埋进土里;小猴坐在树下吃桃子。
2. 中午,大太阳。小熊提着水壶给小苗浇水;小猴躺在树荫下睡大觉。
3. 夏天,小熊的地里结满大西瓜,小熊抱着一个笑着;小猴的地里只长了草。
4. 小熊推着满满一车西瓜,递给小猴一个;小猴低着头,脸红红的。
~~~

你猜,画家会把小猴画成什么样子?`,
    ],
  },
  {
    name: 'math-tutor',
    display: '数学老师',
    subject: '数学',
    avatar: '数',
    preloaded: 1,
    firstQuestion: '勾股定理是什么?',
    script: [
      `~~~text
# 勾股定理
直角三角形三条边的关系
~~~

我们先认一认直角三角形的三条边。

~~~text
# 认边
两条短边叫直角边,最长的一条叫斜边
~~~

两条短边叫[直角边],最长的一条叫[斜边]。

~~~text formula
直角边² + 直角边² = 斜边²
~~~

先记住这个公式:[直角边² + 直角边² = 斜边²]。

~~~text
# 验证
3 的平方是 9,4 的平方是 16,9 加 16 等于 25
~~~

拿 3 和 4 试试:9 加 16 等于 [25],正好是 5 的平方,所以斜边是 5。

~~~text
知道两条直角边,平方相加再开方,就是斜边
~~~

~~~choice
一个直角三角形,两条直角边是 6 和 8,斜边是多少?
- [x] 10
- [ ] 12
- [ ] 14
~~~

你来选一选:两条直角边是 [6 和 8],斜边是多少?`,
      `对,6 的平方加 8 的平方是 100,正好是 10 的平方。

~~~text
# 反过来想
如果知道斜边和一条直角边,也能求另一条直角边
~~~

反过来也行:知道[斜边]和一条直角边,也能求另一条。

~~~text formula
斜边² − 直角边² = 另一条直角边²
~~~

~~~choice
一个直角三角形,斜边是 13,一条直角边是 5,另一条直角边是多少?
- [ ] 8
- [x] 12
- [ ] 18
~~~

你来选一选:斜边是 13,一条直角边是 5,另一条直角边是多少?`,
      `对,169 减 25 等于 144,12 的平方正好是 144。

~~~text
3、4、5 和 5、12、13 都是常见的勾股数组
~~~

我们换一道找规律的题,课里讲过这一段。

~~~lecture
2026-09-04-guilv5 0:00
75、70、65,后面三个空填什么?
~~~

我们回到课里看一遍。[[play]]

看完了,你自己说说,每次少几?`,
    ],
  },
  {
    name: 'english-tutor',
    display: '英语老师',
    subject: '英语',
    avatar: '英',
    preloaded: 0,
    firstQuestion: '',
    script: [
      `Today we learn three fruits. 今天学三种水果。

~~~text
# Fruits
水果
~~~

~~~read
apple 苹果
banana 香蕉
orange 橘子
~~~

Listen and repeat: [apple], [banana], [orange]. 点一下听一下,跟着我读。

~~~image
captures/2026-09-10/fruits.png
三种水果,你家有哪种?
~~~

~~~word
🍎 apple
ap-ple
~~~

This is how we write it: a, p, p, l, e. 看我写一遍。

Which one do you want to try first, [apple], [banana], or [orange]? 你先读哪一个?`,
      // 拍给我看卡(cards/photo/card.md):末句不是问句,下沿照样是「等你拍…」带拍照、相册
      `Good job! 读得真好。

~~~photo
家里的一种水果
~~~

Find a fruit at home. 找一个家里的水果,拍下来给我看。`,
    ],
  },
];

interface MockMessage {
  job: string;
  /** 话题 id(话题第一条的 job) */
  thread: string;
  at: string;
  question: string | null;
  reply: string | null;
  pending: boolean;
  artifacts: string[];
  section: BoardSection | null;
  /** 孩子端的动作(继续不计次数) */
  action?: 'submit';
  /** 交答案时交的是哪张卡(<job>/<n>):交过的卡锁住(同真服务 kid-view 的 submittedCards) */
  submitted?: string;
  /** 卡下标 → 孩子做的事(PUT 进来的) */
  states?: Record<number, unknown>;
  /** 孩子这条带的照片(假路径;/api/kid/image 给占位图) */
  photos?: string[];
  /** 看完小课堂后的第一条:节前画小课堂卡与画的卡(画带那段话;孩子端下发时摘掉) */
  lecture?: KidLecture;
  /** 家长端多看到的看的情况 */
  lectureWatch?: { watchedMs: number; finished: boolean; pauses: number };
  /** 看的过程(录像用;孩子端不下发) */
  lectureLog?: { t: number; pos: number; play: boolean }[];
  /** 实时的一轮(mock 的假嘴发的) */
  live?: true;
  /** 孩子从左栏的纸交的画(摘要按 mock 内存里那张纸算) */
  drawing?: ConversationMessage['drawing'];
}

/** mock 的首页原文(昨晚 21:30 发布的那份;接着按钮指向 past 里昨天的话题,job = 0930-<老师名长度>) */
export function mockHomeMd(today: string, yesterday: string): string {
  return `---
for: ${today}
---

\`\`\`tutor chinese-tutor
我要预习小蝌蚪找妈妈
讲法: 第 22 课。先带他把 1–3 自然段读顺,重点字 塘、脑、袋
接着 ${yesterday} 0930-13 接着讲画蛇添足
讲法: 昨天讲到第二节,先问他还记不记得那杯酒
\`\`\`

\`\`\`tutor math-tutor
再练两道退位减法
讲法: 出 52−7、80−3,先让他说怎么想
小课堂 2026-09-18-po13-jian-8 13 减 8 怎么拆
小课堂 2026-10-06-pingjunfen 平均分怎么分
\`\`\`

\`\`\`text
# 今晚
先读课文,再练两道题
\`\`\`

\`\`\`tianzige
塘脑袋
táng nǎo dai
\`\`\`

\`\`\`dictation chinese-tutor
春天
鼓励 鼓励,老师鼓励我的鼓励
叶 树叶的叶
\`\`\`

\`\`\`dictation english-tutor
red
yellow yellow, a yellow bus
🚌 bus
\`\`\`

## 为什么这么排

- mock 的样例
`;
}

/** 拍照认词表的假识别:不看照片,照《小蝌蚪找妈妈》那页回(词语一行、写字一行,宽大没认准,识字不默认选),再回三行全文;一行隔 100 毫秒,像真的一行一行出来 */
const MOCK_SAY: Record<string, string> = { 脑袋: '小蝌蚪的大脑袋', 灰色: '灰色的小蝌蚪', 眼睛: '大大的眼睛', 肚皮: '白白的肚皮', 孩子: '青蛙妈妈的孩子', 宽大: '宽大的嘴巴', 两: '两个人的两', 哪: '在哪里的哪', 塘: '池塘的塘' };
const MOCK_PHOTO: PhotoItem[] = [
  ...['脑袋', '灰色', '眼睛', '肚皮', '孩子', '宽大'].map((text, i): PhotoItem => ({ text, kind: 'word', pick: true, box: [80 + i * 140, 640, 190 + i * 140, 700], sure: text !== '宽大', say: `${text},${MOCK_SAY[text]}` })),
  ...['两', '哪'].map((text, i): PhotoItem => ({ text, kind: 'char', pick: true, box: [80 + i * 92, 480, 150 + i * 92, 550], sure: true, say: `${text},${MOCK_SAY[text]}` })),
  { text: '塘', kind: 'read', pick: false, box: [80, 320, 150, 390], sure: true, say: `塘,${MOCK_SAY['塘']}` },
];
const MOCK_FULL = ['池塘 里 有 一群 小蝌蚪 , 大大的 脑袋 , 黑灰色 的 身子 。', '小蝌蚪 游 哇 游 , 过了 几天 , 长出 两条 后腿 。', '他们 看见 鲤鱼 妈妈 在 教 小鲤鱼 捕食 。'];
/** 英文单词的假识别(英语老师卡上的拍照听写):一页单词表 */
const MOCK_PHOTO_EN: PhotoItem[] = ['red', 'yellow', 'green', 'bus'].map((text, i): PhotoItem => ({ text, kind: 'word', pick: true, box: [80 + i * 200, 600, 240 + i * 200, 660], sure: true, say: `${text}, a ${text} ${text === 'bus' ? 'stop' : 'car'}`, ...(text === 'bus' ? { emoji: '🚌' } : {}) }));
const MOCK_FULL_EN = ['What colour is it', "It's yellow", 'I can see a red bus'];
const mockRecognize: Recognize = async (_image, onProgress, lang) => {
  const t0 = Date.now();
  const en = lang === 'en';
  const p: PhotoProgress = { items: [], lesson: en ? 'Unit 3 Colours' : '小蝌蚪找妈妈', full: [] };
  onProgress({ ...p });
  if (en) {
    for (const it of MOCK_PHOTO_EN) { await new Promise((r) => setTimeout(r, 100)); p.items = [...p.items, it]; onProgress({ ...p }); }
    p.full = MOCK_FULL_EN; onProgress({ ...p });
    return { ok: true, model: 'mock', ...p, ms: Date.now() - t0 };
  }
  for (const it of MOCK_PHOTO) { await new Promise((r) => setTimeout(r, 100)); p.items = [...p.items, it]; onProgress({ ...p }); }
  for (const f of MOCK_FULL) { await new Promise((r) => setTimeout(r, 100)); p.full = [...p.full, f]; onProgress({ ...p }); }
  return { ok: true, model: 'mock', ...p, ms: Date.now() - t0 };
};

export interface MockRouteResult {
  status: number;
  json?: unknown;
  html?: string;
  /** 静态文件(舞台包、课包) */
  file?: string;
  /** 现生成的二进制(主屏幕图标、网页图标) */
  body?: Uint8Array;
  /** html / file / body / json 的 content-type */
  contentType?: string;
  /** body 的缓存策略;不给 = 一小时 */
  cacheControl?: string;
}

export interface MockOptions {
  scenario?: MockScenario;
  /** 老师「想」多久(毫秒);测试传 0 */
  delayMs?: number;
  now?: () => Date;
  title?: string;
}

export interface Mock {
  route(method: string, path: string, body?: unknown): Promise<MockRouteResult>;
  /** 等所有还在「想」的老师答完(测试用) */
  settle(): Promise<void>;
  /** 等这一轮的老师答完(mock 的假嘴等它写完再「念」) */
  settleJob(job: string): Promise<void>;
  handler(req: IncomingMessage, res: ServerResponse): void;
  /** 在哪个地址上听着(serveMock 在 listen 之后填;扫码页 /dev/qr 每次现问) */
  listen: (() => ListenInfo) | null;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function createMock(opts: MockOptions = {}): Mock {
  const scenario = opts.scenario ?? 'normal';
  const delay = opts.delayMs ?? 1800;
  const now = opts.now ?? (() => new Date());
  const yesterday = (): string => localDate(new Date(now().getTime() - 86400000));
  const title = opts.title ?? '小明的老师们';
  const messages = new Map<string, MockMessage[]>();
  /** 左栏的纸:老师|话题 → 那张纸;不落盘 */
  const papers = new Map<string, PaperState>();
  /** 孩子端传上来的图(照片、纸上交的画、清空前那几版):路径 → 字节,看大图、画卡缩略图给真图;别的路径照旧占位 */
  const uploads = new Map<string, { type: string; data: Buffer }>();
  /** 以前的:昨天每位讲过课的老师有一个话题(拿脚本最后一节充数),只读回放用 */
  const past = new Map<string, MockMessage[]>();
  const cursor = new Map<string, number>();
  const inflight = new Map<string, Promise<void>>();
  let seq = 0;
  /** 孩子端发来的实录(不打盘):老师 → [{话题, 记录}] */
  const mockPlays: Record<string, { thread: string; rec: PlayRecord }[]> = {};
  const nextJob = (): string => { const d = now(); return `${pad(d.getHours())}${pad(d.getMinutes())}-${++seq}`; };
  for (const t of MOCK_TUTORS) {
    const list: MockMessage[] = [];
    for (let i = 0; i < t.preloaded && i < t.script.length; i++) {
      const section = withMockLooks(sectionFromScript(t.script[i]), t.name, i);
      const job = nextJob();
      list.push({ job, thread: list[0]?.thread ?? job, at: now().toISOString(), question: i === 0 ? t.firstQuestion : '继续', reply: section.lines[section.lines.length - 1]?.text ?? null, pending: false, artifacts: [], section });
    }
    messages.set(t.name, list);
    cursor.set(t.name, Math.min(t.preloaded, t.script.length));
    if (t.preloaded && t.script.length) {
      const section = sectionFromScript(t.script[t.script.length - 1]);
      const job = `0930-${t.name.length}`;
      past.set(t.name, [{ job, thread: job, at: `${yesterday()}T09:30`, question: '昨天问的:' + t.firstQuestion, reply: section.lines[section.lines.length - 1]?.text ?? null, pending: false, artifacts: [], section }]);
    }
  }
  /** 话题打星(家长端清单上):<老师>/<话题> → 1–5;记过账的话题(同样的键) */
  const ratings = new Map<string, number>();
  const booked = new Set<string>();
  /** 孩子这回发的消息是真钟几点发的(mock 的 now 可能是假钟;画图卡「在画」按它算,种子里的直接是画好的) */
  const sentAt = new Map<string, number>();
  /** 画图卡(mock 不真画):发出后 MOCK_PAINT_MS 内是「画家在画」,之后给一张占位的四格(/api/kid/image 认 mock-paint/);家长端多一行 note */
  const mockPaints = (section: BoardSection, m: MockMessage, parent = false): BoardSection => {
    if (!section.cards.some((c) => c.kind === 'paint')) return section;
    const t = sentAt.get(m.job);
    const drawing = t !== undefined && Date.now() - t < MOCK_PAINT_MS;
    return { ...section, cards: section.cards.map((c, n) => (c.kind !== 'paint' ? c : { ...c, props: { ...c.props, drawn: drawing ? 'drawing' : 'done', ...(drawing ? {} : { pic: `mock-paint/${m.job}-${n}.png` }), ...(parent ? { note: drawing ? '在画(mock)' : '画好了:qwen-image-2.0-pro,15 秒(mock 的占位图)' } : {}) } })) };
  };
  /** 下发孩子端的形状:答案剥掉、状态并到卡上、小课堂卡补那一段的起止(样本课包在仓库里) */
  const kidMessage = async (m: MockMessage): Promise<KidMessage> => {
    const { states, action: _a, submitted: _s, lectureWatch: _w, lectureLog: _l, drawing, ...rest } = m;
    if (rest.lecture?.marks) rest.lecture = { ...rest.lecture, marks: rest.lecture.marks.map(({ text: _t, ...k }) => k) };
    const mine = [...messages.values()].find((l) => l.includes(m)) ?? [];
    const done = new Set(mine.flatMap((x) => (x.submitted ? [x.submitted] : [])));
    const withState = m.section ? { ...m.section, cards: m.section.cards.map((c, i) => ({ ...c, ...(done.has(`${m.job}/${i}`) ? { submitted: true } : {}), ...(states && i in states ? { state: states[i] } : {}) })) } : null;
    const section = withState ? mockPaints(await enrichLectures(MOCK_LECTURE_DIRS, stripSecrets(withState)), m) : null;
    return { ...rest, ...(drawing && rest.question !== null ? { drawing: { image: drawing.image, strokes: drawing.strokes, ...(drawing.ms !== undefined ? { ms: drawing.ms } : {}) } } : {}), section };
  };
  // 学科色同真服务:按老师的先后定(src/lib/tutor-color.ts)
  const colors = tutorColors(Object.fromEntries(MOCK_TUTORS.map((t) => [t.name, { subject: t.subject }])));
  const tutorsJson = (): KidTutor[] => MOCK_TUTORS.map((t) => ({ name: t.name, display: t.display, avatar: t.avatar, subject: t.subject, color: colors[t.name], mark: boardMarkOf(t.subject), lang: subjectLang(t.subject), hasVoice: false, extras: tutorExtras({ subject: t.subject }).filter((x) => x !== 'talk'), listen: 'hold' }));
  /** 小课堂:样本课包与样本视频在仓库里(tests/fixtures/bundles/、lectures/),起来时和真服务一样读一遍(readLecture)、记住 */
  const lectures = new Map<string, Lecture>();
  const lecturesLoaded = (async () => {
    for (const dir of [MOCK_BUNDLES_DIR, MOCK_LECTURES_DIR]) {
      for (const id of await readdir(dir).catch(() => [] as string[])) { const l = await readLecture(MOCK_LECTURE_DIRS, id); if (l && !lectures.has(id)) lectures.set(id, l); }
    }
  })();
  const mockLecture = (id: string): (Lecture & { ms: number }) | null => { const l = lectures.get(id); return l ? { ...l, ms: l.clock.total } : null; };
  const home = (): KidHome => {
    const d = now();
    const parsed = parseHome(mockHomeMd(localDate(d), yesterday())).cards;
    const names = MOCK_TUTORS.map((t) => t.name);
    const ownerOf = homeOwners(parsed, names);
    const owners = new Map(parsed.map((c, i) => [c, ownerOf[i]]));
    const cards = arrangeHome(parsed, names).map((c) => {
      if (c.kind !== 'tutor') return { ...stripSecrets({ cards: [c], lines: [] }).cards[0], owner: owners.get(c) ?? null }; // 同真服务:答案(听写卡的字)不下发;非老师卡带归属
      const name = String(c.props.tutor);
      const list = messages.get(name) ?? [];
      const asked = list.find((m) => m.question !== null && m.thread === list[list.length - 1]?.thread);
      // mock 的话题都是新话题进去的:今天孩子问过的那个,挂在新话题按钮上(空白板上的胶囊)
      const resumes = asked ? new Map([['free', { thread: asked.thread, title: (asked.question ?? '').slice(0, 10), at: list[list.length - 1]?.at ?? '' }]]) : undefined;
      const alive = (date: string, thread: string): boolean => (date === yesterday() && (past.get(name) ?? []).some((m) => m.thread === thread)) || (date === localDate(d) && list.some((m) => m.thread === thread));
      return { kind: 'tutor', props: { tutor: name, buttons: kidButtons((c.props.buttons ?? []) as TutorButton[], { resumes, alive, lecture: (id) => Boolean(mockLecture(id)), today: localDate(d) }).map((b) => { const l = b.kind === 'lecture' ? mockLecture(b.bundle) : null; return l ? { ...b, title: l.title, ms: l.ms, ...(l.video ? { video: true as const } : {}) } : b; }) } };
    });
    // figshot:和配了 figshot 的 workspace 一样给端口;这台电脑上 figshot 没开着,页面照样藏着这张卡
    return { title, date: localDate(d), tutors: tutorsJson(), home: mockHomeId(), cards, figshot: { port: 8477 }, hand: 'right', ready: scenario !== 'nokey' };
  };
  const mockHomeId = (): string => `${yesterday()}-2130`;
  let dictationRoot: string | null = null;
  // 听写的暂存放临时目录,进程退出时删掉(不删每起一次 mock 留一个,攒到上千个)
  const dictationDir = (): string => {
    if (dictationRoot) return dictationRoot;
    const dir = (dictationRoot = mkdtempSync(join(tmpdir(), 'cotutor-mock-dictation-')));
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
    return dir;
  };
  const dictationDeps = (): DictationDeps => ({
    root: dictationDir(),
    now,
    card: async (home, n) => {
      if (home !== mockHomeId()) return null;
      const c = parseHome(mockHomeMd(localDate(now()), yesterday())).cards.filter((x) => x.kind === 'dictation')[n];
      const r = c ? DictationPropsSchema.safeParse(c.props) : null;
      return r?.success ? r.data : null;
    },
    // 同真服务:卡上写的(或拍照听写从哪位老师卡上进来的)老师在就用他,不然语文老师
    reader: (t) => (t && MOCK_TUTORS.some((x) => x.name === t) ? t : 'chinese-tutor'),
    display: (t) => MOCK_TUTORS.find((x) => x.name === t)?.display ?? '老师',
    face: (t) => backTutorOf(Object.fromEntries(MOCK_TUTORS.map((x) => [x.name, { display: x.display, subject: x.subject }])), t),
    // 念的是一段 0.8 秒的静音(不配音、不念浏览器合成声):页面照真服务那样放音频、等放完
    say: async () => {
      const f = join(dictationDir(), 'say-silence.wav');
      if (!existsSync(f)) writeFileSync(f, wavOfPcm(Buffer.alloc(24000 * 2 * 0.8), 24000));
      return f;
    },
    voiced: () => true,
    medians: async (ch) => (await tianzigeData(ch))?.medians ?? null,
    recognize: mockRecognize,
  });
  /** via → 按钮(真服务在 server/home.ts resolveVia;mock 从同一份原文取) */
  const mockButton = (name: string, via: unknown): TutorButton | 'new' | 'recent' | null => {
    if (!isObj(via)) return null;
    if (via.button === 'new' || via.button === 'recent') return via.button;
    if (via.home !== mockHomeId() || typeof via.button !== 'number') return null;
    const card = parseHome(mockHomeMd(localDate(now()), yesterday())).cards.find((c) => c.kind === 'tutor' && c.props.tutor === name);
    return ((card?.props.buttons ?? []) as TutorButton[])[via.button] ?? null;
  };
  const answer = (m: MockMessage, full: BoardSection | null): void => {
    if (full) {
      m.section = full;
      m.reply = full.lines[full.lines.length - 1]?.text ?? null;
    } else {
      m.section = sectionFromScript('这个我们明天接着说,好不好?');
      m.reply = '这个我们明天接着说,好不好?';
    }
    m.pending = false;
  };
  /** 流式模拟:想的期间每隔一段露一张卡(讲稿句跟到那张卡为止),整段想完才定稿 */
  const think = (t: MockTutor, m: MockMessage, cur = cursor): Promise<void> => {
    const i = cur.get(t.name) ?? 0;
    // 看完小课堂的第一问:老师放课里的那一段(小课堂卡 + [[play]]);不占脚本的位置
    const lectureFirst = Boolean(m.lecture && !m.lecture.again);
    const step = lectureFirst ? (m.lecture?.video ? MOCK_VIDEO_LECTURE_REPLY : MOCK_LECTURE_REPLY) : t.script[i];
    if (!lectureFirst) cur.set(t.name, i + 1);
    const full = step ? withMockLooks(sectionFromScript(step), t.name, i) : null;
    const n = full ? full.cards.length : 0;
    const tick = delay / (n + 1);
    return new Promise<void>((resolve) => {
      let k = 0;
      const reveal = (): void => {
        k++;
        if (k <= n && full) {
          // 拍的就绪同真服务一个规则(readyBeats;mock 没配音 = 不等配音):露到第 k 张卡时前 k-1 拍关了 → 页面就绪一拍播一拍;卡前的句(锚 null)也在,和真 runner 一样
          // 铺到第 k 张时前 k-1 张的样子与行都已定(卡带 look,layout 只到已定的那几张)
          const part = { cards: full.cards.slice(0, k).map((c, i) => (i < k - 1 ? c : (({ look: _l, ...rest }) => rest)(c))), lines: full.lines.filter((l) => l.anchor === null || l.anchor < k - 1) };
          const rows = full.layout ? full.layout.rows.map((r) => r.filter((i) => i < k - 1)).filter((r) => r.length) : [];
          m.section = { ...part, ...(full.layout && rows.length ? { layout: { for: full.layout.for, rows } } : {}), partial: true, ready: readyBeats(part, { done: false }) };
          setTimeout(reveal, tick);
        } else {
          answer(m, full);
          resolve();
        }
      };
      setTimeout(reveal, tick);
    });
  };
  const route = async (method: string, path: string, body?: unknown): Promise<MockRouteResult> => {
    await lecturesLoaded;
    const url = new URL(path, 'http://x');
    const p = url.pathname;
    if (p === '/') return { status: 200, html: kidPage(title, { synth: true }, await stageVersion()) };
    if (p === '/dev/qr') return mock.listen ? { status: 200, html: qrPage(title, mock.listen(), url.searchParams.get('via') === 'ip' ? 'ip' : 'name', url.searchParams.get('to') === 'parent' ? 'parent' : 'kid') } : { status: 404, json: { error: 'not_listening' } };
    if (p === '/dev/voice') return { status: 200, html: VOICE_GALLERY_PAGE };
    if (p === '/manifest.webmanifest') return { status: 200, json: webManifest(title), contentType: 'application/manifest+json; charset=utf-8' };
    // 家长端「记录」:自己的一页(parent-page.ts);清单接口照真服务(答案不剥,第一节带一条给家长的尾巴与记忆)。mock 没有工作台 /dev
    if (p === '/parent') return { status: 200, html: parentPage(title) };
    if (p === '/reel') return { status: 200, html: kidPage(title, { reel: true, synth: true }, await stageVersion()) };
    if (p === '/preview') return { status: 200, html: kidPage(title, { preview: true, synth: true }, await stageVersion()) };
    if (p === '/parent/manifest.webmanifest') return { status: 200, json: webManifest(`${title} · 家长`, { startUrl: '/parent', scope: '/parent' }), contentType: 'application/manifest+json; charset=utf-8' };
    // 主题:mock 没有 workspace,直接给包里的出厂 default
    if (p === '/kid/theme.css') return { status: 200, html: `${cardsCss()}\n\n${(await packageTheme()).css}`, contentType: 'text/css; charset=utf-8' };
    if (p === '/kid/theme.json') return { status: 200, json: (await packageTheme()).manifest };
    const icon = /^\/icon-(\d{2,4})\.png$/.exec(p);
    if (icon) {
      const n = Number(icon[1]);
      return (ICON_SIZES as readonly number[]).includes(n) ? { status: 200, body: appIconPng(n), contentType: 'image/png' } : { status: 404, json: { error: 'not_found' } };
    }
    const fav = faviconResponse(p);
    if (fav) return { status: 200, ...fav, cacheControl: 'no-cache' };
    if (p === '/api/health') return { status: 200, json: { ok: true, mock: true, scenario } };
    if (p === '/api/kid/home' && method === 'GET') return { status: 200, json: home() };
    // 孩子端的流水(kid-log.ts):mock 照收,不落盘
    if (p === '/api/kid/log' && method === 'POST') return { status: 200, json: { ok: true } };
    // 听写(src/dictation/,和真服务同一套接口):卡从 mock 的首页取,存在临时目录,念的是静音
    const tx = await handleDictation(method, url, dictationDeps(), body); if (tx) return tx;
    const ov = /^\/api\/overview\/(today|\d{4}-\d{2}-\d{2})$/.exec(p);
    if (ov && method === 'GET') {
      const today = localDate(now());
      const date = ov[1] === 'today' ? today : ov[1];
      if (date > today) return { status: 400, json: { error: 'bad_request' } };
      const listOf = (name: string, d = date): MockMessage[] => (d === today ? messages.get(name) : d === yesterday() ? past.get(name) : undefined) ?? [];
      const tutors: OverviewTutor[] = MOCK_TUTORS.map((t) => {
        const list = listOf(t.name);
        const by = new Map<string, OverviewThread>();
        for (const m of list) {
          let th = by.get(m.thread);
          if (!th) {
            th = { thread: m.thread, at: m.at, title: Array.from((m.question ?? '').trim()).slice(0, 20).join(''), from: 'kid', via: null, start: { kind: 'new', label: '新话题' }, said: (m.question ?? '').trim() || null, endAt: null, notes: [], remembered: [], sections: 0, cards: 0, stoppedAt: null, rating: ratings.get(`${t.name}/${m.thread}`) ?? null, booked: booked.has(`${t.name}/${m.thread}`) };
            by.set(m.thread, th);
          }
          // 给家长的、记住了:同 mock 的板书接口,那天第一条带
          if (m === list[0] && !m.pending) { th.notes.push('第一遍就答上了,后面那句是我故意留的:看他会不会自己往下想。'); th.remembered.push(`${date} 讲故事时爱抢着说结局,可以先让他猜`); }
          if (m.pending) th.stoppedAt = 'writing';
          else if (m.section && (m.section.cards.length || m.section.lines.length)) { th.sections++; th.cards += m.section.cards.length; th.stoppedAt = m.section.lines[m.section.lines.length - 1]?.ask ? 'ask' : null; }
        }
        // 按住说话连着没发出去:攒着的实录里的 hold;mock 的消息没有真时刻,发成的一句只认打字发出去的
        if (date === today) for (const th of by.values()) {
          const plays = (mockPlays[t.name] ?? []).filter((x) => x.thread === th.thread).map((x) => x.rec);
          const n = Math.max(0, ...reelMissRuns(reelHolds(plays), plays.filter((r) => r.k === 'type' && r.e === 'send').map((r) => r.at)).map((x) => x.n));
          if (n) th.misses = n;
        }
        return { name: t.name, display: t.display, avatar: t.avatar, subject: t.subject, color: colors[t.name], turns: list.length, costUsd: list.length * 0.03, threads: [...by.values()], booking: false, extras: tutorExtras({ subject: t.subject }).filter((x) => x !== 'talk') };
      });
      const week = weekOf(date, today).map((d) => ({ date: d, tutors: MOCK_TUTORS.filter((t) => listOf(t.name, d).length).map((t) => t.name) }));
      const out: Overview = { title, date, today, tutors, week, ready: scenario !== 'nokey' };
      return { status: 200, json: out };
    }
    const pb = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|\d{4}-\d{2}-\d{2})\/board$/.exec(p);
    if (pb && method === 'GET') {
      const [, name, tail] = pb;
      const t = MOCK_TUTORS.find((x) => x.name === name);
      if (!t) return { status: 404, json: { error: 'no_such_tutor' } };
      const today = localDate(now());
      const date = tail === 'today' ? today : tail;
      if (date > today) return { status: 400, json: { error: 'bad_request' } };
      const list = (date === today ? messages.get(name) : date === yesterday() ? past.get(name) : undefined) ?? [];
      const out = await Promise.all(list.map(async (m, i) => {
        const { states, ...rest } = m;
        const withState = (c: BoardSection['cards'][number], k: number) => (states && k in states ? { ...c, state: states[k] } : c);
        const section = m.section ? mockPaints(await enrichLectures(MOCK_LECTURE_DIRS, { ...m.section, cards: m.section.cards.map(withState) }), m, true) : null;
        return { ...rest, from: 'kid' as const, section, ...(i === 0 && !m.pending ? { parentText: '## 家长\n第一遍就答上了,后面那句是我故意留的:看他会不会自己往下想。', remembered: [`${date} 讲故事时爱抢着说结局,可以先让他猜`] } : {}) };
      }));
      const pending = list.find((m) => m.pending);
      return { status: 200, json: { tutor: name, date, messages: out, pending: pending ? pending.job : null, thread: list.length ? list[list.length - 1].thread : null } };
    }
    // 看录像:mock 的消息没有真时刻(种子全是同一刻),照一个固定节奏排——
    // 等老师 3 秒(第二轮 14 秒,看「等老师」的压缩)、念完孩子想 8 秒(第一轮 40 秒,看「孩子想了」);卡的状态算在下一轮开口前 5 秒
    /** 看小课堂的那条:录像要它的看的过程(mock 的家长端条目带着 lecture 与 lectureLog) */
    const lectureOfMock = (m: Record<string, unknown>): { lecture?: NonNullable<ConversationMessage['lecture']> } => {
      const l = m.lecture as KidLecture | undefined;
      if (!l) return {};
      return { lecture: { bundle: l.bundle, title: l.title, watchedMs: 0, finished: true, pauses: 0, ...(l.again ? { again: true as const } : {}), ...(l.video ? { video: true as const } : {}), ...(l.marks ? { marks: l.marks } : {}), ...(Array.isArray(m.lectureLog) ? { log: m.lectureLog as { t: number; pos: number; play: boolean }[] } : {}) } };
    };
    const rl = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|\d{4}-\d{2}-\d{2})\/threads\/([^/]+)\/reel$/.exec(p);
    if (rl && method === 'GET') {
      const [, name, tail, raw] = rl;
      const board = await route('GET', `/api/conversations/${name}/${tail}/board`);
      if (board.status !== 200) return board;
      const day = board.json as { date: string; messages: (Record<string, unknown> & { job: string; thread: string; from: 'kid'; question: string | null; pending: boolean; section: BoardSection | null; action?: 'submit' })[] };
      const thread = decodeURIComponent(raw);
      const mine = day.messages.filter((m) => m.thread === thread);
      let t = now().getTime() - 10 * 60000;
      const starts: number[] = [];
      const conv = mine.map((m, k) => {
        const wait = k === 1 ? 14000 : 3000;
        starts.push(t);
        const startedAt = new Date(t).toISOString();
        t += wait + (m.section?.lines ?? []).reduce((n, l) => n + lineDurationMs(l.text) + 200, 0) + (k === 0 ? 40000 : 8000);
        return { job: m.job, thread, at: startedAt, from: m.from, text: m.question ?? '', result: m.pending ? ('running' as const) : ('ok' as const), artifacts: [], section: m.section, timing: { startedAt, doneMs: wait }, ...(m.action ? { action: m.action } : {}), ...lectureOfMock(m) };
      });
      const cards: CardStates = {};
      mine.forEach((m, k) => (m.section?.cards ?? []).forEach((c, n) => { if (c.state !== undefined) (cards[m.job] ??= {})[n] = { at: new Date((starts[k + 1] ?? t) - 5000).toISOString(), turn: m.job, state: c.state }; }));
      const plays = (mockPlays[name] ?? []).filter((x) => x.thread === thread).map((x) => x.rec);
      const reel = buildReel({ messages: conv, events: {}, cards, now: now().getTime(), plays });
      // mock 的孩子接口只认 today 是今天(写日期的走「以前的」那份)
      const kidDay = await route('GET', `/api/kid/conversations/${name}/${tail === localDate(now()) ? 'today' : tail}`);
      const kid = kidDay.status === 200 ? (kidDay.json as { messages: { thread: string }[] }).messages.filter((m) => m.thread === thread) : [];
      const tt = MOCK_TUTORS.find((x) => x.name === name);
      const face = { name, display: tt?.display ?? name, avatar: tt?.avatar ?? null, subject: tt?.subject ?? null, color: colors[name] ?? NEUTRAL_COLOR, mark: boardMarkOf(tt?.subject) };
      return reel ? { status: 200, json: { tutor: name, date: day.date, thread, reel, messages: mine, kid, device: null, face } } : { status: 404, json: { error: 'no_reel' } };
    }
    // 记账(家长端清单上的「记账」):这天还没记过的话题都算记了(真服务是每个话题起一轮老师;mock 立刻记上)
    const bk = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})\/bookkeep$/.exec(p);
    if (bk && method === 'POST') {
      const [, name] = bk;
      const list = messages.get(name);
      if (!list) return { status: 404, json: { error: 'no_such_tutor' } };
      const queued = [...new Set(list.filter((m) => m.section && !m.pending).map((m) => m.thread))].filter((th) => !booked.has(`${name}/${th}`));
      for (const th of queued) booked.add(`${name}/${th}`);
      return { status: 202, json: { tutor: name, queued, skipped: [] } };
    }
    // 删掉一个话题:列表里去掉;还在想的 409(mock 没有 vault,撤销记 0)
    const del = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})\/threads\/([^/]+)$/.exec(p);
    if (del && method === 'DELETE') {
      const [, name, , thread] = del;
      const store = messages;
      const list = store.get(name);
      if (!list || !list.some((m) => m.thread === thread)) return { status: 404, json: { error: 'no_such_thread' } };
      if (list.some((m) => m.thread === thread && m.pending)) return { status: 409, json: { error: 'busy' } };
      store.set(name, list.filter((m) => m.thread !== thread));
      ratings.delete(`${name}/${thread}`);
      return { status: 200, json: { tutor: name, thread, undo: { memory: 0, diary: 0, misses: [] } } };
    }
    const rate = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})\/threads\/([^/]+)\/rating$/.exec(p);
    if (rate && method === 'PUT') {
      const [, name, , thread] = rate;
      if (!MOCK_TUTORS.some((x) => x.name === name)) return { status: 404, json: { error: 'no_such_tutor' } };
      const rating = isObj(body) ? body.rating : undefined;
      if (!(rating === null || (typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 5))) return { status: 400, json: { error: 'bad_request' } };
      if (rating === null) ratings.delete(`${name}/${thread}`); else ratings.set(`${name}/${thread}`, rating);
      return { status: 200, json: { tutor: name, thread, rating } };
    }
    const pk = p;
    const kid = /^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|messages|history|photos|play|paper|\d{4}-\d{2}-\d{2})$/.exec(pk);
    if (kid) {
      const [, name, tail] = kid;
      const t = MOCK_TUTORS.find((x) => x.name === name);
      if (!t) return { status: 404, json: { error: 'no_such_tutor' } };
      const list = messages.get(name) ?? [];
      const date = localDate(now());
      // 录像的实录:收下就丢(mock 的录像按固定节奏排,不用它);不收的话页面每 10 秒撞一个 404
      // 实录:不打盘,攒在内存里给录像用(按 sentAt 校钟、形状不对的丢掉、孩子端发的卡改动不收,同真服务)
      if (tail === 'play' && method === 'POST') {
        if (!isObj(body) || typeof body.thread !== 'string' || !Array.isArray(body.records)) return { status: 200, json: { kept: 0 } };
        const skew = typeof body.sentAt === 'number' ? now().getTime() - body.sentAt : 0;
        const kept = (body.records as unknown[]).filter((x): x is PlayRecord => playRecordOk(x) && x.k !== 'card').map((x) => ({ ...x, at: Math.round(x.at + skew) }));
        (mockPlays[name] ??= []).push(...kept.map((rec) => ({ thread: body.thread as string, rec })));
        return { status: 200, json: { kept: kept.length } };
      }
      // 作业照片:不落盘,回一个像样的假路径(缩略图由 /api/kid/image 的占位 svg 顶)
      if (tail === 'photos' && method === 'POST') {
        if (!isObj(body) || typeof body.image !== 'string' || !body.image.startsWith('data:image/')) return { status: 400, json: { error: 'bad_request' } };
        const d = now();
        const up = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(body.image);
        const path = `captures/${date}/${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}-${list.length + 1 + uploads.size}.${up && up[1] === 'image/png' ? 'png' : 'jpg'}`;
        if (up) uploads.set(path, { type: up[1], data: Buffer.from(up[2], 'base64') });
        return { status: 201, json: { path } };
      }
      // 左栏的纸:同真服务(app.ts 的 paperRoute),存在内存里
      if (tail === 'paper') {
        const key = method === 'GET' ? (url.searchParams.get('key') ?? '') : isObj(body) && typeof body.key === 'string' ? body.key : '';
        if (!PAPER_KEY_RE.test(key)) return { status: 400, json: { error: 'bad_request' } };
        if (method === 'GET') return { status: 200, json: { key, state: papers.get(`${name}|${key}`) ?? { ink: [] } } };
        if (method !== 'PUT') return { status: 405, json: { error: 'method_not_allowed' } };
        const r = CanvasStateSchema.safeParse(isObj(body) ? body.state : null);
        if (!r.success) return { status: 400, json: { error: 'bad_state' } };
        papers.set(`${name}|${key}`, { ink: r.data.ink, ...(r.data.cleared?.length ? { cleared: r.data.cleared } : {}) });
        if (isObj(body) && body.from === 'new' && key !== 'new') papers.delete(`${name}|new`);
        return { status: 200, json: { ok: true, key } };
      }
      if (tail === 'today' && method === 'GET') {
        const shown = (messages.get(name) ?? []);
        const pending = shown.find((m) => m.pending);
        const out: KidDay = { tutor: name, date, messages: await Promise.all(shown.map(kidMessage)), pending: pending ? pending.job : null, thread: shown.length ? shown[shown.length - 1].thread : null };
        return { status: 200, json: out };
      }
      if (tail === 'history' && method === 'GET') {
        const days: KidHistory['days'] = [];
        const todayThreads = kidThreads(await Promise.all((messages.get(name) ?? []).map(kidMessage))).reverse();
        if (todayThreads.length) days.push({ date, threads: todayThreads });
        const old = past.get(name) ?? [];
        if (old.length) days.push({ date: yesterday(), threads: kidThreads(old) });
        const out: KidHistory = { tutor: name, today: date, days };
        return { status: 200, json: out };
      }
      if (/^\d{4}-/.test(tail) && method === 'GET') {
        if (tail > date) return { status: 400, json: { error: 'bad_request' } };
        const old = tail === yesterday() ? (past.get(name) ?? []) : [];
        const out: KidDay = { tutor: name, date: tail, messages: await Promise.all(old.map(kidMessage)), pending: null, thread: old.length ? old[old.length - 1].thread : null };
        return { status: 200, json: out };
      }
      if (tail === 'messages' && method === 'POST') {
        if (!isObj(body) || typeof body.text !== 'string') return { status: 400, json: { error: 'bad_request' } };
        const action = body.action === 'submit' ? ('submit' as const) : undefined;
        const photos = Array.isArray(body.photos) ? (body.photos as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        const button = body.via === undefined ? undefined : mockButton(name, body.via);
        if (button === null) return { status: 400, json: { error: 'bad_via' } };
        let said = body.text;
        let newThread = body.newThread === true;
        let wantThread = body.thread;
        // 小课堂:看完才能开口,字是孩子说的,新话题;画的那几处现算成一段话(同 runner)。问过以后再看一遍又画了:同一话题的下一条带上(again)
        // 一处几笔(strokes);2026-10-19 以前一笔一处(path),照读
        const marksIn = isObj(body.lecture) && Array.isArray(body.lecture.marks) ? (body.lecture.marks as { atMs: number; strokes?: [number, number][][]; path?: [number, number][]; image?: string; t?: number }[]).map(({ path, strokes, ...m }) => ({ ...m, strokes: strokes ?? (path ? [path] : []) })) : [];
        const logIn = isObj(body.lecture) && Array.isArray(body.lecture.log) ? (body.lecture.log as { t: number; pos: number; play: boolean }[]) : [];
        const lec = isObj(body.lecture) && typeof body.lecture.bundle === 'string' ? { bundle: body.lecture.bundle, finished: body.lecture.finished === true, again: false, watchedMs: Number(body.lecture.watchedMs) || 0, pauses: Number(body.lecture.pauses) || 0 } : null;
        if (lec && (typeof button !== 'object' || button === null || button.kind !== 'lecture')) {
          const from = list.find((x) => x.thread === body.thread && x.lecture && !x.lecture.again);
          if (!from || from.lecture?.bundle !== lec.bundle || (!marksIn.length && !logIn.length)) return { status: 400, json: { error: 'bad_request' } };
          lec.again = true;
        }
        if (typeof button === 'object' && button !== null && button.kind === 'lecture') {
          if (!lec || lec.bundle !== button.bundle || !lec.finished) return { status: 400, json: { error: 'bad_request' } };
          newThread = true; wantThread = undefined;
        } else if (button && button !== 'new' && button !== 'recent') {
          said = button.label;
          if (button.kind === 'continue' && button.date === date) { wantThread = button.thread; newThread = false; }
          else { newThread = true; wantThread = undefined; }
        }
        const drawIn = isObj(body.drawing) && typeof body.drawing.key === 'string' && PAPER_KEY_RE.test(body.drawing.key) && typeof body.drawing.image === 'string' ? { key: body.drawing.key, image: body.drawing.image } : null;
        if (body.drawing !== undefined && !drawIn) return { status: 400, json: { error: 'bad_request' } };
        const drawing = drawIn ? paperDrawing(papers.get(`${name}|${drawIn.key}`) ?? { ink: [] }, drawIn.image) : null;
        if (!said.trim() && !action && !photos.length && !drawing) return { status: 400, json: { error: 'bad_request' } };
        if (list.some((m) => m.pending)) return { status: 409, json: { error: 'busy' } };
        const focusCard = isObj(body.focus) && typeof body.focus.card === 'string' ? body.focus.card : null;
        if (action === 'submit' && focusCard && list.some((x) => x.submitted === focusCard)) return { status: 409, json: { error: 'submitted' } };
        const text = said.trim() || (action === 'submit' ? '(交了答案,没说话)' : photos.length === 1 ? '(拍了一张)' : photos.length ? `(拍了 ${photos.length} 张)` : DRAW_ONLY_TEXT);
        const job = nextJob();
        // 话题:newThread → 自己的 job;指定的要在今天的列表里;缺省接当前(末条)的
        let thread = job;
        if (!newThread && list.length) {
          if (wantThread !== undefined) {
            if (typeof wantThread !== 'string' || !list.some((x) => x.thread === wantThread)) return { status: 400, json: { error: 'bad_request' } };
            thread = wantThread;
          } else thread = list[list.length - 1].thread;
        }
        const lt = lec ? mockLecture(lec.bundle) : null;
        const marks = lt ? storedMarks(lt, marksIn, photos.length) : [];
        sentAt.set(job, Date.now());
        // 新话题的第一条:话题还没有时画的那张纸归它(同真服务的 adoptPaper)
        if (thread === job && papers.has(`${name}|new`) && !papers.has(`${name}|${thread}`)) { papers.set(`${name}|${thread}`, papers.get(`${name}|new`)!); papers.delete(`${name}|new`); }
        const m: MockMessage = { job, thread, at: now().toISOString(), question: text, reply: null, pending: true, artifacts: [], section: null, ...(body.live === true ? { live: true as const } : {}), ...(action ? { action } : {}), ...(action === 'submit' && focusCard ? { submitted: focusCard } : {}), ...(photos.length ? { photos } : {}), ...(drawing ? { drawing } : {}), ...(lec ? { lecture: { bundle: lec.bundle, title: lt?.title ?? lec.bundle, ...(lec.again ? { again: true as const } : {}), ...(lt?.video ? { video: true as const } : {}), ...(marks.length ? { marks } : {}) }, lectureWatch: { watchedMs: lec.watchedMs, finished: lec.finished, pauses: lec.pauses }, ...(logIn.length ? { lectureLog: logIn } : {}) } : {}) };
        list.push(m);
        const done = think(t, m, cursor).then(() => { inflight.delete(m.job); });
        inflight.set(m.job, done);
        return { status: 202, json: { tutor: name, date, job: m.job, thread } };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }
    // 卡的状态:孩子的走 /api/kid/…
    const card = /^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/cards\/([^/]+)\/(\d+)$/.exec(pk);
    if (card) {
      const [, name, job, n] = card;
      const m = (messages.get(name) ?? []).find((x) => x.job === job);
      const target = m?.section?.cards[Number(n)];
      if (!target) return { status: 404, json: { error: 'no_such_card' } };
      if (method !== 'PUT') return { status: 405, json: { error: 'method_not_allowed' } };
      if ((messages.get(name) ?? []).some((x) => x.submitted === `${job}/${n}`)) return { status: 409, json: { error: 'submitted' } };
      const r = parseCardState(target, body);
      if (!r.ok) return { status: 400, json: { error: 'bad_state' } };
      (m!.states ??= {})[Number(n)] = r.state;
      return { status: 200, json: { ok: true, card: `${job}/${n}`, state: r.state } };
    }
    const hz = /^\/api\/kid\/tianzige\/([^/]+)$/.exec(p);
    if (hz) {
      // 田字格卡:数据包就在 node_modules 里,mock 也给真笔顺
      const d = await tianzigeData(decodeURIComponent(hz[1]));
      return d ? { status: 200, json: d } : { status: 404, json: { error: 'not_found' } };
    }
    const lt = /^\/api\/kid\/letters\/([^/]+)$/.exec(p);
    if (lt) {
      // 单词卡:字形包就在 node_modules 里,mock 也给真笔顺
      const d = lettersData(decodeURIComponent(lt[1]));
      return d ? { status: 200, json: d } : { status: 404, json: { error: 'not_found' } };
    }
    if (p === '/api/kid/image') {
      // 图片卡:任何路径都给一张占位 svg(写着路径),前端能看到版式;画图卡(mock-paint/)给一张方的四格
      const rel = url.searchParams.get('p') ?? '';
      if (rel.startsWith('mock-paint/')) return { status: 200, contentType: 'image/svg+xml', html: MOCK_PAINT_SVG };
      const up = uploads.get(rel);
      if (up) return { status: 200, contentType: up.type, body: up.data };
      const esc = rel.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
      return { status: 200, contentType: 'image/svg+xml', html: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7d9a8"/><stop offset="1" stop-color="#8fbf9f"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/><circle cx="260" cy="250" r="90" fill="#e8743b"/><circle cx="420" cy="230" r="80" fill="#f4c542"/><circle cx="560" cy="270" r="85" fill="#e0508a"/><text x="400" y="460" font-size="22" text-anchor="middle" fill="#2b2b2b" font-family="sans-serif">${esc}</text></svg>` };
    }
    if (p.startsWith('/stage/') && method === 'GET') {
      if (p === '/stage/') { const html = await stageIndex(); return html === null ? { status: 404, json: { error: 'not_found' } } : { status: 200, html }; }
      const f = await stageAsset(p);
      return f ? { status: 200, file: f.file, contentType: f.contentType } : { status: 404, json: { error: 'not_found' } };
    }
    // 视频小课堂:同真服务(app.ts)
    const lv = /^\/api\/kid\/lectures\/([a-z0-9][a-z0-9-]*)\/(lecture\.json|video\.mp4)$/.exec(p);
    if (lv && method === 'GET') {
      const l = lectures.get(lv[1]);
      if (!l?.video) return { status: 404, json: { error: 'not_found' } };
      if (lv[2] === 'video.mp4') return { status: 200, file: join(MOCK_LECTURES_DIR, lv[1], 'video.mp4'), contentType: 'video/mp4' };
      return { status: 200, json: { title: l.title, total: l.clock.total, segments: l.clock.segments.map((x) => ({ start: x.start, len: x.len, line: x.line })) } };
    }
    const frame = /^\/api\/bundles\/([a-z0-9][a-z0-9-]*)\/frame\.svg$/.exec(p);
    if (frame && method === 'GET') {
      const svg = await lectureFrameSvg({ dirs: { bundles: MOCK_BUNDLES_DIR } }, frame[1], parseSvgMs(url.searchParams.get('svg')), parseRing(url.searchParams.get('ring')), { bake: ensureBaked });
      return svg === null ? { status: 404, json: { error: 'not_found' } } : { status: 200, body: Buffer.from(svg), contentType: 'image/svg+xml; charset=utf-8' };
    }
    if (p.startsWith('/api/bundles/') && method === 'GET') {
      const f = await bundleAsset(MOCK_BUNDLES_DIR, p);
      return f ? { status: 200, file: f.file, contentType: f.contentType } : { status: 404, json: { error: 'not_found' } };
    }
    // 字幕重放:真服务端给 src/live/call.ts 落的那份嘴的声音;mock 没有嘴,每句按字数估多长、放一段静音
    const mouth = /^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/mouth\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d+)$/.exec(p);
    if (mouth && method === 'GET') {
      const day = (await route('GET', `/api/kid/conversations/${mouth[1]}/today`)).json as KidDay | undefined;
      const m = day?.messages.find((x) => x.job === mouth[3]);
      const said = m && m.live && m.section ? m.section.lines : [];
      if (!said.length) return { status: 404, json: { error: 'not_found' } };
      let at = 0;
      const lines = said.map((l, line) => { const r = { line, ms: at }; at += lineDurationMs(plainLine(l.text)); return r; });
      return { status: 200, json: { audio: `/api/mock/silence.wav?ms=${at}`, ms: at, lines } };
    }
    if (p === '/api/mock/silence.wav' && method === 'GET') {
      const ms = Math.min(120_000, Math.max(0, Number(url.searchParams.get('ms')) || 0));
      return { status: 200, contentType: 'audio/wav', body: wavOfPcm(Buffer.alloc(Math.round(ms * 24) * 2), 24000) };
    }
    if (p.startsWith('/api/')) return { status: 404, json: { error: 'not_found', path: p } };
    return { status: 404, json: { error: 'not_found', path: p } };
  };
  const settle = async (): Promise<void> => { await Promise.all([...inflight.values()]); };
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      let body: unknown;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; } catch { body = undefined; }
      const r = await route(req.method ?? 'GET', req.url ?? '/', body);
      if (r.file !== undefined) await sendFile(req, res, { status: r.status, file: r.file, contentType: r.contentType, cacheControl: 'private, max-age=3600' });
      else if (r.body !== undefined) { res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/octet-stream', 'cache-control': r.cacheControl ?? 'private, max-age=3600' }); res.end(Buffer.from(r.body)); }
      else if (r.html !== undefined) { res.writeHead(r.status, { 'content-type': r.contentType ?? 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(r.html); }
      else { res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(r.json ?? null)); }
    })().catch((err) => { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal', message: String(err) })); });
  };
  const settleJob = async (job: string): Promise<void> => { await inflight.get(job); };
  const mock: Mock = { route, settle, settleJob, handler, listen: null };
  return mock;
}

export interface ServeMockOptions extends MockOptions {
  port?: number;
  host?: string;
  /** 强制 HTTP(缺省:机器级证书在就走 HTTPS,iPad 上按住说话要它) */
  http?: boolean;
}

export interface ServeMockResult {
  server: Server;
  mock: Mock;
  port: number;
  https: boolean;
  urls: string[];
  /** 扫码页:在这台电脑上打开的那条 */
  qrPage: string;
}

export async function serveMock(opts: ServeMockOptions = {}): Promise<ServeMockResult> {
  const mock = createMock(opts);
  let tls: { cert: Buffer; key: Buffer } | null = null;
  if (!opts.http) {
    try {
      tls = { cert: readFileSync(join(USER_CERT_DIR, 'cert.pem')), key: readFileSync(join(USER_CERT_DIR, 'key.pem')) };
    } catch {
      tls = null;
    }
  }
  const server = tls ? createHttps(tls, mock.handler) : createHttp(mock.handler);
  { const up = mockLiveUpgrade(mock); server.on('upgrade', (req, socket, head) => { if (!up(req, socket, head)) socket.destroy(); }); }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 8790, opts.host ?? '0.0.0.0', () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  const scheme = tls ? 'https' : 'http';
  const urls = [hostname(), ...lanAddresses()].map((h) => `${scheme}://${h}:${port}/`);
  mock.listen = () => listenInfo(Boolean(tls), port);
  return { server, mock, port, https: Boolean(tls), urls, qrPage: `${scheme}://localhost:${port}/dev/qr` };
}
