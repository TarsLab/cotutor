#!/usr/bin/env node
/**
 * 手拍的作业照片上,认字给的行框、题框准不准:真连百炼(一张一次,几分钱),不进产品。
 * 起因(2026-11-16《多模态教学harness-开发计划》阶段 3 任务 1):照片页像课本一样页宽铺、上下滚,老师写 [[看 第 3 题]] 窗就滚到那一道,
 * [[摆 …]] 的白纸条贴着题框的下沿。scripts/probe-photo-text.mjs 只试过扫描的平整页;这里拿孩子真拍的歪照片走产品那条路
 * (src/scenes/photo-words/recognize.ts,FORMAT_BOXED,提示词是数学「检查作业」的「认字收到什么」),把行框(蓝)、题框(红)画回照片,人看图判断。
 * 用法:node scripts/probe-photo-boxes.mjs --out <目录> <照片>...   要 magick 画框;照片先拷出来,别在孩子的 workspace 里跑
 * 结论(2026-11-16)写在文件最后。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { photoPromptFrom, recognizeWith } = await import(join(repo, 'src', 'scenes', 'photo-words', 'recognize.ts'));
const { lookAt } = await import(join(repo, 'src', 'media', 'vision.ts'));
const args = process.argv.slice(2);
const at = args.indexOf('--out');
const out = at >= 0 ? args[at + 1] : null;
const photos = args.filter((_, i) => i !== at && i !== at + 1);
if (!out || !photos.length) { console.error('用法:node scripts/probe-photo-boxes.mjs --out <目录> <照片>...'); process.exit(2); }
mkdirSync(out, { recursive: true });
const MODEL = 'qwen3.8-max';
const md = readFileSync(join(repo, 'grades', 'grade-2', 'agents', 'math-tutor', 'activities', '检查作业.md'), 'utf8');
const prompt = photoPromptFrom(/```认字\n([\s\S]*?)\n```/.exec(md)[1], 'zh', { boxed: true });

await Promise.all(photos.map(async (photo) => {
  const name = basename(photo).replace(/\.\w+$/, '');
  const r = await recognizeWith(lookAt, { data: readFileSync(photo), mime: 'image/jpeg' }, () => {}, { model: MODEL, text: prompt });
  writeFileSync(join(out, `${name}.json`), JSON.stringify(r, null, 1));
  const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', photo]).toString().split(' ').map(Number);
  const px = (b) => [b[0] * w / 1000, b[1] * h / 1000, b[2] * w / 1000, b[3] * h / 1000].map(Math.round).join(',');
  const draw = [
    ...(r.lines ?? []).flatMap((l) => ['-stroke', 'blue', '-strokewidth', '3', '-fill', 'none', '-draw', `rectangle ${px(l.box)}`]),
    ...(r.questions ?? []).flatMap((q) => ['-stroke', 'red', '-strokewidth', '7', '-fill', 'none', '-draw', `rectangle ${px(q.box)}`]),
  ];
  execFileSync('magick', [photo, ...draw, '-resize', '1200x1200', join(out, `${name}.jpg`)]);
  console.log(`${name}: ${r.ok ? '' : `没成 ${r.error} `}${(r.ms / 1000).toFixed(1)} 秒,${r.lines?.length ?? 0} 行,题 ${(r.questions ?? []).map((q) => q.no).join('、') || '无'}`);
}));

/*
 * 结论(2026-11-16,qwen3.8-max 不想;ray 10-20、11-11 拍的 9 张作业:数学练习册 6 张、语文练习 3 张,横着拿手机拍,有的歪、有的书页弯):
 * - 题框:书页平、只是有点斜的 7 张,题号都认出来了(语文的「一、二、三」也认成 1、2、3),框住整道题,上下沿大致贴着题和题之间的点线(看图判断,没量);
 *   相邻两道的框有的叠一截(2038 第 2、3 题叠 30 个千分点,2056 第 3、4 题叠 32 个),白纸条贴着题框下沿会盖住下一道最上面那一行,能接受。
 *   带大图的题(平面图)框住了整幅图。
 * - 不行的:斜得厉害、书页弯的 2 张。一张(2057)只认出 2 行、没有题;一张只拍了一窄条(2113)的行框整体偏了半行(框是正的,字是斜的)。
 *   两页摊开的(2123)只框了左边那页的题,右边那页的字认了但没题号。这种照片上 [[看 第 3 题]] 找不到,窗不动,给家长记一句。
 * - 行框:平的照片紧贴着字;斜的照片框是正的、字是斜的,一行越长越偏——按字数等分算字的位置(点字、圈字)在斜照片上只能当「大概」。
 * - 时间:整张 4–15 秒,字多的两页摊开那张 46 秒。
 * 所以:照片页上「看第几题」「白纸条贴题下沿」可以靠题框;圈一个字在斜照片上会偏,请孩子拍正一点(拍照屏上那句提示),认不出的题老师就请孩子自己圈。
 */
