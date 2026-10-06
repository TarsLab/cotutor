/**
 * 场景协议 v2 回归:静态场景(steps 空)、blocks / subscenes 的引用完整性、
 * 三层墨迹 layer 标、课包 build/read 往返、块命中盒几何。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sceneSchema } from '../src/schema/scene.ts';
import { checkScene } from '../src/cli/check.ts';
import { buildBundle, readBundle } from '../src/cli/build.ts';
import { computeStepWindows } from '../src/player/timeline.ts';
import { allBlockBounds, blockBounds } from '../src/player/blocks.ts';
import type { ChalkScene } from '../src/player/types.ts';

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}: ${detail}`);
  }
}
const errorsOf = (raw: unknown) => checkScene(raw).findings.filter((f) => f.level === 'error');
const rules = (raw: unknown) => checkScene(raw).findings.map((f) => f.rule);

const wordSkeletons = [
  { type: 'text', id: 'w1', x: 100, y: 100, text: 'r', fontSize: 28, width: 14, height: 36, customData: { layer: 'base' } },
  { type: 'text', id: 'w2', x: 118, y: 100, text: 'am', fontSize: 28, width: 30, height: 36 },
];

const staticScene = {
  id: 'reading-page',
  title: '点读页',
  problem: '圈一个词读给你听',
  model: 'reading-page',
  template: 'static',
  skeletons: wordSkeletons,
  blocks: [{ id: 'b-ram', elementIds: ['w1', 'w2'], text: 'ram', audioSrc: 'audio/tokens/ram.mp3', subsceneId: 'blend-ram' }],
  subscenes: [
    {
      id: 'blend-ram',
      skeletons: [
        { type: 'rectangle', id: 'card', x: 0, y: 0, width: 260, height: 140, backgroundColor: '#2f2f2f' },
        { type: 'text', id: 'blend-line', x: 40, y: 52, text: 'r + am = ram', fontSize: 24 },
      ],
      audioSrc: 'audio/blend/ram.slow.mp3',
    },
  ],
};

// ---- schema:steps 可省略,规范形是空数组 ----
{
  const parsed = sceneSchema.safeParse(staticScene);
  check('静态场景(无 steps 字段)过 schema', parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues));
  if (parsed.success) {
    check('省略的 steps 规范化为空数组', Array.isArray(parsed.data.steps) && parsed.data.steps.length === 0);
  }
  const badLayer = sceneSchema.safeParse({
    ...staticScene,
    skeletons: [{ ...wordSkeletons[0], customData: { layer: 'bogus' } }, wordSkeletons[1]],
  });
  check('customData.layer 非法值被 schema 拦下', !badLayer.success);
}

// ---- check:静态场景 0 错;模板与 steps 的一致性 ----
{
  const errs = errorsOf(staticScene);
  check('静态好场景 0 错', errs.length === 0, errs.map((f) => f.message).join('\n'));
  const warns = checkScene(staticScene).findings.filter((f) => f.level === 'warning');
  check('静态好场景 0 警', warns.length === 0, warns.map((f) => f.message).join('\n'));

  check(
    '讲解模板 steps 为空报 steps-required',
    rules({ ...staticScene, template: 'paper-strict', blocks: undefined, subscenes: undefined }).includes('steps-required'),
  );
  check(
    'static 带 steps 报 static-steps',
    rules({
      ...staticScene,
      steps: [{ step: 1, elementIds: ['w1', 'w2'], line: '读', pauseAfter: false }],
    }).includes('static-steps'),
  );
}

// ---- check:blocks / subscenes 引用完整性 ----
{
  check(
    '块引用不存在的元素报 block-element',
    rules({ ...staticScene, blocks: [{ ...staticScene.blocks[0], elementIds: ['nope'] }] }).includes('block-element'),
  );
  check(
    '块引用不存在的子场景报 block-subscene',
    rules({ ...staticScene, blocks: [{ ...staticScene.blocks[0], subsceneId: 'nope' }] }).includes('block-subscene'),
  );
  check(
    '无触发的块报 block-trigger 警告',
    rules({ ...staticScene, subscenes: undefined, blocks: [{ id: 'b', elementIds: ['w1'], text: 'r' }] }).includes('block-trigger'),
  );
  check(
    '块 text 与元素文本不一致报 block-text',
    rules({ ...staticScene, blocks: [{ ...staticScene.blocks[0], text: 'rat' }] }).includes('block-text'),
  );
  check(
    '没被任何块引用的子场景报 subscene-orphan',
    rules({ ...staticScene, blocks: [{ ...staticScene.blocks[0], subsceneId: undefined }] }).includes('subscene-orphan'),
  );
  const dupBlocks = rules({ ...staticScene, blocks: [staticScene.blocks[0], { ...staticScene.blocks[0], subsceneId: undefined }] });
  check('块 id 重复报 unique-id', dupBlocks.includes('unique-id'));

  // 子场景内部同样吃画面 lint:steps 未覆盖 skeletons → stroke-cover,且消息带子场景前缀
  const badSub = checkScene({
    ...staticScene,
    subscenes: [
      {
        ...staticScene.subscenes[0],
        steps: [{ step: 1, elementIds: ['blend-line'], line: '拼一拼', pauseAfter: false }],
      },
    ],
  }).findings;
  const cover = badSub.find((f) => f.rule === 'stroke-cover');
  check('子场景 steps 覆盖不全报 stroke-cover', !!cover);
  check('子场景 finding 带前缀', !!cover && cover.message.includes("子场景 'blend-ram'"), cover?.message ?? '');
}

// ---- timeline:静态场景无时间窗,不再 throw ----
{
  const parsed = sceneSchema.parse(staticScene);
  check('computeStepWindows 空 steps 返回 []', computeStepWindows(parsed.skeletons, parsed.steps).length === 0);
}

// ---- build/read 往返:blocks 与 subscenes 走 manifest v2,不丢不涨 ----
{
  const dir = mkdtempSync(join(tmpdir(), 'drawtell-scene-v2-'));
  try {
    const scene: ChalkScene = sceneSchema.parse(staticScene);
    await buildBundle(scene, join(dir, scene.id));
    const manifest = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(dir, scene.id, 'manifest.json'), 'utf8')));
    check('manifest 版本为 2', manifest.version === 2, String(manifest.version));
    const back = await readBundle(dir, scene.id);
    check('往返后 blocks 一致', JSON.stringify(back.blocks) === JSON.stringify(scene.blocks));
    check('往返后 subscenes 一致', JSON.stringify(back.subscenes) === JSON.stringify(scene.subscenes));
    check('往返后 layer 标还在', back.skeletons[0].customData?.layer === 'base');

    // 无 blocks 的讲解场景:manifest 不长出空字段,老课包形状不变
    const lecture: ChalkScene = sceneSchema.parse({
      id: 'lecture',
      title: '讲解',
      problem: '题面',
      model: '时间数轴',
      template: 'paper-strict',
      skeletons: [{ type: 'text', id: 't1', x: 0, y: 0, text: '9:20', fontSize: 28 }],
      steps: [{ step: 1, elementIds: ['t1'], line: '先写下时间', pauseAfter: true }],
    });
    await buildBundle(lecture, join(dir, lecture.id));
    const m2 = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(dir, lecture.id, 'manifest.json'), 'utf8')));
    check('讲解课包 manifest 无 blocks/subscenes 键', !('blocks' in m2) && !('subscenes' in m2));
    const lectureErrs = errorsOf(lecture);
    check('讲解场景照旧 0 错', lectureErrs.length === 0, lectureErrs.map((f) => f.message).join('\n'));

    // 背景图:build 把图拷进课包并把 src 改写成课包内相对路径;出界的笔迹给警告
    const { writeFileSync, existsSync } = await import('node:fs');
    writeFileSync(join(dir, 'photo.PNG'), 'png-bytes');
    const onPhoto: ChalkScene = sceneSchema.parse({ ...lecture, id: 'on-photo', background: { src: 'photo.PNG', width: 400, height: 300 } });
    await buildBundle(onPhoto, join(dir, onPhoto.id), dir);
    check('背景图拷进课包', existsSync(join(dir, onPhoto.id, 'background.png')));
    const backPhoto = await readBundle(dir, onPhoto.id);
    check('往返后 background 指向课包内文件', JSON.stringify(backPhoto.background) === JSON.stringify({ src: 'background.png', width: 400, height: 300 }), JSON.stringify(backPhoto.background));
    check('图内笔迹不报 background-bounds', !rules(onPhoto).includes('background-bounds'));
    check('图外笔迹报 background-bounds', rules({ ...onPhoto, background: { src: 'photo.PNG', width: 20, height: 20 } }).includes('background-bounds'));
    check('讲解课包 scene.json 无 background 键', !('background' in JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(dir, lecture.id, 'scene.json'), 'utf8')))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- 块命中盒:所引元素包围盒之并 ----
{
  const scene = sceneSchema.parse(staticScene);
  const b = blockBounds(scene, scene.blocks![0]);
  check('blockBounds 是元素并集', !!b && b.minX === 100 && b.minY === 100 && b.maxX === 148 && b.maxY === 136, JSON.stringify(b));
  check('allBlockBounds 全量索引', allBlockBounds(scene).length === 1);
  const missing = blockBounds(scene, { id: 'x', elementIds: ['nope'], text: 'x' });
  check('全缺元素的块返回 null', missing === null);
}

console.log(`${passed} 通过, ${failed} 失败`);
if (failed) process.exit(1);
