/**
 * 模拟接口(`cotutor mock`):不经真实老师与配音,用固定的板书 JSON 把孩子端页面喂起来,
 * 专门测前端的交互逻辑与渲染效果(卡先铺、笔跟声、停下等、追问追加、上限、离线)。
 * 不需要 workspace。老师的每一轮从各自的脚本里按顺序取;脚本用完给一句收尾话。
 * 没有配音文件(/api/audio 一律 404),页面退回浏览器自带的合成声,所以逐句节奏是真的。
 * 场景:normal(缺省)/ limit(每日上限已到)/ offline(接口全 500,页面该灰)。
 */
import { readFileSync } from 'node:fs';
import { createServer as createHttp, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { anchorMarks, isQuestion, phrasesIn, plainLine, type BoardCard, type BoardSection } from '../lib/kid-board.ts';
import { lanAddresses } from '../cli/serve.ts';
import { USER_CERT_DIR } from '../cli/workspace.ts';
import { KID_PAGE } from './kid-page.ts';

export type MockScenario = 'normal' | 'limit' | 'offline';

export interface MockTutor {
  name: string;
  display: string;
  subject: string;
  avatar: string;
  motto: string;
  /** 每轮一节;讲稿一行一句,[词] 是标注 */
  script: { cards: BoardCard[]; say: string[] }[];
  /** 打开页面时已经讲过的轮数(取脚本前几节) */
  preloaded: number;
  /** 首轮的那句问题(孩子问的;不上板,只进索引) */
  firstQuestion: string;
}

/** 脚本 → 板书节:句子里的 [词] 落到卡上,末句问句 → ask */
export function sectionFromScript(s: { cards: BoardCard[]; say: string[] }): BoardSection {
  return { cards: s.cards, lines: s.say.map((text) => ({ text: plainLine(text), audio: null, marks: anchorMarks(s.cards, phrasesIn(text)), ask: isQuestion(text) })) };
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
      {
        cards: [
          { type: 'cover', title: '画蛇添足', subtitle: '一个成语,一杯酒的故事' },
          { type: 'oneline', text: '画蛇添足 = 多做一步,反而坏事' },
          { type: 'section', title: '这个成语从哪来' },
          { type: 'types', items: [{ name: '出处', note: '《战国策》里的故事' }, { name: '用法', note: '批评人多此一举' }] },
          { type: 'section', title: '故事是这样的' },
          { type: 'fact', text: '几个人分一壶酒,酒不够,就比赛画蛇,先画完的喝。' },
          { type: 'fact', text: '有个人先画完了,得意地给蛇添上脚;第二个画完的说:蛇没有脚,你画的不是蛇。' },
          { type: 'quote', text: '为蛇足者,终亡其酒。' },
          { type: 'think', question: '如果那个人不给蛇画脚,酒是谁的?', back: '当然是他的:他本来就是第一个画完的。' },
        ],
        say: [
          '你有没有过这种事:本来做得好好的,又多加了一点,结果反而糟了?',
          '这个成语说的就是:[画蛇添足 = 多做一步,反而坏事]。',
          '它有两个来头:[出处]在《战国策》,[用法]是批评人多此一举。',
          '故事是这样的:几个人分一壶酒,酒不够,就[比赛画蛇],先画完的喝。',
          '有个人先画完了,得意地[给蛇添上脚];第二个画完的说,蛇没有脚,你画的不是蛇。',
          '古人把这件事记成一句话:[为蛇足者,终亡其酒]。',
          '最后我想问你一个问题:如果那个人不给蛇画脚,酒是谁的?',
        ],
      },
      {
        cards: [
          { type: 'section', title: '酒到底归谁' },
          { type: 'fact', text: '先画完的人本来赢了;他多画了脚,蛇就不是蛇了,酒归第二个画完的。' },
          { type: 'list', items: [{ lead: '画完就停', text: '做到了,就别再动' }, { lead: '看清要求', text: '题目要的是蛇,不是有脚的蛇' }] },
          { type: 'checklist', items: ['作文写完了,又硬加一段', '搭好的积木,再放一块就塌了'] },
          { type: 'think', question: '你有没有画过「蛇脚」?想一件小事说说看。' },
        ],
        say: [
          '这个问题问得好。先画完的人本来是赢了的。',
          '他多画了脚,蛇就[不是蛇]了,所以酒归第二个画完的。',
          '记住两件事:[画完就停],[看清要求]。',
          '你有没有画过蛇脚?比如[作文写完了,又硬加一段]。',
          '想一件自己的小事说说看?',
        ],
      },
      {
        cards: [{ type: 'oneline', text: '做到了,就停下来' }],
        say: ['说得好,这就是画蛇添足要提醒我们的:[做到了,就停下来]。明天我们讲另一个成语,好不好?'],
      },
    ],
  },
  {
    name: 'math-tutor',
    display: '数学老师',
    subject: '数学',
    avatar: '数',
    motto: '不懂的都来问我',
    preloaded: 1,
    firstQuestion: '长方形长6宽4,画一条对角线,阴影是多少?',
    script: [
      {
        cards: [
          { type: 'problem', text: '长方形长 6、宽 4,画一条对角线,求阴影部分的面积。' },
          { type: 'figure', caption: '对角线把长方形分成两个三角形' },
          { type: 'core', title: '核心操作', text: '对角线把长方形分成一样大的两半。' },
          { type: 'formula', text: '阴影面积 = 长方形面积 ÷ 2' },
          { type: 'calc', title: '算一算', text: '6 × 4 ÷ 2 = 12' },
        ],
        say: [
          '你好呀,我们一起来看这道题。先把题目整理到黑板上:[长方形长 6、宽 4]。',
          '画一条对角线,你看,两个三角形是不是一模一样?',
          '所以关键一步是:[对角线把长方形分成一样大的两半]。',
          '那阴影就是[长方形面积 ÷ 2]。',
          '算一算:[6 × 4 ÷ 2 = 12]。',
          '这一步明白吗?',
        ],
      },
      {
        cards: [
          { type: 'section', title: '再来一道' },
          { type: 'problem', text: '正方形边长 5,画一条对角线,阴影是其中一半,面积是多少?' },
          { type: 'calc', title: '算一算', text: '5 × 5 ÷ 2 = 12.5' },
        ],
        say: ['太棒了。那换个正方形:[边长 5],对角线一画,阴影还是一半。', '所以是[5 × 5 ÷ 2 = 12.5]。', '你自己再出一道类似的题考考我?'],
      },
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
    script: [],
  },
];

