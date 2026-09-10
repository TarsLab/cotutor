/** 路由层:健康、workspace 回报(脱敏)、配置与老师列表、页面、404 / 405。不碰文件的部分;发消息与补丁在 runner.test.ts。 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  check('workspace 回报脱敏', rep.workspace.startsWith('$HOME') && rep.tutors.length === 5, JSON.stringify(rep));
  const cfg = (await get('/api/config')).json as { title: string; runtimes: string[]; tutors: { name: string; policy: { replyMaxChars: number } }[]; tutorPatches: Record<string, unknown> };
  check('配置接口带老师、政策、运行时名', cfg.title === '小明的老师们' && cfg.tutors.length === 5 && cfg.tutors[0].policy.replyMaxChars === 60 && cfg.runtimes.join() === 'claude,qwen' && 'planner' in cfg.tutorPatches);
  check('孩子端老师列表不含 hidden', ((await get('/api/tutors?kid=1')).json as unknown[]).length === 4);
  check('首页 html 是板书页,没有家长入口', (await get('/')).html?.includes('发消息或按住说话') === true && (await get('/')).html?.includes('/parent') === false);
  check('家长页', (await get('/parent')).html?.includes('对话') === true);
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
