/**
 * 后期的真模型评测(花钱,不进 pnpm test):对 tests/fixtures/post/ 的每份样本真起快模型(走 runPost:各拍并行,和 repost 一样),
 * 按 expect.json 打分(must 命中、never 失手、行、底色、丢的条数、每拍延迟 p50 / p95、费用),打印一张表,留档到样本的 runs/(gitignore)。
 * 调提示词 / 骨架的日常:改 themes/<主题>/post.md → pnpm test 看快照 diff → 跑这个看分。
 *
 * 用法:node --experimental-strip-types scripts/post-eval.ts --workspace <dir> [--only <名>] [--repeat <n>] [--tutor <老师>] [--builtin | --template <file>] [--serial] [--model <名>]
 *   --model 把运行时命令里 --model 后面那个换掉(比模型用,不动 workspace)
 *   运行时、主题、骨架都取自这个 workspace(policy.post.runtime,缺省 claude-fast);在 Claude Code 会话里跑要 env -u CLAUDECODE
 *   --builtin 用代码里的出厂骨架(POST_TEMPLATE_HTML),--template 指定一份文件;都不给就用 workspace 主题的
 *   --serial 各拍顺着起(前文带已定的样子,和流式一样);缺省并行(和 repost 一样,四拍并行时容易有一拍超时)
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspace } from '../src/cli/workspace.ts';
import { loadPostFixture, scoreFixture, type FixtureScore } from '../src/lib/post-fixtures.ts';
import { POST_TEMPLATE_HTML } from '../src/lib/post-html.ts';
import { runPost } from '../src/server/post.ts';
import { resolvePolicy } from '../src/schema/index.ts';

const argv = process.argv.slice(2);
const flag = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const workspace = flag('workspace');
const only = flag('only');
const repeat = Number(flag('repeat') ?? 1);
const tutor = flag('tutor') ?? 'math-tutor';
const builtin = argv.includes('--builtin');
const templateFile = flag('template');
const serial = argv.includes('--serial');
const model = flag('model');
const template = templateFile ? readFileSync(templateFile, 'utf8') : builtin ? POST_TEMPLATE_HTML : undefined;
if (!workspace) { console.error('用法:node --experimental-strip-types scripts/post-eval.ts --workspace <dir> [--only <名>] [--repeat <n>] [--tutor <老师>]'); process.exit(2); }
const ws = loadWorkspace(workspace);
const policy = resolvePolicy(ws.config, tutor);
const root = fileURLToPath(new URL('../tests/fixtures/post/', import.meta.url));
const names = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && (!only || d.name === only)).map((d) => d.name).sort();
const pct = (a: number, b: number): string => (b ? `${a}/${b}` : '-');
const q = (xs: number[], p: number): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
console.log(`后期评测:${names.length} 份样本 × ${repeat} 次 · 运行时 ${policy.post.runtime} · 主题 ${ws.config.kid.theme} · 骨架 ${templateFile ?? (builtin ? '出厂' : '主题的')}${model ? ` · 模型 ${model}` : ''} · ${serial ? '各拍顺着起' : '各拍并行'} · 每拍超时 ${policy.post.timeoutMs}ms`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const all: { name: string; score: FixtureScore; beatMs: number[] }[] = [];
for (const name of names) {
  const fx = loadPostFixture(join(root, name), name);
  for (let i = 0; i < repeat; i++) {
    const r = await runPost(ws, tutor, fx.section, { device: fx.expect.device, policy, env: process.env, ...(template ? { template } : {}), serial, ...(model ? { model } : {}) });
    const score = scoreFixture(r.section, r.file, fx.expect);
    const beatMs = r.file.beats.map((b) => b.ms);
    all.push({ name, score, beatMs });
    mkdirSync(join(fx.dir, 'runs'), { recursive: true });
    writeFileSync(join(fx.dir, 'runs', `${stamp}-${policy.post.runtime}${model ? `-${model}` : ''}-html${serial ? '-serial' : ''}${repeat > 1 ? `-${i + 1}` : ''}.json`), `${JSON.stringify({ at: new Date().toISOString(), runtime: policy.post.runtime, score, file: r.file, section: r.section }, null, 2)}\n`);
    console.log(`  ${name.padEnd(18)} 拍 ${pct(score.okBeats, score.beats)}  must ${pct(score.mustHit, score.mustTotal)}  never 失手 ${pct(score.neverHit, score.neverTotal)}  行 ${score.rowsOk === null ? '-' : score.rowsOk ? '✓' : '✗'}  底色 ${pct(score.lookOk, score.lookTotal)}  丢 ${score.dropped}${score.droppedOk === false ? '(超)' : ''}  每拍 p50 ${q(beatMs, 0.5)}ms  ${score.costUsd !== undefined ? `$${score.costUsd.toFixed(3)}` : ''}`);
    for (const b of r.file.beats) for (const d of b.dropped) console.log(`      丢:${d}`);
    for (const b of r.file.beats) if (!b.ok) console.log(`      拍 ${b.beat} 没成:${b.error}`);
  }
}
const ms = all.flatMap((x) => x.beatMs);
const sum = (f: (s: FixtureScore) => number): number => all.reduce((a, x) => a + f(x.score), 0);
console.log(`合计:拍 ${pct(sum((s) => s.okBeats), sum((s) => s.beats))} · must ${pct(sum((s) => s.mustHit), sum((s) => s.mustTotal))} · never 失手 ${pct(sum((s) => s.neverHit), sum((s) => s.neverTotal))} · 底色 ${pct(sum((s) => s.lookOk), sum((s) => s.lookTotal))} · 丢 ${sum((s) => s.dropped)} · 每拍 p50 ${q(ms, 0.5)}ms p95 ${q(ms, 0.95)}ms · 费用 $${sum((s) => s.costUsd ?? 0).toFixed(3)} · 留档 tests/fixtures/post/*/runs/${stamp}-*`);
