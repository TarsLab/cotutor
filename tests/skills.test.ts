/**
 * 包根 skills/ 的两条纪律(2026-09-15,照 hyperframes 的 lint-skills):
 * 1. 生成的技能入库后要和生成器一致(cotutor-board 整个 ← cards/<kind>/card.md;cotutor-vault 的 references/记账.md ← 记账契约;UPDATE_SNAPSHOTS=1 或 pnpm run gen:skills 重写)
 * 2. 每个出厂 SKILL.md 的 frontmatter:能解析、只有 name / description(两 CLI 的公共子集)、name 等于目录名、description ≤ 1536 字;
 *    正文围栏外的行内反引号里不出现 `!` 与 `>字`(Claude Code 的 bash 权限检查会把它们当 history 展开 / 重定向,技能装不上——hyperframes 踩过)
 *    drawtell 的四个也一起查(拷进 workspace 的是它们),没装就跳过;它们的闸门在 drawtell 仓自己的 tests/skills.test.ts,这里只提醒
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SHIPPED_SKILLS, skillSourceDir } from '../src/cli/skills.ts';
import { GENERATED, writeGeneratedSkills } from '../scripts/gen-skills.ts';
import { check, done } from './_check.ts';
import { ContextPackSchema } from '../src/schema/context-pack.ts';

if (process.env.UPDATE_SNAPSHOTS === '1') writeGeneratedSkills();

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

// ---- 1. 入库的 == 生成的
for (const [name, g] of Object.entries(GENERATED)) {
  const skill = SHIPPED_SKILLS.find((s) => s.name === name);
  const dir = skill ? skillSourceDir(skill) : null;
  const want = g.files();
  const have = dir && statSync(dir, { throwIfNoEntry: false })?.isDirectory() ? walk(dir) : [];
  const listed = g.whole ? have : have.filter((f) => f in want);
  const sameSet = listed.length === Object.keys(want).length && listed.every((f) => f in want);
  const sameContent = sameSet && listed.every((f) => readFileSync(join(dir as string, f), 'utf8') === want[f]);
  check(`skills/${name}/ 入库的和生成的一致${g.whole ? '(整个目录)' : '(生成的那几个文件)'}——改了源就 pnpm run gen:skills`, sameSet && sameContent, `入库 ${have.join(',')} vs 生成 ${Object.keys(want).join(',')}`);
  if (!g.whole) check(`skills/${name}/SKILL.md 是手写的,在`, have.includes('SKILL.md'));
}

// ---- 2. lint
export interface Frontmatter {
  keys: Record<string, string>;
  error?: string;
}

/** 最小 frontmatter 解析:`key: 值` 一行一键,缩进行接上一键(`>` / `|` 折行);不是这两种形状就报错 */
export function parseFrontmatter(md: string): Frontmatter {
  const lines = md.split('\n');
  if (lines[0] !== '---') return { keys: {}, error: '第一行不是 ---' };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { keys: {}, error: 'frontmatter 没收尾' };
  const keys: Record<string, string> = {};
  let last: string | null = null;
  for (const l of lines.slice(1, end)) {
    const m = /^([a-z][a-z0-9-]*):\s*(.*)$/.exec(l);
    if (m) {
      last = m[1];
      if (last in keys) return { keys, error: `键重复:${last}` };
      keys[last] = m[2] === '>' || m[2] === '|' ? '' : m[2];
    } else if (/^\s+\S/.test(l) && last) keys[last] = `${keys[last]}${keys[last] ? ' ' : ''}${l.trim()}`;
    else if (l.trim()) return { keys, error: `看不懂的行:${l}` };
  }
  return { keys };
}

