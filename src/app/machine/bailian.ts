/**
 * 百炼:孩子端的老师靠实时模型开口,没配百炼孩子端打不开,家长在家长端「首页」里配。
 * 配的是按量的 key + 业务空间 id(Token Plan 的 `sk-sp-` 没有 realtime;端点要业务空间 id 的域名)。
 * 存机器级 ~/.config/cotutor/bailian.json(0600,同 PIN、证书,几个孩子的 workspace 共用),不进 cotutor.json:
 * workspace 是 git 仓,工作台的 PATCH /api/config 也能改它。cotutor 的 key 只认这里(开发机另有 token-plan.json),见 src/shared/qianwen.ts。
 *
 *   GET  /api/parent/bailian        {ready, keyTail, workspaceId, canEdit}
 *   PUT  /api/parent/bailian        {key, workspaceId}:先试连,通了才存;回 GET 那份 + ms
 *   POST /api/parent/bailian/test   拿现在用的那份试连一次:{ok, ms, message?}
 *
 * 改 key 要么在这台电脑上(本机免密),要么设了家长密码:没设 PIN 时局域网谁都进得了家长端,不让别的设备往这台电脑写 key。
 * 测试与探针指了假的实时端点(COTUTOR_LIVE_ENDPOINT)就当配好了,试连也连那个。
 *
 * 跑起来以后也会坏(欠费、key 失效、这台电脑断网):ready 只说「填过」,看不出来。嘴和脑出错时记一笔(note),/api/health 带给图标和家长端;
 * 要家长动手的那几类,孩子端显示「叫爸爸妈妈」(blocked)。错误码照官方错误码表(help.aliyun.com/zh/model-studio/error-code);欠费没法真测,是照表写的,假 key 是真跑过的。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { bailianFile } from '../../shared/qianwen.ts';
import { dashscopeAuth } from '../../realtime/bailian.ts';
import { askRealtime, probeRealtime, unclearWhy } from '../../realtime/preview.ts';
import type { Who } from '../http/access.ts';
import type { AppContext, RouteResult } from '../http/app.ts';

export interface BailianAuth {
  key: string;
  workspaceId: string;
}

export interface BailianStatus {
  /** 孩子端能用:按量 key 与业务空间 id 都有(或指了假端点) */
  ready: boolean;
  /** key 的末四位(不回显整把) */
  keyTail: string | null;
  workspaceId: string | null;
}

export type TroubleKind = 'key' | 'money' | 'space' | 'network' | 'other';

/** 谁报的:嘴连不上、通话中百炼报错、脑的请求失败 */
export type TroubleSource = 'mouth' | 'call' | 'brain';

export interface BailianTrouble {
  kind: TroubleKind;
  message: string;
  fix: string;
  /** 百炼的原话(错误码),排查用 */
  why: string;
  /** 孩子端要显示「叫爸爸妈妈」 */
  blocked: boolean;
}

const TROUBLE_TEXT: Record<TroubleKind, { message: string; fix: string }> = {
  key: { message: '百炼的 key 不对或失效了', fix: '到家长端「首页」换一把百炼按量的 key。' },
  money: { message: '百炼欠费或没开通按量付费', fix: '到百炼控制台充值或开通,好了几分钟内自己恢复。' },
  space: { message: '这把 key 用不了这个业务空间', fix: '到家长端「首页」核对业务空间 id。' },
  network: { message: '这台电脑连不上百炼', fix: '看看这台电脑的网络,好了几分钟内自己恢复。' },
  other: { message: '百炼这几次都没连上', fix: '过一会儿再看;一直这样,到家长端「首页」点试连。' },
};

/** 按错误码分类;官方表里没有的算 other */
export function troubleKind(why: string): TroubleKind {
  if (/InvalidApiKey|invalid_api_key|\b401\b/i.test(why)) return 'key';
  if (/Arrearage|BillOverdue|AllocationQuota|CommodityNotPurchased|Unpurchased|insufficient_quota/i.test(why)) return 'money';
  if (/AccessDenied|\b403\b/i.test(why)) return 'space';
  if (/^network$|^timeout$|请求或流断了/.test(why)) return 'network';
  return 'other';
}

/** 这几类等不好,要家长动手,一次就算;网络和别的可能只是抖一下,连着两次才算 */
const needsParent = (kind: TroubleKind): boolean => kind === 'key' || kind === 'money' || kind === 'space';
const STRIKES = 2;
/** 脑和通话中的错没法自己再试(再试要花钱),多久没再犯就算过去了;还在坏的话孩子下一次用又会记上 */
const EVENT_TTL_MS = 3600_000;

export interface Bailian {
  status(): BailianStatus;
  /** 试连;不给 auth 就用现在那份。null = 通 */
  probe(auth?: BailianAuth): Promise<string | null>;
  save(auth: BailianAuth): Promise<void>;
  /** 跑起来以后的故障;没有 → null */
  trouble(): BailianTrouble | null;
  /** 孩子端该灰着:嘴连不上,而且要家长动手 */
  blocked(): boolean;
  /** 出错了:记一笔;「连不上」这种说不清的先问清原因 */
  note(source: TroubleSource, why: string): Promise<void>;
  /** 好了;不给 source 就全清(换了 key、试连通了) */
  fine(source?: TroubleSource): void;
  /** 嘴连不上时隔一阵再试一次,好了就清(充上钱、网回来了,没人点也会恢复) */
  recheck(): Promise<void>;
}

