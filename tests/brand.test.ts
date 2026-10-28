/**
 * 品牌标记(src/server/brand.ts,LICENSE 附加条件第 2 条):家长端各页的页脚、PIN 页、工作台页头都带;
 * 孩子端的页面(含家长端 iframe 里开的 /reel、/preview)不带页脚与仓库链接;录像两页是全屏播放器,不带。
 * 「XX的老师们」前面的 logo:家长端记录与首页彩色,孩子端首页跟标题同色。
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
const BRANDED = ['/parent', '/parent/home', '/parent/dictation', '/dev'];
const KID = ['/', '/reel', '/preview', '/dictation', '/dictation?lang=en', '/talk'];
const PLAYERS = ['/parent/dictation/reel'];

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
// 回首页的胶囊「‹ logo」:老师页、听写、口语课、小课堂舞台同一颗单色 logo,不放老师头像、不动
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
// 胶囊带上老师:填这位老师的颜色、logo 后面接名字首字(同首页牌上的 .fc),四处一份——老师页、听写与口语课(tutor-face.ts 的 BACK_TINT_*)、小课堂舞台
const { BACK_TINT_JS, BACK_TINT_CSS, TUTOR_FACE_CSS } = await import('../src/server/tutor-face.ts');
const { SUBJECT_COLORS } = await import('../src/lib/tutor-color.ts');
check('胶囊着色:首字取名字第一个字、填老师的颜色加 .tinted', BACK_TINT_JS.includes("Array.from(t.display || '')[0]") && BACK_TINT_JS.includes("classList.toggle('tinted'") && BACK_TINT_CSS.includes('#back.tinted { background:var(--bk)') && BACK_TINT_CSS.includes('#back.tinted .ct-logo { color:#fff; }'));
check('听写、口语课的胶囊用同一份着色(set 走 backTint)', TUTOR_FACE_JS.includes(BACK_TINT_JS) && TUTOR_FACE_CSS.includes(BACK_TINT_CSS) && /set: function \(t\) \{ backTint\(el, t\); \}/.test(TUTOR_FACE_JS));
const kidHtml = await html('/');
check('老师页的胶囊用同一份着色,首页牌上的首字也用 tutorInitial(取首字只有着色里那一处)', kidHtml.includes(BACK_TINT_JS.trim()) && kidHtml.includes(BACK_TINT_CSS.trim()) && (kidHtml.match(/Array\.from\(t\.display \|\| ''\)\[0\]/g) ?? []).length === 1);
/** 服务端插进页面的那位老师(BACK_TUTOR) */
const backTutor = (h: string): { color: string; initial: string } | null => { const m = /BACK_TUTOR = (null|\{[^;]*\});/.exec(h); return m ? JSON.parse(m[1]) : null; };
const zh = backTutor(await html('/dictation?tutor=chinese-tutor')), en = backTutor(await html('/dictation?lang=en&tutor=english-tutor')), dflt = backTutor(await html('/dictation'));
check('听写页出页面就带上念的老师:语文 = 语文的颜色 + 「语」', zh?.color === SUBJECT_COLORS['语文'] && zh?.initial === '语', JSON.stringify(zh));
check('英文听写:英语老师的颜色 + 「英」', en?.color === SUBJECT_COLORS['英语'] && en?.initial === '英', JSON.stringify(en));
check('听写页没带老师:reader 缺省给语文老师(听写一定有念的老师)', dflt?.initial === '语', JSON.stringify(dflt));
check('口语课带 ?tutor= 就带上那位老师;没带是 null(等页面找到老师再填)', backTutor(await html('/talk?tutor=english-tutor'))?.initial === '英' && backTutor(await html('/talk')) === null && /BACK_TUTOR = null;/.test(await html('/talk')));
check('页面里没有剩下 __BACK_TUTOR__ 占位符', ![await html('/dictation'), await html('/dictation?lang=en'), await html('/talk')].some((h) => h.includes('__BACK_TUTOR__')));
const stageCss = readFileSync(new URL('../src/stage/stage.css', import.meta.url), 'utf8');
check('小课堂舞台的胶囊同一个样子:填颜色(--bk)、接首字', lecture.includes("'lc-back' + (back ? ' lc-tinted' : '')") && lecture.includes('className="lc-ini"') && stageCss.includes('.lc-back.lc-tinted { background: var(--bk)'));
check('家长端的占位符换掉了', !(await html('/parent')).includes('__BRAND__') && !(await html('/')).includes('__BRAND__') && !(await html('/')).includes('__MARK__') && !(await html('/parent')).includes('__MARK__'));

done();
