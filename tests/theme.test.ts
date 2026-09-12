/** 主题:清单契约、出厂拷贝 + hash + upgrade(没改过换新、改过保留)、add-theme、服务端读取与回退。 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-theme-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { ThemeManifestSchema, tintOrDefault } = await import('../src/schema/index.ts');
const { initWorkspace } = await import('../src/cli/init.ts');
const { addTheme, packageTheme, readTheme, themeDir, themeStatuses, upgradeThemes } = await import('../src/cli/themes.ts');
const { readManifest, writeManifest } = await import('../src/cli/tutors.ts');
const { dirHash } = await import('../src/cli/skills.ts');
const { PACKAGE_VERSION } = await import('../src/cli/skeleton.ts');
const { themeFiles, resetThemeCache } = await import('../src/server/theme.ts');
const { doctorWorkspace } = await import('../src/cli/doctor.ts');

try {
  // ---- 契约 ----
  const ok = ThemeManifestSchema.safeParse({ name: 'x', default: 'a', tints: { a: { use: '甲' }, b: { use: '乙' } } });
  check('清单:槽任意多,looks / pens 可省', ok.success && Object.keys(ok.data.looks).length === 0 && Object.keys(ok.data.pens).length === 0, JSON.stringify(ok));
  check('清单:default 不在 tints 里 → 不过', !ThemeManifestSchema.safeParse({ name: 'x', default: 'zz', tints: { a: { use: '甲' } } }).success);
  check('清单:没有底色槽 → 不过;槽名只认小写连字符', !ThemeManifestSchema.safeParse({ name: 'x', default: 'a', tints: {} }).success && !ThemeManifestSchema.safeParse({ name: 'x', default: 'a', tints: { 'A B': { use: '甲' } } }).success);
  check('槽名不在表里 → default', ok.success && tintOrDefault(ok.data, 'b') === 'b' && tintOrDefault(ok.data, 'nope') === 'a' && tintOrDefault(ok.data, undefined) === 'a');

  // ---- 出厂主题本身要过契约 ----
  const factory = await packageTheme();
  check('出厂 default:六个底色槽、四个字形槽、五支笔,css 在', factory.manifest.name === 'default' && Object.keys(factory.manifest.tints).join() === 'paper,sky,moss,sand,plum,night' && Object.keys(factory.manifest.looks).length === 4 && Object.keys(factory.manifest.pens).length === 5 && factory.css.includes(':root'));

  // ---- init 拷贝 + hash ----
  const { root, steps } = await initWorkspace({ slug: 'ming' });
  const dir = themeDir(root, 'default');
  check('init 拷进 themes/default/,两个文件都在', existsSync(join(dir, 'theme.json')) && existsSync(join(dir, 'kid.css')) && steps.some((s) => s.item === 'themes/default/' && s.action === 'created'));
  check('出厂 hash 记进 shipped.json 的 themes,tutors / skills 的记录还在', (await readManifest(root)).themes?.default.hash.startsWith('sha256:') === true && Object.keys((await readManifest(root)).tutors).length > 0 && (await readManifest(root)).skills !== undefined);
  check('刚 init:latest', (await themeStatuses(root))[0].state === 'latest');
  check('重跑 init:exists', (await initWorkspace({ slug: 'ming' })).steps.find((s) => s.item === 'themes/default/')?.action === 'exists');

  // 包更新了、家长没改:记录的 hash 与目录一起改成旧内容 → upgradable → upgrade 换新
  writeFileSync(join(dir, 'kid.css'), '/* 旧版 */\n');
  const m = await readManifest(root);
  m.themes!.default = { hash: await dirHash(dir), version: '0.0.9' };
  await writeManifest(root, m);
  check('状态 upgradable', (await themeStatuses(root))[0].state === 'upgradable');
  const u1 = await upgradeThemes(root);
  check('upgrade 换新版并记新 hash', u1[0].action === 'upgraded' && readFileSync(join(dir, 'kid.css'), 'utf8').includes(':root') && (await readManifest(root)).themes?.default.version === PACKAGE_VERSION);

  // 家长改过:保留
  writeFileSync(join(dir, 'kid.css'), readFileSync(join(dir, 'kid.css'), 'utf8') + '\n.c { border-radius: 4px; }\n');
  check('改过 → custom,upgrade 不动', (await themeStatuses(root))[0].state === 'custom' && (await upgradeThemes(root))[0].action === 'kept-custom' && readFileSync(join(dir, 'kid.css'), 'utf8').includes('border-radius: 4px'));

  // 缺了 → upgrade 补
  rmSync(dir, { recursive: true });
  check('缺 → installed', (await upgradeThemes(root))[0].action === 'installed' && existsSync(join(dir, 'theme.json')));

  // ---- add-theme ----
  const added = await addTheme(root, 'dark');
  check('add-theme 拷一份 default,清单 name 改成新名,状态 untracked 且不是出厂件', added.from === 'default' && (await readTheme(added.dir)).manifest.name === 'dark' && (await themeStatuses(root)).find((t) => t.name === 'dark')?.state === 'untracked' && (await themeStatuses(root)).find((t) => t.name === 'dark')?.shipped === false);
  let dup = false;
  try {
    await addTheme(root, 'dark');
  } catch {
    dup = true;
  }
  check('add-theme 重名 / 坏名报错', dup && (await addTheme(root, 'Bad Name').catch(() => null)) === null);

  // ---- 服务端读取:workspace 的那份;坏了退出厂;mtime 缓存 ----
  resetThemeCache();
  const t1 = await themeFiles(root, 'default');
  check('themeFiles 读 workspace 的主题', t1.source === 'workspace' && t1.css.includes(':root') && t1.manifest.default === 'paper');
  writeFileSync(join(dir, 'theme.json'), '{ 坏的');
  await new Promise((r) => setTimeout(r, 10));
  const t2 = await themeFiles(root, 'default');
  check('清单坏了 → 退回出厂 default 并带原因', t2.source === 'fallback' && typeof t2.error === 'string' && t2.css.includes(':root'));
  const t3 = await themeFiles(root, 'nope');
  check('主题名不存在 → 退回出厂', t3.source === 'fallback');
  const d = await doctorWorkspace(root, { probeEnv: false });
  check('doctor:清单坏了点名 theme.manifest,自家的 dark 是「自家的主题」', d.checks.some((c) => c.name === 'theme.manifest' && !c.ok && c.fix?.includes('init')) && d.checks.some((c) => c.name === 'theme.dark.origin' && c.ok && c.detail.includes('自家')));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
