/** 路由层:健康、workspace 回报(脱敏)、配置与老师列表、页面、404 / 405。不碰文件的部分;发消息与补丁在 runner.test.ts。 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
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
  check('workspace 回报脱敏', rep.workspace.startsWith('$HOME') && rep.tutors.length === 4, JSON.stringify(rep));
  const cfg = (await get('/api/config')).json as { title: string; runtimes: string[]; tutors: { name: string; policy: { replyMaxChars: number } }[]; tutorPatches: Record<string, unknown> };
  check('配置接口带老师、政策、运行时名', cfg.title === '小明的老师们' && cfg.tutors.length === 4 && cfg.tutors[0].policy.replyMaxChars === 60 && cfg.runtimes.join() === 'claude,qwen,claude-scene,qwen-scene,claude-fast' && 'scene-maker' in cfg.tutorPatches);
  check('孩子端老师列表不含 hidden', ((await get('/api/tutors?kid=1')).json as unknown[]).length === 3);
  // 政策文件补缺:新 workspace 没有差异;老 workspace 的差异由 /api/config 带给设置页,POST 补(与 cotutor upgrade --config 同一条路)
  check('新 workspace 没有可补的出厂件', ((await get('/api/config')).json as { migrate: unknown[] }).migrate.length === 0);
  {
    const cfgFile = join(root, 'cotutor.json');
    const raw = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
    delete raw.runtimes['qwen-scene'];
    writeFileSync(cfgFile, `${JSON.stringify(raw, null, 2)}\n`);
    await ctx.reload();
    check('缺的出厂运行时出现在 /api/config 的 migrate 里', ((await get('/api/config')).json as { migrate: { path: string }[] }).migrate.map((g) => g.path).join() === 'runtimes.qwen-scene');
    const done = await route('POST', '/api/config/migrate', ctx);
    check('POST /api/config/migrate 补上并热重载', done.status === 200 && (done.json as { applied: boolean }).applied && ((await get('/api/config')).json as { migrate: unknown[] }).migrate.length === 0 && 'qwen-scene' in (JSON.parse(readFileSync(cfgFile, 'utf8')) as { runtimes: Record<string, unknown> }).runtimes);
  }
  check('首页 html 是板书页,没有家长入口', (await get('/')).html?.includes('发消息或按住说话') === true && (await get('/')).html?.includes('/parent') === false);
  // 主题:页面 link /kid/theme.css;css 与清单从 workspace 的 themes/default/ 现读;改了 css 不重起就换
  check('板书页 link 主题 css,卡的样式不再内联', (await get('/')).html?.includes('href="/kid/theme.css"') === true && (await get('/')).html?.includes('.mk-marker') === false);
  {
    const css = await get('/kid/theme.css');
    check('/kid/theme.css 是 text/css,含卡与笔的样式', css.status === 200 && css.contentType?.startsWith('text/css') === true && css.html?.includes('.mk-marker') === true && css.html?.includes(':root') === true);
    const tj = (await get('/kid/theme.json')).json as { theme: string; source: string; default: string; tints: Record<string, unknown> };
    check('/kid/theme.json 带清单与来源', tj.theme === 'default' && tj.source === 'workspace' && tj.default === 'paper' && 'sky' in tj.tints);
    const cssFile = join(root, 'themes', 'default', 'kid.css');
    writeFileSync(cssFile, readFileSync(cssFile, 'utf8') + '\n/* 家长改的 */ .c { outline: 1px solid red; }\n');
    await new Promise((r) => setTimeout(r, 10));
    check('改了主题 css 刷新就有(按 mtime 现读)', (await get('/kid/theme.css')).html?.includes('家长改的') === true);
    check('/api/config 报当前主题', ((await get('/api/config')).json as { theme: string }).theme === 'default');
  }
  const parent = (await get('/dev')).html ?? '';
  check('工作台 /dev(原家长页)', parent.includes('对话') && parent.includes('看原文') && parent.includes('工作台') && parent.includes('href="/parent"'));
  {
    // 家长页的内联脚本:模板里的转义没把 JS 写断(\\n 写成 \n、正则里的 \\/ 被吃掉都在这里现形)
    const js = parent.slice(parent.indexOf('<script>') + 8, parent.lastIndexOf('</script>'));
    let parses = true;
    try { new Function(js); } catch (e) { parses = false; console.error(String(e)); }
    check('家长页内联脚本能解析', parses);
    check('模板的换行转义没被吃掉(\\\\n 少写一层就变成真换行,字符串断在这里)', js.includes('replace(/\\n/g') && js.includes("split('\\n')"));
  }
  // 舞台包与课包:静态文件;越界、不存在 404;dist/stage 没打包时 /stage/ 404(doctor 点名)
  const { stageBuilt, STAGE_DIR } = await import('../src/server/stage.ts');
  const st = await get('/stage/');
  check('舞台包:打了包就给 index.html,没打就 404', stageBuilt() ? st.status === 200 && st.file === join(STAGE_DIR, 'index.html') && st.contentType?.startsWith('text/html') === true : st.status === 404, JSON.stringify(st));
  if (stageBuilt()) check('舞台包 js / css 能取', (await get('/stage/stage.js')).contentType?.startsWith('text/javascript') === true && (await get('/stage/stage.css')).status === 200);
  // 舞台包是拆开的(esbuild splitting):stage.js 只是入口,肉在同目录的 chunk-*.js 里,按需取;整目录都要能给
  if (stageBuilt()) {
    const chunks = readdirSync(STAGE_DIR).filter((f) => f.startsWith('chunk-') && f.endsWith('.js'));
    const one = chunks[0] ? await get(`/stage/${chunks[0]}`) : null;
    check('按需 chunk 也从 dist/stage 给', chunks.length > 10 && one?.status === 200 && one.contentType?.startsWith('text/javascript') === true, `${chunks.length} 个 chunk`);
  }
  const font = await get('/stage/fonts/Xiaolai/Xiaolai-Regular-019d66dcad46dc156b162d267f981c20.woff2');
  // 字体目录是从 @excalidraw/excalidraw 的包入口**现解析**的,不是写死的 `<包根>/node_modules/`——
  // npm 扁平安装时依赖不在本包下,写死的话装出来的 /stage/fonts/ 全 404(2026-09-11 发版前用 tgz 装出来撞见)
  const { FONTS_DIR } = await import('../src/server/stage.ts');
  check('字体从 excalidraw 包里给,目录现解析', font.status === 200 && font.contentType === 'font/woff2' && font.file?.includes('@excalidraw') === true
    && FONTS_DIR === join(dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'fonts') + sep, JSON.stringify(font));
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
  // 老师条目本来没有 policy 键(出厂五位都是),页面把留空的字段发成 null:
  // 深合并要先剥 null 再落,否则写出 policy: {replyMaxChars: null, …},整份过不了契约、一保存就报错
  {
    const { deepMerge } = await import('../src/server/store.ts');
    check('深合并:底下没这个对象时也剥 null、不留空对象', JSON.stringify(deepMerge({}, { policy: { board: 'off', replyMaxChars: null, contextPack: { recent: null } } })) === '{"policy":{"board":"off"}}', JSON.stringify(deepMerge({}, { policy: { board: 'off', replyMaxChars: null, contextPack: { recent: null } } })));
    check('深合并:原有的键该删还是删', JSON.stringify(deepMerge({ a: { x: 1, y: 2 } }, { a: { x: null } })) === '{"a":{"y":2}}');
    const r = await route('PATCH', '/api/config', ctx, { tutors: { 'scene-maker': { policy: { board: 'off', scenes: { dailyMax: 1 }, replyMaxChars: null, contextPack: { recent: null, planLines: null } } } } });
    const saved = (JSON.parse(readFileSync(join(root, 'cotutor.json'), 'utf8')) as { tutors: Record<string, { policy?: unknown }> }).tutors['scene-maker'].policy;
    check('板书与讲解动画个数这两个旋钮存得进老师条目,留空的字段不落盘', r.status === 200 && JSON.stringify(saved) === '{"board":"off","scenes":{"dailyMax":1}}', JSON.stringify(saved));
  }
  // 家长板书页(《家长板书页设计.md》§4.3):板书接口答案在、家长的话在、出错的轮有 error;同一份索引下孩子接口的输出不变(护栏);清单;页面与 manifest
  {
    const { emptyIndex, addMessage, localDate } = await import('../src/lib/conversation.ts');
    const { writeIndex } = await import('../src/server/store.ts');
    const { parseBoard } = await import('../src/lib/board.ts');
    const today = localDate(new Date());
    const b1 = parseBoard('开场。\n\n```choice\n酒是谁的?\n- [x] 他自己的\n- [ ] 平分\n```\n\n酒是谁的?').section;
    const b2 = parseBoard('再想想,借一个够不够?').section;
    let idx = emptyIndex('math-tutor', today);
    idx = addMessage(idx, { job: '1620-1', thread: '1620-1', at: `${today}T16:20`, from: 'kid', text: '7 减 9 怎么算', result: 'ok', artifacts: [], kidText: '开场。\n酒是谁的?', section: b1, parentText: '## 家长\n他其实会了。', remembered: [`${today} 减法爱跳步`] });
    idx = addMessage(idx, { job: '1625-2', thread: '1620-1', at: `${today}T16:25`, from: 'parent', text: '换个说法', result: 'ok', artifacts: [], kidText: '再想想,借一个够不够?', section: b2 });
    idx = addMessage(idx, { job: '1630-3', thread: '1630-3', at: `${today}T16:30`, from: 'kid', text: '再来', result: 'error', artifacts: [], error: 'timeout' });
    idx = { ...idx, ratings: { '1620-1': 4 }, costUsd: 0.12 };
    await writeIndex(ctx.ws, idx);
    type PMsg = { from: string; question: string | null; section?: { cards: { props: Record<string, unknown> }[] }; parentText?: string; remembered?: string[]; error?: string };
    const pb = (await get('/api/conversations/math-tutor/today/board')).json as { messages: PMsg[]; thread: string | null };
    check('板书接口:三条都在,答案不剥、给家长的尾巴与记忆在、家长的话有 from、出错的轮有 error', pb.messages.length === 3 && JSON.stringify(pb.messages[0].section?.cards[0].props.answer) === '[0]' && pb.messages[0].parentText === '## 家长\n他其实会了。' && pb.messages[0].remembered?.length === 1 && pb.messages[1].from === 'parent' && pb.messages[1].question === '换个说法' && pb.messages[2].error === 'timeout' && pb.thread === '1630-3', JSON.stringify(pb));
    const kb = (await get('/api/kid/conversations/math-tutor/today')).json as { messages: PMsg[] };
    check('护栏:同一份索引,孩子接口答案剥掉、没有家长尾巴与记忆、家长的话没有问句、没有 error', kb.messages.length === 3 && !('answer' in (kb.messages[0].section?.cards[0].props ?? {})) && !('parentText' in kb.messages[0]) && !('remembered' in kb.messages[0]) && kb.messages[1].question === null && !('from' in kb.messages[1]) && !('error' in kb.messages[2]), JSON.stringify(kb));
    type OvTutor = { name: string; turns: number; costUsd: number; threads: { thread: string; title: string; from: string; sections: number; cards: number; stoppedAt: string | null; rating: number | null; booked: boolean }[] };
    const ov = (await get('/api/overview/today')).json as { date: string; today: string; tutors: OvTutor[] };
    const mt = ov.tutors.find((t) => t.name === 'math-tutor');
    // 卡数 2:选择题一张,第二节末句问句没配能答的卡、解析器补的提问卡一张
    check('清单:三位有脸的老师;数学老师 3 轮、两个话题;第一个话题的题、节数、卡数、停在末句问句、星;出错的话题 0 节', ov.date === today && ov.tutors.length === 3 && mt?.turns === 3 && mt.costUsd === 0.12 && mt.threads.length === 2 && mt.threads[0].title === '7 减 9 怎么算' && mt.threads[0].sections === 2 && mt.threads[0].cards === 2 && mt.threads[0].stoppedAt === 'ask' && mt.threads[0].rating === 4 && !mt.threads[0].booked && mt.threads[1].sections === 0 && mt.threads[1].stoppedAt === null, JSON.stringify(ov));
    check('清单与板书接口:未来的日期 400,没这位老师 404', (await get('/api/overview/2099-01-01')).status === 400 && (await get('/api/conversations/math-tutor/2099-01-01/board')).status === 400 && (await get('/api/conversations/nobody/today/board')).status === 404);
    const page = (await get('/parent')).html ?? '';
    check('家长端 /parent:孩子端页面带家长标记、自己的 manifest;manifest 从这页起;工作台在 /dev,/parent/board 没了', page.includes('const MODE = {"parent":true};') && page.includes('href="/parent/manifest.webmanifest"') && page.includes('· 家长</title>') && ((await get('/parent/manifest.webmanifest')).json as { start_url: string; scope: string }).start_url === '/parent' && ((await get('/manifest.webmanifest')).json as { start_url: string }).start_url === '/' && ((await get('/dev')).html ?? '').includes('老师团') && (await get('/parent/board')).status === 404);
  }
  check('404 / 405', (await get('/nope')).status === 404 && (await route('POST', '/api/health', ctx)).status === 200 && (await route('POST', '/api/workspace', ctx)).status === 405 && (await route('PUT', '/api/config', ctx)).status === 405);
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
