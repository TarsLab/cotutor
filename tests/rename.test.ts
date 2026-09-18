/** 出厂老师改名(reading-tutor → english-tutor)的迁移:upgrade --config 把设置、老师文件、目录、对话、记忆笔记、首页一起挪;冲突先查、一个都不动。 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-rename-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { readManifest, sha256, tutorStatuses, writeManifest } = await import('../src/cli/tutors.ts');
const { configGapsOf, upgradeConfig } = await import('../src/cli/migrate.ts');
const { RenameConflict } = await import('../src/cli/rename.ts');

const OLD = 'reading-tutor';
const NEW = 'english-tutor';

/** 造一个包更新前的 workspace:新名的东西全换回旧名,再放上对话、头像、记忆、首页 */
async function oldWorkspace(slug: string, opts: { custom?: boolean; display?: string } = {}): Promise<string> {
  const { root } = await initWorkspace({ slug, dir: join(home, slug) });
  const cfgFile = join(root, 'cotutor.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  cfg.tutors = Object.fromEntries(
    Object.entries(cfg.tutors).map(([k, v]) => (k === NEW ? [OLD, { ...(v as object), display: opts.display ?? '朗读老师', avatar: '📖', voice: 'v-en' }] : [k, v])),
  );
  writeFileSync(cfgFile, `${JSON.stringify(cfg, null, 2)}\n`);

  const text = readFileSync(join(root, '.claude/agents', `${NEW}.md`), 'utf8').replace(`name: ${NEW}`, `name: ${OLD}`);
  unlinkSync(join(root, '.claude/agents', `${NEW}.md`));
  writeFileSync(join(root, '.claude/agents', `${OLD}.md`), opts.custom ? `${text}\n- 家长加的一条\n` : text);
  unlinkSync(join(root, '.qwen/agents', `${NEW}.md`));
  symlinkSync(`../../.claude/agents/${OLD}.md`, join(root, '.qwen/agents', `${OLD}.md`));
  const m = await readManifest(root);
  delete m.tutors[NEW];
  m.tutors[OLD] = { hash: sha256(text), version: '0.2.0' };
  await writeManifest(root, m);

  renameSync(join(root, 'agents', NEW), join(root, 'agents', OLD));
  const conv = join(root, 'conversations', OLD);
  mkdirSync(conv, { recursive: true });
  writeFileSync(join(conv, '2026-09-10.json'), JSON.stringify({ tutor: OLD, date: '2026-09-10', messages: [{ state: { image: `conversations/${OLD}/2026-09-10.1658-1.cards/0.png` } }] }, null, 2));
  writeFileSync(join(conv, '2026-09-10.1658-1.log'), 'log');
  mkdirSync(join(root, 'avatars'), { recursive: true });
  writeFileSync(join(root, 'avatars', `${OLD}.png`), 'png');
  mkdirSync(join(root, '记忆'), { recursive: true });
  writeFileSync(join(root, '记忆', '朗读老师.md'), `---\ncotutor: memory\nagent: ${OLD}\n---\n- 2026-09-10 喜欢水果\n`);
  writeFileSync(join(root, '记忆', '别人的.md'), `---\ncotutor: memory\nagent: math-tutor\n---\n- 提到 agent: ${OLD}\n`);
  mkdirSync(join(root, 'home'), { recursive: true });
  writeFileSync(join(root, 'home', 'draft.md'), `# 首页\n\n\`\`\`tutor ${OLD}\n▶ 学水果\n\`\`\`\n`);
  writeFileSync(join(root, 'home', 'published.json'), JSON.stringify({ cards: [{ kind: 'tutor', props: { tutor: OLD } }] }, null, 2));
  return root;
}

const cfgOf = (root: string) => JSON.parse(readFileSync(join(root, 'cotutor.json'), 'utf8'));

