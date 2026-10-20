/**
 * 品牌标记(src/server/brand.ts,LICENSE 附加条件第 2 条):家长端各页的页脚、PIN 页、工作台页头都带;
 * 孩子端的页面(含家长端 iframe 里开的 /reel、/preview)一个都不带;录像两页是全屏播放器,不带。
 */
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-brand-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { gatePage } = await import('../src/server/access.ts');
const { BRAND_FOOTER, BRAND_NAME, BRAND_URL } = await import('../src/server/brand.ts');

const MARK = 'data-cotutor-brand';
const BRANDED = ['/parent', '/parent/home', '/parent/xlaoshi', '/parent/dictation', '/dev'];
const KID = ['/', '/reel', '/preview', '/dictation', '/dictation?lang=en', '/talk'];
const PLAYERS = ['/parent/talk/reel', '/parent/dictation/reel'];

const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const ctx = createContext(loadWorkspace(root));
const html = async (p: string): Promise<string> => {
  const r = await route('GET', p, ctx);
  return r.status === 200 && typeof r.html === 'string' ? r.html : '';
};

check('页脚带 logo、名字、仓库链接', BRAND_FOOTER.includes('<svg') && BRAND_FOOTER.includes(`>${BRAND_NAME}<`) && BRAND_FOOTER.includes(`href="${BRAND_URL}"`));
for (const p of BRANDED) {
  const h = await html(p);
  check(`${p} 带品牌标记`, h.includes(MARK) && h.includes(BRAND_URL), h ? '没找到' : '页面没开出来');
}
check('PIN 页带品牌标记', gatePage('小明').includes(MARK));
for (const p of [...KID, ...PLAYERS]) {
  const h = await html(p);
  check(`${p} 开得出来`, h.length > 0);
  check(`${p} 不带品牌标记`, !h.includes(MARK) && !h.includes(BRAND_URL));
}
check('家长端的占位符换掉了', !(await html('/parent')).includes('__BRAND__') && !(await html('/')).includes('__BRAND__'));

done();
