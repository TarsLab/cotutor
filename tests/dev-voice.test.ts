/** 工作台老师签和孩子端共用状态、按钮与压纸实现。 */
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-dev-voice-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { VOICE_GALLERY_PAGE } = await import('../src/ui/dev/voice-gallery-page.ts');
const { VOICE_CSS, VOICE_JS } = await import('../src/ui/kid/voice-ui.ts');
const { DEV_CSS } = await import('../src/ui/dev/dev-theme.ts');
const { VOICE_SCENES } = await import('../src/ui/dev/voice-scenes.ts');
const { kidPage } = await import('../src/ui/kid/kid-page.ts');

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
check('等待两秒才转 C 环，每圈 2.4 秒', VOICE_CSS.includes('vb-wait-turn 2.4s linear 2s infinite'));
check('减弱动态效果时可静止等待', VOICE_CSS.includes('prefers-reduced-motion:reduce'));
done();