try {
  // ---- 没改过的老师文件 ----
  const root = await oldWorkspace('ming');
  const gaps = await configGapsOf(root);
  check('差异:一项改名,新名不当成「缺的出厂老师」', gaps.some((g) => g.kind === 'rename' && g.path === `tutors.${OLD}`) && !gaps.some((g) => g.kind === 'tutor'), JSON.stringify(gaps));

  const dry = await upgradeConfig(root, { dryRun: true });
  check('dry-run:列出要挪的,一个都不动', !dry.applied && dry.moved.length >= 7 && existsSync(join(root, 'conversations', OLD)) && OLD in cfgOf(root).tutors, JSON.stringify(dry.moved));

  const served = await upgradeConfig(root, { renames: false });
  check('服务里点「补上」不做改名', OLD in cfgOf(root).tutors && !(NEW in cfgOf(root).tutors) && existsSync(join(root, 'agents', OLD)), JSON.stringify(served.gaps));

  const r = await upgradeConfig(root);
  const cfg = cfgOf(root);
  check('设置:键换了、位置不变、值留着;出厂显示名与头像跟着换', r.applied && Object.keys(cfg.tutors).join() === 'chinese-tutor,english-tutor,math-tutor,scene-maker' && cfg.tutors[NEW].display === '英语老师' && cfg.tutors[NEW].avatar === '🔤' && cfg.tutors[NEW].voice === 'v-en', JSON.stringify(cfg.tutors));
  const status = Object.fromEntries((await tutorStatuses(root)).map((s) => [s.name, s.state]));
  const man = await readManifest(root);
  check('老师文件:旧的删了,新的是出厂原样,记录换了', !existsSync(join(root, '.claude/agents', `${OLD}.md`)) && status[NEW] === 'latest' && !(OLD in man.tutors) && NEW in man.tutors, JSON.stringify(status));
  check('.qwen 链:旧的没了,新的指向新文件', lstatSync(join(root, '.qwen/agents', `${OLD}.md`), { throwIfNoEntry: false }) === undefined && readlinkSync(join(root, '.qwen/agents', `${NEW}.md`)).endsWith(`.claude/agents/${NEW}.md`));
  check('会话目录挪了', existsSync(join(root, 'agents', NEW, '.gitkeep')) && !existsSync(join(root, 'agents', OLD)));
  const idx = readFileSync(join(root, 'conversations', NEW, '2026-09-10.json'), 'utf8');
  check('对话挪了,索引的 tutor 与图片路径改了', !existsSync(join(root, 'conversations', OLD)) && existsSync(join(root, 'conversations', NEW, '2026-09-10.1658-1.log')) && JSON.parse(idx).tutor === NEW && idx.includes(`conversations/${NEW}/`) && !idx.includes(OLD), idx);
  check('头像挪了', existsSync(join(root, 'avatars', `${NEW}.png`)) && !existsSync(join(root, 'avatars', `${OLD}.png`)));
  check('记忆笔记:agent 改了、文件名不动;别人的笔记正文里提到旧名也不碰', readFileSync(join(root, '记忆', '朗读老师.md'), 'utf8').includes(`agent: ${NEW}\n`) && readFileSync(join(root, '记忆', '别人的.md'), 'utf8').includes(`agent: ${OLD}`));
  check('首页:草稿的 tutor 卡与已发布的都改了', readFileSync(join(root, 'home', 'draft.md'), 'utf8').includes(`\`\`\`tutor ${NEW}\n`) && JSON.parse(readFileSync(join(root, 'home', 'published.json'), 'utf8')).cards[0].props.tutor === NEW);
  check('再跑一次:没有差异', (await configGapsOf(root)).length === 0);

  // ---- 改过的老师文件、家长改过的显示名 ----
  const root2 = await oldWorkspace('hong', { custom: true, display: '阅读老师' });
  await upgradeConfig(root2);
  const t2 = readFileSync(join(root2, '.claude/agents', `${NEW}.md`), 'utf8');
  const st2 = (await tutorStatuses(root2)).find((s) => s.name === NEW);
  check('改过的:挪成新名、name 跟着改、改动留着,upgrade 当自定义', t2.includes(`name: ${NEW}\n`) && t2.includes('家长加的一条') && st2?.state === 'custom', JSON.stringify(st2));
  check('家长改过的显示名不动', cfgOf(root2).tutors[NEW].display === '阅读老师');

  // ---- 包更新后 upgrade 已经拷进来新名的出厂件:让位,不算冲突 ----
  const root3 = await oldWorkspace('lan');
  writeFileSync(join(root3, '.claude/agents', `${NEW}.md`), readFileSync(join(import.meta.dirname, '..', 'agents', `${NEW}.md`), 'utf8'));
  mkdirSync(join(root3, 'agents', NEW), { recursive: true });
  writeFileSync(join(root3, 'agents', NEW, '.gitkeep'), '');
  await upgradeConfig(root3);
  check('新名下只有出厂原样与空目录:照迁', NEW in cfgOf(root3).tutors && !existsSync(join(root3, 'agents', OLD)));

  // ---- 冲突:新名下已经有对话 ----
  const root4 = await oldWorkspace('qing');
  mkdirSync(join(root4, 'conversations', NEW), { recursive: true });
  writeFileSync(join(root4, 'conversations', NEW, '2026-09-11.json'), '{}');
  let err: unknown = null;
  await upgradeConfig(root4).catch((e) => (err = e));
  check('冲突:报出来,一个都不动', err instanceof RenameConflict && String((err as Error).message).includes(`conversations/${NEW}/`) && OLD in cfgOf(root4).tutors && existsSync(join(root4, 'agents', OLD)) && existsSync(join(root4, '.claude/agents', `${OLD}.md`)), String(err));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();
