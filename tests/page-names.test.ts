/**
 * 页面内联脚本里没有「找不到的名字」:删功能时删了定义、漏了一处引用,脚本照样能解析(mock.test 的 new Function 拦不住),
 * 跑到那一行才抛——2026-10-22 大清理时删浏览器识别漏了 staleReload 里的 rec、删念讲稿漏了点读用的 say,都是这样。
 * 做法:按真服务的路由拿到每个页面,把内联脚本各包一层函数写成 .js,用仓里的 tsc 带 --checkJs 看,只认 TS2304 / TS2552(找不到名字),
 * 别的类型错不管(页面脚本没写类型)。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-page-names-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');

/** 带内联脚本的页面:孩子端(家长端、录像、预览是同一份)、家长端、工作台、听写、口语课、小老师、舞台 */
const PAGES = ['/', '/parent', '/parent/home', '/dev', '/dev/voice', '/dictation', '/dictation?lang=en', '/talk', '/parent/xlaoshi', '/parent/dictation', '/parent/talk/reel', '/stage/'];

try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ctx = createContext(loadWorkspace(root));
  const dir = join(home, 'pages');
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const missing: string[] = [];
  for (const p of PAGES) {
    const r = await route('GET', p, ctx);
    const html = r.html ?? '';
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    if (r.status !== 200 || !scripts.length) { missing.push(`${p}(${r.status})`); continue; }
    const name = `${p.replace(/[^a-z]+/g, '_') || 'root'}.js`;
    writeFileSync(join(dir, name), scripts.map((s) => `(function () {\n${s}\n})();`).join('\n'));
    files.push(name);
  }
  check('页面都在、都有内联脚本', missing.length === 0, missing.join(' '));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { allowJs: true, checkJs: true, noEmit: true, target: 'es2022', lib: ['es2023', 'dom', 'dom.iterable'], strict: false, noImplicitAny: false, skipLibCheck: true }, files }));
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  let out = '';
  try { out = execFileSync(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { out = String((e as { stdout?: string }).stdout ?? ''); }
  const unknown = out.split('\n').filter((l) => /error TS(2304|2552):/.test(l)).map((l) => l.replace(dir + '/', ''));
  check(`${files.length} 个页面的内联脚本里没有找不到的名字`, unknown.length === 0, unknown.slice(0, 10).join('\n'));
} finally {
  rmSync(home, { recursive: true, force: true });
  done();
}
