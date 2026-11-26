/**
 * 给课本出分块的技能(skills/cotutor-textbook/):references/格式.md 里那份例子(草稿的写法:字行写行号、box 能不写)换成存的样子后过形状和检查,
 * schema 的每个字段都讲到;SKILL.md 讲到每个子命令,三科的规范都在;分块.schema.json 认得行号。命令本身在 tests/textbook-cli.test.ts。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { PACKAGE_SKILLS_DIR, SHIPPED_SKILLS } from '../src/app/cli/skills.ts';
import { LINE_REF, ZoneFileSchema, ZonePageSchema, resolveDraft, walkZones, zonePageProblems, type PermilleBox } from '../src/schema/index.ts';
import { check, done } from './_check.ts';

const dir = join(PACKAGE_SKILLS_DIR, 'cotutor-textbook');
const doc = readFileSync(join(dir, 'references', '格式.md'), 'utf8');
const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(doc)?.[1] ?? 'null') as unknown;
// 行号换成编的框:第 n 行在页上从上往下排,一行里第 k 截往右排(例子里的框都是编的,只要过得了检查)
const fake = (ref: string): PermilleBox | null => { const m = /^L(\d+)(?:\.(\d+))?$/.exec(ref); if (!m) return null; const y = 60 + Number(m[1]) * 100, k = Number(m[2] ?? 0); return k ? [700 + k * 40, y + 30, 730 + k * 40, y + 50] : [100, y, 900, y + 20]; };
const left: string[] = [];
const resolved = resolveDraft(example, fake, '例子', left);
check('格式.md 的例子:行号都认得,没写 box 的都撑得出', left.length === 0, left.join(';'));
const parsed = ZoneFileSchema.safeParse(resolved);
check('格式.md 的例子过形状', parsed.success, JSON.stringify(parsed.error?.issues));
check('格式.md 的例子:id 照页名起头,写了 cont', parsed.success && (() => { let ok = true; walkZones(parsed.data.zones, (z) => { if (!z.id.startsWith(`${parsed.data.name}-`)) ok = false; }); return ok; })() && doc.includes('"cont"'));
check('格式.md 的例子过检查', parsed.success && zonePageProblems(parsed.data).length === 0, parsed.success ? zonePageProblems(parsed.data).join('\n') : '');
check('格式.md 的例子有套着的小块、表格、一组口诀、泡泡、注释、圈、打勾、量的框、一截的行号、ignore', ['"children"', '"kind": "table"', '"kind": "group"', '"kind": "bubble"', '"kind": "note"', '"kind": "circle"', '"kind": "tick"', '"src": "measured"', '"L4.2"', '"ignore"'].every((x) => doc.includes(x)));

/** schema 里出现的每个字段名(对象一层层往下走,块是递归的) */
const fieldNames = (s: z.ZodType, out = new Set<string>(), seen = new Set<z.ZodType>()): Set<string> => {
  if (seen.has(s)) return out;
  seen.add(s);
  if (s instanceof z.ZodLazy) fieldNames(s.unwrap() as z.ZodType, out, seen);
  else if (s instanceof z.ZodObject) for (const [k, v] of Object.entries(s.shape as Record<string, z.ZodType>)) { out.add(k); fieldNames(v, out, seen); }
  else if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) fieldNames(s.unwrap() as z.ZodType, out, seen);
  else if (s instanceof z.ZodArray) fieldNames(s.element as z.ZodType, out, seen);
  else if (s instanceof z.ZodTuple) for (const x of s.def.items) fieldNames(x as z.ZodType, out, seen);
  else if (s instanceof z.ZodPipe) fieldNames(s.def.in as z.ZodType, out, seen);
  return out;
};
const fields = [...fieldNames(ZonePageSchema)];
const unexplained = fields.filter((k) => !doc.includes(`\`${k}\``));
check('格式.md 讲到 schema 的每个字段(加了字段忘了写,这里红)', fields.length > 25 && unexplained.length === 0, JSON.stringify([fields.length, unexplained]));

const skill = readFileSync(join(dir, 'SKILL.md'), 'utf8');
check('SKILL.md 讲到每个子命令,不写答案', ['textbook prep', 'textbook check', 'textbook preview', 'textbook push'].every((c) => skill.includes(c)) && skill.includes('不写答案'));
const schemaJson = JSON.parse(readFileSync(join(dir, 'references', '分块.schema.json'), 'utf8')) as unknown;
check('分块.schema.json:字行认行号,块的 box 能不写', JSON.stringify(schemaJson).includes(JSON.stringify(LINE_REF.source)) && JSON.stringify(schemaJson).includes('"required":["id","kind","label"]'), JSON.stringify(schemaJson).slice(0, 300));
check('三科的规范都在', ['数学', '语文', '科学'].every((s) => readFileSync(join(dir, 'references', `${s}.md`), 'utf8').includes('## 念法')));
check('是出厂的机器件(refresh 覆盖)', SHIPPED_SKILLS.some((s) => s.name === 'cotutor-textbook' && s.machine));

done();
