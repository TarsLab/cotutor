/** 工作台(《工作台设计.md》):概览的数字从会话索引算对、接口在、页面是侧栏 + 五个标签、三页共用一份色板。 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-dev-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { writeIndex } = await import('../src/server/store.ts');
const { ConversationIndexSchema } = await import('../src/schema/conversation.ts');
const { devOverview, SLOW_FIRST_MS } = await import('../src/server/dev-overview.ts');
const { localDate } = await import('../src/lib/conversation.ts');
const { DEV_PAGE } = await import('../src/server/dev-page.ts');
const { qrPage } = await import('../src/server/qr-page.ts');
const { VOICE_TEST_PAGE } = await import('../src/server/voice-test-page.ts');
const { DEV_CSS } = await import('../src/server/dev-theme.ts');
const { recordKidLog } = await import('../src/server/kid-log.ts');
const { codeChanged } = await import('../src/server/build.ts');

try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ws = loadWorkspace(root);
  const now = new Date(2026, 9, 16, 15, 50);
  const today = localDate(now);
  const yesterday = localDate(new Date(2026, 9, 15, 12));
  const msg = (job: string, extra: Record<string, unknown>) => ({ job, thread: job, at: `${extra.date ?? today}T${job.slice(0, 2)}:${job.slice(2, 4)}`, from: 'kid', text: '3/4 和 5/8 哪个大?', result: 'ok', runtime: 'qwen', ...extra });
  await writeIndex(ws, ConversationIndexSchema.parse({
    tutor: 'math-tutor',
    date: today,
    messages: [
      msg('1540-1', { tokens: { in: 1000, out: 50 }, timing: { startedAt: 'x', firstReadyMs: 3000, doneMs: 9000 } }),
      msg('1544-2', { thread: '1540-1', tokens: { in: 2000, out: 70 }, timing: { startedAt: 'x', firstReadyMs: SLOW_FIRST_MS + 23_200, doneMs: 44_000 } }),
      msg('1548-3', { thread: '1540-1', from: 'system', text: '记账', tokens: { in: 500, out: 20 } }),
    ],
  }));
  await writeIndex(ws, ConversationIndexSchema.parse({
    tutor: 'chinese-tutor',
    date: yesterday,
    messages: [
      { job: '0930-1', at: `${yesterday}T09:30`, from: 'kid', text: '师是什么意思', result: 'error', error: 'max_wall_time', runtime: 'claude', costUsd: 0.12 },
      { job: '0941-2', at: `${yesterday}T09:41`, from: 'kid', text: '那老呢', result: 'ok', runtime: 'claude', costUsd: 0.05, warnings: ['第 3 行 choice 卡没解析,当讲稿念了'] },
    ],
  }));

  const ov = await devOverview(ws, now);
  check('七天,今天在最后', ov.days.length === 7 && ov.days[6].date === today && ov.days[5].date === yesterday, JSON.stringify(ov.days));
  check('轮只算孩子的话;应用的任务单记', ov.todayTurns === 2 && ov.todayTasks === 1 && ov.days[5].turns === 2, JSON.stringify(ov));
  check('今天:一个话题、最近 15:44、慢的 1 轮', ov.todayThreads === 1 && ov.lastAt === `${today}T15:44` && ov.slow === 1);
  const math = ov.tutors.find((t) => t.name === 'math-tutor');
  const chinese = ov.tutors.find((t) => t.name === 'chinese-tutor');
  check('老师行:今天跑过的记那轮的运行时,没跑过的是配的', math?.turns === 2 && math.runtime === 'qwen' && chinese?.turns === 0 && chinese.runtime === (ws.config.tutors['chinese-tutor'].runtime ?? ws.config.runtimes.default), JSON.stringify(ov.tutors));
  const qwen = ov.usage.find((u) => u.runtime === 'qwen');
  const claude = ov.usage.find((u) => u.runtime === 'claude');
  check('用量按运行时:token 与钱各记各的,记账任务也算', qwen?.turns === 3 && qwen.tokensIn === 3500 && qwen.tokensOut === 140 && Math.abs((claude?.costUsd ?? 0) - 0.17) < 1e-9, JSON.stringify(ov.usage));
  check('要看一眼:新的在前,慢 / 出错 / 提醒各一条', ov.issues.map((i) => i.kind).join(',') === 'slow,warn,error' && ov.issues[0].detail.startsWith('首句就绪 38') && ov.issues[2].detail === 'max_wall_time', JSON.stringify(ov.issues));
  check('最近一轮给「看原文」直达', ov.last?.tutor === 'math-tutor' && ov.last.job === '1544-2');
  check('画图:今天 0 张,只数不带上限', ov.paint.today === 0 && !('daily' in ov.paint));

  // ---- 孩子端的流水(《孩子端流水设计.md》§五):设备卡、页面出错合成一条、改名 ----
  {
    const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1';
    const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';
    const open = (ua: string, touch: number) => ({ k: 'open' as const, page: 'kid', v: 'v1', ua, touch, standalone: false, w: 0, h: 0, vw: 0, vh: 0, dpr: 2, lang: 'zh-CN' });
    const err = (msg: string, extra: Record<string, unknown> = {}) => ({ k: 'error' as const, page: 'kid', mode: 'kid', v: 'v1', msg, where: '12:3', stack: 'at f (/:12:3)', ua: IPAD, ctx: { tutor: 'chinese-tutor', thread: '1500-1' }, ...extra });
    const ipad = 'aaaaaaaaaaaa', mac = 'bbbbbbbbbbbb', old = 'cccccccccccc';
    await recordKidLog(ws, open(MAC, 0), { device: old }, new Date(2026, 7, 1, 9));
    await recordKidLog(ws, { ...open(MAC, 0), caps: { mic: 'granted', gum: true, sr: false } }, { device: mac }, new Date(2026, 9, 15, 21, 2));
    await recordKidLog(ws, open(IPAD, 5), { device: ipad }, new Date(2026, 9, 16, 15, 0));
    await recordKidLog(ws, open(IPAD, 5), { device: ipad }, new Date(2026, 9, 16, 15, 30));
    await recordKidLog(ws, err('x is null'), { device: ipad }, new Date(2026, 9, 16, 15, 31));
    await recordKidLog(ws, err('x is null'), { device: mac }, new Date(2026, 9, 16, 15, 40));
    await recordKidLog(ws, err('y is undefined', { mode: 'parent', ctx: null }), { device: 'dddddddddddd' }, new Date(2026, 9, 16, 15, 45));
    // 前台:昨天 20 分;今天 iPad 15:00 打开、15:30 记 30 分、15:45 又 10 分,Mac 一笔 5 分
    await recordKidLog(ws, { k: 'fg', page: 'kid', ms: 20 * 60_000 }, { device: mac }, new Date(2026, 9, 15, 21, 30));
    await recordKidLog(ws, { k: 'fg', page: 'kid', ms: 30 * 60_000 }, { device: ipad }, new Date(2026, 9, 16, 15, 30));
    await recordKidLog(ws, { k: 'fg', page: 'dictation', ms: 10 * 60_000 }, { device: ipad }, new Date(2026, 9, 16, 15, 45));
    await recordKidLog(ws, { k: 'fg', page: 'kid', ms: 5 * 60_000 }, { device: mac }, new Date(2026, 9, 16, 15, 46));
    await recordKidLog(ws, { k: 'perm', page: 'kid', what: 'autoplay', state: 'blocked' }, { device: ipad }, new Date(2026, 9, 16, 15, 47));
    const o2 = await devOverview(ws, now);
    check('设备的毛病:iPad 声音被拦过(琥珀),Mac 没有语音识别(琥珀);没毛病的不写', o2.devices[0].flags.map((f) => f.text + f.level).join() === '声音被拦过warn' && o2.devices[1].flags.map((f) => f.text + f.level).join() === '没有语音识别warn' && o2.olderDevices[0].flags.length === 0, JSON.stringify(o2.devices.map((x) => x.flags)));
    check('孩子端开着:今天前台 45 分、15:00–15:46;近七天昨天 20 分;设备今天各几分', o2.kidTime.today?.ms === 45 * 60_000 && o2.kidTime.today.from === '15:00' && o2.kidTime.today.to === '15:46' && o2.kidTime.days.find((x) => x.date === yesterday)?.ms === 20 * 60_000 && o2.devices[0].todayMs === 40 * 60_000 && o2.devices[1].todayMs === 5 * 60_000, JSON.stringify({ t: o2.kidTime, d: o2.devices.map((x) => x.todayMs) }));
    check('设备卡:近 30 天的,最近开的在前,今天开了几次、近 7 天出错几条;更早的折起来', o2.devices.map((x) => x.id).join() === `${ipad},${mac}` && o2.devices[0].label === 'iPad · Safari 27' && o2.devices[0].today === 2 && o2.devices[0].errors === 1 && o2.devices[1].today === 0 && o2.devices[1].label === 'Mac · Safari 26' && o2.olderDevices.map((x) => x.id).join() === old, JSON.stringify(o2.devices));
    const js = o2.issues.filter((i) => i.kind === 'js');
    const x = js.find((i) => i.text === 'x is null');
    check('页面出错:同一条合成一条,×2、两台设备、时刻是最近一次(本地时间)、带老师与话题', js.length === 2 && x?.js?.count === 2 && x.js.devices.join() === 'iPad · Safari 27,Mac · Safari 26' && x.at === `${today}T15:40` && x.js.first === `${today}T15:31` && x.tutor === 'chinese-tutor' && x.js.thread === '1500-1' && x.detail === 'kid · 12:3', JSON.stringify(js));
    const y = js.find((i) => i.text === 'y is undefined');
    check('家长端的出错照记,标上模式;设备不在表里写浏览器标签', y?.detail === 'kid(parent) · 12:3' && y.js?.devices[0] === 'iPad · Safari 27' && y.tutor === '', JSON.stringify(y));
    check('和轮次的问题一起按时刻排,新的在前', o2.issues[0].kind === 'js' && o2.issues[0].text === 'y is undefined');
    const c2 = createContext(ws);
    const rn = await route('PATCH', `/api/dev/devices/${ipad}`, c2, { name: 'Ray 的 iPad' });
    const list = (await route('GET', '/api/dev/devices', c2)).json as Record<string, { name: string | null; label: string }>;
    check('起名:PATCH 写进设备表,GET 列名字与标签;设备卡与出错跟着写名字', rn.status === 200 && list[ipad].name === 'Ray 的 iPad' && list[mac].name === null && list[mac].label === 'Mac · Safari 26' && (await devOverview(ws, now)).issues.find((i) => i.text === 'x is null')?.js?.devices[0] === 'Ray 的 iPad');
    check('起名:没有这台 404、不是字 400、编号不对不认', (await route('PATCH', '/api/dev/devices/ffffffffffff', c2, { name: 'x' })).status === 404 && (await route('PATCH', `/api/dev/devices/${ipad}`, c2, { name: 3 })).status === 400 && (await route('PATCH', '/api/dev/devices/../x', c2, { name: 'x' })).status !== 200 && (await route('PATCH', '/api/dev/devices/AAAA', c2, { name: 'x' })).status !== 200);
  }

  const ctx = createContext(ws);
  const r = await route('GET', '/api/dev/overview', ctx);
  check('GET /api/dev/overview 200', r.status === 200 && Array.isArray((r.json as { days: unknown[] }).days));
  const h = (await route('GET', '/api/health', ctx)).json as { started: string; version: string | null; commit: string | null; head: string | null; changed: boolean; dirty: boolean };
  check('/api/health 带起服务的时刻与版本', typeof h.started === 'string' && !Number.isNaN(Date.parse(h.started)) && typeof h.version === 'string');
  check('/api/health 带跑的提交与仓里现在的(仓库检出是 git 仓;测试里两个一样)', /^[0-9a-f]{7}$/.test(h.commit ?? '') && h.head === h.commit && h.changed === false && typeof h.dirty === 'boolean', JSON.stringify(h));
  check('代码更新了:起来时与现在的提交都知道、不一样才算', codeChanged('a1', 'b2') && !codeChanged('a1', 'a1') && !codeChanged(null, 'b2') && !codeChanged('a1', null));
  const c = (await route('GET', '/api/config', ctx)).json as { root: string };
  check('/api/config 带 workspace 根(家目录写成 $HOME)', c.root === '$HOME/cotutor/ming', c.root);
  const dr = await route('POST', '/api/dev/doctor', ctx, {});
  check('POST /api/dev/doctor:不带 --live 的体检', dr.status === 200 && (dr.json as { checks: { name: string }[] }).checks.some((k) => k.name === 'workspace'));

  check('页面:侧栏五个标签,概览打头', ['overview', 'chat', 'team', 'voices', 'settings'].every((t) => DEV_PAGE.includes(`data-tab="${t}"`)) && DEV_PAGE.indexOf('data-tab="overview"') < DEV_PAGE.indexOf('data-tab="chat"') && DEV_PAGE.includes('<aside id="side">'));
  const devScript = DEV_PAGE.slice(DEV_PAGE.indexOf('<script>') + 8, DEV_PAGE.lastIndexOf('</script>'));
  let parsed = '';
  try { new Function(devScript); } catch (e) { parsed = String(e); }
  check('工作台页面的内联脚本能解析', devScript.length > 1000 && parsed === '', parsed);
  check('工作台三页共用一份色板', [DEV_PAGE, qrPage('t', { name: 'https://m.local:5180/', ip: 'https://192.168.1.9:5180/', https: true }), VOICE_TEST_PAGE].every((p) => p.includes(DEV_CSS)));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
