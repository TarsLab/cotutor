/**
 * 白纸条上的图形(src/chalk/kit/):[[摆 …]] 的参数怎么读、画面、孩子做了什么说成给老师的那几句;照片页的文字层(认出的字换成课本的样子)、点字。
 * 方向盘照 2026-11-10 那次检查作业:「早晨面向太阳,前面是东,后面、左面、右面各是什么」;
 * 点阵照「分一分」:18 个贴纸平均分给 2 个、3 个、6 个小朋友。孩子的笔画不归整,读数只是大概。
 */
import { KID_INK, KITS, bookFind, bookPick, bookSheets, bookTarget, bookView, elementBounds, kitMarks, kitOf, kitParams, photoBookPage, photoText, pickEnglish, pickable, readKitLines, turnPoint, turnedSkeletons, type KitState } from '../src/chalk/index.ts';
import { sceneSchema } from '../src/chalk/scene-schema.ts';
import { check, done } from './_check.ts';

const kit = kitOf('方向盘')!;
const grid = kitOf('点阵')!;
check('两种图形在册:点阵、方向盘(照片、白板 2026-11-16 起是一节课的页,不是卡)', KITS.map((k) => k.name).join() === '点阵,方向盘' && kitOf('没有这种') === undefined);

// ---- 参数 ----
const read = readKitLines(kit, ['上: 东', '小人:没有', '把「东」转到上面。', '想一想:哪个字在下面?']);
check('参数行认全角半角冒号;不是参数的行是题目(带冒号的一句话也算题目)', read.params['上'] === '东' && read.params['小人'] === '没有' && read.prompt === '把「东」转到上面。 想一想:哪个字在下面?', JSON.stringify(read));
const def = readKitLines(kit, []);
check('没写的参数补缺省:上北、有小人', def.params['上'] === '北' && def.params['小人'] === '有' && def.prompt === '', JSON.stringify(def));
const errOf = (f: () => unknown): string => { try { f(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };
check('参数的值不在能取的里面:抛,说清能写什么', errOf(() => readKitLines(kit, ['上: 东北'])).includes('北、东、南、西'));
check('存下来的参数不对就退回缺省(老记录里的,不抛)', kitParams(kit, { 上: '天', 小人: 3 })['上'] === '北' && kitParams(kit, undefined)['小人'] === '有' && kitParams(grid, { 行: '99' })['行'] === '2');
const g1 = readKitLines(grid, ['2 行 9 个', '线: 竖 3、竖 6', '再切一刀,分成 6 份。']);
check('点阵:一行简写「2 行 9 个」、已有的线;认不出的那一截留着(摆 的参数里有它就算写错)', g1.params['行'] === '2' && g1.params['每行'] === '9' && g1.params['线'] === '竖3 竖6' && g1.prompt === '再切一刀,分成 6 份。', JSON.stringify(g1));
check('点阵:不写就是 2 行 9 个、没有线;行列写过了头、线写得不对:抛', readKitLines(grid, []).params['每行'] === '9' && readKitLines(grid, []).params['线'] === '' && readKitLines(grid, ['9 行 9 个']).params['行'] === '9' && errOf(() => readKitLines(grid, ['10 行 9 个'])).includes('1 到 9') && errOf(() => readKitLines(grid, ['线: 斜 1'])).includes('横 1'));

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
check('给老师的那一句(大概)', said(P, { ...east, marks: [ring(320, 448, 44)] }) === '把方向盘逆时针转了 90°(按了 1 次);现在前面是东、右面是南、后面是西、左面是北;圈住了:西(在后面)', said(P, { ...east, marks: [ring(320, 448, 44)] }));
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
const M = readKitLines(grid, ['17 个,每行 5 个']);
const Y = (r: number): number => 70 + (r - 1) * 56;
const hcut = (r: number): [number, number][] => [[40, Y(r) + 28], [150, Y(r) + 25], [320, Y(r) + 30]];
const three: [number, number][][] = [3, 4, 5].map((c) => [[X(c), Y(4)], [X(c), Y(4)]]);
check('一共 17 个、每行 5 个:排成 4 行,最后一行 2 个', M.params['共'] === '17' && M.params['每行'] === '5' && grid.build(M.params).skeletons.length === 17 && grid.build(M.params).skeletons.some((e) => e.id === 'dot-4-2') && !grid.build(M.params).skeletons.some((e) => e.id === 'dot-4-3'), JSON.stringify(M));
check('在空的地方点三下:添了 3 个,一共 20 个;点在圈圈上还是指它', gread(M.params, three) === '添了 3 个圈,连原来的一共 20 个' && gread(M.params, [[[X(2), Y(4)], [X(2), Y(4)]]]) === '点了第 4 行第 2 个', gread(M.params, three));
check('自己画一个小圈也算添;绕着圈圈画的还是圈', gread(M.params, [ring(X(4), Y(4), 18)]) === '添了 1 个圈,连原来的一共 18 个' && gread(M.params, [ring(X(1), Y(4), 30)]) === '圈了一圈,里面大约 1 个', gread(M.params, [ring(X(4), Y(4), 18)]));
check('添了 3 个再横着切三道:4 份,每份 5 个(他添的也数进去)', gread(M.params, [...three, hcut(1), hcut(2), hcut(3)]) === '添了 3 个圈,连原来的一共 20 个;画了 3 道横线;大致分成 4 份:每份 5 个', gread(M.params, [...three, hcut(1), hcut(2), hcut(3)]));
check('没添就切:最后一份少,照实说 5、5、5、2', gread(M.params, [hcut(1), hcut(2), hcut(3)]) === '画了 3 道横线;大致分成 4 份:5、5、5、2', gread(M.params, [hcut(1), hcut(2), hcut(3)]));
check('给老师的那一句', gread(G, [vline(GX(3)), vline(GX(6))]) === '画了 2 道竖线;大致分成 3 份:每份 6 个');


// ---- 照片页的文字层:认出的字换成课本的样子,和课本用同一份找框、点字、说窗里是哪 ----
{
  // 一张 2000 × 1500 的横拍照片:页宽 1000、高 750;竖的千分比 × 0.75
  const T = {
    items: [{ text: '开兴', box: [300, 300, 380, 340] as const }],
    lines: [
      { text: '3.看拼音写词语。', box: [100, 200, 500, 240] as const },
      { text: '开兴 快乐', box: [300, 300, 600, 340] as const },
      { text: '4.What colour is it?', box: [100, 600, 700, 640] as const },
    ],
    questions: [{ no: '3', box: [80, 180, 920, 500] as const }, { no: '4', box: [80, 560, 920, 900] as const }, { no: '3', box: [1, 1, 2, 2] as const }],
  };
  const { page, blocks } = photoBookPage(1, { w: 2000, h: 1500 }, T);
  check('一张照片当一页:宽 1000,高照宽高比;行框竖的乘高宽比;挑出的字词也当一行(放在前面)', page.w === 1000 && page.h === 750 && page.printed === null && page.lines.length === 4 && page.lines[0].text === '开兴' && page.lines[1].y1 === 150 && page.lines[1].y2 === 180, JSON.stringify(page.lines[1]));
  check('行里的字照字数等分', page.lines[2].chars.length === 5 && page.lines[2].chars[0].x1 === 300 && page.lines[2].chars[1].x1 === 360, JSON.stringify(page.lines[2].chars.slice(0, 2)));
  check('题:题号、题框(竖的乘高宽比)、框里的那几行;同一题号只留第一个', blocks.length === 2 && blocks[0].no === 3 && JSON.stringify(blocks[0].area) === '{"n":1,"box":[80,135,920,375]}' && blocks[0].refs.map((r) => r.i).join() === '1,2' && blocks[1].refs.map((r) => r.i).join() === '3', JSON.stringify(blocks));
  check('给老师的正文:一行一句,有题号的行前面带题号,挑出的字词不重复', JSON.stringify(photoText(page, blocks)) === '["第3题 3.看拼音写词语。","开兴 快乐","第4题 4.What colour is it?"]', JSON.stringify(photoText(page, blocks)));
  const p2 = photoBookPage(2, { w: 1000, h: 1000 }, null);
  const sheets = bookSheets([page, p2.page]);
  check('两张从上往下连着,中间空一条', sheets[0].top === 0 && sheets[1].top === 780 && sheets[1].height === 1000, JSON.stringify(sheets));
  const all = [...blocks, ...p2.blocks];
  check('看第 3 题:是题框(比框里的几行大,图也在里面)', JSON.stringify(bookTarget([page, p2.page], sheets, all, '第 3 题')) === '{"label":"第3题","box":[80,135,920,375]}', JSON.stringify(bookTarget([page, p2.page], sheets, all, '第 3 题')));
  check('圈字:先找挑出的字词(框更紧),再找正文的行', JSON.stringify(bookFind([page], sheets, '开兴')) === '[300,225,380,255]' && JSON.stringify(bookFind([page], sheets, '快乐')) === '[480,225,600,255]', JSON.stringify([bookFind([page], sheets, '开兴'), bookFind([page], sheets, '快乐')]));
  check('点字:汉字是落在的那一格;英文是那个字母所在的词;行外面不算', bookPick([page], sheets, 335, 240)?.c === '开' && bookPick([page], sheets, 470, 465)?.c === 'colour' && bookPick([page], sheets, 50, 465) === null && bookPick([page], sheets, 335, 300) === null, JSON.stringify([bookPick([page], sheets, 335, 240), bookPick([page], sheets, 470, 465)]));
  check('窗里是哪:第几张、露出一半以上的题', bookView([page, p2.page], sheets, all, [0, 100, 1000, 400], '张') === '第 1 张:第 3 题', bookView([page, p2.page], sheets, all, [0, 100, 1000, 400], '张'));
  check('还没认出来:一页空的,没有题', p2.page.lines.length === 0 && p2.blocks.length === 0);
  check('能弹出来的:一到四个汉字、一个英文单词', pickable('变') && pickable('灌溉田地') && pickable('yellow') && pickEnglish("It's") && !pickEnglish('变') && !pickable('小蝌蚪找妈妈') && !pickable('123') && !pickable(''));
}

done();
