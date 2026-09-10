/** 路由层:健康、workspace 回报(脱敏)、配置与老师列表、页面、404 / 405。不碰文件的部分;发消息与补丁在 runner.test.ts。 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-server-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { httpsFiles } = await import('../src/cli/serve.ts');

try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ctx = createContext(loadWorkspace(root));
  const get = (p: string) => route('GET', p, ctx);

  check('health', (await get('/api/health')).status === 200 && ((await get('/api/health')).json as { ok: boolean }).ok);
  const rep = (await get('/api/workspace')).json as { workspace: string; tutors: string[] };
  check('workspace 回报脱敏', rep.workspace.startsWith('$HOME') && rep.tutors.length === 6, JSON.stringify(rep));
  const cfg = (await get('/api/config')).json as { title: string; runtimes: string[]; tutors: { name: string; policy: { replyMaxChars: number } }[]; tutorPatches: Record<string, unknown> };
  check('配置接口带老师、政策、运行时名', cfg.title === '小明的老师们' && cfg.tutors.length === 6 && cfg.tutors[0].policy.replyMaxChars === 60 && cfg.runtimes.join() === 'claude,qwen,claude-scene,qwen-scene' && 'planner' in cfg.tutorPatches);
  check('孩子端老师列表不含 hidden', ((await get('/api/tutors?kid=1')).json as unknown[]).length === 4);
  check('首页 html 是板书页,没有家长入口', (await get('/')).html?.includes('发消息或按住说话') === true && (await get('/')).html?.includes('/parent') === false);
  check('家长页', (await get('/parent')).html?.includes('对话') === true);
  // 舞台包与课包:静态文件;越界、不存在 404;dist/stage 没打包时 /stage/ 404(doctor 点名)
  const { stageBuilt, STAGE_DIR } = await import('../src/server/stage.ts');
  const st = await get('/stage/');
  check('舞台包:打了包就给 index.html,没打就 404', stageBuilt() ? st.status === 200 && st.file === join(STAGE_DIR, 'index.html') && st.contentType?.startsWith('text/html') === true : st.status === 404, JSON.stringify(st));
  if (stageBuilt()) check('舞台包 js / css 能取', (await get('/stage/stage.js')).contentType?.startsWith('text/javascript') === true && (await get('/stage/stage.css')).status === 200);
  const font = await get('/stage/fonts/Xiaolai/Xiaolai-Regular-019d66dcad46dc156b162d267f981c20.woff2');
  check('字体从 node_modules 的 excalidraw 里给', font.status === 200 && font.contentType === 'font/woff2' && font.file?.includes('@excalidraw') === true, JSON.stringify(font));
  check('舞台包越界 / 不存在 404', (await get('/stage/../package.json')).status === 404 && (await get('/stage/nope.js')).status === 404 && (await get('/stage/fonts/../../package.json')).status === 404);
  check('课包:还没有 → 404', (await get('/api/bundles/2026-09-04-guilv5/scene.json')).status === 404);
  cpSync(fileURLToPath(new URL('./fixtures/bundles/2026-09-04-guilv5', import.meta.url)), join(root, 'bundles', '2026-09-04-guilv5'), { recursive: true });
  const sj = await get('/api/bundles/2026-09-04-guilv5/scene.json');
  check('课包落到 bundles/<id>/ → scene.json / manifest.json 能取;坏 id、越界、别的扩展名 404', sj.status === 200 && sj.contentType?.startsWith('application/json') === true && (await get('/api/bundles/2026-09-04-guilv5/manifest.json')).status === 200 && (await get('/api/bundles/Bad/scene.json')).status === 404 && (await get('/api/bundles/2026-09-04-guilv5/../../cotutor.json')).status === 404 && existsSync(join(root, 'bundles', '2026-09-04-guilv5', 'scene.json')), JSON.stringify(sj));
  check('日期列表空', ((await get('/api/conversations/math-tutor')).json as { dates: string[] }).dates.length === 0);
  check('没这位老师 404', (await get('/api/conversations/nobody')).status === 404);
  // 证书是机器级的:没有 → null;~/.config/cotutor/certs/ 有 → 用它;server.https 配了 → 覆盖(相对 workspace 根)
  check('没证书走 HTTP', httpsFiles(ctx.ws) === null);
  const certDir = join(home, '.config', 'cotutor', 'certs');
  mkdirSync(certDir, { recursive: true });
  writeFileSync(join(certDir, 'cert.pem'), 'c');
  writeFileSync(join(certDir, 'key.pem'), 'k');
  check('机器级证书目录被认', httpsFiles(ctx.ws)?.cert === join(certDir, 'cert.pem'));
  const patched = await route('PATCH', '/api/config', ctx, { server: { https: { cert: 'my/cert.pem', key: 'my/key.pem' } } });
  check('server.https 覆盖机器级,相对 workspace 根', patched.status === 200 && httpsFiles(ctx.ws)?.cert === join(root, 'my', 'cert.pem'), JSON.stringify(patched.json));
  check('404 / 405', (await get('/nope')).status === 404 && (await route('POST', '/api/health', ctx)).status === 200 && (await route('POST', '/api/workspace', ctx)).status === 405 && (await route('PUT', '/api/config', ctx)).status === 405);
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
