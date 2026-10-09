/**
 * 老师进程的代理(src/lib/proxy.ts):探测(先 ~/.claude/settings.json 再环境变量)、只注给 claude、
 * init 的选择(命令行给的 / 问了要 / 问了不要 / 不在终端只提示 / 选过不再问)、doctor 的几种状态、真跑一轮时 claude 子进程拿到了代理。
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-proxy-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];

const { detectProxy, withProxy } = await import('../src/lib/proxy.ts');
const { initWorkspace } = await import('../src/cli/init.ts');
const { proxyOf, setProxy } = await import('../src/cli/proxy.ts');
const { doctorWorkspace } = await import('../src/cli/doctor.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');

// ---- 探测 ----
check('都没有 → null', detectProxy() === null);
check('环境变量', detectProxy({ env: { https_proxy: 'http://127.0.0.1:1080' } })?.source === '环境变量');
check('不像地址的不算', detectProxy({ env: { HTTPS_PROXY: 'yes please' } }) === null);
mkdirSync(join(home, '.claude'), { recursive: true });
writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { HTTPS_PROXY: 'http://127.0.0.1:32769' } }));
const d = detectProxy({ env: { HTTPS_PROXY: 'http://10.0.0.1:9' } });
check('~/.claude/settings.json 优先(claude 平常用的就是它)', d?.url === 'http://127.0.0.1:32769' && d.source === '~/.claude/settings.json', JSON.stringify(d));

// ---- 只注给 claude ----
const base = { PATH: '/bin' };
check('claude(裸名或全路径)注 HTTP(S)_PROXY,大小写都给', withProxy(['claude', '-p'], base, 'http://p:1').HTTPS_PROXY === 'http://p:1' && withProxy(['/usr/local/bin/claude'], base, 'http://p:1').http_proxy === 'http://p:1');
check('qwen 不注 cotutor.json 的代理(只加它自己的环境变量)、voxtell 不动;false、没选不动', withProxy(['qwen'], base, 'http://p:1').HTTPS_PROXY === undefined && withProxy(['voxtell'], base, 'http://p:1') === base && withProxy(['claude'], base, false) === base && withProxy(['claude'], base, undefined) === base);

// ---- init 的选择 ----
const w1 = (await initWorkspace({ slug: 'a', proxy: 'http://127.0.0.1:7890' })).root;
check('--proxy <地址> 直接写', (await proxyOf(w1)) === 'http://127.0.0.1:7890');
let asked = 0;
const w2 = (await initWorkspace({ slug: 'b', askProxy: async () => (asked++, true) })).root;
check('探到了、终端里问 → 要:写探到的地址', asked === 1 && (await proxyOf(w2)) === 'http://127.0.0.1:32769');
const w3 = (await initWorkspace({ slug: 'c', askProxy: async () => false })).root;
check('问了不要 → false(以后不再问)', (await proxyOf(w3)) === false);
await initWorkspace({ slug: 'c', askProxy: async () => (asked++, true) });
check('选过了再 init 不问、不改', asked === 1 && (await proxyOf(w3)) === false);
const r4 = await initWorkspace({ slug: 'e' });
const w4 = r4.root;
check('不在终端(没有 ask):不写,「下一步」里提示 cotutor proxy on / off', (await proxyOf(w4)) === undefined && !r4.steps.some((s) => s.item.includes('proxy')) && r4.suggestions.some((x) => /cotutor proxy on/.test(x)), JSON.stringify(r4.suggestions));
let bad = '';
try { await setProxy(w4, 'not a url'); } catch (e) { bad = (e as Error).message; }
check('坏地址不收', /代理地址/.test(bad) && (await proxyOf(w4)) === undefined);

// ---- doctor ----
const px = async (root: string) => (await doctorWorkspace(root, { probeEnv: false })).checks.find((c) => c.name === 'proxy');
const c4 = await px(w4);
check('doctor:探到了没选 → 提醒,修法是 cotutor proxy on', c4?.ok === false && /cotutor proxy on/.test(c4.fix ?? ''), JSON.stringify(c4));
check('doctor:选了走 → 绿', (await px(w2))?.ok === true);
check('doctor:选了不走 → 绿,顺手说本机有代理', (await px(w3))?.ok === true && /本机有/.test((await px(w3))?.detail ?? ''));
await setProxy(w1, 'http://127.0.0.1:1');
const c1 = await px(w1);
check('doctor:写的和本机现在的不一样 → 提醒换', c1?.ok === false && /本机现在是 http:\/\/127\.0\.0\.1:32769/.test(c1.detail), JSON.stringify(c1));

// ---- 真跑一轮:claude 子进程的环境里有代理 ----
const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const bin = join(home, 'bin');
mkdirSync(bin, { recursive: true });
const claude = join(bin, 'claude');
writeFileSync(claude, `#!/bin/sh\nexec "${process.execPath}" --experimental-strip-types --no-warnings "${FAKE}" "$@"\n`);
chmodSync(claude, 0o755);
const cfgFile = join(w2, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.runtimes = { default: 'claude', claude: { run: [claude, '--agent', '{agent}', '{prompt}'], resume: [claude, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(w2), { now: () => new Date('2026-09-26T19:00:00'), env: { PATH: process.env.PATH } });
const sent = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '一加一' });
for (let i = 0; i < 400 && ctx.runner.running('math-tutor'); i++) await new Promise((r) => setTimeout(r, 25));
const log = join(w2, 'conversations', 'math-tutor', `2026-09-26.${(sent.json as { job: string }).job}.log`);
const init = existsSync(log) ? (JSON.parse(readFileSync(log, 'utf8').split('\n')[0]) as { proxy?: string }) : {};
check('serve 的环境里没代理,claude 子进程照样拿到 cotutor.json 的那个', init.proxy === 'http://127.0.0.1:32769', JSON.stringify(init));
await ctx.runner.flush();
done();
