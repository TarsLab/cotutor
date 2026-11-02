/**
 * 百炼(src/app/machine/bailian.ts):孩子端要它才打得开,家长端配。
 * 只认 ~/.config/cotutor/ 的文件(环境变量不看)、配的接口(先试连,通了才存;Token Plan 的 key、坏的业务空间 id 不收;没设 PIN 时别的设备不让配)、
 * 孩子端首页与家长记录带 ready、假端点当配好了、doctor 的 bailian 是必需项、token-plan 那条只在有文件(或还 export 着旧环境变量)时出。
 */
import { mkdtempSync, readFileSync, realpathSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-bailian-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.COTUTOR_LIVE_ENDPOINT;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route, kidHome, overview } = await import('../src/app/http/app.ts');
const { createBailian, probeMessage } = await import('../src/app/machine/bailian.ts');
const { createAccess, setPin } = await import('../src/app/http/access.ts');
const { dashscopeAuth } = await import('../src/realtime/bailian.ts');
const { bailianFile, tokenPlanFile } = await import('../src/shared/qianwen.ts');
const { doctorWorkspace } = await import('../src/app/cli/doctor.ts');
const { KID_PAGE } = await import('../src/ui/kid/kid-page.ts');
const { PARENT_HOME_PAGE } = await import('../src/ui/parent/parent-home-page.ts');

const env = { HOME: home } as NodeJS.ProcessEnv;
const GOOD = 'sk-0123456789abcdef0123';
const tried: { key: string; workspaceId: string }[] = [];
const probe = async (auth?: { key: string; workspaceId: string }): Promise<string | null> => {
  if (auth) tried.push(auth);
  return auth && auth.key !== GOOD ? 'connect' : null;
};

