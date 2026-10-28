/**
 * 工作台按钮样张 /dev/voice:页在、用工作台的色板、内联脚本能解析、场景表每一格都摆出来;
 * 画法只有一处(voice-ui.ts):孩子端页面与样张引用的是同一份;老师那边的动画是弱的(10-21 Jack:三道小弧、不走,最深 0.45,最外离头像边不超过 36)。
 */
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-dev-voice-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { VOICE_GALLERY_PAGE } = await import('../src/server/voice-gallery-page.ts');
const { VOICE_CSS, VOICE_JS, VOICE_TUNE } = await import('../src/server/voice-ui.ts');
const { DEV_CSS } = await import('../src/server/dev-theme.ts');
const { VOICE_SCENES } = await import('../src/lib/voice-scenes.ts');
const { kidPage } = await import('../src/server/kid-page.ts');

const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const ctx = createContext(loadWorkspace(root));
const r = await route('GET', '/dev/voice', ctx);
check('/dev/voice 开得出来', r.status === 200 && typeof r.html === 'string' && r.html === VOICE_GALLERY_PAGE);
check('样张用工作台的色板', VOICE_GALLERY_PAGE.includes(DEV_CSS));
const kid = kidPage('t', {}, 'v');
check('样张和孩子端老师页用的是 voice-ui.ts 同一份画法', VOICE_GALLERY_PAGE.includes(VOICE_JS) && VOICE_GALLERY_PAGE.includes(VOICE_CSS) && kid.includes(VOICE_JS) && kid.includes(VOICE_CSS));
check('孩子端头像的动作只定义在 voice-ui.ts(老师页里不再有 av-talk / lv-ring 这些关键帧)', !/@keyframes (av-(talk|spin|breathe|turn|listen|nod)|lv-(ring|phone))/.test(kid));
check('占位符都换掉了', !/__[A-Z_]+__/.test(VOICE_GALLERY_PAGE));
const js = VOICE_GALLERY_PAGE.slice(VOICE_GALLERY_PAGE.indexOf('<script>') + 8, VOICE_GALLERY_PAGE.lastIndexOf('</script>'));
let parses = true;
try { new Function(js); } catch (e) { parses = false; console.error(String(e)); }
check('样张的内联脚本能解析', parses);
check('场景表每一格都在样张里', VOICE_SCENES.every((s) => VOICE_GALLERY_PAGE.includes(s.name)));
check('画法的脚本里没有模板字符串会吃掉的东西(反引号、美元花括号)', !/[`]|\$\{/.test(VOICE_JS));
// 老师那边是弱的(后 10-21 改:有字幕在变、有声音,动画太强会把注意力从内容上拉走)
check('老师的三道小弧:三道、最外离头像边不超过 36、最深不超过 0.45、最浅不低于 0', VOICE_TUNE.arcR.length === 3 && Math.max(...VOICE_TUNE.arcR) <= 36 && VOICE_TUNE.arcMax <= 0.45 && VOICE_TUNE.arcMin >= 0 && VOICE_TUNE.arcMin < VOICE_TUNE.arcMax);
check('老师在说时头像不放大(外圈只有静止 / 很慢的明暗 / 没有)', ['static', 'breath', 'none'].includes(VOICE_TUNE.talkHalo) && !/vb-talk[^{]*\{[^}]*scale/.test(VOICE_CSS));

done();
