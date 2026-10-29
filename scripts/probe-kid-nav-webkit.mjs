#!/usr/bin/env node
/**
 * 孩子端不往浏览器历史里加东西(src/ui/kid/kid-nav.ts)在 Safari(WebKit)上的验收:
 * 首页点老师卡上的「拍照听写」→ 听写页 → 左上胶囊回首页,浏览器历史一条没多;这时按后退,离开孩子端(回到打开首页之前那页),不会回到旧的听写页;
 * 页面从浏览器缓存原样恢复(pageshow.persisted)就重载一次。本进程起服务(临时 workspace,不花钱)。
 * 本仓不装 playwright:借一份 playwright-core 和它配套的 WebKit(见 probe-lecture-webkit.mjs)。
 * 用法:PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录> node scripts/probe-kid-nav-webkit.mjs
 */
import { probeDir } from './_guard.mjs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
if (!process.env.PLAYWRIGHT_CORE) { console.error('要 PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录>'); process.exit(2); }
const { webkit } = require(process.env.PLAYWRIGHT_CORE + '/node_modules/playwright-core');
const repo = fileURLToPath(new URL('..', import.meta.url));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import(join(repo, 'src', 'app', 'cli', 'init.ts'));
const { loadWorkspace } = await import(join(repo, 'src', 'app', 'workspace.ts'));
const { createContext, createHandler } = await import(join(repo, 'src', 'app', 'http', 'app.ts'));

const tmp = probeDir('cotutor-probe-kid-nav-');
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot });
const ctx = createContext(loadWorkspace(wsRoot), { warm: false });
await ctx.reload();
const server = createServer(createHandler(ctx));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
  await page.goto('about:blank');
  await page.goto(base + '/');
  await page.waitForSelector('a.bt-x-photo', { timeout: 15000 });
  const len0 = await page.evaluate(() => history.length);

  // 首页 → 听写:替换当前页,历史不多
  await page.click('a.bt-x-photo');
  await page.waitForURL(/\/dictation\?/, { timeout: 15000 });
  const len1 = await page.evaluate(() => history.length);
  ok('首页点「拍照听写」到听写页:替换当前页,浏览器历史没多一条', len1 === len0, JSON.stringify({ len0, len1 }));

  // 听写 → 胶囊回首页:替换当前页
  await page.waitForSelector('#back:not([hidden])', { timeout: 15000 });
  await page.click('#back');
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });
  await page.waitForSelector('a.bt-x-photo', { timeout: 15000 });
  const len2 = await page.evaluate(() => history.length);
  ok('听写页胶囊回首页:替换当前页,浏览器历史还是那么多', len2 === len0, JSON.stringify({ len0, len2 }));

  // 后退:离开孩子端,不回到旧的听写页
  await page.goBack({ timeout: 15000 }).catch(() => null);
  const afterBack = page.url();
  ok('这时按后退:回到打开首页之前那页(about:blank),不是旧的听写页', afterBack === 'about:blank', afterBack);

  // 前进回来;再模拟一次「从浏览器缓存原样恢复」:pageshow.persisted 就重载
  await page.goForward({ timeout: 15000 }).catch(() => null);
  await page.waitForSelector('a.bt-x-photo', { timeout: 15000 });
  await page.evaluate(() => { window.__mark = 1; });
  const reloaded = page.waitForEvent('load', { timeout: 15000 }).then(() => true, () => false);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  const didReload = await reloaded;
  const mark = await page.evaluate(() => window.__mark ?? null).catch(() => 'gone');
  ok('从浏览器缓存原样恢复(pageshow.persisted):重载一次,旧画面上的状态没了', didReload && mark === null, JSON.stringify({ didReload, mark }));

  // 听写页自己也带着:缓存恢复同样重载
  await page.click('a.bt-x-photo');
  await page.waitForURL(/\/dictation\?/, { timeout: 15000 });
  await page.evaluate(() => { window.__mark = 2; });
  const reloaded2 = page.waitForEvent('load', { timeout: 15000 }).then(() => true, () => false);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  const didReload2 = await reloaded2;
  const mark2 = await page.evaluate(() => window.__mark ?? null).catch(() => 'gone');
  ok('听写页从缓存原样恢复也重载', didReload2 && mark2 === null, JSON.stringify({ didReload2, mark2 }));
} finally {
  await browser.close();
  server.close();
}
console.log(bad ? `\n${bad} 项没过` : '\n全过');
process.exit(bad ? 1 : 0);
