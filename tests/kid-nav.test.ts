/**
 * 孩子端不往浏览器历史里加东西(src/server/kid-nav.ts,《产品规划.md》拍板 25):孩子端各页都带 KID_NAV_JS(同站链接、回首页都是替换当前页,
 * 从浏览器缓存原样恢复就重载),页面里没有 location.href = / location.assign 这种加一条历史的跳转。新加孩子端页面要在 KID 里登记。
 */
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-kid-nav-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { KID_NAV_JS } = await import('../src/server/kid-nav.ts');

/** 孩子端自己开的页面(录像、预览是家长端 iframe 里开的,不在这里) */
const KID = ['/', '/dictation', '/dictation?lang=en', '/talk'];

const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const ctx = createContext(loadWorkspace(root));
const html = async (p: string): Promise<string> => {
  const r = await route('GET', p, ctx);
  return r.status === 200 && typeof r.html === 'string' ? r.html : '';
};

check('KID_NAV_JS 是替换当前页、点同站链接也替换、缓存恢复就重载', KID_NAV_JS.includes('location.replace(url)') && KID_NAV_JS.includes("closest('a[href]')") && KID_NAV_JS.includes('e.persisted') && KID_NAV_JS.includes('location.reload()'));
check('KID_NAV_JS 能插进模板字符串(没有反斜杠、反引号)', !/[\\`]/.test(KID_NAV_JS));
for (const p of KID) {
  const h = await html(p);
  check(`${p} 开得出来`, h.length > 0);
  check(`${p} 带 KID_NAV_JS`, h.includes(KID_NAV_JS.trim()));
  check(`${p} 没有加一条历史的跳转(location.href = / location.assign)`, !/location\.href\s*=[^=]/.test(h) && !/location\.assign\(/.test(h), (h.match(/.{0,40}location\.(href\s*=[^=]|assign\().{0,40}/) ?? [''])[0]);
}
// 首页去听写、口语课的入口是同站链接(点了由 KID_NAV_JS 换成替换当前页)
const kid = await html('/');
check('首页的听写、口语课入口是以 / 开头的同站链接', kid.includes("href: '/dictation?") && kid.includes("href: '/talk?"));
check('家长端、录像、预览不走孩子端的跳转(老师页里那段有条件)', kid.includes('if (!PARENT && !REEL && !PREVIEW) {'));

done();
