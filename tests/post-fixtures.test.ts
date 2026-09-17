/**
 * 后期的样本即测试(离线,不花钱):每份样本 section.md 过解析器 → 各拍提示词 == prompts.md 快照(出厂骨架,HTML 方言;UPDATE_SNAPSHOTS=1 重写)；
 * 期望本身合法(must / never 的词在卡上、rows 盖住全部卡);must 的每条提给校验器都收得下;never 里老师已标的那些校验器会丢。
 * 真模型评测(花钱)在 scripts/post-eval.ts。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beatsOf } from '../src/lib/kid-board.ts';
import { expectProblems, loadPostFixture, renderFixturePrompts } from '../src/lib/post-fixtures.ts';
import { POST_TEMPLATE_FALLBACK, validateBeatPost } from '../src/lib/postprocess.ts';
import { ThemeManifestSchema } from '../src/schema/index.ts';
import { check, done } from './_check.ts';

const root = fileURLToPath(new URL('./fixtures/post/', import.meta.url));
const theme = ThemeManifestSchema.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../themes/default/theme.json', import.meta.url)), 'utf8')));
const template = readFileSync(fileURLToPath(new URL('../themes/default/post.md', import.meta.url)), 'utf8');
check('出厂骨架与代码里的兜底同文', template === POST_TEMPLATE_FALLBACK);
const names = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
check('至少三份样本', names.length >= 3, names.join(','));
const update = process.env.UPDATE_SNAPSHOTS === '1';
for (const name of names) {
  const fx = loadPostFixture(join(root, name), name);
  const beats = beatsOf(fx.section);
  check(`${name}:解析出卡与拍`, fx.section.cards.length > 0 && beats.some((b) => b.card !== null), `${fx.section.cards.length} 卡`);
  const problems = expectProblems(fx.section, fx.expect);
  check(`${name}:期望本身合法`, problems.length === 0, problems.join(';'));
  const prompts = renderFixturePrompts(fx.section, fx.expect.device, theme, template);
  if (update || fx.snapshot === null) { writeFileSync(join(fx.dir, 'prompts.md'), prompts); console.log(`  · ${name}:写了 prompts.md 快照(${prompts.length} 字)`); }
  else {
    const same = fx.snapshot === prompts;
    if (!same) {
      const a = fx.snapshot.split('\n'), b = prompts.split('\n');
      const i = a.findIndex((l, k) => l !== b[k]);
      console.log(`  · ${name} 第 ${i + 1} 行起不同:\n    快照:${a[i]}\n    现在:${b[i]}`);
    }
    check(`${name}:提示词快照没变(变了是有意的就 UPDATE_SNAPSHOTS=1 重写)`, same);
  }
  // must 的每条:提给它所在那张卡的拍,校验器收下(不然评测永远命中不了)
  for (const m of fx.expect.must) {
    const b = beats.find((x) => x.card === m.card);
    const line = b && b.lines.length ? 0 : -1;
    const v = b && line >= 0 ? validateBeatPost(fx.section, b, theme, fx.expect.device, { row: 'new', marks: [{ line, phrase: m.phrase, pen: 'marker' }], anchors: [] }) : null;
    check(`${name}:must「${m.phrase}」@卡 ${m.card} 校验器收得下`, v !== null && v.kept.marks === 1, v ? v.dropped.join(';') : '这拍没有讲稿');
  }
  // never 里老师已标过的:提了校验器会丢(契约挡得住;没标过的只有评测能看)
  for (const n of fx.expect.never) {
    const already = fx.section.lines.some((l) => l.marks.some((x) => x.card === n.card && x.phrase === n.phrase));
    if (!already) continue;
    const b = beats.find((x) => x.card === n.card);
    if (!b || !b.lines.length) continue;
    const v = validateBeatPost(fx.section, b, theme, fx.expect.device, { row: 'new', marks: [{ line: 0, phrase: n.phrase, pen: 'marker' }], anchors: [] });
    check(`${name}:never「${n.phrase}」老师已标,校验器会丢`, v.kept.marks === 0 && v.dropped.some((d) => d.includes('已经标过')), v.dropped.join(';'));
  }
}
done();
