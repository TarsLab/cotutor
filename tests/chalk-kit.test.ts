/**
 * 教具(src/chalk/kit/):参数怎么读、每张卡开放哪些操作、画面、孩子做了什么说成给老师的那几句。
 * 方向盘照 2026-11-10 那次检查作业:「早晨面向太阳,前面是东,后面、左面、右面各是什么」;
 * 点阵照「分一分」:18 个贴纸平均分给 2 个、3 个、6 个小朋友。孩子的笔画不归整,读数只是大概。
 */
import { KID_INK, KITS, kitLookOnly, describeKit, elementBounds, kitMarks, kitOf, kitOps, kitParams, kitTouched, readKitLines, turnPoint, turnedSkeletons, type KitState } from '../src/chalk/index.ts';
import { sceneSchema } from '../src/chalk/scene-schema.ts';
import { check, done } from './_check.ts';

const kit = kitOf('方向盘')!;
const grid = kitOf('点阵')!;
check('三种画法在册:照片、点阵、方向盘', KITS.map((k) => k.name).join() === '照片,点阵,方向盘' && kitOf('没有这种') === undefined);
check('每种教具都列了孩子能做的操作', kit.ops.join() === '转,圈' && grid.ops.join() === '切,圈,涂,添');

// ---- 参数与操作 ----
const read = readKitLines(kit, ['上: 东', '小人:没有', '把「东」转到上面。', '想一想:哪个字在下面?']);
check('参数行认全角半角冒号;不是参数的行是题目(带冒号的一句话也算题目)', read.params['上'] === '东' && read.params['小人'] === '没有' && read.prompt === '把「东」转到上面。 想一想:哪个字在下面?', JSON.stringify(read));
const def = readKitLines(kit, []);
check('没写的参数补缺省:上北、有小人;没写操作 = 全开', def.params['上'] === '北' && def.params['小人'] === '有' && def.prompt === '' && def.ops.join() === '转,圈', JSON.stringify(def));
const errOf = (f: () => unknown): string => { try { f(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };
check('参数的值不在能取的里面:抛,说清能写什么', errOf(() => readKitLines(kit, ['上: 东北'])).includes('北、东、南、西'));
check('「操作: 圈」只开放这一种;写了这张卡没有的操作:抛,说清有哪些', readKitLines(kit, ['操作: 圈']).ops.join() === '圈' && readKitLines(grid, ['操作:涂、切']).ops.join() === '切,涂' && errOf(() => readKitLines(kit, ['操作: 切'])).includes('转、圈'));
check('存下来的参数、操作不对就退回缺省(老对话里的,不抛)', kitParams(kit, { 上: '天', 小人: 3 })['上'] === '北' && kitParams(kit, undefined)['小人'] === '有' && kitOps(kit, ['圈', '飞']).join() === '圈' && kitOps(kit, 'x').join() === '转,圈' && kitParams(grid, { 行: '99' })['行'] === '2');
const g1 = readKitLines(grid, ['2 行 9 个', '线: 竖 3、竖 6', '操作: 切、涂', '再切一刀,分成 6 份。']);
check('点阵:一行简写「2 行 9 个」、板上已有的线、操作、题目', g1.params['行'] === '2' && g1.params['每行'] === '9' && g1.params['线'] === '竖3 竖6' && g1.ops.join() === '切,涂' && g1.prompt === '再切一刀,分成 6 份。', JSON.stringify(g1));
check('点阵:不写就是 2 行 9 个、没有线;行列写过了头、线写得不对:抛', readKitLines(grid, []).params['每行'] === '9' && readKitLines(grid, []).params['线'] === '' && errOf(() => readKitLines(grid, ['9 行 9 个'])).includes('1 到 5') && errOf(() => readKitLines(grid, ['线: 斜 1'])).includes('横 1'));

// ---- 方向盘的画面 ----
const P = def.params;
const scene = kit.build(P);
const ids = scene.skeletons.map((e) => e.id);
const valid = (name: string, sk: unknown[]): boolean => sceneSchema.safeParse({ id: 'kit', title: name, problem: name, model: 'kit', template: 'static', skeletons: sk, steps: [] }).success;
check('元素 id 不重;画面是合法的 chalk 场景(两种教具)', new Set(ids).size === ids.length && valid('方向盘', scene.skeletons) && valid('点阵', grid.build(g1.params).skeletons));
const disc = scene.turns[0];
const at = disc.elementIds.map((id) => ids.indexOf(id));
check('能转的那一组在笔顺里连着(舞台收进一个 <g>);保持正着的是四个方向字', at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i === at[k - 1] + 1) && disc.upright.length === 4 && disc.upright.every((id) => disc.elementIds.includes(id)));
const center = (id: string, list = scene.skeletons): [number, number] => { const b = elementBounds(list.find((e) => e.id === id)!); return [Math.round((b.minX + b.maxX) / 2), Math.round((b.minY + b.maxY) / 2)]; };
check('没转:北在上、东在右、南在下、西在左;写了「上: 东」东就在上', center('dir-n')[1] < 320 && center('dir-e')[0] > 320 && center('dir-s')[1] > 320 && center('dir-w')[0] < 320 && center('dir-e', kit.build({ ...P, 上: '东' }).skeletons)[1] < 320);
check('小人和前后左右都有名字;不要小人就只有盘', scene.skeletons.filter((e) => e.label === '小人').length === 5 && ['前面', '右面', '后面', '左面'].every((s) => scene.skeletons.some((e) => e.label === s)) && kit.build({ ...P, 小人: '没有' }).skeletons.every((e) => disc.elementIds.includes(e.id)));
check('老师画的不用孩子的笔的颜色,线也比孩子的细(每种教具的缺省画面)', KITS.every((k) => k.build(kitParams(k, undefined)).skeletons.every((e) => String(e.strokeColor ?? '').toLowerCase() !== KID_INK && String(e.backgroundColor ?? '').toLowerCase() !== KID_INK && (typeof e.strokeWidth !== 'number' || e.strokeWidth < 5))));

// ---- 方向盘:转、圈(算得准的) ----
const said = (p: Record<string, string>, st: KitState): string => kit.read(p, st, kit.build(p));
check('顺时针转 90°:上面的点到右面', JSON.stringify(turnPoint([320, 192], [320, 320], 90)) === '[448,320]');
const east: KitState = { turn: { disc: 270 }, moves: 1 };
check('没转:说没转、现在谁在哪', said(P, {}) === '没转(前面是北、右面是东、后面是南、左面是西);没有圈', said(P, {}));
check('把东转到前面(逆时针一格)', said(P, east) === '把方向盘逆时针转了 90°(按了 1 次);现在前面是东、右面是南、后面是西、左面是北;没有圈', said(P, east));
check('不要小人时说上下左右', said({ ...P, 小人: '没有' }, east).includes('上面是东、右面是南、下面是西、左面是北'));
const turned = turnedSkeletons(scene, east);
check('转过以后字的位置跟着走、大小不变;不在盘上的不动', JSON.stringify(center('dir-e', turned)) === '[320,192]' && JSON.stringify(center('dir-w', turned)) === '[320,448]' && JSON.stringify(center('side-0', turned)) === JSON.stringify(center('side-0')));
/** 绕 (cx, cy) 画一个半径 r 的圈 */
const ring = (cx: number, cy: number, r: number): [number, number][] => Array.from({ length: 24 }, (_, k) => [Math.round(cx + r * Math.cos((k / 24) * Math.PI * 2)), Math.round(cy + r * Math.sin((k / 24) * Math.PI * 2))] as [number, number]);
const circled = kitMarks(scene, { ...east, marks: [ring(320, 448, 44)] });
check('转过以后圈下面那个字:圈住的是西;没转时同一个地方是南', circled[0]?.kind === 'circle' && circled[0].items[0].label === '西' && JSON.stringify(kitMarks(scene, { marks: [ring(320, 448, 44)] })).includes('"南"'), JSON.stringify(circled));
check('点一下、划过、划在底下、空白处', kitMarks(scene, { ...east, marks: [[[322, 190], [322, 190]]] })[0]?.kind === 'tap' && kitMarks(scene, { ...east, marks: [[[262, 448], [320, 450], [378, 447]]] })[0]?.kind === 'on' && kitMarks(scene, { ...east, marks: [[[296, 486], [344, 486]]] })[0]?.kind === 'near' && kitMarks(scene, { marks: [[[20, 20], [60, 30], [40, 60]]] })[0]?.kind === 'empty');
check('圈住中间说小人;圈住整个盘只说四个字和小人(盘的边、刻度不算)', (() => { const me = kitMarks(scene, { marks: [ring(320, 320, 62)] })[0]; const all = kitMarks(scene, { marks: [ring(320, 320, 205)] })[0]; return me?.kind === 'circle' && me.items.length === 1 && me.items[0].label === '小人' && all?.kind === 'circle' && all.items.length === 5; })());
check('给老师的那几句:请他做的 + 大概', describeKit(kit, P, { ...east, marks: [ring(320, 448, 44)] }, ['圈']) === '请他做的:圈;大概:把方向盘逆时针转了 90°(按了 1 次);现在前面是东、右面是南、后面是西、左面是北;圈住了:西(在后面)', describeKit(kit, P, { ...east, marks: [ring(320, 448, 44)] }, ['圈']));
check('转了一圈回到原处也说转过;同一样东西圈两笔只说一遍', said(P, { turn: { disc: 0 }, moves: 4 }).startsWith('把方向盘转了一圈回到原处(按了 4 次)') && said(P, { marks: [ring(448, 320, 44), ring(448, 320, 50)] }).split('圈住了').length === 2);

// ---- 点阵:切、圈、涂(只算大概,孩子画歪了照他画的算) ----
const G = readKitLines(grid, ['2 行 9 个']).params;
const gs = grid.build(G);
const gread = (p: Record<string, string>, marks: [number, number][][]): string => grid.read(p, { marks }, grid.build(p));
check('2 行 9 个:18 个圈圈、没有线;写了线就多两道老师的红线', gs.skeletons.length === 18 && gs.skeletons.every((e) => e.type === 'ellipse') && gs.turns.length === 0 && grid.build(g1.params).skeletons.filter((e) => e.type === 'line').length === 2);
// 圆心:第 c 列 x = 70 + (c-1)*56,第 r 行 y = 70 + (r-1)*56;列缝在两列正中
const X = (c: number): number => 70 + (c - 1) * 56, GX = (c: number): number => X(c) + 28;
/** 一道有点歪的线:中间鼓出去一点 */
const hline: [number, number][] = [[40, 100], [180, 94], [330, 99], [560, 96]];
const vline = (x: number, wob = 4): [number, number][] => [[x, 30], [x + wob, 70], [x - wob, 110], [x + 1, 165]];
check('还没画', gread(G, []) === '还没画');
check('横着切一道(有点歪):大致分成 2 份,每份 9 个', gread(G, [hline]) === '画了 1 道横线;大致分成 2 份:每份 9 个', gread(G, [hline]));
check('竖着切两道,切在第 3、6 列后面:3 份,每份 6 个', gread(G, [vline(GX(3)), vline(GX(6))]) === '画了 2 道竖线;大致分成 3 份:每份 6 个', gread(G, [vline(GX(3)), vline(GX(6))]));
check('第二道切偏了(切在第 5 列后面):照他画的说 6、4、8,不说对错', gread(G, [vline(GX(3)), vline(GX(5))]) === '画了 2 道竖线;大致分成 3 份:6、4、8', gread(G, [vline(GX(3)), vline(GX(5))]));
check('线压着一列圈圈:说一声,哪边的让老师看图', gread(G, [vline(X(4), 1)]).includes('压着圈圈'), gread(G, [vline(X(4), 1)]));
check('板上原来有两道竖线,孩子加一道横的:连同原来的线共 6 份,每份 3 个', gread(g1.params, [hline]) === '画了 1 道横线;连同板上原来的线,大致分成 6 份:每份 3 个', gread(g1.params, [hline]));
check('绕左上三个圈一圈:圈里大约 3 个', gread(G, [ring(X(2), 70, 88).map(([x, y]) => [x, Math.round(70 + (y - 70) * 0.4)] as [number, number])]) === '圈了一圈,里面大约 3 个', gread(G, [ring(X(2), 70, 88).map(([x, y]) => [x, Math.round(70 + (y - 70) * 0.4)] as [number, number])]));
const scribble: [number, number][] = Array.from({ length: 14 }, (_, k) => [k % 2 ? X(3) + 14 : X(1) - 14, 50 + k * 7] as [number, number]);
check('在左边来回涂:盖住大约 6 个(两行各 3 个)', gread(G, [scribble]) === '涂了一块,盖住大约 6 个', gread(G, [scribble]));
check('点一下、看不出是什么的一笔', gread(G, [[[X(4), 126], [X(4), 126]]]) === '点了第 2 行第 4 个' && gread(G, [[[300, 200], [330, 230], [300, 250]]]) === '有 1 笔看不出是什么,看图', gread(G, [[[300, 200], [330, 230], [300, 250]]]));
// 添:17 个、每行 5 个(最后一行只有 2 个);孩子在空的地方点三下,再横着切三道
const M = readKitLines(grid, ['17 个,每行 5 个', '操作: 添、切']);
const Y = (r: number): number => 70 + (r - 1) * 56;
const hcut = (r: number): [number, number][] => [[40, Y(r) + 28], [150, Y(r) + 25], [320, Y(r) + 30]];
const three: [number, number][][] = [3, 4, 5].map((c) => [[X(c), Y(4)], [X(c), Y(4)]]);
check('一共 17 个、每行 5 个:排成 4 行,最后一行 2 个;只开放添、切', M.params['共'] === '17' && M.params['每行'] === '5' && M.ops.join() === '切,添' && grid.build(M.params).skeletons.length === 17 && grid.build(M.params).skeletons.some((e) => e.id === 'dot-4-2') && !grid.build(M.params).skeletons.some((e) => e.id === 'dot-4-3'), JSON.stringify(M));
check('在空的地方点三下:添了 3 个,一共 20 个;点在圈圈上还是指它', gread(M.params, three) === '添了 3 个圈,连原来的一共 20 个' && gread(M.params, [[[X(2), Y(4)], [X(2), Y(4)]]]) === '点了第 4 行第 2 个', gread(M.params, three));
check('自己画一个小圈也算添;绕着圈圈画的还是圈', gread(M.params, [ring(X(4), Y(4), 18)]) === '添了 1 个圈,连原来的一共 18 个' && gread(M.params, [ring(X(1), Y(4), 30)]) === '圈了一圈,里面大约 1 个', gread(M.params, [ring(X(4), Y(4), 18)]));
check('添了 3 个再横着切三道:4 份,每份 5 个(他添的也数进去)', gread(M.params, [...three, hcut(1), hcut(2), hcut(3)]) === '添了 3 个圈,连原来的一共 20 个;画了 3 道横线;大致分成 4 份:每份 5 个', gread(M.params, [...three, hcut(1), hcut(2), hcut(3)]));
check('没添就切:最后一份少,照实说 5、5、5、2', gread(M.params, [hcut(1), hcut(2), hcut(3)]) === '画了 3 道横线;大致分成 4 份:5、5、5、2', gread(M.params, [hcut(1), hcut(2), hcut(3)]));
check('给老师的那几句', describeKit(grid, G, { marks: [vline(GX(3)), vline(GX(6))] }, ['切']) === '请他做的:切;大概:画了 2 道竖线;大致分成 3 份:每份 6 个');

// ---- 照片:孩子拍的作业做底,位置都是整张照片的千分比 ----
const shot = kitOf('照片')!;
const PH = readKitLines(shot, ['captures/2026-11-10/2159-1.jpg', '框: 243, 601, 927, 971', '圈: 595, 665, 694, 752', '操作: 圈', '心理辅导室的东面是哪两间?圈出来。']);
check('照片:第一行是路径,框和圈规整成四个数,题目留下', PH.params['图'] === 'captures/2026-11-10/2159-1.jpg' && PH.params['框'] === '243 601 927 971' && PH.params['圈'] === '595 665 694 752' && PH.params['北'] === '上' && PH.ops.join() === '圈' && PH.prompt === '心理辅导室的东面是哪两间?圈出来。', JSON.stringify(PH));
const threw = (lines: string[]): boolean => { try { readKitLines(shot, lines); return false; } catch { return true; } };
check('照片:没写图、网上的图、框的数不对、千分比出界都读不成', threw(['圈出来。']) && threw(['https://example.com/a.jpg']) && threw(['a.jpg', '框: 1, 2, 3']) && threw(['a.jpg', '圈: 10, 10, 1200, 500']) && threw(['a.jpg', '方位: 5']));
const ps = shot.build(PH.params, { aspect: 1.0076 });
check('照片:画框是裁的那一块(多留一圈边),照片占整个场景,竖的数乘了高宽比', ps.photo?.src === 'captures/2026-11-10/2159-1.jpg' && ps.photo.width === 1000 && Math.abs(ps.photo.height - 1007.6) < 0.01 && ps.frame![0] < 243 && ps.frame![0] > 200 && Math.abs(ps.frame![1] - (601 - 370 * 0.04) * 1.0076) < 0.01, JSON.stringify(ps.frame));
check('照片:一处圈 = 一个红圈,套在老师给的框外面', ps.skeletons.length === 1 && ps.skeletons[0].type === 'ellipse' && ps.skeletons[0].strokeColor === '#e03131' && Number(ps.skeletons[0].x) < 595 && Number(ps.skeletons[0].x) + Number(ps.skeletons[0].width) > 694);
const rose = shot.build({ ...PH.params, 圈: '', 方位: '644 708', 北: '右' }, { aspect: 1 });
const word = (d: string) => rose.skeletons.find((e) => e.type === 'text' && e.text === d)!;
check('照片:方位十字四个字各一支箭头;北写右,北就在右边、东在下面', rose.skeletons.filter((e) => e.type === 'arrow').length === 4 && rose.skeletons.filter((e) => e.type === 'text').length === 4 && Number(word('北').x) > 644 && Number(word('东').y) > 708 && Number(word('南').x) < 600);
check('照片:老师的记号不用孩子的蓝', [...ps.skeletons, ...rose.skeletons].every((e) => e.strokeColor !== KID_INK));
check('照片:只有图也行,板上没有老师的记号', shot.build(readKitLines(shot, ['a.jpg']).params).skeletons.length === 0);
// 孩子在 (780, 708) 附近圈了一圈:场景里竖的是千分比 × 高宽比,说回去要除回来
const A = 1.25;
const kidRing = ring(780, 708 * A, 40);
check('照片:孩子圈的说成千分比(中间、左上、右下),老师照抄就能把记号画在那', describeKit(shot, PH.params, { marks: [kidRing], aspect: A }, ['圈']) === '请他做的:圈;大概:圈了一圈,中间在 (780, 708),左上 (740, 676)、右下 (820, 740);这些数是整张照片的千分比,和你写「圈」「方位」用的一样', describeKit(shot, PH.params, { marks: [kidRing], aspect: A }, ['圈']));
check('照片:一道线说从哪到哪;没量到高宽比只说画了什么', shot.read(PH.params, { marks: [[[600, 500], [700, 500], [800, 500]]], aspect: 1 }, ps) === '画了一道线,从 (600, 500) 到 (800, 500);这些数是整张照片的千分比,和你写「圈」「方位」用的一样' && shot.read(PH.params, { marks: [kidRing] }, ps) === '圈了一圈;位置看图' && shot.read(PH.params, {}, ps) === '还没画');

// 照片上写字:写进框里(字照框的大小)、写在点上;只看的板
const W = readKitLines(shot, ['captures/2026-11-12/0935-1.jpg', '写: 18 在 591, 860, 657, 948;18 ÷ 3 = 6 在 600, 700', '操作: 看', '算式这样填。']);
const wsk = shot.build(W.params, { aspect: 0.468 }).skeletons;
check('照片的「写」:规整成「字|数」,两处各一段红字,写在点上的垫一块纸色的底;写进框里的字落在框中间、不出框', W.params['写'] === '18|591 860 657 948;18 ÷ 3 = 6|600 700' && wsk.length === 3 && wsk.filter((e) => e.type === 'text').length === 2 && wsk[1].type === 'rectangle' && wsk[1].backgroundColor === '#fffdf8' && wsk.every((e) => e.strokeColor === '#e03131') && Number(wsk[0].x) >= 591 && Number(wsk[0].x) + Number(wsk[0].width) <= 657 && Number(wsk[0].y) >= 860 * 0.468 && Number(wsk[0].y) + Number(wsk[0].height) <= 948 * 0.468 + 1, JSON.stringify([W.params['写'], wsk[0]]));
const B = readKitLines(shot, ['a.jpg', '框: 100, 400, 900, 900', '写: 18 ÷ 3 = 6;每人折 6 只', '操作: 看']);
const bs = shot.build(B.params, { aspect: 0.5 });
check('照片的「写」不给位置:写在照片下面另起的纸上,一行一行,画框跟着往下长,不压着照片上裁的那一块', B.params['写'] === '18 ÷ 3 = 6|;每人折 6 只|' && bs.skeletons.length === 3 && bs.skeletons[0].type === 'rectangle' && bs.skeletons[0].backgroundColor === '#fffdf8' && bs.skeletons.slice(1).every((e) => e.type === 'text' && Number(e.y) > (900 + 500 * 0.04) * 0.5) && Number(bs.skeletons[2].y) > Number(bs.skeletons[1].y) + Number(bs.skeletons[1].height) && bs.frame![1] + bs.frame![3] > Number(bs.skeletons[2].y) + Number(bs.skeletons[2].height) && JSON.stringify(kitParams(shot, B.params)) === JSON.stringify(B.params), JSON.stringify([B.params['写'], bs.frame, bs.skeletons.map((e) => [e.y, e.height])]));
check('存下来的参数再读一遍不变(舞台、服务端都是这样读的)', JSON.stringify(kitParams(shot, W.params)) === JSON.stringify(W.params) && JSON.stringify(kitParams(shot, PH.params)) === JSON.stringify(PH.params) && JSON.stringify(kitParams(grid, M.params)) === JSON.stringify(M.params), JSON.stringify(kitParams(shot, W.params)));
check('只看:写明了才有;不写操作时全开里没有它', W.ops.join() === '看' && kitLookOnly(W.ops) && !kitLookOnly(PH.ops) && readKitLines(shot, ['a.jpg']).ops.join() === '圈,画' && kitOps(shot, undefined).join() === '圈,画' && kitOps(shot, ['看']).join() === '看');
check('照片的「写」写错了读不成:字太长、数的个数不对、位置出界', threw(['a.jpg', '写: ' + '字'.repeat(15) + ' 在 500, 500']) && threw(['a.jpg', '写: ' + '字'.repeat(21)]) && threw(['a.jpg', '写: 18 在 1, 2, 3']) && threw(['a.jpg', '写: 18 在 1200, 500']));

check('做了没有:转过或画过才算', !kitTouched(null) && !kitTouched({}) && !kitTouched({ turn: { disc: 0 }, moves: 0, marks: [] }) && kitTouched({ moves: 1 }) && kitTouched({ marks: [[[1, 1], [2, 2]]] }));

done();