try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const now = new Date(2026, 9, 22, 20, 0);
  const access = createAccess({ now: () => now });
  const ctx = createContext(loadWorkspace(root), { now: () => now, access, env, bailian: createBailian({ env, probe }) });
  const as = (who: 'local' | 'anon' | 'parent') => (method: string, p: string, body?: unknown) => route(method, p, ctx, body, who);
  const local = as('local'), anon = as('anon');

  // ---- 读的先后 ----
  check('什么都没配:dashscopeAuth 是 null', dashscopeAuth(env) === null);
  check('环境变量不看', dashscopeAuth({ ...env, DASHSCOPE_API_KEY: 'sk-envenvenvenvenvenvenv', DASHSCOPE_WORKSPACE_ID: 'llm-env' }) === null);
  check('文件在机器级 ~/.config/cotutor/bailian.json', bailianFile(home) === join(home, '.config', 'cotutor', 'bailian.json'));

  // ---- 没配 ----
  const g0 = (await local('GET', '/api/parent/bailian')).json as { ready: boolean; canEdit: boolean };
  check('没配:GET 回 ready false、本机能改', g0.ready === false && g0.canEdit === true, JSON.stringify(g0));
  check('没配:孩子端首页 ready false', (await kidHome(ctx, now)).ready === false);
  check('没配:家长记录 ready false', (await overview(ctx, '2026-10-22')).ready === false);
  check('没配:孩子端首页接口照常 200(只是页面灰着)', (await anon('GET', '/api/kid/home')).status === 200);

  // ---- 配:各种不收 ----
  const n0 = tried.length;
  const a0 = await anon('PUT', '/api/parent/bailian', { key: GOOD, workspaceId: 'llm-abcdef' });
  check('没设 PIN:别的设备不让配(403 need_pin,说怎么办)', a0.status === 403 && (a0.json as { error: string; message: string }).error === 'need_pin' && /cotutor pin/.test((a0.json as { message: string }).message));
  const tp = await local('PUT', '/api/parent/bailian', { key: 'sk-sp-0123456789abcdef', workspaceId: 'llm-abcdef' });
  check('Token Plan 的 key 不收,说要按量的', tp.status === 400 && /Token Plan/.test((tp.json as { message: string }).message));
  check('不像 key 的不收', (await local('PUT', '/api/parent/bailian', { key: 'abc', workspaceId: 'llm-abcdef' })).status === 400);
  check('业务空间 id 带怪字符不收', (await local('PUT', '/api/parent/bailian', { key: GOOD, workspaceId: 'llm abc/..' })).status === 400);
  check('上面这几次都没去试连', tried.length === n0);
  const f0 = await local('PUT', '/api/parent/bailian', { key: 'sk-ffffffffffffffffffff', workspaceId: 'llm-abcdef' });
  check('试连没通:400、说原因、不存', f0.status === 400 && (f0.json as { message: string }).message === probeMessage('connect') && !existsSync(bailianFile(home)), JSON.stringify(f0.json));

  // ---- 配上 ----
  const ok = await local('PUT', '/api/parent/bailian', { key: `  ${GOOD} `, workspaceId: ' llm-abcdef ' });
  const okj = ok.json as { ready: boolean; keyTail: string; workspaceId: string };
  check('试连通了:存好、回 ready、只回末四位', ok.status === 200 && okj.ready && okj.keyTail === '0123' && okj.workspaceId === 'llm-abcdef' && !JSON.stringify(okj).includes(GOOD), JSON.stringify(okj));
  check('试的是去掉空白的那把', tried.at(-1)?.key === GOOD && tried.at(-1)?.workspaceId === 'llm-abcdef');
  check('文件 0600,不进 workspace', (statSync(bailianFile(home)).mode & 0o777) === 0o600 && !readFileSync(join(root, 'cotutor.json'), 'utf8').includes(GOOD));
  check('dashscopeAuth 用上了', dashscopeAuth(env)?.key === GOOD && dashscopeAuth(env)?.workspaceId === 'llm-abcdef');
  check('配好了:孩子端首页 ready true', (await kidHome(ctx, now)).ready === true);
  const t1 = (await local('POST', '/api/parent/bailian/test')).json as { ok: boolean; ms: number };
  check('试连现在那份:通', t1.ok === true && typeof t1.ms === 'number');

  // ---- 设了 PIN ----
  await setPin('2468');
  check('设了 PIN:没凭证的进不来家长接口', (await anon('GET', '/api/parent/bailian')).status === 401);
  const pj = (await as('parent')('GET', '/api/parent/bailian')).json as { canEdit: boolean };
  check('设了 PIN:凭了 PIN 的设备能改', pj.canEdit === true);

  // ---- 假端点(测试、探针)当配好了 ----
  const fake = createBailian({ env: { HOME: join(home, 'nobody'), COTUTOR_LIVE_ENDPOINT: 'ws://127.0.0.1:1/x' } });
  check('指了假端点:没 key 也 ready', fake.status().ready === true && fake.status().keyTail === null);

  // ---- doctor ----
  const d1 = await doctorWorkspace(root, { probeEnv: false, env });
  const c1 = d1.checks.find((c) => c.name === 'bailian');
  check('doctor:配了 → bailian 绿、必需', c1?.ok === true && c1.required === true && c1.detail.includes('…0123'), JSON.stringify(c1));
  const d0 = await doctorWorkspace(root, { probeEnv: false, env: { HOME: join(home, 'nobody') } });
  const c0 = d0.checks.find((c) => c.name === 'bailian');
  check('doctor:没配 → bailian 红、必需、说去家长端配', c0?.ok === false && c0.required === true && /家长端/.test(c0.fix ?? ''), JSON.stringify(c0));
  check('doctor:没有 token-plan.json → 不提 Token Plan', !d1.checks.some((c) => c.name === 'token-plan'));
  const stale = await doctorWorkspace(root, { probeEnv: false, env: { HOME: join(home, 'nobody'), DASHSCOPE_API_KEY: 'sk-old', QWENCLOUD_TOKEN_PLAN_API_KEY: 'sk-sp-old' } });
  check('doctor:shell 里还 export 着旧的 → 说不读了、Token Plan 写进文件', /DASHSCOPE_API_KEY 已经不读了/.test(stale.checks.find((c) => c.name === 'bailian')?.detail ?? '') && /token-plan\.json/.test(stale.checks.find((c) => c.name === 'token-plan')?.fix ?? ''), JSON.stringify(stale.checks.filter((c) => /bailian|token-plan/.test(c.name))));
  writeFileSync(tokenPlanFile(home), JSON.stringify({ apiKey: 'sk-sp-0123456789abcdef9876' }));
  const tp1 = (await doctorWorkspace(root, { probeEnv: false, env })).checks.find((c) => c.name === 'token-plan');
  check('doctor:有 token-plan.json → 绿、不必需、只给末四位', tp1?.ok === true && tp1.required === false && tp1.detail.includes('…9876') && !tp1.detail.includes('0123456789abcdef'), JSON.stringify(tp1));
  writeFileSync(tokenPlanFile(home), JSON.stringify({ apiKey: 'sk-0123456789abcdef' }));
  const tp2 = (await doctorWorkspace(root, { probeEnv: false, env })).checks.find((c) => c.name === 'token-plan');
  check('doctor:token-plan.json 里不是 sk-sp- → 黄', tp2?.ok === false && tp2.required === false, JSON.stringify(tp2));

  // ---- 页面 ----
  check('孩子端页面:有「老师们还没到」那一行,首页读到 ready false 就灰', KID_PAGE.includes('id="gate"') && KID_PAGE.includes('setGated('));
  check('家长首页:有配百炼那块,走 /api/parent/bailian', PARENT_HOME_PAGE.includes("'/api/parent/bailian'") && PARENT_HOME_PAGE.includes('bl-key'));
} finally {
  done();
}
