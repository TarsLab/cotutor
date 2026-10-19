/**
 * `cotutor mock --live`(src/server/mock-live.ts):不花钱看实时老师页。首页接口里语文、数学老师 live;那条 WebSocket 是假嘴——
 * 松手接住、发消息给 mock 的老师(消息带 live)、写完一句一句念(静音的声音 + 到点的 read)、按下打断;不开 --live 不升级。
 */
import { check, done } from './_check.ts';

const { serveMock, createMock } = await import('../src/server/mock.ts');
const { MOCK_LIVE_SAID } = await import('../src/server/mock-live.ts');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 8000): Promise<boolean> => { const t = Date.now() + ms; while (!f() && Date.now() < t) await sleep(20); return f(); };
type Msg = Record<string, any>;

{
  const home = (await createMock({ delayMs: 0 }).route('GET', '/api/kid/home')).json as { tutors: { name: string; live: boolean }[] };
  check('不开 --live:首页接口里谁都不是实时的', home.tutors.length > 0 && home.tutors.every((t) => !t.live));
}

const r = await serveMock({ port: 0, http: true, live: true, delayMs: 60 });
const base = `127.0.0.1:${r.port}`;
try {
  const home = (await (await fetch(`http://${base}/api/kid/home`)).json()) as { tutors: { name: string; live: boolean }[] };
  check('--live:首页接口里语文、数学老师是实时的,别的不是', home.tutors.filter((t) => t.live).map((t) => t.name).sort().join() === 'chinese-tutor,math-tutor', JSON.stringify(home.tutors.map((t) => [t.name, t.live])));

  const ws = new WebSocket(`ws://${base}/api/live/chinese-tutor/ws`);
  ws.binaryType = 'arraybuffer';
  const msgs: Msg[] = [];
  let bins = 0;
  ws.onmessage = (e) => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data) as Msg); else bins++; };
  await new Promise((res) => { ws.onopen = res; ws.onerror = res; });
  check('连上:ready', await until(() => msgs.some((m) => m.t === 'ready')));

  ws.send(JSON.stringify({ t: 'hold' }));
  ws.send(new Uint8Array(3200));
  ws.send(JSON.stringify({ t: 'release', body: { newThread: true, device: 'tablet-landscape' } }));
  const okTurn = await until(() => msgs.some((m) => m.t === 'turn'));
  const turn = msgs.find((m) => m.t === 'turn')!;
  check('松手:先接住(字幕 + 声音)、孩子那句、脑开写', okTurn && msgs.some((m) => m.t === 'tutor' && m.of === 'catch') && msgs.some((m) => m.t === 'kid' && m.text === MOCK_LIVE_SAID) && bins >= 1 && turn.thread === turn.job, JSON.stringify(msgs.slice(0, 6)));
  const day = (await (await fetch(`http://${base}/api/kid/conversations/chinese-tutor/today`)).json()) as { messages: Msg[] };
  await r.mock.settleJob(turn.job);
  const day2 = (await (await fetch(`http://${base}/api/kid/conversations/chinese-tutor/today`)).json()) as { messages: Msg[] };
  const mine = day2.messages.find((m) => m.job === turn.job)!;
  const lines = (mine.section?.lines ?? []) as { text: string }[];
  const okRead = await until(() => msgs.filter((m) => m.t === 'read' && m.job === turn.job).length >= Math.min(1, lines.length), 4000);
  check('老师写完:消息带 live、孩子那句是按住说的;讲稿第一句到点发 read(字幕跟着)', day.messages.some((m) => m.job === turn.job) && mine.live === true && mine.question === MOCK_LIVE_SAID && lines.length > 0 && okRead && msgs.find((m) => m.t === 'read')!.line === 0, JSON.stringify({ live: mine.live, q: mine.question, lines: lines.length }));

  // 念着的时候按下:清了,这一轮没念的不再念
  const n0 = msgs.length;
  ws.send(JSON.stringify({ t: 'hold' }));
  const okFlush = await until(() => msgs.slice(n0).some((m) => m.t === 'flush'), 2000);
  const reads = msgs.filter((m) => m.t === 'read' && m.job === turn.job).length;
  await sleep(lines.reduce((n, l) => n + l.text.length * 250, 0) + 500);
  check('念着时按下:孩子端清播放队列、没念的不再念', okFlush && msgs.filter((m) => m.t === 'read' && m.job === turn.job).length === reads && reads < lines.length, JSON.stringify({ reads, lines: lines.length }));
  ws.send(JSON.stringify({ t: 'hush' }));

  // 卡上的「?」:问卡的接住
  const n1 = msgs.length;
  ws.send(JSON.stringify({ t: 'send', body: { text: '讲讲这张卡', focus: { card: `${turn.job}/0` }, ask: true, thread: turn.thread } }));
  check('卡上的「?」:问卡的接住、新一轮', await until(() => msgs.slice(n1).some((m) => m.t === 'tutor' && m.of === 'catch' && String(m.done).includes('这张卡')) && msgs.slice(n1).some((m) => m.t === 'turn')));
  ws.close();
} finally {
  r.server.close();
}
{
  const plain = await serveMock({ port: 0, http: true, delayMs: 0 });
  const ws = new WebSocket(`ws://127.0.0.1:${plain.port}/api/live/chinese-tutor/ws`);
  const refused = await new Promise<boolean>((res) => { ws.onopen = () => res(false); ws.onerror = () => res(true); ws.onclose = () => res(true); });
  check('不开 --live:那条 WebSocket 不升级', refused);
  plain.server.close();
}

done();
