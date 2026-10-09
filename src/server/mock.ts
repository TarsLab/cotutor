/**
 * 模拟接口(`cotutor mock`):不经真实老师与配音,用固定的板书 JSON 把孩子端页面喂起来,
 * 专门测前端的交互逻辑与渲染效果(卡先铺、笔跟声、停下等、追问追加、上限、离线)。
 * 不需要 workspace。老师的每一轮从各自的脚本里按顺序取(脚本就是老师会写的正文,过真解析器);脚本用完给一句收尾话。
 * 没有配音文件(/api/audio 一律 404),页面退回浏览器自带的合成声(页面模式 synth,只有这里给;真服务的孩子端不用合成声),所以逐句节奏是真的。
 * 老师「想」的期间按流式模拟:卡在 delay 里一张张出现(pending 条目带 partial 板书),想完才有讲稿与声音。
 * 卡的状态 PUT 假存在内存里(过真的 state 契约),today 里并回卡上;发消息接 {text, action, focus},「交给老师」后照常追加下一节。
 * 场景:normal(缺省)/ limit(每日上限已到)/ offline(接口全 500,页面该灰)。
 * 首页是一份写死的「已发布」(mockHomeMd,过真解析器与真排法):语文老师有开场与接着昨天的按钮,数学老师有开场,英语老师没写(补一张);
 * 发消息带 via 时照真服务的规则换成按钮上的字、定话题。
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createServer as createHttp, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { parseBoard } from '../lib/board.ts';
import { parseCardState, stripSecrets } from '../cards/index.ts';
import { fileURLToPath } from 'node:url';
import { bundleAsset, stageAsset, stageIndex, stageVersion } from './stage.ts';
import { sendFile } from './send-file.ts';
import type { ConversationMessage } from '../schema/index.ts';
import { enrichLectures, ensureBaked, lectureFrameSvg, parseRing, parseSvgMs, readLecture, storedMarks, type Lecture } from './lecture.ts';
import { tianzigeData } from './tianzige.ts';
import { lettersData } from './letters.ts';

/** 看完小课堂的第一问,mock 老师这样答:对着圈的地方说,放课里拆开那一捆的那一段(《小课堂设计.md》§六);视频的放轮着分那一段 */
const MOCK_VIDEO_LECTURE_REPLY = [
  '你圈的是轮着分的那一下。',
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
  '你圈的是右边散的 3 根。8 根要从哪儿拿?',
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
import { lineDurationMs, readyBeats, type BoardSection, type KidLecture, type PenName } from '../lib/kid-board.ts';
import { REEL_LINE_GAP_MS, buildReel, playRecordOk, type PlayRecord } from '../lib/reel.ts';
import type { CardStates } from '../lib/conversation.ts';
import { lanAddresses, listenInfo } from '../cli/serve.ts';
import { qrPage, type ListenInfo } from './qr-page.ts';
import { USER_CERT_DIR } from '../cli/workspace.ts';
import { kidThreads } from '../lib/kid-view.ts';
import { ICON_SIZES, appIconPng, webManifest } from '../lib/icon.ts';
import { kidPage } from './kid-page.ts';
import { arrangeHome, kidButtons, parseHome } from '../lib/home.ts';
import type { TutorButton } from '../cards/index.ts';
import { packageTheme } from '../cli/themes.ts';
import { cardsCss } from '../cards/docs.ts';

export type MockScenario = 'normal' | 'limit' | 'offline' | 'nopost';

export interface MockTutor {
  name: string;
  display: string;
  subject: string;
  avatar: string;
  motto: string;
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
 * 页面走的是同一条渲染路(look 的槽、带 pen 的标注;行由页面按卡的宽度排)。键 = 老师名:脚本序号。`nopost` 场景不套。
 */
export const MOCK_POST: Record<string, { marks: { line: number; card: number; phrase: string; pen: PenName }[]; look: Record<string, { tint?: string; look?: string; emoji?: string }> }> = {
  // 勾股定理:验证是方法卡(moss),封面的「三条边」画圈(讲到第一句时)、16 下划线(老师自己标的 直角边 / 斜边 / 25 保留,不重复)
  'math-tutor:0': {
    marks: [{ line: 0, card: 0, phrase: '三条边', pen: 'circle' }, { line: 3, card: 3, phrase: '16', pen: 'underline' }],
    look: { '3': { tint: 'moss' }, '4': { emoji: '💡' } },
  },
  'math-tutor:1': { marks: [], look: { '0': { tint: 'moss' } } },
  'chinese-tutor:0': { marks: [{ line: 1, card: 1, phrase: '多做一步', pen: 'marker' }], look: { '1': { emoji: '💡' } } },
};

/** mock 家长端的录音卡评测(真服务从 heard.json 读):过、重录、没评上各一份 */
const MOCK_HEARD = [
  { ok: true, take: '20260926-162103-a1b2c3', verdict: '过', reasons: ['全部过线'], accuracy: 91, chars: ['十', '四', '是', '十', '四'].map((ch, i) => ({ ch, phone: i % 2 ? 's' : 'sh', score: [88, 90, 84, 86, 92][i], ok: true, risk: ['sh_s'] })), costYuan: 0.01, ms: 1100 },
  { ok: true, take: '20260926-162203-b7a1c2', verdict: '重录', reasons: ['句准确度 36 < 80', '山 的 sh 19 < 65,读成 s', '树 的 sh 20 < 65', '语速 92 字/分 < 160,太慢'], accuracy: 36, charsPerMin: 92, chars: [{ ch: '老', phone: 'l', score: 43, ok: true }, { ch: '师', phone: 'sh', score: 74, ok: true, risk: ['sh_s'] }, { ch: '上', phone: 'sh', score: 71, ok: true, risk: ['sh_s'] }, { ch: '山', phone: 'sh', score: 19, ok: false, risk: ['sh_s'], readAs: 's' }, { ch: '看', phone: 'an4', score: 88, ok: true }, { ch: '树', phone: 'sh', score: 20, ok: false, risk: ['sh_s'] }], costYuan: 0.02, ms: 1400 },
  { ok: false, error: 'timeout', ms: 20000 },
];

function withMockPost(section: BoardSection, tutor: string, i: number): BoardSection {
  const out = MOCK_POST[`${tutor}:${i}`];
  if (!out) return section;
  const cards = section.cards.map((c, n) => (out.look[String(n)] ? { ...c, look: { ...(c.look ?? {}), ...out.look[String(n)] } } : c));
  const lines = section.lines.map((l, n) => ({ ...l, marks: [...l.marks, ...out.marks.filter((m) => m.line === n).map(({ card, phrase, pen }) => ({ card, phrase, pen }))] }));
  return { ...section, cards, lines };
}

export const MOCK_TUTORS: MockTutor[] = [
  {
    name: 'chinese-tutor',
    display: '语文老师',
    subject: '语文',
    avatar: '语',
    motto: '故事里都有道理',
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

~~~fill
画蛇添足,就是做到了还要___,反而把事情弄糟。
= 多做一步
~~~

你来填一填:画蛇添足,就是做到了还要什么?`,
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
~~~

你说的是加油打气的那个鼓励吧,看,鼓先写,励后写。

~~~text
鼓励:给人加油、打气
~~~

鼓是敲鼓的鼓,励是[努力]的力多一个厂字头,一个人在厂下面使劲。

你想再看一遍哪个字?点一下它就再写一遍。`,
    ],
  },
  {
    name: 'math-tutor',
    display: '数学老师',
    subject: '数学',
    avatar: '数',
    motto: '不懂的都来问我',
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

~~~fill
一个直角三角形,斜边是 13,一条直角边是 5,另一条直角边是___。
= 12
~~~

你来填一填:斜边是 13,一条直角边是 5,另一条直角边是多少?`,
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
    motto: '一起大声读',
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
    ],
  },
  {
    // 口播老师(《口播老师设计.md》):一节三张录音卡;交了之后只盯一个字。mock 不起 koubo,老师的第二节就是按「山」重录写的
    name: 'koubo-tutor',
    display: '口播老师',
    subject: '口播',
    avatar: '播',
    motto: '一个字一个字来',
    preloaded: 0,
    firstQuestion: '',
    script: [
      `今天练 [sh] 和 s。上周 sh 的中位数是 58,还差一点。

~~~text
# 今天练什么
sh 舌尖翘起来往后,s 舌尖平放抵住下牙。
~~~

~~~record pinyin focus=sh_s
shi2 si4 shi4 shi2 si4
【十】四【是】【十】四
~~~

~~~record focus=sh_s
老师上【山】看【树】
~~~

~~~record focus=sh_s
四是四,十是十,十四是十四
~~~

三句,一句一句来:点开听我念一遍,再按住录。三句都录完交给我。`,
      `十四是十四,读得很准。[山] 这个字舌尖再往后一点,我们先只盯这一个字。

~~~text
# 口型
「山」的 sh:舌尖翘起来,往后缩一点,不碰牙齿,气从舌尖上面出来。
~~~

~~~read
山
上山
老师上山看树
~~~

~~~record focus=sh_s
上【山】
~~~

~~~record focus=sh_s
老师上【山】看树
~~~

先由字到句听一遍,再录这两句。`,
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
  action?: 'continue' | 'submit';
  /** 卡下标 → 孩子做的事(PUT 进来的) */
  states?: Record<number, unknown>;
  /** 孩子这条带的照片(假路径;/api/kid/image 给占位图) */
  photos?: string[];
  /** 看完小课堂后的第一条:节前画小课堂卡与圈的卡(圈带那段话;孩子端下发时摘掉) */
  lecture?: KidLecture;
  /** 家长端多看到的看的情况 */
  lectureWatch?: { watchedMs: number; finished: boolean; pauses: number };
  /** 看的过程(录像用;孩子端不下发) */
  lectureLog?: { t: number; pos: number; play: boolean }[];
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
\`\`\`

## 为什么这么排

- mock 的样例
`;
}

export interface MockRouteResult {
  status: number;
  json?: unknown;
  html?: string;
  /** 静态文件(舞台包、课包) */
  file?: string;
  /** 现生成的二进制(主屏幕图标) */
  body?: Uint8Array;
  /** html / file / body / json 的 content-type */
  contentType?: string;
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
  handler(req: IncomingMessage, res: ServerResponse): void;
  /** 在哪个地址上听着(serveMock 在 listen 之后填;扫码页 /qr 每次现问) */
  listen: (() => ListenInfo) | null;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function createMock(opts: MockOptions = {}): Mock {
  // 写死的样子:nopost 场景看素版
  const withPost = (section: BoardSection, tutor: string, i: number): BoardSection => (opts.scenario === 'nopost' ? section : withMockPost(section, tutor, i));
  const scenario = opts.scenario ?? 'normal';
  const delay = opts.delayMs ?? 1800;
  const now = opts.now ?? (() => new Date());
  const yesterday = (): string => localDate(new Date(now().getTime() - 86400000));
  const title = opts.title ?? '小明的老师们';
  const messages = new Map<string, MockMessage[]>();
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
      const section = withPost(sectionFromScript(t.script[i]), t.name, i);
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
  const dailyLimit = 30;
  const used = (name: string): number => (messages.get(name) ?? []).filter((m) => m.question !== null && m.action !== 'continue').length;
  /** 话题打星(家长端清单上):<老师>/<话题> → 1–5;记过账的话题(同样的键) */
  const ratings = new Map<string, number>();
  /** 录音卡的录音(<老师>/<日期>.<job>.cards/<n>/rec-<k>.<ext> → 字节),只在内存里 */
  const recordings = new Map<string, { type: string; data: Buffer }>();
  const booked = new Set<string>();
  /** 下发孩子端的形状:答案剥掉、状态并到卡上、小课堂卡补那一段的起止(样本课包在仓库里) */
  const kidMessage = async (m: MockMessage) => {
    const { states, action: _a, lectureWatch: _w, lectureLog: _l, ...rest } = m;
    if (rest.lecture?.marks) rest.lecture = { ...rest.lecture, marks: rest.lecture.marks.map(({ text: _t, ...k }) => k) };
    const withState = m.section ? { ...m.section, cards: m.section.cards.map((c, i) => (states && i in states ? { ...c, state: states[i] } : c)) } : null;
    const section = withState ? await enrichLectures(MOCK_LECTURE_DIRS, stripSecrets(withState)) : null;
    return { ...rest, section };
  };
  const remaining = (name: string): number => (scenario === 'limit' ? 0 : Math.max(0, dailyLimit - used(name)));
  const tutorsJson = () => MOCK_TUTORS.map((t) => ({ name: t.name, display: t.display, avatar: t.avatar, subject: t.subject, motto: t.motto, hasVoice: false, remaining: remaining(t.name), available: remaining(t.name) > 0 }));
  /** 小课堂:样本课包与样本视频在仓库里(tests/fixtures/bundles/、lectures/),起来时和真服务一样读一遍(readLecture)、记住 */
  const lectures = new Map<string, Lecture>();
  const lecturesLoaded = (async () => {
    for (const dir of [MOCK_BUNDLES_DIR, MOCK_LECTURES_DIR]) {
      for (const id of await readdir(dir).catch(() => [] as string[])) { const l = await readLecture(MOCK_LECTURE_DIRS, id); if (l && !lectures.has(id)) lectures.set(id, l); }
    }
  })();
  const mockLecture = (id: string): (Lecture & { ms: number }) | null => { const l = lectures.get(id); return l ? { ...l, ms: l.clock.total } : null; };
  const home = () => {
    const d = now();
    const cards = arrangeHome(parseHome(mockHomeMd(localDate(d), yesterday())).cards, MOCK_TUTORS.map((t) => t.name)).map((c) => {
      if (c.kind !== 'tutor') return c;
      const name = String(c.props.tutor);
      const list = messages.get(name) ?? [];
      const asked = list.find((m) => m.question !== null && m.thread === list[list.length - 1]?.thread);
      const recent = asked ? { date: localDate(d), thread: asked.thread, title: asked.question ?? '' } : null;
      const alive = (date: string, thread: string): boolean => (date === yesterday() && (past.get(name) ?? []).some((m) => m.thread === thread)) || (date === localDate(d) && list.some((m) => m.thread === thread));
      return { kind: 'tutor', props: { tutor: name, buttons: kidButtons((c.props.buttons ?? []) as TutorButton[], { recent, alive, lecture: (id) => Boolean(mockLecture(id)) }).map((b) => { const l = b.kind === 'lecture' ? mockLecture(b.bundle) : null; return l ? { ...b, title: l.title, ms: l.ms, ...(l.video ? { video: true as const } : {}) } : b; }) } };
    });
    // figshot:和配了 figshot 的 workspace 一样给端口;这台电脑上 figshot 没开着,页面照样藏着这张卡
    return { title, date: localDate(d), tutors: tutorsJson(), home: mockHomeId(), cards, figshot: { port: 8477 } };
  };
  const mockHomeId = (): string => `${yesterday()}-2130`;
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
    const full = step ? withPost(sectionFromScript(step), t.name, i) : null;
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
          m.section = { ...part, ...(full.layout && rows.length ? { layout: { for: full.layout.for, rows } } : {}), partial: true, ready: readyBeats(part, { voiced: false, done: false }) };
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
    if (p === '/qr') return mock.listen ? { status: 200, html: qrPage(title, mock.listen(), url.searchParams.get('via') === 'ip' ? 'ip' : 'name', url.searchParams.get('to') === 'parent' ? 'parent' : 'kid') } : { status: 404, json: { error: 'not_listening' } };
    if (p === '/manifest.webmanifest') return { status: 200, json: webManifest(title), contentType: 'application/manifest+json; charset=utf-8' };
    // 家长端(《家长板书页设计.md》):同一个页面,家长模式;清单与一天的板书(答案不剥,第一节带一条给家长的尾巴与记忆,看旁注的样子)。mock 没有工作台 /dev
    if (p === '/parent') return { status: 200, html: kidPage(title, { parent: true, synth: true }, await stageVersion()) };
    if (p === '/reel') return { status: 200, html: kidPage(title, { reel: true, synth: true }, await stageVersion()) };
    if (p === '/parent/manifest.webmanifest') return { status: 200, json: webManifest(`${title} · 家长`, { startUrl: '/parent', scope: '/parent' }), contentType: 'application/manifest+json; charset=utf-8' };
    // 主题:mock 没有 workspace,直接给包里的出厂 default
    if (p === '/kid/theme.css') return { status: 200, html: `${cardsCss()}\n\n${(await packageTheme()).css}`, contentType: 'text/css; charset=utf-8' };
    if (p === '/kid/theme.json') return { status: 200, json: (await packageTheme()).manifest };
    const icon = /^\/icon-(\d{2,4})\.png$/.exec(p);
    if (icon) {
      const n = Number(icon[1]);
      return (ICON_SIZES as readonly number[]).includes(n) ? { status: 200, body: appIconPng(n), contentType: 'image/png' } : { status: 404, json: { error: 'not_found' } };
    }
    if (p === '/api/health') return { status: 200, json: { ok: scenario !== 'offline', mock: true, scenario } };
    if (scenario === 'offline' && p.startsWith('/api/')) return { status: 500, json: { error: 'mock_offline' } };
    if (p === '/api/kid/home' && method === 'GET') return { status: 200, json: home() };
    const ov = /^\/api\/overview\/(today|\d{4}-\d{2}-\d{2})$/.exec(p);
    if (ov && method === 'GET') {
      const today = localDate(now());
      const date = ov[1] === 'today' ? today : ov[1];
      if (date > today) return { status: 400, json: { error: 'bad_request' } };
      const listOf = (name: string): MockMessage[] => (date === today ? messages.get(name) : date === yesterday() ? past.get(name) : undefined) ?? [];
      const tutors = MOCK_TUTORS.map((t) => {
        const list = listOf(t.name);
        const by = new Map<string, { thread: string; at: string; title: string; from: 'kid'; via: null; sections: number; cards: number; stoppedAt: 'writing' | 'ask' | null; rating: number | null; booked: boolean }>();
        for (const m of list) {
          let th = by.get(m.thread);
          if (!th) {
            th = { thread: m.thread, at: m.at, title: Array.from((m.question ?? '').trim()).slice(0, 20).join(''), from: 'kid', via: null, sections: 0, cards: 0, stoppedAt: null, rating: ratings.get(`${t.name}/${m.thread}`) ?? null, booked: booked.has(`${t.name}/${m.thread}`) };
            by.set(m.thread, th);
          }
          if (m.pending) th.stoppedAt = 'writing';
          else if (m.section && (m.section.cards.length || m.section.lines.length)) { th.sections++; th.cards += m.section.cards.length; th.stoppedAt = m.section.lines[m.section.lines.length - 1]?.ask ? 'ask' : null; }
        }
        const recorded = list.reduce((n, m) => n + Object.keys(m.states ?? {}).filter((k) => m.section?.cards[Number(k)]?.kind === 'record').length, 0);
        return { name: t.name, display: t.display, avatar: t.avatar, subject: t.subject, turns: list.length, costUsd: list.length * 0.03, threads: [...by.values()], booking: false, ...(recorded ? { kouboYuan: recorded * 0.015 } : {}) };
      });
      return { status: 200, json: { title, date, today, tutors } };
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
        // 录音卡录过的:家长端旁注给一份写死的评测(mock 不起 koubo),按这一节里第几张录音卡轮着给 过 / 重录 / 没评上
        let rec = 0;
        const withHeard = (c: BoardSection['cards'][number], k: number) => {
          const st = states && k in states ? states[k] : undefined;
          if (c.kind !== 'record') return st === undefined ? c : { ...c, state: st };
          const h = st === undefined ? undefined : MOCK_HEARD[rec % MOCK_HEARD.length];
          rec++;
          return st === undefined ? c : { ...c, state: st, ...(h ? { heard: h } : {}) };
        };
        const section = m.section ? await enrichLectures(MOCK_LECTURE_DIRS, { ...m.section, cards: m.section.cards.map(withHeard) }) : null;
        return { ...rest, from: 'kid' as const, section, ...(i === 0 && !m.pending ? { parentText: '## 家长\n第一遍就答上了,后面那句是我故意留的:看他会不会自己往下想。', remembered: [`${date} 讲故事时爱抢着说结局,可以先让他猜`] } : {}) };
      }));
      const pending = list.find((m) => m.pending);
      return { status: 200, json: { tutor: name, date, messages: out, pending: pending ? pending.job : null, thread: list.length ? list[list.length - 1].thread : null } };
    }
    // 看录像(《家长录像设计.md》):mock 的消息没有真时刻(种子全是同一刻),照一个固定节奏排——
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
      const day = board.json as { date: string; messages: (Record<string, unknown> & { job: string; thread: string; from: 'kid'; question: string | null; pending: boolean; section: BoardSection | null; action?: 'continue' | 'submit' })[] };
      const thread = decodeURIComponent(raw);
      const mine = day.messages.filter((m) => m.thread === thread);
      let t = now().getTime() - 10 * 60000;
      const starts: number[] = [];
      const conv = mine.map((m, k) => {
        const wait = k === 1 ? 14000 : 3000;
        starts.push(t);
        const startedAt = new Date(t).toISOString();
        t += wait + (m.section?.lines ?? []).reduce((n, l) => n + lineDurationMs(l.text) + REEL_LINE_GAP_MS, 0) + (k === 0 ? 40000 : 8000);
        return { job: m.job, thread, at: startedAt, from: m.from, text: m.question ?? '', result: m.pending ? ('running' as const) : ('ok' as const), artifacts: [], section: m.section, timing: { startedAt, doneMs: wait, dubbedMs: wait }, ...(m.action ? { action: m.action } : {}), ...lectureOfMock(m) };
      });
      const cards: CardStates = {};
      mine.forEach((m, k) => (m.section?.cards ?? []).forEach((c, n) => { if (c.state !== undefined) (cards[m.job] ??= {})[n] = { at: new Date((starts[k + 1] ?? t) - 5000).toISOString(), turn: m.job, state: c.state }; }));
      const plays = (mockPlays[name] ?? []).filter((x) => x.thread === thread).map((x) => x.rec);
      const reel = buildReel({ messages: conv, events: {}, cards, durations: {}, tutor: name, now: now().getTime(), plays });
      // mock 的孩子接口只认 today 是今天(写日期的走「以前的」那份)
      const kidDay = await route('GET', `/api/kid/conversations/${name}/${tail === localDate(now()) ? 'today' : tail}`);
      const kid = kidDay.status === 200 ? (kidDay.json as { messages: { thread: string }[] }).messages.filter((m) => m.thread === thread) : [];
      const tt = MOCK_TUTORS.find((x) => x.name === name);
      const face = { name, display: tt?.display ?? name, avatar: tt?.avatar ?? null, subject: tt?.subject ?? null };
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
    const kid = /^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|messages|history|photos|play|\d{4}-\d{2}-\d{2})$/.exec(pk);
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
        return { status: 201, json: { path: `captures/${date}/${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}-${list.length + 1}.jpg` } };
      }
      if (tail === 'today' && method === 'GET') {
        const shown = (messages.get(name) ?? []);
        const pending = shown.find((m) => m.pending);
        return { status: 200, json: { tutor: name, date, messages: await Promise.all(shown.map(kidMessage)), remaining: remaining(name), pending: pending ? pending.job : null, thread: shown.length ? shown[shown.length - 1].thread : null } };
      }
      if (tail === 'history' && method === 'GET') {
        const days: { date: string; threads: unknown[] }[] = [];
        const todayThreads = kidThreads(await Promise.all((messages.get(name) ?? []).map(kidMessage))).reverse();
        if (todayThreads.length) days.push({ date, threads: todayThreads });
        const old = past.get(name) ?? [];
        if (old.length) days.push({ date: yesterday(), threads: kidThreads(old) });
        return { status: 200, json: { tutor: name, today: date, days } };
      }
      if (/^\d{4}-/.test(tail) && method === 'GET') {
        if (tail > date) return { status: 400, json: { error: 'bad_request' } };
        const old = tail === yesterday() ? (past.get(name) ?? []) : [];
        return { status: 200, json: { tutor: name, date: tail, messages: await Promise.all(old.map(kidMessage)), remaining: remaining(name), pending: null, thread: old.length ? old[old.length - 1].thread : null } };
      }
      if (tail === 'messages' && method === 'POST') {
        if (!isObj(body) || typeof body.text !== 'string') return { status: 400, json: { error: 'bad_request' } };
        const action = body.action === 'continue' || body.action === 'submit' ? body.action : undefined;
        const photos = Array.isArray(body.photos) ? (body.photos as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        const button = body.via === undefined ? undefined : mockButton(name, body.via);
        if (button === null) return { status: 400, json: { error: 'bad_via' } };
        let said = body.text;
        let newThread = body.newThread === true;
        let wantThread = body.thread;
        // 小课堂:看完才能开口,字是孩子说的,新话题;圈的那几处现算成一段话(同 runner)。问过以后再看一遍又圈了:同一话题的下一条带上(again)
        const marksIn = isObj(body.lecture) && Array.isArray(body.lecture.marks) ? (body.lecture.marks as { atMs: number; path: [number, number][]; image?: string; t?: number }[]) : [];
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
        if (!said.trim() && !action && !photos.length) return { status: 400, json: { error: 'bad_request' } };
        if (action !== 'continue' && remaining(name) <= 0) return { status: 429, json: { error: 'limit', remaining: 0 } };
        if (list.some((m) => m.pending)) return { status: 409, json: { error: 'busy' } };
        const text = said.trim() || (action === 'continue' ? '继续' : action === 'submit' ? '(交了答案,没说话)' : photos.length === 1 ? '(拍了一张)' : `(拍了 ${photos.length} 张)`);
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
        const m: MockMessage = { job, thread, at: now().toISOString(), question: text, reply: null, pending: true, artifacts: [], section: null, ...(action ? { action } : {}), ...(photos.length ? { photos } : {}), ...(lec ? { lecture: { bundle: lec.bundle, title: lt?.title ?? lec.bundle, ...(lec.again ? { again: true as const } : {}), ...(lt?.video ? { video: true as const } : {}), ...(marks.length ? { marks } : {}) }, lectureWatch: { watchedMs: lec.watchedMs, finished: lec.finished, pauses: lec.pauses }, ...(logIn.length ? { lectureLog: logIn } : {}) } : {}) };
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
      // 录音卡:data:audio 存在内存里,状态换成真服务那样的路径(/api/audio 从内存回放);mock 不评测
      let raw = body;
      if (target.kind === 'record' && isObj(body) && typeof body.audio === 'string' && body.audio.startsWith('data:')) {
        const am = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(body.audio);
        if (!am) return { status: 400, json: { error: 'bad_state' } };
        const k = [...recordings.keys()].filter((x) => x.startsWith(`${name}/${localDate(now())}.${job}.cards/${n}/`)).length + 1;
        const ext = am[1].includes('mp4') ? 'm4a' : 'webm';
        const rel = `${localDate(now())}.${job}.cards/${n}/rec-${k}.${ext}`;
        recordings.set(`${name}/${rel}`, { type: am[1], data: Buffer.from(am[2], 'base64') });
        raw = { ...body, audio: `conversations/${name}/${rel}` };
      }
      const r = parseCardState(target, raw);
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
      // 图片卡:任何路径都给一张占位 svg(写着路径),前端能看到版式
      const rel = url.searchParams.get('p') ?? '';
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
    if (p.startsWith('/api/audio/')) {
      const rec = recordings.get(decodeURIComponent(p.slice('/api/audio/'.length)));
      return rec ? { status: 200, contentType: rec.type, body: rec.data } : { status: 404, json: { error: 'not_found' } };
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
      else if (r.body !== undefined) { res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' }); res.end(Buffer.from(r.body)); }
      else if (r.html !== undefined) { res.writeHead(r.status, { 'content-type': r.contentType ?? 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(r.html); }
      else { res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(r.json ?? null)); }
    })().catch((err) => { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal', message: String(err) })); });
  };
  const mock: Mock = { route, settle, handler, listen: null };
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
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 8790, opts.host ?? '0.0.0.0', () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  const scheme = tls ? 'https' : 'http';
  const urls = [hostname(), ...lanAddresses()].map((h) => `${scheme}://${h}:${port}/`);
  mock.listen = () => listenInfo(Boolean(tls), port);
  return { server, mock, port, https: Boolean(tls), urls, qrPage: `${scheme}://localhost:${port}/qr` };
}
