/**
 * 模拟接口(`cotutor mock`):不经真实老师与配音,用固定的板书 JSON 把孩子端页面喂起来,
 * 专门测前端的交互逻辑与渲染效果(卡先铺、笔跟声、停下等、追问追加、上限、离线)。
 * 不需要 workspace。老师的每一轮从各自的脚本里按顺序取(脚本就是老师会写的正文,过真解析器);脚本用完给一句收尾话。
 * 没有配音文件(/api/audio 一律 404),页面退回浏览器自带的合成声,所以逐句节奏是真的。
 * 老师「想」的期间按流式模拟:卡在 delay 里一张张出现(pending 条目带 partial 板书),想完才有讲稿与声音。
 * 卡的状态 PUT 假存在内存里(过真的 state 契约),today 里并回卡上;发消息接 {text, action, focus},「交给老师」后照常追加下一节。
 * 场景:normal(缺省)/ limit(每日上限已到)/ offline(接口全 500,页面该灰)。
 * 首页是一份写死的「已发布」(mockHomeMd,过真解析器与真排法):语文老师有开场与接着昨天的按钮,数学老师有开场,朗读老师没写(补一张);
 * 发消息带 via 时照真服务的规则换成按钮上的字、定话题。
 */
import { createReadStream, readFileSync } from 'node:fs';
import { createServer as createHttp, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { parseBoard } from '../lib/board.ts';
import { parseCardState, stripSecrets } from '../cards/index.ts';
import { fileURLToPath } from 'node:url';
import { bundleAsset, stageAsset } from './stage.ts';
import { enrichScenes } from './scene-props.ts';
import { tianzigeData } from './tianzige.ts';

/** mock 的课包目录:仓库里的样本(tests/fixtures/bundles/),场景卡从这里播 */
export const MOCK_BUNDLES_DIR = fileURLToPath(new URL('../../tests/fixtures/bundles/', import.meta.url));
import { readyBeats, type BoardSection } from '../lib/kid-board.ts';
import { lanAddresses } from '../cli/serve.ts';
import { USER_CERT_DIR } from '../cli/workspace.ts';
import { kidThreads } from '../lib/kid-view.ts';
import { ICON_SIZES, appIconPng, webManifest } from '../lib/icon.ts';
import { kidPage } from './kid-page.ts';
import { arrangeHome, kidButtons, parseHome } from '../lib/home.ts';
import type { TutorButton } from '../cards/index.ts';
import { PACKAGE_THEMES_DIR, packageTheme } from '../cli/themes.ts';
import { validatePost, type PostOutput } from '../lib/postprocess.ts';
import { cardsCss } from '../cards/docs.ts';
import { ThemeManifestSchema, type ThemeManifest } from '../schema/index.ts';

/** 出厂主题的清单(假后期校验槽名用;同步读,预装的节也要带后期) */
const MOCK_THEME: ThemeManifest = ThemeManifestSchema.parse(JSON.parse(readFileSync(join(PACKAGE_THEMES_DIR, 'default', 'theme.json'), 'utf8')));

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
 * 假后期:真服务里这是快模型出的提案(src/lib/postprocess.ts 校验后套上);mock 没有模型,给几节写死的提案,
 * 过同一个 validatePost——页面走的是同一条渲染路(layout 的行、look 的槽、带 pen 的标注)。键 = 老师名:脚本序号。
 */
export const MOCK_POST: Record<string, PostOutput> = {
  // 勾股定理:封面独占,认边与公式并排,验证与一句话并排,选择题独占;验证是方法卡(moss),封面的「三条边」画圈(讲到第一句时)、16 下划线(老师自己标的 直角边 / 斜边 / 25 保留,不重复)
  'math-tutor:0': {
    marks: [{ line: 0, card: 0, phrase: '三条边', pen: 'circle' }, { line: 3, card: 3, phrase: '16', pen: 'underline' }],
    anchors: [],
    layout: { rows: [[0], [1, 2], [3, 4], [5]] },
    look: { '3': { tint: 'moss' }, '4': { emoji: '💡' } },
  },
  'math-tutor:1': { marks: [], anchors: [], layout: { rows: [[0, 1], [2]] }, look: { '0': { tint: 'moss' } } },
  'chinese-tutor:0': { marks: [{ line: 1, card: 1, phrase: '多做一步', pen: 'marker' }], anchors: [], layout: { rows: [[0], [1], [2], [3]] }, look: { '1': { emoji: '💡' } } },
};

function withMockPost(section: BoardSection, tutor: string, i: number, device: 'phone' | 'tablet-portrait' | 'tablet-landscape' = 'tablet-landscape'): BoardSection {
  const out = MOCK_POST[`${tutor}:${i}`];
  if (!out) return section;
  return validatePost(section, MOCK_THEME, device, out).section;
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

我们换一道找规律的题,我把它画出来看。

~~~scene
2026-09-04-guilv5
75、70、65,后面三个空填什么?
~~~

看我一步一步画。[[play]]

看完了,你自己说说,每次少几?`,
    ],
  },
  {
    name: 'reading-tutor',
    display: '朗读老师',
    subject: '英语',
    avatar: '读',
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

Which one do you want to try first, [apple], [banana], or [orange]? 你先读哪一个?`,
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
}

const pad = (n: number): string => String(n).padStart(2, '0');
const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function createMock(opts: MockOptions = {}): Mock {
  // 假后期:nopost 场景看素版
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
  /** 下发孩子端的形状:答案剥掉、状态并到卡上、场景卡补课包快照(样本课包在仓库里) */
  const kidMessage = async (m: MockMessage) => {
    const { states, action: _a, ...rest } = m;
    const section = m.section ? await enrichScenes({ bundles: MOCK_BUNDLES_DIR }, stripSecrets({ ...m.section, cards: m.section.cards.map((c, i) => (states && i in states ? { ...c, state: states[i] } : c)) })) : null;
    return { ...rest, section };
  };
  const remaining = (name: string): number => (scenario === 'limit' ? 0 : Math.max(0, dailyLimit - used(name)));
  const tutorsJson = () => MOCK_TUTORS.map((t) => ({ name: t.name, display: t.display, avatar: t.avatar, subject: t.subject, motto: t.motto, hasVoice: false, remaining: remaining(t.name), available: remaining(t.name) > 0 }));
  const home = () => {
    const d = now();
    const cards = arrangeHome(parseHome(mockHomeMd(localDate(d), yesterday())).cards, MOCK_TUTORS.map((t) => t.name)).map((c) => {
      if (c.kind !== 'tutor') return c;
      const name = String(c.props.tutor);
      const list = messages.get(name) ?? [];
      const asked = list.find((m) => m.question !== null && m.thread === list[list.length - 1]?.thread);
      const recent = asked ? { date: localDate(d), thread: asked.thread, title: asked.question ?? '' } : null;
      const alive = (date: string, thread: string): boolean => date === yesterday() && (past.get(name) ?? []).some((m) => m.thread === thread);
      return { kind: 'tutor', props: { tutor: name, buttons: kidButtons((c.props.buttons ?? []) as TutorButton[], { recent, alive }) } };
    });
    return { title, date: localDate(d), tutors: tutorsJson(), home: mockHomeId(), cards };
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
  const think = (t: MockTutor, m: MockMessage): Promise<void> => {
    const i = cursor.get(t.name) ?? 0;
    const step = t.script[i];
    cursor.set(t.name, i + 1);
    const full = step ? withPost(sectionFromScript(step), t.name, i) : null;
    const n = full ? full.cards.length : 0;
    const tick = delay / (n + 1);
    return new Promise<void>((resolve) => {
      let k = 0;
      const reveal = (): void => {
        k++;
        if (k <= n && full) {
          // 拍的就绪同真服务一个规则(readyBeats;mock 没配音 = 不等配音):露到第 k 张卡时前 k-1 拍关了 → 页面就绪一拍播一拍;卡前的句(锚 null)也在,和真 runner 一样
          // 后期按拍:铺到第 k 张时前 k-1 张的样子与行都已定(卡带 look,layout 只到已定的那几张)
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
    const url = new URL(path, 'http://x');
    const p = url.pathname;
    if (p === '/') return { status: 200, html: kidPage(title) };
    if (p === '/manifest.webmanifest') return { status: 200, json: webManifest(title), contentType: 'application/manifest+json; charset=utf-8' };
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
    const kid = /^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|messages|history|photos|\d{4}-\d{2}-\d{2})$/.exec(p);
    if (kid) {
      const [, name, tail] = kid;
      const t = MOCK_TUTORS.find((x) => x.name === name);
      if (!t) return { status: 404, json: { error: 'no_such_tutor' } };
      const list = messages.get(name) ?? [];
      const date = localDate(now());
      // 作业照片:不落盘,回一个像样的假路径(缩略图由 /api/kid/image 的占位 svg 顶)
      if (tail === 'photos' && method === 'POST') {
        if (!isObj(body) || typeof body.image !== 'string' || !body.image.startsWith('data:image/')) return { status: 400, json: { error: 'bad_request' } };
        const d = now();
        return { status: 201, json: { path: `captures/${date}/${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}-${list.length + 1}.jpg` } };
      }
      if (tail === 'today' && method === 'GET') {
        const pending = list.find((m) => m.pending);
        return { status: 200, json: { tutor: name, date, messages: await Promise.all(list.map(kidMessage)), remaining: remaining(name), pending: pending ? pending.job : null, thread: list.length ? list[list.length - 1].thread : null } };
      }
      if (tail === 'history' && method === 'GET') {
        const days: { date: string; threads: unknown[] }[] = [];
        const todayThreads = kidThreads(list).reverse();
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
        if (button && button !== 'new' && button !== 'recent') {
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
        const m: MockMessage = { job, thread, at: now().toISOString(), question: text, reply: null, pending: true, artifacts: [], section: null, ...(action ? { action } : {}), ...(photos.length ? { photos } : {}) };
        list.push(m);
        const done = think(t, m).then(() => { inflight.delete(m.job); });
        inflight.set(m.job, done);
        return { status: 202, json: { tutor: name, date, job: m.job, thread } };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }
    const card = /^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/cards\/([^/]+)\/(\d+)$/.exec(p);
    if (card) {
      const [, name, job, n] = card;
      const m = (messages.get(name) ?? []).find((x) => x.job === job);
      const target = m?.section?.cards[Number(n)];
      if (!target) return { status: 404, json: { error: 'no_such_card' } };
      if (method !== 'PUT') return { status: 405, json: { error: 'method_not_allowed' } };
      const r = parseCardState(target, body);
      if (!r.ok) return { status: 400, json: { error: 'bad_state' } };
      (m!.states ??= {})[Number(n)] = r.state;
      return { status: 200, json: { ok: true, card: `${job}/${n}` } };
    }
    const hz = /^\/api\/kid\/tianzige\/([^/]+)$/.exec(p);
    if (hz) {
      // 田字格卡:数据包就在 node_modules 里,mock 也给真笔顺
      const d = await tianzigeData(decodeURIComponent(hz[1]));
      return d ? { status: 200, json: d } : { status: 404, json: { error: 'not_found' } };
    }
    if (p === '/api/kid/image') {
      // 图片卡:任何路径都给一张占位 svg(写着路径),前端能看到版式
      const rel = url.searchParams.get('p') ?? '';
      const esc = rel.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
      return { status: 200, contentType: 'image/svg+xml', html: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7d9a8"/><stop offset="1" stop-color="#8fbf9f"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/><circle cx="260" cy="250" r="90" fill="#e8743b"/><circle cx="420" cy="230" r="80" fill="#f4c542"/><circle cx="560" cy="270" r="85" fill="#e0508a"/><text x="400" y="460" font-size="22" text-anchor="middle" fill="#2b2b2b" font-family="sans-serif">${esc}</text></svg>` };
    }
    if (p.startsWith('/stage/') && method === 'GET') {
      const f = await stageAsset(p);
      return f ? { status: 200, file: f.file, contentType: f.contentType } : { status: 404, json: { error: 'not_found' } };
    }
    if (p.startsWith('/api/bundles/') && method === 'GET') {
      const f = await bundleAsset(MOCK_BUNDLES_DIR, p);
      return f ? { status: 200, file: f.file, contentType: f.contentType } : { status: 404, json: { error: 'not_found' } };
    }
    if (p.startsWith('/api/audio/')) return { status: 404, json: { error: 'not_found' } };
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
      if (r.file !== undefined) { res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' }); createReadStream(r.file).on('error', () => res.end()).pipe(res); }
      else if (r.body !== undefined) { res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' }); res.end(Buffer.from(r.body)); }
      else if (r.html !== undefined) { res.writeHead(r.status, { 'content-type': r.contentType ?? 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(r.html); }
      else { res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(r.json ?? null)); }
    })().catch((err) => { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal', message: String(err) })); });
  };
  return { route, settle, handler };
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
  return { server, mock, port, https: Boolean(tls), urls };
}
