/**
 * 双文件场景源回归:scene.excalidraw + scene.json(chalk-scene-src 信封)→ loadSceneFiles →
 * checkScene → buildBundle 全链;错误路径(错 schema、带 skeletons、缺文件)与输入分发;
 * bboxOf 实测宽度优先(编辑器量过的文本不再被近似误报重叠)。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXCALIDRAW_FILE, ENVELOPE_FILE, LoadError, NotFoundError, loadSceneFiles, resolveSceneInput } from '../src/cli/load-scene.ts';
import { checkScene } from '../src/cli/check.ts';
import { buildBundle, readBundle } from '../src/cli/build.ts';

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}: ${detail}`);
  }
}
async function expectThrow(name: string, fn: () => Promise<unknown>, kind: typeof LoadError | typeof NotFoundError, needle: string): Promise<void> {
  try {
    await fn();
    check(name, false, '没有抛错');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(name, err instanceof kind && msg.includes(needle), `${(err as Error).constructor?.name}: ${msg}`);
  }
}

const envelope = {
  schema: 'chalk-scene-src',
  version: 1,
  id: 'twofile',
  title: '双文件点读页',
  problem: '圈一个词读给你听',
  model: 'reading-page',
  template: 'static',
  subject: '英语',
  blocks: [{ id: 'w-0-0', elementIds: ['tok-0-0', 'tokp-0-0'], text: 'ram', audioSrc: 'audio/tokens/ram.mp3' }],
};

const excalidraw = {
  type: 'excalidraw',
  version: 2,
  elements: [
    { type: 'rectangle', id: 'paper', x: 0, y: 0, width: 400, height: 300, customData: { layer: 'base' } },
    // 实测宽度 30:近似(0.55×44≈24/字 → 'r' 24)也不重叠;但 'am' 若无实测会被算成 48 宽,与右邻相交——见下 bboxOf 用例
    { type: 'text', id: 'tok-0-0', x: 60, y: 40, width: 22, height: 58, text: 'r', fontSize: 44, customData: { layer: 'base', kind: 'token' } },
    { type: 'text', id: 'tokp-0-0', x: 84, y: 40, width: 46, height: 58, text: 'am', fontSize: 44, customData: { layer: 'base' } },
    { type: 'text', id: 'gone', x: 0, y: 0, text: 'x', fontSize: 20, isDeleted: true },
  ],
};

function writePair(dir: string, env: unknown = envelope, exca: unknown = excalidraw): void {
  writeFileSync(join(dir, ENVELOPE_FILE), JSON.stringify(env));
  writeFileSync(join(dir, EXCALIDRAW_FILE), JSON.stringify(exca));
}

const root = mkdtempSync(join(tmpdir(), 'drawtell-scene-files-'));
try {
  // ---- 输入分发 ----
  const src = join(root, 'src');
  mkdirSync(src);
  writePair(src);
  check('目录 → files', (await resolveSceneInput(src)).kind === 'files');
  check('scene.json 路径 → files', (await resolveSceneInput(join(src, ENVELOPE_FILE))).kind === 'files');
  writeFileSync(join(root, 'a.ts'), 'export const x = 1;');
  check('.ts → ts', (await resolveSceneInput(join(root, 'a.ts'))).kind === 'ts');

  // ---- 好路径:load → check → build → read 往返 ----
  const { raw, exportName } = await loadSceneFiles(src);
  check('exportName 标双文件', exportName.includes(EXCALIDRAW_FILE));
  const { scene, findings } = checkScene(raw);
  const errs = findings.filter((f) => f.level === 'error');
  check('双文件场景 0 错', errs.length === 0, errs.map((f) => f.message).join('\n'));
  check('isDeleted 元素被滤掉', !!scene && scene.skeletons.every((e) => e.id !== 'gone'));
  check('元素数正确(4-1)', !!scene && scene.skeletons.length === 3, String(scene?.skeletons.length));
  if (scene) {
    await buildBundle(scene, join(root, 'bundles', scene.id));
    const back = await readBundle(join(root, 'bundles'), scene.id);
    check('build 往返 blocks 保全', JSON.stringify(back.blocks) === JSON.stringify(envelope.blocks));
    check('build 往返 template static', back.template === 'static' && back.steps.length === 0);
    check('build 往返 subject 保全', back.subject === '英语', String(back.subject));
  }

  // ---- bboxOf 实测宽度优先:去掉实测宽度后,近似把 'am'(48 宽)算重叠;有实测(46 起点 84)不重叠已在上面 0 错里证明 ----
  const approx = {
    ...excalidraw,
    elements: excalidraw.elements.map((e) => (e.type === 'text' ? { ...e, width: undefined, height: undefined } : e)),
  };
  const wide = join(root, 'approx');
  mkdirSync(wide);
  writePair(wide, envelope, approx);
  const approxFindings = checkScene((await loadSceneFiles(wide)).raw).findings;
  check(
    '无实测宽度时近似仍工作(此布局近似也不重叠→0 错)',
    approxFindings.filter((f) => f.level === 'error').length === 0,
    approxFindings.map((f) => f.message).join('\n'),
  );

  // ---- 错误路径 ----
  const bad1 = join(root, 'bad1');
  mkdirSync(bad1);
  writePair(bad1, { ...envelope, schema: 'chalk-scene' });
  await expectThrow('课包 scene.json 当场景源 → 指出区别', () => loadSceneFiles(bad1), LoadError, '不能当场景源');

  const bad2 = join(root, 'bad2');
  mkdirSync(bad2);
  writePair(bad2, { ...envelope, skeletons: [] });
  await expectThrow('信封带 skeletons → 指出画面来源', () => loadSceneFiles(bad2), LoadError, 'skeletons 来自');

  const bad3 = join(root, 'bad3');
  mkdirSync(bad3);
  writeFileSync(join(bad3, ENVELOPE_FILE), JSON.stringify(envelope));
  await expectThrow('缺 scene.excalidraw → NotFound 带指引', () => loadSceneFiles(bad3), NotFoundError, EXCALIDRAW_FILE);

  // 信封多余字段:load 放行,checkScene 的 strict schema 拦下
  const bad4 = join(root, 'bad4');
  mkdirSync(bad4);
  writePair(bad4, { ...envelope, nope: true });
  const bad4Findings = checkScene((await loadSceneFiles(bad4)).raw).findings;
  check(
    '信封未知字段被 schema 拦下',
    bad4Findings.some((f) => f.rule === 'schema' && f.message.includes('nope')),
    bad4Findings.map((f) => f.message).join('\n'),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`${passed} 通过, ${failed} 失败`);
if (failed) process.exit(1);
