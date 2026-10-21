/**
 * 品牌标记(src/server/brand.ts,LICENSE 附加条件第 2 条):家长端各页的页脚、PIN 页、工作台页头都带;
 * 孩子端的页面(含家长端 iframe 里开的 /reel、/preview)不带页脚与仓库链接;录像两页是全屏播放器,不带。
 * 「XX的老师们」前面的 logo(《首页设计.md》拍板 33):家长端记录与首页彩色,孩子端首页跟标题同色。
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
const { LOGO_CLAY } = await import('../src/lib/logo.ts');

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
/** 标题前那颗:#ct-mark 里的 SVG */
const mark = (h: string): string => /<span id="ct-mark"[^>]*>(<svg[\s\S]*?<\/svg>)/.exec(h)?.[1] ?? '';
for (const p of ['/parent', '/parent/home']) check(`${p} 标题前是彩色的 logo`, mark(await html(p)).includes(`stroke="${LOGO_CLAY}"`), p);
for (const p of ['/', '/reel', '/preview']) {
  const m = mark(await html(p));
  check(`${p} 标题前是单色的 logo(跟标题同色)`, m.includes('stroke="currentColor"') && !m.includes(LOGO_CLAY), p);
}
// 回首页的胶囊「‹ logo」(《产品规划.md》拍板 24):老师页、听写、口语课、小课堂舞台同一颗单色 logo,不放老师头像、不动
const { BACK_LOGO } = await import('../src/server/brand.ts');
const { TUTOR_FACE_JS } = await import('../src/server/tutor-face.ts');
const { readFileSync } = await import('node:fs');
check('胶囊的 logo 单色、不挂动作', BACK_LOGO.includes('stroke="currentColor"') && !BACK_LOGO.includes(LOGO_CLAY) && !/ct-(draw|nod|hover)/.test(BACK_LOGO));
const backOf = (h: string): string => /<button id="back"[^>]*>([\s\S]*?)<\/button>/.exec(h)?.[1] ?? '';
for (const p of ['/', '/reel']) {
  const b = backOf(await html(p));
  check(`${p} 老师页的胶囊里是那颗 logo、没有老师头像`, b.includes(BACK_LOGO) && !b.includes('c-av') && !b.includes('class="av"'), b.slice(0, 120));
}
check('听写、口语课的胶囊里是同一颗 logo、不塞老师头像', TUTOR_FACE_JS.includes(BACK_LOGO) && !/backCapsule[\s\S]*tutorAvatar\(/.test(TUTOR_FACE_JS.slice(TUTOR_FACE_JS.indexOf('var backCapsule'))));
const lecture = readFileSync(new URL('../src/stage/lecture.tsx', import.meta.url), 'utf8');
check('小课堂舞台的胶囊画同一颗 logo(logo.ts 大号那档、单色)、没有老师头像', /logoBody\(LOGO_BIG, \{ outer: 'currentColor', inner: 'currentColor' \}\)/.test(lecture) && lecture.includes('className="lc-logo"') && !lecture.includes('lc-av'));
check('家长端的占位符换掉了', !(await html('/parent')).includes('__BRAND__') && !(await html('/')).includes('__BRAND__') && !(await html('/')).includes('__MARK__') && !(await html('/parent')).includes('__MARK__'));

done();
