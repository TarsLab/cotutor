/** 路由层:健康、工作区回报(脱敏)、配置与老师列表、页面、404 / 405。不碰文件的部分;发消息与补丁在 runner.test.ts。 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-server-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');

try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ctx = createContext(loadWorkspace(root));
  const get = (p: string) => route('GET', p, ctx);

  check('health', (await get('/api/health')).status === 200 && ((await get('/api/health')).json as { ok: boolean }).ok);
  const rep = (await get('/api/workspace')).json as { workspace: string; teachers: string[] };
  check('工作区回报脱敏', rep.workspace.startsWith('$HOME') && rep.teachers.length === 5, JSON.stringify(rep));
  const cfg = (await get('/api/config')).json as { title: string; presets: string[]; teachers: { name: string; policy: { replyMaxChars: number } }[]; teacherPatches: Record<string, unknown> };
  check('配置接口带老师、政策、预设名', cfg.title === '小明的书房' && cfg.teachers.length === 5 && cfg.teachers[0].policy.replyMaxChars === 60 && cfg.presets.join() === 'claude,qwen' && 'planner' in cfg.teacherPatches);
  check('孩子端老师列表不含 hidden', ((await get('/api/teachers?kid=1')).json as unknown[]).length === 4);
  check('首页 html 指向家长端', (await get('/')).html?.includes('/parent') === true);
  check('家长页', (await get('/parent')).html?.includes('对话') === true);
  check('日期列表空', ((await get('/api/conversations/math-teacher')).json as { dates: string[] }).dates.length === 0);
  check('没这位老师 404', (await get('/api/conversations/nobody')).status === 404);
  check('404 / 405', (await get('/nope')).status === 404 && (await route('POST', '/api/health', ctx)).status === 200 && (await route('POST', '/api/workspace', ctx)).status === 405 && (await route('PUT', '/api/config', ctx)).status === 405);
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