// disable-model-invocation 只有 claude 认(不让模型主动用 Skill 工具调这篇),别的 CLI 忽略,无害;cotutor-board 由应用递给老师,用它拔掉「再读一遍」的触发点
const ALLOWED = new Set(['name', 'description', 'disable-model-invocation']);
const INLINE = /`[^`\n]*`/g;

export function lintSkill(md: string, dirName: string): string[] {
  const problems: string[] = [];
  const fm = parseFrontmatter(md);
  if (fm.error) problems.push(`frontmatter:${fm.error}`);
  for (const k of Object.keys(fm.keys)) if (!ALLOWED.has(k)) problems.push(`frontmatter 多了键 ${k}(两 CLI 公共子集只有 name / description,外加 claude 专用的 disable-model-invocation)`);
  if (!fm.keys.name) problems.push('缺 name');
  else if (fm.keys.name !== dirName) problems.push(`name(${fm.keys.name})不等于目录名(${dirName})`);
  if (!fm.keys.description) problems.push('缺 description');
  else if (fm.keys.description.length > 1536) problems.push(`description ${fm.keys.description.length} 字,超 1536 会被截`);
  let fence = false;
  md.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    for (const m of l.matchAll(INLINE)) {
      if (m[0].includes('!')) problems.push(`第 ${i + 1} 行行内反引号里有 !:${m[0]}`);
      if (/>\w/.test(m[0])) problems.push(`第 ${i + 1} 行行内反引号里有 >字:${m[0]}`);
    }
  });
  return problems;
}

// 自查:lint 本身认得出坏样子
{
  const bad = lintSkill('---\nname: x\ndescription: y\ncategory: z\n---\n\n用 `!important` 和 `>150ms`\n\n```\n`!ok` 围栏里不算\n```\n', 'y');
  check('lint 自查:多余键、目录名不符、行内 ! 与 >字 都抓到,围栏里的放过', bad.length === 4 && bad.some((p) => p.includes('category')) && bad.some((p) => p.includes('目录名')) && bad.some((p) => p.includes('有 !')) && bad.some((p) => p.includes('>字')), bad.join(' | '));
  const folded = parseFrontmatter('---\nname: a\ndescription: >\n  第一行\n  第二行\n---\n');
  check('lint 自查:> 折行的 description 拼成一行', folded.keys.description === '第一行 第二行' && !folded.error);
}

for (const skill of SHIPPED_SKILLS) {
  const dir = skillSourceDir(skill);
  if (!dir || !statSync(join(dir, 'SKILL.md'), { throwIfNoEntry: false })) {
    check(`${skill.name}:来源 ${skill.source} 没装,跳过`, true);
    continue;
  }
  const problems = lintSkill(readFileSync(join(dir, 'SKILL.md'), 'utf8'), skill.name);
  // 别的包的文件这里改不了:本包的判失败,drawtell 的只打一行提醒(闸门在 drawtell 仓的 tests/skills.test.ts)
  if (skill.source === 'cotutor') check(`${skill.name}(${skill.source})SKILL.md 过 lint`, problems.length === 0, problems.join(' | '));
  else check(`${skill.name}(${skill.source})SKILL.md 过 lint${problems.length ? `——没过,去 drawtell 仓改:${problems.join(' | ')}` : ''}`, true);
}
{
  // 上下文包每一行的说明是手写的 markdown(人改得动),和 schema 靠这条对上:加了字段忘了写,这里红
  const doc = readFileSync(join(skillSourceDir(SHIPPED_SKILLS.find((s) => s.name === 'cotutor-tutor')!)!, 'references', '上下文包.md'), 'utf8');
  const keys = Object.keys(ContextPackSchema.shape).filter((k) => k !== 'notes');
  const missing = keys.filter((k) => !doc.includes(`| \`${k}\` |`));
  const extra = [...doc.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]).filter((k) => !keys.includes(k) && !['rules', 'boardGuide', 'profile', 'entry', 'memory'].includes(k));
  check('cotutor-tutor/references/上下文包.md:schema 的每个字段(notes 除外)一行,没有 schema 里不存在的行', missing.length === 0 && extra.length === 0, JSON.stringify({ missing, extra }));
}
done();
