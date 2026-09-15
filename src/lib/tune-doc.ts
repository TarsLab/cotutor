/**
 * cotutor-tune 技能的生成部分(2026-09-15):references/字段.md 从 cotutor.json 的契约(schema/config.ts 的 .describe() 与 POLICY_DEFAULTS)、
 * 老师文件 frontmatter 的允许键(lib/agent-file.ts)与 CLI 用法(cli/usage.ts)现生成,scripts/gen-skills.ts 写进包根 skills/cotutor-tune/,
 * tests/skills.test.ts 断言入库的和生成的一致——改老师团时能改哪些字段、缺省是什么,永远和契约同源。SKILL.md 本体(三条路子、禁区)是手写的。
 */
import { z } from 'zod';
import { USAGE } from '../cli/usage.ts';
import { POLICY_DEFAULTS, PolicySchema, TutorSchema } from '../schema/config.ts';
import { AGENT_FRONTMATTER_KEYS } from './agent-file.ts';

export const TUNE_SKILL = 'cotutor-tune';

const TUNE_COMMANDS = ['add', 'add-theme', 'upgrade', 'doctor', 'pack', 'replay', 'compare', 'show'];

function unwrap(s: z.ZodTypeAny): z.ZodTypeAny {
  let cur = s;
  for (let i = 0; i < 5; i++) {
    if (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable) cur = cur.unwrap() as z.ZodTypeAny;
    else if (cur instanceof z.ZodDefault) cur = cur.removeDefault() as z.ZodTypeAny;
    else break;
  }
  return cur;
}

/** 一个 zod object 的字段行;嵌套的 object 展开成 a.b */
function rows(shape: Record<string, z.ZodTypeAny>, defaults: Record<string, unknown> | undefined, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, s] of Object.entries(shape)) {
    const inner = unwrap(s);
    const key = `${prefix}${k}`;
    if (inner instanceof z.ZodObject) {
      out.push(...rows(inner.shape as Record<string, z.ZodTypeAny>, (defaults?.[k] as Record<string, unknown> | undefined) ?? undefined, `${key}.`));
      continue;
    }
    const optional = s.safeParse(undefined).success;
    const d = defaults?.[k];
    const dv = d === undefined ? '' : Array.isArray(d) ? d.join(',') : String(d);
    out.push(`| \`${key}\` | ${optional ? '可选' : '必需'} | ${dv} | ${s.description ?? inner.description ?? ''} |`);
  }
  return out;
}

export function tuneReferenceDoc(): string {
  const cmds = USAGE.split('\n').filter((l) => {
    const m = /^\s+cotutor (\S+)/.exec(l);
    return m !== null && TUNE_COMMANDS.includes(m[1]);
  });
  // tutors 字段的缺省从 zod 的 .default() 取(enabled / hidden);display 是必需的,给个占位再抹掉
  const tutorDefaults = TutorSchema.parse({ display: 'x' }) as unknown as Record<string, unknown>;
  delete tutorDefaults.display;
  const tutorRows = rows(TutorSchema.shape as Record<string, z.ZodTypeAny>, tutorDefaults).filter((r) => !r.startsWith('| `policy'));
  const policyRows = rows(PolicySchema.shape as Record<string, z.ZodTypeAny>, POLICY_DEFAULTS as unknown as Record<string, unknown>);
  return `# 能改的字段(机器生成,别改)

## 老师文件 .claude/agents/<name>.md

frontmatter 只写这几个键(两个 CLI 的公共子集),多写的 claude 不认、qwen 会报:${AGENT_FRONTMATTER_KEYS.map((k) => `\`${k}\``).join('、')}。\`name\` 必须等于文件名,也是 cotutor.json 里 tutors 的键,**不能改**。正文就是系统提示。

## cotutor.json 的 tutors.<name>(人设、开关、运行时)

| 字段 | 必需 | 缺省 | 说明 |
|---|---|---|---|
${tutorRows.join('\n')}

\`policy\` 是下面这张表的子集,写了的覆盖 policyDefaults,没写的继承。

## 政策(policyDefaults,或 tutors.<name>.policy 按老师覆盖)

| 字段 | 必需 | 出厂缺省 | 说明 |
|---|---|---|---|
${policyRows.join('\n')}

## 相关命令(完整用法 cotutor --help)

\`\`\`
${cmds.join('\n')}
\`\`\`
`;
}

export function tuneSkillGeneratedFiles(): Record<string, string> {
  return { 'references/字段.md': tuneReferenceDoc() };
}