interface MockMessage {
  job: string;
  at: string;
  question: string | null;
  reply: string | null;
  audio: null;
  pending: boolean;
  artifacts: string[];
  section: BoardSection | null;
}

export interface MockRouteResult {
  status: number;
  json?: unknown;
  html?: string;
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
  const scenario = opts.scenario ?? 'normal';
  const delay = opts.delayMs ?? 1800;
  const now = opts.now ?? (() => new Date());
  const title = opts.title ?? '小明的老师们';
  const messages = new Map<string, MockMessage[]>();
  const cursor = new Map<string, number>();
  const inflight = new Map<string, Promise<void>>();
  let seq = 0;
  const nextJob = (): string => { const d = now(); return `${pad(d.getHours())}${pad(d.getMinutes())}-${++seq}`; };
  for (const t of MOCK_TUTORS) {
    const list: MockMessage[] = [];
    for (let i = 0; i < t.preloaded && i < t.script.length; i++) {
      const section = sectionFromScript(t.script[i]);
      list.push({ job: nextJob(), at: now().toISOString(), question: i === 0 ? t.firstQuestion : '继续', reply: section.lines[section.lines.length - 1]?.text ?? null, audio: null, pending: false, artifacts: [], section });
    }
    messages.set(t.name, list);
    cursor.set(t.name, Math.min(t.preloaded, t.script.length));
  }
  const dailyLimit = 30;
  const used = (name: string): number => (messages.get(name) ?? []).filter((m) => m.question !== null).length;
  const remaining = (name: string): number => (scenario === 'limit' ? 0 : Math.max(0, dailyLimit - used(name)));
  const tutorsJson = () => MOCK_TUTORS.map((t) => ({ name: t.name, display: t.display, avatar: t.avatar, subject: t.subject, motto: t.motto, hasVoice: false, remaining: remaining(t.name), available: remaining(t.name) > 0 }));
  const timetable = [
    { day: 1, subject: '数学', start: '17:00', end: '17:20' },
    { day: 2, subject: '语文', start: '16:00', end: '16:30' },
    { day: 3, subject: '语文', start: '16:00', end: '16:30' },
    { day: 3, subject: '数学', start: '17:00', end: '17:20' },
    { day: 4, subject: '英语', start: '16:30', end: '16:50' },
    { day: 5, subject: '数学', start: '17:00', end: '17:20' },
  ];
  const home = () => {
    const d = now();
    const day = d.getDay() === 0 ? 7 : d.getDay();
    return { title, date: localDate(d), day, timetable, slot: null, tutors: tutorsJson(), stacks: [], suggestions: [{ tutor: 'chinese-tutor', text: '「静夜思」怎么背' }, { tutor: 'math-tutor', text: '25 加 17 怎么算' }, { tutor: 'reading-tutor', text: '再听一遍昨天的故事' }] };
  };
  const answer = (t: MockTutor, m: MockMessage): void => {
    const i = cursor.get(t.name) ?? 0;
    const step = t.script[i];
    cursor.set(t.name, i + 1);
    if (step) {
      m.section = sectionFromScript(step);
      m.reply = m.section.lines[m.section.lines.length - 1]?.text ?? null;
    } else {
      m.section = null;
      m.reply = t.script.length ? '这个我们明天接着说,好不好?' : `你说的是「${m.question ?? ''}」,我们一起大声读一遍?`;
    }
    m.pending = false;
  };
  const route = async (method: string, path: string, body?: unknown): Promise<MockRouteResult> => {
    const url = new URL(path, 'http://x');
    const p = url.pathname;
    if (p === '/') return { status: 200, html: KID_PAGE.replace('__TITLE__', title) };
    if (p === '/api/health') return { status: 200, json: { ok: scenario !== 'offline', mock: true, scenario } };
    if (scenario === 'offline' && p.startsWith('/api/')) return { status: 500, json: { error: 'mock_offline' } };
    if (p === '/api/kid/home' && method === 'GET') return { status: 200, json: home() };
    const kid = /^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|messages)$/.exec(p);
    if (kid) {
      const [, name, tail] = kid;
      const t = MOCK_TUTORS.find((x) => x.name === name);
      if (!t) return { status: 404, json: { error: 'no_such_tutor' } };
      const list = messages.get(name) ?? [];
      const date = localDate(now());
      if (tail === 'today' && method === 'GET') {
        const pending = list.find((m) => m.pending);
        return { status: 200, json: { tutor: name, date, messages: list, remaining: remaining(name), pending: pending ? pending.job : null } };
      }
      if (tail === 'messages' && method === 'POST') {
        if (!isObj(body) || typeof body.text !== 'string' || !body.text.trim()) return { status: 400, json: { error: 'bad_request' } };
        if (remaining(name) <= 0) return { status: 429, json: { error: 'limit', remaining: 0 } };
        if (list.some((m) => m.pending)) return { status: 409, json: { error: 'busy' } };
        const m: MockMessage = { job: nextJob(), at: now().toISOString(), question: body.text, reply: null, audio: null, pending: true, artifacts: [], section: null };
        list.push(m);
        const done = new Promise<void>((resolve) => setTimeout(() => { answer(t, m); inflight.delete(m.job); resolve(); }, delay));
        inflight.set(m.job, done);
        return { status: 202, json: { tutor: name, date, job: m.job } };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
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
      if (r.html !== undefined) { res.writeHead(r.status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(r.html); }
      else { res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(r.json ?? null)); }
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
