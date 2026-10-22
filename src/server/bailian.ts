/**
 * 百炼(《产品规划.md》拍板 30):孩子端的老师靠实时模型开口,没配百炼孩子端打不开,家长在家长端「首页」里配。
 * 配的是按量的 key + 业务空间 id(Token Plan 的 `sk-sp-` 没有 realtime;端点要业务空间 id 的域名)。
 * 存机器级 ~/.config/cotutor/bailian.json(0600,同 PIN、证书,几个孩子的 workspace 共用),不进 cotutor.json:
 * workspace 是 git 仓,工作台的 PATCH /api/config 也能改它。读的顺序(家长端配的在最前)见 src/lib/qianwen.ts。
 *
 *   GET  /api/parent/bailian        {ready, from, keyTail, workspaceId, canEdit}
 *   PUT  /api/parent/bailian        {key, workspaceId}:先试连,通了才存;回 GET 那份 + ms
 *   POST /api/parent/bailian/test   拿现在用的那份试连一次:{ok, ms, message?}
 *
 * 改 key 要么在这台电脑上(本机免密),要么设了家长密码:没设 PIN 时局域网谁都进得了家长端,不让别的设备往这台电脑写 key。
 * 测试与探针指了假的实时端点(COTUTOR_LIVE_ENDPOINT)就当配好了,试连也连那个。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { bailianFile, cotutorBailian } from '../lib/qianwen.ts';
import { dashscopeAuth } from '../live/realtime.ts';
import { probeRealtime } from '../live/preview.ts';
import type { Who } from './access.ts';
import type { AppContext, RouteResult } from './app.ts';

export interface BailianAuth {
  key: string;
  workspaceId: string;
}

export interface BailianStatus {
  /** 孩子端能用:按量 key 与业务空间 id 都有(或指了假端点) */
  ready: boolean;
  /** 用的那份是哪来的:parent = 家长端配的;machine = 这台电脑别处配的(环境变量、qwen、voxtell);null = 没有 */
  from: 'parent' | 'machine' | null;
  /** key 的末四位(不回显整把) */
  keyTail: string | null;
  workspaceId: string | null;
}

export interface Bailian {
  status(): BailianStatus;
  /** 试连;不给 auth 就用现在那份。null = 通 */
  probe(auth?: BailianAuth): Promise<string | null>;
  save(auth: BailianAuth): Promise<void>;
}

export function createBailian(opts: { env?: NodeJS.ProcessEnv; probe?: (auth?: BailianAuth) => Promise<string | null> } = {}): Bailian {
  const env = opts.env ?? process.env;
  const home = env.HOME || homedir();
  const fake = env.COTUTOR_LIVE_ENDPOINT || undefined;
  return {
    status() {
      const auth = dashscopeAuth(env);
      if (!auth) return { ready: Boolean(fake), from: null, keyTail: null, workspaceId: null };
      const mine = cotutorBailian(home);
      return { ready: true, from: mine.apiKey === auth.key && mine.workspaceId === auth.workspaceId ? 'parent' : 'machine', keyTail: auth.key.slice(-4), workspaceId: auth.workspaceId };
    },
    probe: opts.probe ?? ((auth) => probeRealtime({ auth, env, endpoint: fake })),
    async save(auth) {
      const file = bailianFile(home);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify({ apiKey: auth.key, workspaceId: auth.workspaceId, at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    },
  };
}

/** 试连没通的原因,写给家长看 */
export function probeMessage(why: string): string {
  if (why === 'no_auth') return '还没配 key 和业务空间 id';
  if (why === 'connect' || why.startsWith('connect:') || why.startsWith('closed:')) return '连不上:key 或业务空间 id 不对,或者这台电脑上不了网';
  if (why === 'timeout') return '连上了,等不到回音(超时),过一会儿再试';
  return `百炼说:${why}`;
}

const KEY_RE = /^sk-[A-Za-z0-9._-]{16,}$/;
const WS_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,62}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (message: string): RouteResult => ({ status: 400, json: { error: 'bad_request', message } });

export async function bailianRoute(method: string, p: string, ctx: AppContext, body: unknown, who: Who): Promise<RouteResult | null> {
  if (p !== '/api/parent/bailian' && p !== '/api/parent/bailian/test') return null;
  const canEdit = who === 'local' || (await ctx.access.pinSet());
  const view = () => ({ ...ctx.bailian.status(), canEdit });
  if (p === '/api/parent/bailian/test') {
    if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
    const t0 = Date.now();
    const why = await ctx.bailian.probe();
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
