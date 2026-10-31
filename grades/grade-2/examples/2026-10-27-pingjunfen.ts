/** 6 个圆片平均放进 3 个盘子。一轮一个,每盘一样多;无需先学除法。 */
import type { ChalkScene, ChalkSkeleton } from 'cotutor/chalk';
const ink = '#1e1e1e';
const text = (id: string, value: string, x: number, y: number): ChalkSkeleton => ({ type: 'text', id, text: value, x, y, fontSize: 26, strokeColor: ink, animateDuration: 900 });
const plates: ChalkSkeleton[] = Array.from({ length: 3 }, (_, i) => ({ type: 'rectangle', id: `plate-${i}`, x: 55 + i * 215, y: 100, width: 150, height: 100, strokeColor: ink, animateDuration: 900 }));
const round = (n: number): ChalkSkeleton[] => Array.from({ length: 3 }, (_, i) => ({ type: 'ellipse', id: `round-${n}-${i}`, x: 92 + i * 215 + (n - 1) * 45, y: 135, width: 26, height: 26, strokeColor: ink, backgroundColor: '#d3f9d8', fillStyle: 'solid', animateDuration: 900 }));
const scene: ChalkScene = {
  id: '2026-10-27-pingjunfen', title: '平均分:每盘一样多',
  problem: '6 个圆片平均放进 3 个盘子,每盘几个?',
  model: '实物分组', template: 'paper-strict', subject: '数学',
  skeletons: [
    text('title', '6 个圆片,平均放进 3 个盘子', 55, 30), ...plates,
    ...round(1), ...round(2),
    text('answer', '每盘 2 个,三盘一样多。', 55, 240),
    text('verify', '2 + 2 + 2 = 6', 55, 300),
  ],
  groups: plates.map((_, i) => ({ id: `group-${i}`, label: `第 ${i + 1} 个盘子`, elementIds: [`plate-${i}`, `round-1-${i}`, `round-2-${i}`] })),
  steps: [
    { step: 1, elementIds: ['title', ...plates.map(p => p.id!)], line: '6 个圆片,放进 3 个盘子,每盘要一样多。', pauseAfter: true },
    { step: 2, elementIds: round(1).map(p => p.id!), line: '先给每个盘子放 1 个,一共放了 3 个。', pauseAfter: true },
    { step: 3, elementIds: round(2).map(p => p.id!), line: '还剩 3 个,再给每盘放 1 个,正好放完。', pauseAfter: true },
    { step: 4, elementIds: ['answer'], line: '数一数,每盘都是 2 个。每盘一样多,就是平均分。', pauseAfter: true },
    { step: 5, elementIds: ['verify'], line: '再合起来数,2 加 2 加 2 是 6,一个也没少。', pauseAfter: true },
  ],
};
export default scene;
