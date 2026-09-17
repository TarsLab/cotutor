/** 事件的纯函数:一句话、一行、道过滤、jsonl 解析(坏行跳过)。发事件的那头在 runner.test.ts。 */
import { beatTimings, describeEvent, formatEvent, laneFilter, parseEvents, timelineSpans, type RunEvent } from '../src/lib/events.ts';
import { check, done } from './_check.ts';

const ev = (e: Omit<RunEvent, 't'> & Record<string, unknown>, t = 1234): RunEvent => ({ t, ...e } as RunEvent);
check('main:起 / 卡 / 句 / 工具 / 退出', describeEvent(ev({ lane: 'main', kind: 'start', cli: 'claude', runtime: 'claude', resume: true })) === '起 claude(claude,resume)' && describeEvent(ev({ lane: 'main', kind: 'card', card: 0, label: 'text cover「勾股定理」' })) === '卡 0 text cover「勾股定理」' && describeEvent(ev({ lane: 'main', kind: 'line', line: 2, text: '先认边。' })) === '句 2「先认边。」' && describeEvent(ev({ lane: 'main', kind: 'tool', name: 'Read x', sub: true })) === '子代理 工具 Read x' && describeEvent(ev({ lane: 'main', kind: 'exit', ok: true, costUsd: 0.111, turns: 3 })) === '退出 ok · 3 turns · $0.111' && describeEvent(ev({ lane: 'main', kind: 'exit', ok: false, reason: 'error_max_turns' })) === '退出 出错(error_max_turns)');
check('tts / post / ready / index / scene / ledger', describeEvent(ev({ lane: 'tts', kind: 'done', label: '第 1 句', ms: 1898, file: 'a.mp3' })) === '第 1 句✓ 1.90s' && describeEvent(ev({ lane: 'tts', kind: 'failed', label: '第 2 句', ms: 300, error: '音色不存在' })) === '第 2 句✗ 0.30s 音色不存在' && describeEvent(ev({ lane: 'post', kind: 'start', beat: 1, card: 1, context: 1 })) === '拍 1 起(卡 1,前文 1 张)' && describeEvent(ev({ lane: 'post', kind: 'done', beat: 1, ms: 2799, kept: { marks: 1, anchors: 0, look: true, row: 'same' }, dropped: 0, costUsd: 0.004 })) === '拍 1 ✓ 2.80s 标 1 锚 0 接上一行 有样子 丢 0 · $0.004' && describeEvent(ev({ lane: 'post', kind: 'failed', beat: 2, ms: 4001, error: '超时' })) === '拍 2 ✗ 4.00s 超时' && describeEvent(ev({ lane: 'ready', kind: 'beat', beat: 0, card: 0, first: true })) === '拍 0 ✓(卡 0) ← 首拍就绪' && describeEvent(ev({ lane: 'ready', kind: 'all', cards: 4, lines: 6 })) === '全部就绪(4 张卡 6 句)' && describeEvent(ev({ lane: 'index', kind: 'written', warnings: 2 })) === '写入 · 提醒 2' && describeEvent(ev({ lane: 'scene', kind: 'skipped', bundle: 'x-1', why: '关着' })) === '课包 x-1 没起:关着' && describeEvent(ev({ lane: 'scene', kind: 'started', bundle: 'x-1', job: '1902-4' })) === '课包 x-1 起了 scene-maker 1902-4' && describeEvent(ev({ lane: 'ledger', kind: 'artifact', id: 'x-1', status: '记了账' })) === '课包 x-1 记了账');
check('一行:相对秒右对齐两位小数、道补齐 7 位', formatEvent(ev({ lane: 'tts', kind: 'queued', label: '第 1 句' }, 6402)) === '  6.40 tts     第 1 句排队');
const keep = laneFilter('post, tts,bogus');
check('道过滤:认识的留下、不认识的忽略;空 = 全部', keep(ev({ lane: 'tts', kind: 'queued', label: 'x' })) && !keep(ev({ lane: 'main', kind: 'start', cli: 'c', runtime: 'r', resume: false })) && laneFilter(undefined)(ev({ lane: 'main', kind: 'start', cli: 'c', runtime: 'r', resume: false })) && laneFilter('bogus')(ev({ lane: 'index', kind: 'written', warnings: 0 })));
const parsed = parseEvents('{"t":1,"lane":"main","kind":"start","cli":"c","runtime":"r","resume":false}\n坏行\n{"t":2,"lane":"nope","kind":"x"}\n\n{"t":3,"lane":"index","kind":"written","warnings":0}\n');
check('jsonl 解析:坏行与不认识的道跳过', parsed.length === 2 && parsed[0].kind === 'start' && parsed[1].lane === 'index');
// 每拍的埋点从事件推:关 = 下一张卡出现(末拍 = 退出)、配音齐 = 这拍最后一句配完、后期回、就绪(末拍取 all)
const run: RunEvent[] = [
  ev({ lane: 'main', kind: 'start', cli: 'c', runtime: 'r', resume: false }, 0),
  ev({ lane: 'main', kind: 'card', card: 0, label: 'a' }, 500), ev({ lane: 'main', kind: 'line', line: 0, text: 'x' }, 600), ev({ lane: 'tts', kind: 'queued', label: '第 1 句' }, 600),
  ev({ lane: 'tts', kind: 'done', label: '第 1 句', ms: 100, file: 'f' }, 700), ev({ lane: 'post', kind: 'start', beat: 0, card: 0, context: 0 }, 900), ev({ lane: 'main', kind: 'card', card: 1, label: 'b' }, 900),
  ev({ lane: 'post', kind: 'done', beat: 0, ms: 300, kept: { marks: 0, anchors: 0, look: false, row: 'new' }, dropped: 1 }, 1200), ev({ lane: 'ready', kind: 'beat', beat: 0, card: 0, first: true }, 1200),
  ev({ lane: 'main', kind: 'line', line: 1, text: 'y' }, 1300), ev({ lane: 'tts', kind: 'queued', label: '第 2 句' }, 1300), ev({ lane: 'main', kind: 'exit', ok: true }, 1500), ev({ lane: 'tts', kind: 'failed', label: '第 2 句', ms: 400, error: 'e' }, 1700),
  ev({ lane: 'post', kind: 'failed', beat: 1, ms: 800, error: '超时' }, 2300), ev({ lane: 'ready', kind: 'all', cards: 2, lines: 2 }, 2300), ev({ lane: 'index', kind: 'written', warnings: 0 }, 2310),
];
const bt = beatTimings(run, [{ card: 0, lines: [0] }, { card: 1, lines: [1] }]);
check('每拍埋点:拍 0 关在卡 1 出现、配音 700、后期 1200、就绪 1200;拍 1 关在退出、配音(失败也算落定)1700、后期 2300、就绪取 all', JSON.stringify(bt) === '[{"card":0,"closedMs":900,"dubbedMs":700,"postMs":1200,"readyMs":1200},{"card":1,"closedMs":1500,"dubbedMs":1700,"postMs":2300,"readyMs":2300}]', JSON.stringify(bt));
const sp = timelineSpans(run);
const of = (lane: string) => sp.filter((x) => x.lane === lane);
check('时间线的段:老师 0→1500;配音两段(一段 fail);后期两段(丢了的 warn、超时 fail);瞬时的 to = from;按起点排序', of('main')[0].from === 0 && of('main')[0].to === 1500 && of('tts').length === 2 && of('tts')[1].state === 'fail' && of('post').length === 2 && of('post')[0].state === 'warn' && of('post')[1].state === 'fail' && of('ready').every((x) => x.from === x.to) && sp.every((x, i) => i === 0 || x.from >= sp[i - 1].from), JSON.stringify(sp.map((x) => [x.lane, x.from, x.to, x.state])));
check('没收尾的段画到最后一条事件并标 warn', timelineSpans(run.slice(0, 6)).some((x) => x.lane === 'post' && x.state === 'warn' && x.label.includes('没收尾')));
done();
