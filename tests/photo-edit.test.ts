/**
 * 作业照片编辑的坐标(photo-edit.ts):拖框夹边、转 90° 框与笔画跟着走、转四次回原样、导出缩放。
 * 《作业照片设计.md》§六。
 */
import { dragCrop, edited, exportPlan, newEdit, newStroke, region, rotMatrix, rotateEdit, rotatedSize, setCrop, type PhotoEdit, type Pt } from '../src/lib/photo-edit.ts';
import { check, done } from './_check.ts';

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** rotMatrix 作用在原图的点上 */
const apply = (e: PhotoEdit, p: Pt): Pt => {
  const [a, b, c, d, x0, y0] = rotMatrix(e);
  return { x: a * p.x + c * p.y + x0, y: b * p.x + d * p.y + y0 };
};

// ---- 拖框 ----
{
  const r = { x: 100, y: 100, w: 200, h: 200 };
  check('平移夹在图内', eq(dragCrop(r, 'move', 5000, -5000, 1000, 800, 64), { x: 800, y: 0, w: 200, h: 200 }));
  check('右下角拉出界被夹', eq(dragCrop(r, 'se', 5000, 5000, 1000, 800, 64), { x: 100, y: 100, w: 900, h: 700 }));
  check('左上角拉出界被夹', eq(dragCrop(r, 'nw', -5000, -5000, 1000, 800, 64), { x: 0, y: 0, w: 300, h: 300 }));
  check('左上角往里推不小于 min', eq(dragCrop(r, 'nw', 5000, 5000, 1000, 800, 64), { x: 236, y: 236, w: 64, h: 64 }));
  check('右下角往里推不小于 min', eq(dragCrop(r, 'se', -5000, -5000, 1000, 800, 64), { x: 100, y: 100, w: 64, h: 64 }));
  check('ne 只动上边与右边', eq(dragCrop(r, 'ne', 10, 10, 1000, 800, 64), { x: 100, y: 110, w: 210, h: 190 }));
  check('sw 只动左边与下边', eq(dragCrop(r, 'sw', 10, 10, 1000, 800, 64), { x: 110, y: 100, w: 190, h: 210 }));
  check('min 比图大时退成图的边', dragCrop({ x: 0, y: 0, w: 30, h: 30 }, 'se', -100, -100, 30, 30, 64).w === 30);
}

// ---- setCrop:铺满当没裁 ----
{
  const e = newEdit(1000, 800);
  check('铺满 = null', setCrop(e, { x: 0, y: 0, w: 1000, h: 800 }).crop === null);
  check('差一点点也算铺满', setCrop(e, { x: 0.2, y: 0, w: 999.5, h: 800 }).crop === null);
  check('真裁了就留着', eq(setCrop(e, { x: 10, y: 0, w: 990, h: 800 }).crop, { x: 10, y: 0, w: 990, h: 800 }));
  check('没改 = edited false', !edited(e));
  check('裁了 = edited', edited(setCrop(e, { x: 10, y: 0, w: 500, h: 800 })));
}

// ---- 转 90° ----
{
  let e: PhotoEdit = { ...newEdit(1000, 800), crop: { x: 100, y: 50, w: 300, h: 200 }, strokes: [{ width: 8, pts: [{ x: 120, y: 60 }, { x: 390, y: 240 }] }] };
  const e1 = rotateEdit(e);
  check('转一次宽高互换', eq(rotatedSize(e1), { w: 800, h: 1000 }));
  // 框的左上 (100,50)、右下 (400,250) → (800−50, 100)=(750,100) 与 (800−250, 400)=(550,400):新框 x=550..750, y=100..400
  check('转一次框跟着走', eq(e1.crop, { x: 550, y: 100, w: 200, h: 300 }), JSON.stringify(e1.crop));
  check('转一次笔画跟着走', eq(e1.strokes[0].pts, [{ x: 740, y: 120 }, { x: 560, y: 390 }]), JSON.stringify(e1.strokes[0].pts));
  check('转一次线宽不变', e1.strokes[0].width === 8);
  let e4 = e;
  for (let i = 0; i < 4; i++) e4 = rotateEdit(e4);
  check('转四次回原样', eq(e4, e), JSON.stringify(e4));
  // rotMatrix 与 rotateEdit 对同一个点给同一个答案(笔画是用 rotateEdit 转的,底图是用 rotMatrix 画的,两边要对得上)
  const p = { x: 123, y: 456 };
  let k: PhotoEdit = { ...newEdit(1000, 800), strokes: [{ width: 1, pts: [p] }] };
  for (let i = 1; i <= 3; i++) {
    k = rotateEdit(k);
    check(`rotMatrix 转 ${i} 次与笔画一致`, eq(apply(k, p), k.strokes[0].pts[0]), JSON.stringify([apply(k, p), k.strokes[0].pts[0]]));
  }
  check('rotMatrix 不转是单位阵', eq(rotMatrix(newEdit(10, 20)), [1, 0, 0, 1, 0, 0]));
  e = rotateEdit(newEdit(1000, 800));
  check('转了 = edited', edited(e));
  check('没框时 region 是整张转过之后的图', eq(region(e), { x: 0, y: 0, w: 800, h: 1000 }));
}

// ---- 导出 ----
{
  const big = exportPlan(newEdit(4032, 3024));
  check('长边缩到 1600', big.w === 1600 && big.h === 1200, JSON.stringify(big));
  const small = exportPlan(newEdit(800, 600));
  check('小图不放大', small.w === 800 && small.h === 600 && small.scale === 1);
  const cropped = exportPlan(setCrop(newEdit(4032, 3024), { x: 1000, y: 1000, w: 1200, h: 600 }));
  check('裁一小块:按原分辨率取,不再缩', cropped.w === 1200 && cropped.h === 600 && cropped.src.x === 1000);
  const tall = exportPlan(rotateEdit(newEdit(4032, 3024)));
  check('转过之后竖着导出', tall.w === 1200 && tall.h === 1600, JSON.stringify(tall));
}

// ---- 线宽跟着看到的那块 ----
{
  const e = newEdit(4000, 3000);
  check('整张:长边 × 1.5%', newStroke(e, { x: 0, y: 0 }).width === 60);
  check('裁小了线也细', newStroke(setCrop(e, { x: 0, y: 0, w: 1000, h: 500 }), { x: 0, y: 0 }).width === 15);
}

done();
