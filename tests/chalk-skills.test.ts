/**
 * 做课包的四个技能 skills/chalk-<名>(2026-09-15 从 drawtell-skills 仓搬进 drawtell,2026-10-31 随 drawtell 并进来改名)的纪律,
 * frontmatter 与行内反引号的 lint 在 tests/skills.test.ts(每个出厂技能都过),这里只管那边没有的两条:
 * 1. 相对链接指向存在的文件(models-index.md 靠它)
 * 2. 退役的名字不回流:drawtell-<x> 技能名、drawtell 的命令与壳(cotutor chalk 是唯一入口)、老工作流的词(drawtell-vault、homework-run、CONTEXT.md、BRIEF.md、#题型/ …)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { check, done } from './_check.ts';

const SKILLS = resolve(import.meta.dirname, '..', 'skills');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const LINK = /!?\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
const RETIRED = ['drawtell-vault', 'homework-run', 'homework-grade', 'math-explainer', 'reading-book', 'drawtell-skills', 'CONTEXT.md', 'BRIEF.md', '#题型/', '#册子/', 'drawtell tidy', '.cotutor/drawtell', 'drawtell.json'];
const OLD_COMMAND = /\bdrawtell (check|build|bake|snap|dub|serve|ls|note|init|doctor)\b/;

/** 一个技能目录的问题 */
function lintSkillDir(dir: string): string[] {
  const problems: string[] = [];
  for (const f of walk(dir).filter((f) => f.endsWith('.md'))) {
    const rel = relative(SKILLS, f);
    let fence = false;
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) {
        fence = !fence;
        return;
      }
      if (fence) return;
      for (const m of l.matchAll(LINK)) {
        const target = m[1];
        if (/^[a-z]+:/.test(target) || target.startsWith('#')) continue;
        if (!existsSync(resolve(dirname(f), target.split('#')[0]))) problems.push(`${rel}:${i + 1} 链接指向不存在的文件:${target}`);
      }
      for (const m of l.matchAll(/\bdrawtell-[a-z][a-z0-9-]*/g)) problems.push(`${rel}:${i + 1} 退役的技能名 ${m[0]}(现在是 chalk-*)`);
      const cmd = OLD_COMMAND.exec(l);
      if (cmd) problems.push(`${rel}:${i + 1} 退役的命令 ${cmd[0]}(现在是 cotutor chalk ${cmd[1]})`);
      for (const w of RETIRED) if (l.includes(w)) problems.push(`${rel}:${i + 1} 退役的词回流:${w}`);
    });
  }
  return problems;
}

// 自查:坏样子要抓得到,围栏里的放过
{
  const dir = join(SKILLS, '..', 'tests', '.chalk-skill-lint-self');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '见 [坏链](nope.md),查 drawtell-vault,跑 `drawtell check x.ts`\n\n```\n[围栏里不算](nope.md)\n```\n');
  const problems = lintSkillDir(dir);
  rmSync(dir, { recursive: true, force: true });
  check('lint 自查:坏链、退役技能名 + 退役词(drawtell-vault 各一条)、退役命令都抓到,围栏里的放过', problems.length === 4, problems.join(' | '));
}

const skills = readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('chalk-')).map((e) => e.name);
check('四个做课包的技能都在', ['chalk-cli', 'chalk-scene', 'chalk-teaching', 'chalk-verify'].every((n) => skills.includes(n)), skills.join(','));
for (const name of skills) {
  const problems = lintSkillDir(join(SKILLS, name));
  check(`${name} 链接与退役名`, problems.length === 0, problems.join(' | '));
}
done();