export function createBailian(opts: { env?: NodeJS.ProcessEnv; probe?: (auth?: BailianAuth) => Promise<string | null>; ask?: () => Promise<string | null>; now?: () => number } = {}): Bailian {
  const env = opts.env ?? process.env;
  const home = env.HOME || homedir();
  const fake = env.COTUTOR_LIVE_ENDPOINT || undefined;
  const now = opts.now ?? Date.now;
  const ask = opts.ask ?? (() => askRealtime({ env, endpoint: fake }));
  const notes = new Map<TroubleSource, { why: string; kind: TroubleKind; count: number; at: number }>();
  const probe = opts.probe ?? ((auth?: BailianAuth) => probeRealtime({ auth, env, endpoint: fake }));
  const counted = (source: TroubleSource) => {
    const n = notes.get(source);
    if (!n) return null;
    if (source !== 'mouth' && now() - n.at > EVENT_TTL_MS) { notes.delete(source); return null; }
    return needsParent(n.kind) || n.count >= STRIKES ? n : null;
  };
  const bailian: Bailian = {
    status() {
      const auth = dashscopeAuth(env);
      if (!auth) return { ready: Boolean(fake), keyTail: null, workspaceId: null };
      return { ready: true, keyTail: auth.key.slice(-4), workspaceId: auth.workspaceId };
    },
    probe,
    async save(auth) {
      const file = bailianFile(home);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify({ apiKey: auth.key, workspaceId: auth.workspaceId, at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
      notes.clear();
    },
    trouble() {
      const n = counted('mouth') ?? counted('call') ?? counted('brain');
      return n ? { kind: n.kind, ...TROUBLE_TEXT[n.kind], why: n.why.slice(0, 200), blocked: bailian.blocked() } : null;
    },
    blocked() {
      const n = counted('mouth');
      return Boolean(n && needsParent(n.kind));
    },
    async note(source, why) {
      // 通话自己结束了、还没配:都不是故障(没配有 ready 管)
      if (why === 'ended' || why === 'no_auth') return;
      const real = unclearWhy(why) ? (await ask().catch(() => null)) ?? why : why;
      if (real === 'no_auth') return;
      const kind = troubleKind(real);
      // 通话中百炼报的多半是这一句的事(声音太短之类),只认要家长动手的
      if (source === 'call' && !needsParent(kind)) return;
      const was = notes.get(source);
      notes.set(source, { why: real, kind, count: (was?.count ?? 0) + 1, at: now() });
    },
    fine(source) {
      if (source) notes.delete(source);
      else notes.clear();
    },
    async recheck() {
      if (!notes.has('mouth')) return;
      const why = await probe();
      if (why === null || why === 'no_auth') notes.delete('mouth');
      else notes.set('mouth', { why, kind: troubleKind(why), count: STRIKES, at: now() });
    },
  };
  return bailian;
}

/** 试连没通的原因,写给家长看 */
export function probeMessage(why: string): string {
  if (why === 'no_auth') return '还没配 key 和业务空间 id';
  if (why === 'connect' || why.startsWith('connect:') || why.startsWith('closed:')) return '连不上:key 或业务空间 id 不对,或者这台电脑上不了网';
  if (why === 'timeout') return '连上了,等不到回音(超时),过一会儿再试';
  const kind = troubleKind(why);
  if (kind !== 'other') return `${TROUBLE_TEXT[kind].message}。${TROUBLE_TEXT[kind].fix}`;
  return `百炼说:${why}`;
}

const KEY_RE = /^sk-[A-Za-z0-9._-]{16,}$/;
const WS_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,62}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (message: string): RouteResult => ({ status: 400, json: { error: 'bad_request', message } });

export async function bailianRoute(method: string, p: string, ctx: AppContext, body: unknown, who: Who): Promise<RouteResult | null> {
  if (p !== '/api/parent/bailian' && p !== '/api/parent/bailian/test') return null;
  const canEdit = who === 'local' || (await ctx.access.pinSet());
  const view = () => ({ ...ctx.bailian.status(), canEdit, trouble: ctx.bailian.trouble() });
  if (p === '/api/parent/bailian/test') {
    if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
    const t0 = Date.now();
    const why = await ctx.bailian.probe();
    if (why === null) ctx.bailian.fine();
    else await ctx.bailian.note('mouth', why);
    return { status: 200, json: { ok: why === null, ms: Date.now() - t0, ...(why === null ? {} : { message: probeMessage(why) }) } };
  }
  if (method === 'GET') return { status: 200, json: view() };
  if (method !== 'PUT') return { status: 405, json: { error: 'method_not_allowed' } };
  if (!canEdit) return { status: 403, json: { error: 'need_pin', message: '先设家长密码(在电脑上跑 cotutor pin),或者在这台电脑上打开家长端来配' } };
  if (!isObj(body)) return bad('要 {key, workspaceId}');
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
  if (key.startsWith('sk-sp-')) return bad('这是 Token Plan 的 key(sk-sp- 开头),老师开口要百炼按量的 key(sk- 开头)');
  if (!KEY_RE.test(key)) return bad('key 不像百炼的 API key(sk- 开头)');
  if (!WS_RE.test(workspaceId)) return bad('业务空间 id 不对(百炼控制台「业务空间」里那串,只有字母、数字、横线)');
  const t0 = Date.now();
  const why = await ctx.bailian.probe({ key, workspaceId });
  if (why !== null) return { status: 400, json: { error: 'probe_failed', message: probeMessage(why) } };
  await ctx.bailian.save({ key, workspaceId });
  return { status: 200, json: { ...view(), ms: Date.now() - t0 } };
}
