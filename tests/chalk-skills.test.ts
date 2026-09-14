/**
 * skills/ 的纪律(2026-09-15,四个领域 skill 从 drawtell-skills 仓搬进来时立的;规则同 cotutor 的 tests/skills.test.ts):
 * 1. 每个 skills/<dir>/SKILL.md 的 frontmatter 能解析、键只有 name / description(claude / qwen 两 CLI 的公共子集)、name = 目录名、description ≤ 1536 字
 * 2. 全目录每个 .md:围栏外行内反引号里不含 `!`、不含 `>字`——Claude Code 的 bash 权限检查会当 history 展开 / 重定向,技能装不上(hyperframes 踩过)
 * 3. 相对链接指向存在的文件(models-index.md 靠它)
 * 4. 退役名不回流:出现 drawtell-<x> 必须是 skills/ 里的目录;老工作流的词(drawtell-vault、homework-run、CONTEXT.md、BRIEF.md、#题型/ …)出现即败
 * 5. package.json 的 files 含 skills(防发包漏掉)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}: ${detail}`);
  }
}

const ROOT = resolve(import.meta.dirname, '..');
const SKILLS = join(ROOT, 'skills');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function parseFrontmatter(md: string): { keys: Record<string, string>; error?: string } {
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

const ALLOWED = new Set(['name', 'description']);
const INLINE = /`[^`\n]*`/g;
const LINK = /!?\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
const RETIRED = ['drawtell-vault', 'homework-run', 'homework-grade', 'math-explainer', 'reading-book', 'drawtell-skills', 'CONTEXT.md', 'BRIEF.md', '#题型/', '#册子/', 'drawtell tidy'];

/** 一个技能目录的全部问题 */
export function lintSkillDir(dir: string, known: Set<string>): string[] {
  const problems: string[] = [];
  const name = relative(SKILLS, dir);
  const skillMd = join(dir, 'SKILL.md');
  if (!existsSync(skillMd)) return [`${name}:没有 SKILL.md`];
  const fm = parseFrontmatter(readFileSync(skillMd, 'utf8'));
  if (fm.error) problems.push(`${name}:frontmatter ${fm.error}`);
  for (const k of Object.keys(fm.keys)) if (!ALLOWED.has(k)) problems.push(`${name}:frontmatter 多了键 ${k}`);
  if (!fm.keys.name) problems.push(`${name}:缺 name`);
  else if (fm.keys.name !== name) problems.push(`${name}:name(${fm.keys.name})不等于目录名`);
  if (!fm.keys.description) problems.push(`${name}:缺 description`);
  else if (fm.keys.description.length > 1536) problems.push(`${name}:description ${fm.keys.description.length} 字,超 1536 会被截`);
  for (const f of walk(dir).filter((f) => f.endsWith('.md'))) {
    const rel = relative(SKILLS, f);
    const md = readFileSync(f, 'utf8');
    let fence = false;
    md.split('\n').forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) {
        fence = !fence;
        return;
      }
      if (fence) return;
      for (const m of l.matchAll(INLINE)) {
        if (m[0].includes('!')) problems.push(`${rel}:${i + 1} 行内反引号里有 !:${m[0]}`);
        if (/>\w/.test(m[0])) problems.push(`${rel}:${i + 1} 行内反引号里有 >字:${m[0]}`);
      }
      for (const m of l.matchAll(LINK)) {
        const target = m[1];
        if (/^[a-z]+:/.test(target) || target.startsWith('#')) continue;
        if (!existsSync(resolve(dirname(f), target.split('#')[0]))) problems.push(`${rel}:${i + 1} 链接指向不存在的文件:${target}`);
      }
      for (const m of l.matchAll(/\bdrawtell-[a-z][a-z0-9-]*/g)) if (!known.has(m[0])) problems.push(`${rel}:${i + 1} 引用了不存在的技能 ${m[0]}`);
      for (const w of RETIRED) if (l.includes(w)) problems.push(`${rel}:${i + 1} 退役的词回流:${w}`);
    });
  }
  return problems;
}

// 自查:坏样子要抓得到,围栏里的放过
{
  const md = '---\nname: x\ndescription: y\ncategory: z\n---\n\n用 `!important` 和 `>150ms`,见 [坏链](nope.md),查 drawtell-vault\n\n```\n`!ok` 围栏里不算\n```\n';
  const dir = join(SKILLS, '..', 'tests', '.skill-lint-self');
  const { mkdirSync, rmSync, writeFileSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), md);
  const problems = lintSkillDir(dir, new Set(['drawtell-cli']));
  rmSync(dir, { recursive: true, force: true });
  check('lint 自查:多余键、目录名、行内 ! 与 >字、坏链、退役名(未知技能 + 退役词各一条)都抓到,围栏里的放过', problems.length === 7, problems.join(' | '));
}

const skills = readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
check('四个领域 skill 都在', ['drawtell-cli', 'drawtell-scene', 'drawtell-teaching', 'drawtell-verify'].every((n) => skills.includes(n)), skills.join(','));
const known = new Set(skills);
for (const name of skills) {
  const problems = lintSkillDir(join(SKILLS, name), known);
  check(`${name} 过 lint`, problems.length === 0, problems.join(' | '));
}
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { files: string[] };
check('package.json files 含 skills', pkg.files.includes('skills'));

console.log(`${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
