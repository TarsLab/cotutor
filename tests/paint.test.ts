/**
 * 你说我画(《wip/你说我画设想.md》):画图卡的提示词、交给百炼画(假服务)、后台画与一天的上限、下发时补画好没有、告诉老师画好没有。不花钱、不联网。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-paint-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.DASHSCOPE_API_KEY;

const { paintPrompt, paintLayout, paintSize, PAINT_NEGATIVE } = await import('../src/paint/prompt.ts');
const { makeDraw } = await import('../src/paint/draw.ts');
const { startPaints, enrichPaints, paintLines, paintedToday, paintNote, PAINT_STALE_MS } = await import('../src/paint/painter.ts');
const { parseCard } = await import('../src/cards/index.ts');
const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { readIndex } = await import('../src/server/store.ts');
const { PAINT_DEFAULT } = await import('../src/schema/index.ts');
type Draw = import('../src/paint/draw.ts').Draw;
type BoardSection = import('../src/lib/kid-board.ts').BoardSection;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

// ---- 提示词 ----
{
  const card = parseCard('paint', '题: 图上画了谁?\n词: 播种、羞愧\n角色: 小熊:棕色,戴黄草帽\n角色: 小猴:黄褐色,穿红背心\n1. 早上,小熊播种。\n2. 中午,小猴睡大觉。\n第3幅:夏天,西瓜熟了。\n4、小猴低着头,脸红红的。').card;
  const p = card.props as { panels: string[]; cast: { name: string; look: string }[]; ask: string; words: string[] };
  check('解析:四幅(1. / 第3幅: / 4、都认)、两个角色、题干、词', card.kind === 'paint' && p.panels.length === 4 && p.panels[2] === '夏天,西瓜熟了。' && p.cast.length === 2 && p.cast[1].look === '黄褐色,穿红背心' && p.ask === '图上画了谁?' && p.words.join() === '播种,羞愧', JSON.stringify(card));
  const full = parseCard('paint', '题：图上画了谁？\n词：播种，羞愧；满满\n角色：小熊：棕色\n1．早上,小熊播种。\n2）中午,小猴睡觉。\n第3幅：夏天。').card;
  const fp = full.props as { panels: string[]; cast: { name: string; look: string }[]; ask: string; words: string[] };
  check('全角冒号、逗号、分号、句点、括号都认(qwen 爱写全角)', full.kind === 'paint' && fp.ask === '图上画了谁？' && fp.words.join() === '播种,羞愧,满满' && fp.cast[0]?.look === '棕色' && fp.panels.length === 3, JSON.stringify(full));
  const prompt = paintPrompt(p);
  check('四格:2×2、圆圈数字、画风缺省、角色一行一个、第 n 格', prompt.startsWith('一张四格连环画,四格按 2×2 排') && prompt.includes(PAINT_DEFAULT.prompt[0]) && prompt.includes('- 小熊:棕色,戴黄草帽') && prompt.includes('第 4 格:小猴低着头,脸红红的。') && !prompt.includes('播种、羞愧') && !prompt.includes('图上画了谁'), prompt);
  check('题干与词语宝库不进画(画面里不要字)', !prompt.includes('题') && !prompt.includes('词语宝库'));
  check('家长改的画风换掉缺省那几行,版式与分幅照接', paintPrompt(p, ['剪纸风']).includes('剪纸风') && !paintPrompt(p, ['剪纸风']).includes(PAINT_DEFAULT.prompt[0]) && paintPrompt(p, ['剪纸风']).includes('第 1 格'));
  check('三格横排、两格横排、一幅一张画', paintLayout(3).includes('三格从左到右横着排') && paintLayout(2).includes('依次是第 1、2 格') && paintLayout(1) === '一张画。' && paintPrompt({ panels: ['小熊在地里。'] }).includes('画面:小熊在地里。'));
  check('尺寸:四格与一幅照配置,两三格换宽的', paintSize(4, '1280*1280') === '1280*1280' && paintSize(1, '1024*1024') === '1024*1024' && paintSize(3, '1280*1280') === '1664*928');
  check('反向提示词不超过 500 字符、不要字', PAINT_NEGATIVE.length < 500 && PAINT_NEGATIVE.startsWith('文字'));
  check('五幅解析不成、退文字卡', parseCard('paint', '1. a\n2. b\n3. c\n4. d\n5. e').card.kind === 'text');
  check('认不出的行解析不成(老师写成一段话)', parseCard('paint', '小熊种西瓜,小猴很懒。').card.kind === 'text');
}

// ---- 交给百炼画(假服务) ----
{
  const { createServer } = await import('node:http');
  const got: { auth?: string; body?: Record<string, unknown> }[] = [];
  const srv = createServer((req, res) => {
    if (req.url === '/img.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return; }
    if (req.url === '/bad.png') { res.writeHead(200); res.end('not a png'); return; }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as { input: { messages: { content: { text: string }[] }[] } };
      got.push({ auth: req.headers.authorization, body });
      const text = body.input.messages[0].content[0].text;
      const port = (srv.address() as { port: number }).port;
      if (text.includes('审核')) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: 'DataInspectionFailed', message: 'x' })); return; }
      const image = text.includes('坏图') ? `http://127.0.0.1:${port}/bad.png` : `http://127.0.0.1:${port}/img.png`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: [{ image }] } }] }, usage: { image_count: 1 } }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(srv.address() as { port: number }).port}/gen`;
  const draw = makeDraw({ env: { DASHSCOPE_API_KEY: 'k-test' }, endpoint });
  const ok = await draw({ prompt: '一张画', model: 'qwen-image-2.0-pro', size: '1280*1280' });
  const sent = got[0]?.body as { model?: string; parameters?: { size?: string; n?: number; prompt_extend?: boolean; watermark?: boolean; negative_prompt?: string } } | undefined;
  check('画好:下载图片地址拿回 PNG', ok.ok && ok.data.equals(PNG) && ok.model === 'qwen-image-2.0-pro', JSON.stringify(ok));
  check('请求:key 只进请求头、模型、尺寸、一张、不改写、不加水印、带反向提示词', got[0]?.auth === 'Bearer k-test' && sent?.model === 'qwen-image-2.0-pro' && sent.parameters?.size === '1280*1280' && sent.parameters.n === 1 && sent.parameters.prompt_extend === false && sent.parameters.watermark === false && sent.parameters.negative_prompt === PAINT_NEGATIVE, JSON.stringify(sent));
  const bad = await draw({ prompt: '审核', model: 'm', size: '1*1' });
  check('内容审核没过:http_400:DataInspectionFailed,不抛', !bad.ok && bad.error === 'http_400:DataInspectionFailed', JSON.stringify(bad));
  const notPng = await draw({ prompt: '坏图', model: 'm', size: '1*1' });
  check('拿回来的不是 PNG:not_png', !notPng.ok && notPng.error === 'not_png', JSON.stringify(notPng));
  const noKey = await makeDraw({ env: { HOME: home }, endpoint })({ prompt: 'x', model: 'm', size: '1*1' });
  check('没 key:no_key,不发请求', !noKey.ok && noKey.error === 'no_key' && got.length === 3);
  const down = await makeDraw({ env: { DASHSCOPE_API_KEY: 'k' }, endpoint: 'http://127.0.0.1:1/gen' })({ prompt: 'x', model: 'm', size: '1*1' });
  check('连不上:network', !down.ok && down.error === 'network', JSON.stringify(down));
  srv.close();
}

// ---- 后台画、一天的上限、下发时补、告诉老师 ----
{
  const { root } = await initWorkspace({ slug: 'paint', name: '小画', dir: join(home, 'ws-paint') });
  const cfgFile = join(root, 'cotutor.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
  cfg.paint = { daily: 2 };
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  const ws = loadWorkspace(root);
  check('出厂:paint 只跟着你说我画 activity(语文老师的卡里没有);paint 缺省 pro、1280、一天 2 张', !(ws.config.tutors['chinese-tutor'].cards ?? []).includes('paint') && ws.config.paint.model === 'qwen-image-2.0-pro' && ws.config.paint.size === '1280*1280' && ws.config.paint.daily === 2);
  const asked: string[] = [];
  const fakeDraw: Draw = async ({ prompt, model, size }) => { asked.push(`${model} ${size} ${prompt.split('\n')[0]}`); return prompt.includes('画不出') ? { ok: false, error: 'http_400:DataInspectionFailed', ms: 5 } : { ok: true, data: PNG, model, ms: 1234 }; };
  const sec = (panels: string[]): BoardSection => ({ cards: [{ kind: 'text', props: { text: '先说' } }, parseCard('paint', panels.map((t, i) => `${i + 1}. ${t}`).join('\n')).card], lines: [{ text: '画家开始画了。', audio: null }] } as unknown as BoardSection);
  const date = '2026-10-11';
  const dir = (job: string, n: number): string => join(root, 'conversations', 'chinese-tutor', `${date}.${job}.cards`, String(n));
  const now = new Date('2026-10-11T10:00:00Z');
  await startPaints(ws, 'chinese-tutor', date, '1000-1', sec(['小熊播种。', '小猴睡觉。', '西瓜熟了。', '小猴脸红。']), { draw: fakeDraw, now: () => now });
  const rec1 = JSON.parse(readFileSync(join(dir('1000-1', 1), 'paint.json'), 'utf8')) as { state: string; model: string; size: string; ms: number; prompt: string };
  check('画好:图落在这张卡的资产目录 paint.png,记录 done、模型、尺寸、几毫秒、拼好的提示词', readFileSync(join(dir('1000-1', 1), 'paint.png')).equals(PNG) && rec1.state === 'done' && rec1.model === 'qwen-image-2.0-pro' && rec1.size === '1280*1280' && rec1.ms === 1234 && rec1.prompt.includes('第 4 格:小猴脸红。'), JSON.stringify(rec1));
  check('只画画图卡(文字卡那格没有资产目录)', !existsSync(dir('1000-1', 0)) && asked.length === 1);
  await startPaints(ws, 'chinese-tutor', date, '1000-1', sec(['小熊播种。']), { draw: fakeDraw, now: () => now });
  check('已经有记录的不重画', asked.length === 1);
  await startPaints(ws, 'math-tutor', date, '1001-1', sec(['画不出']), { draw: fakeDraw, now: () => now });
  const rec2 = JSON.parse(readFileSync(join(root, 'conversations', 'math-tutor', `${date}.1001-1.cards`, '1', 'paint.json'), 'utf8')) as { state: string; error: string };
  check('没画成:记录 none + 原因,没有图', rec2.state === 'none' && rec2.error === 'http_400:DataInspectionFailed' && !existsSync(join(root, 'conversations', 'math-tutor', `${date}.1001-1.cards`, '1', 'paint.png')));
  check('今天画了几张:只数画好的(没画成的退回)', (await paintedToday(ws, date)) === 1);
  await startPaints(ws, 'chinese-tutor', date, '1002-1', sec(['第二张。']), { draw: fakeDraw, now: () => now });
  await startPaints(ws, 'chinese-tutor', date, '1003-1', sec(['第三张。']), { draw: fakeDraw, now: () => now });
  const rec4 = JSON.parse(readFileSync(join(dir('1003-1', 1), 'paint.json'), 'utf8')) as { state: string; error: string };
  check('一天的上限(各位老师加起来):第三张不画,记 daily:2/2', asked.length === 3 && rec4.state === 'none' && rec4.error === 'daily:2/2' && paintNote(rec4 as never).includes('今天画了 2 张'), JSON.stringify(rec4));
  check('明天重新数', (await paintedToday(ws, '2026-10-12')) === 0);
  await startPaints(ws, 'chinese-tutor', date, '1004-1', sec(['回放的。']), { draw: fakeDraw, now: () => now, replay: true });
  check('回放不画', asked.length === 3 && JSON.parse(readFileSync(join(dir('1004-1', 1), 'paint.json'), 'utf8')).error === 'replay');

  // 下发时补
  const at = now.toISOString();
  const kidDone = await enrichPaints(ws, 'chinese-tutor', date, '1000-1', at, sec(['小熊播种。']), { now: now.getTime() });
  const pd = kidDone.cards[1].props as { drawn?: string; pic?: string; note?: string };
  check('孩子端:画好了 → drawn done + pic(相对 workspace 根),没有 note', pd.drawn === 'done' && pd.pic === `conversations/chinese-tutor/${date}.1000-1.cards/1/paint.png` && pd.note === undefined && kidDone.cards[0].kind === 'text', JSON.stringify(pd));
  const parentDone = await enrichPaints(ws, 'chinese-tutor', date, '1000-1', at, sec(['小熊播种。']), { parent: true, now: now.getTime() });
  check('家长端:note 写模型与秒数', (parentDone.cards[1].props as { note?: string }).note === '画好了:qwen-image-2.0-pro,1 秒', JSON.stringify(parentDone.cards[1].props));
  const kidNone = (await enrichPaints(ws, 'chinese-tutor', date, '1003-1', at, sec(['x']), { now: now.getTime() })).cards[1].props as { drawn?: string; pic?: string };
  check('没画成 → drawn none,没有 pic', kidNone.drawn === 'none' && !kidNone.pic);
  const fresh = (await enrichPaints(ws, 'chinese-tutor', date, '1009-1', at, sec(['x']), { now: now.getTime() + 1000 })).cards[1].props as { drawn?: string };
  const old = (await enrichPaints(ws, 'chinese-tutor', date, '1009-1', at, sec(['x']), { now: now.getTime() + PAINT_STALE_MS + 1000 })).cards[1].props as { drawn?: string };
  check('还没记录:刚跑完 = drawing;过了五分钟还没有 = none', fresh.drawn === 'drawing' && old.drawn === 'none');
  // 告诉老师
  const l1 = await paintLines(ws, 'chinese-tutor', date, '1000-1', sec(['x']));
  const l2 = await paintLines(ws, 'chinese-tutor', date, '1003-1', sec(['x']));
  check('交给老师的一行:画好了(你看不到图,问孩子)/ 没画成', l1.length === 1 && l1[0].startsWith('1000-1/1 画图卡:画好了') && l1[0].includes('你看不到图') && l2[0].includes('没画成'), JSON.stringify([l1, l2]));
  writeFileSync(join(dir('1003-1', 1), 'paint.json'), JSON.stringify({ state: 'drawing', at, prompt: 'p', model: 'm' }));
  const stale = (await enrichPaints(ws, 'chinese-tutor', date, '1003-1', at, sec(['x']), { now: now.getTime() + PAINT_STALE_MS + 1000, parent: true })).cards[1].props as { drawn?: string; note?: string };
  check('「在画」五分钟还没落成(服务重起过)= none,家长端说清楚', stale.drawn === 'none' && stale.note === '没画成:画到一半服务重起了', JSON.stringify(stale));
  const plain: BoardSection = { cards: [{ kind: 'text', props: { text: 'x' } }], lines: [] } as unknown as BoardSection;
  check('没有画图卡的节原样返回', (await enrichPaints(ws, 'chinese-tutor', date, '1000-1', at, plain)) === plain);

}

// ---- 全流程:假老师出画图卡 → 后台画 → 孩子端看到图 → 下一条老师拿到「画好了」 ----
{
  const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
  const node = process.execPath;
  const { root } = await initWorkspace({ slug: 'flow', name: '小流', dir: join(home, 'ws-flow') });
  const cfgFile = join(root, 'cotutor.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
  cfg.runtimes = { default: 'fake', fake: { run: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '{prompt}'], resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] } };
  for (const t of Object.values((cfg as { tutors: Record<string, { runtime?: string }> }).tutors)) delete t.runtime; // 出厂语文老师走 qwen;测试都走假 CLI
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  let calls = 0;
  const now = new Date('2026-10-11T02:00:00Z');
  const ctx = createContext(loadWorkspace(root), { now: () => now, warm: false, draw: async ({ model }) => { calls++; return { ok: true, data: PNG, model, ms: 10 }; } });
  const sent = await route('POST', '/api/kid/conversations/chinese-tutor/messages', ctx, { text: '我说完了,画图吧' });
  check('发出去', sent.status === 202, JSON.stringify(sent.json));
  for (let i = 0; i < 100 && ctx.runner.running('chinese-tutor'); i++) await new Promise((r) => setTimeout(r, 50));
  await ctx.runner.flush();
  const date = '2026-10-11';
  const idx = await readIndex(ctx.ws, 'chinese-tutor', date);
  const m = idx.messages[0];
  const n = m.section?.cards.findIndex((c) => c.kind === 'paint') ?? -1;
  check('老师出了画图卡,后台画了一张', n >= 0 && calls === 1 && existsSync(join(root, 'conversations', 'chinese-tutor', `${date}.${m.job}.cards`, String(n), 'paint.png')), JSON.stringify(m.section?.cards.map((c) => c.kind)));
  const day = (await route('GET', '/api/kid/conversations/chinese-tutor/today', ctx)).json as { messages: { section?: BoardSection }[] };
  const kc = day.messages[0].section?.cards[n]?.props as { drawn?: string; pic?: string; note?: string; cast?: unknown } | undefined;
  check('孩子端:drawn done、pic,没有家长那行', kc?.drawn === 'done' && typeof kc.pic === 'string' && kc.note === undefined, JSON.stringify(kc));
  const img = await route('GET', `/api/kid/image?p=${encodeURIComponent(kc?.pic ?? '')}`, ctx);
  check('图经 /api/kid/image 取得到', img.status === 200 && img.contentType === 'image/png', JSON.stringify({ status: img.status }));
  const pday = (await route('GET', `/api/conversations/chinese-tutor/${date}/board`, ctx)).json as { messages: { section?: BoardSection }[] };
  check('家长端:多一行 note', (pday.messages[0].section?.cards[n]?.props as { note?: string }).note?.startsWith('画好了') === true, JSON.stringify(pday.messages[0].section?.cards[n]?.props));
  await route('POST', '/api/kid/conversations/chinese-tutor/messages', ctx, { text: '小猴没有脸红' });
  for (let i = 0; i < 100 && ctx.runner.running('chinese-tutor'); i++) await new Promise((r) => setTimeout(r, 50));
  await ctx.runner.flush();
  const idx2 = await readIndex(ctx.ws, 'chinese-tutor', date);
  const m2 = idx2.messages[1];
  check('下一条:上下文包的 cards 里告诉老师画好了;家长视图也记着', (m2.cards ?? []).some((c) => c.card === `${m.job}/${n}` && c.text.startsWith('画图卡:画好了')), JSON.stringify(m2.cards));
  check('这一条没有画图卡,不再画', calls === 1);
}

done();
