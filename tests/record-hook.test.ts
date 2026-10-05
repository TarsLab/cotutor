/**
 * 录音卡的评测接线(《口播老师设计.md》§4–5,假老师 + 假 koubo,不花钱):
 * PUT data:audio → 落 .cards/<n>/rec-<k>.<ext>、状态换路径 → 后台起 koubo card(模板占位、cwd = workspace 根)→ heard.json 落在录音旁边;
 * 孩子端 JSON 里只有 {audio, seconds},没有判;交给老师时 cards: 那一行接上判 / 还没评完,晚到的照样落盘;
 * 单测 runKoubo 与队列:超时、cost_limit、JSON 坏、koubo 不在、服务重启后现起补跑、回放不起新的。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-record-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { KouboQueue, readHeard, runKoubo } = await import('../src/server/koubo.ts');
const { parseTranscript } = await import('../src/lib/transcript.ts');

const node = process.execPath;
const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const FAKE_KOUBO = fileURLToPath(new URL('./_fake-koubo.ts', import.meta.url));
const koubo = [node, '--experimental-strip-types', '--no-warnings', FAKE_KOUBO, 'card', '--audio', '{audio}', '--text', '{text}', '--mode', '{mode}', '--pairs', '{pairs}', '--json'];
const LOG = join(home, 'koubo.log');
const env = { ...process.env, FAKE_KOUBO_LOG: LOG };

const { root } = await initWorkspace({ slug: 'jack', name: 'Jack' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
cfg.runtimes = { default: 'fake', fake: { run: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '{prompt}'], resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] } };
cfg.tutors['koubo-tutor'].enabled = true;
cfg.koubo = { card: koubo, timeoutMs: 1500 };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const now = new Date('2026-09-26T16:20:00');
const ctx = createContext(loadWorkspace(root), { now: () => now, env });
const wait = async (): Promise<void> => {
  for (let i = 0; i < 400 && ctx.runner.running('koubo-tutor'); i++) await new Promise((r) => setTimeout(r, 25));
};
type Card = { kind: string; props: Record<string, unknown>; state?: Record<string, unknown>; assets?: string[] };
type KidDay = { messages: { job: string; section: { cards: Card[] } | null }[] };
const kidDay = async () => (await route('GET', '/api/kid/conversations/koubo-tutor/today', ctx)).json as KidDay;
const audio = (tag: string) => 'data:audio/webm;codecs=opus;base64,' + Buffer.from(tag).toString('base64');

try {
  // ---- 老师出一节三张录音卡 ----
  const r1 = await route('POST', '/api/kid/conversations/koubo-tutor/messages', ctx, { text: '出录音卡' });
  check('发给口播老师 202', r1.status === 202, JSON.stringify(r1.json));
  await wait();
  const d1 = await kidDay();
  const job = d1.messages[0].job;
  const cards = d1.messages[0].section!.cards;
  const [a, b, c] = cards.map((x, i) => (x.kind === 'record' ? i : -1)).filter((i) => i >= 0);
  check('一节三张录音卡', [a, b, c].every((i) => typeof i === 'number') && cards[c].props.mode === 'pinyin', JSON.stringify(cards.map((x) => x.kind)));

  // ---- 存录音 → 落盘、状态换路径、后台评 ----
  const pa = await route('PUT', `/api/kid/conversations/koubo-tutor/cards/${job}/${a}`, ctx, { audio: audio('A'), seconds: 7.1 });
  const sa = (pa.json as { state: { audio: string; seconds: number } }).state;
  check('PUT 录音 200,状态是资产目录下的路径', pa.status === 200 && sa.audio === `conversations/koubo-tutor/2026-09-26.${job}.cards/${a}/rec-1.webm` && sa.seconds === 7.1, JSON.stringify(pa.json));
  check('录音落盘', readFileSync(join(root, sa.audio), 'utf8') === 'A');
  await ctx.runner.flush();
  const ha = await readHeard(join(root, sa.audio));
  check('后台评完,heard.json 在录音旁边(重录、原因、take、逐字)', ha?.ok === true && ha.verdict === '重录' && ha.take.includes('rec1webm') && ha.chars[0].readAs === 's', JSON.stringify(ha));
  const calls = readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { cwd: string; args: string[] });
  check('koubo 模板:audio 绝对路径、text 剥了【】、mode 1、pairs = focus;cwd 是 workspace 根', calls[0].cwd === root && calls[0].args.join(' ') === `card --audio ${join(root, sa.audio)} --text 老师上山看树 --mode 1 --pairs sh_s --json`, JSON.stringify(calls[0]));

  const pc = await route('PUT', `/api/kid/conversations/koubo-tutor/cards/${job}/${c}`, ctx, { audio: audio('C'), seconds: 2.4 });
  await ctx.runner.flush();
  const call2 = readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args: string[] })[1];
  check('拼音题:mode 8、没写 focus 是 auto', pc.status === 200 && call2.args.includes('8') && call2.args.at(-2) === 'auto', JSON.stringify(call2));

  // ---- 孩子端拿不到判 ----
  const d2 = await kidDay();
  const ka = d2.messages[0].section!.cards[a];
  check('孩子端:状态只有 audio / seconds,没有判;录音不当资产下发', JSON.stringify(Object.keys(ka.state ?? {}).sort()) === '["audio","seconds"]' && !(ka.assets ?? []).some((x) => x.includes('rec-')) && !JSON.stringify(d2).includes('重录'), JSON.stringify(ka));
  const back = await route('GET', `/api/audio/koubo-tutor/${sa.audio.replace('conversations/koubo-tutor/', '')}`, ctx);
  check('回放:/api/audio 取得回,content-type 是 webm', back.status === 200 && back.contentType === 'audio/webm');
  check('坏录音:不是 audio 的 data → 400', (await route('PUT', `/api/kid/conversations/koubo-tutor/cards/${job}/${b}`, ctx, { audio: 'data:text/plain;base64,eA==', seconds: 1 })).status === 400);

  // ---- 「慢」那句刚存就交:等到存录音之后 1.5 秒还没好 → 还没评完;晚到的照样落盘 ----
  const pb = await route('PUT', `/api/kid/conversations/koubo-tutor/cards/${job}/${b}`, ctx, { audio: audio('B'), seconds: 3 });
  const sb = (pb.json as { state: { audio: string } }).state;
  const sub = await route('POST', '/api/kid/conversations/koubo-tutor/messages', ctx, { text: '', action: 'submit', focus: { card: `${job}/${b}` } });
  check('交给老师 202', sub.status === 202, JSON.stringify(sub.json));
  await wait();
  const idx = (await route('GET', '/api/conversations/koubo-tutor/2026-09-26', ctx)).json as { index: { messages: { job: string; cards?: { card: string; text: string }[] }[] } };
  const lines = idx.index.messages[1].cards ?? [];
  const line = (n: number) => lines.find((l) => l.card === `${job}/${n}`)?.text ?? '';
  check('cards: 重录那张接上判、原因、take', line(a) === `record「老师上山看树」 已录 7.1 秒;判 重录:句准确度 36 < 80;山 的 sh 19 < 65,读成 s;pairs=sh_s;take=${ha?.ok ? ha.take : ''}`, line(a));
  check('cards: 拼音题过了,只写判与 take', /^record「十四」 已录 2\.4 秒;判 过;take=\S+$/.test(line(c)), line(c));
  check('cards: 刚存就交、还在评 → 还没评完', line(b) === 'record「慢慢读这一句」 已录 3.0 秒;还没评完', line(b));
  const said = parseTranscript(readFileSync(join(root, 'conversations', 'koubo-tutor', `2026-09-26.${idx.index.messages[1].job}.log`), 'utf8')).final?.text ?? '';
  check('老师收到的就是这三行(假 CLI 把 cards: 段原样回显)', said.includes(line(a)) && said.includes(line(b)) && said.includes(line(c)), said);
  await ctx.runner.flush();
  const hb = await readHeard(join(root, sb.audio));
  check('晚到的结果照样落盘(超时 → 没评上)', hb?.ok === false && hb.error === 'timeout', JSON.stringify(hb));

  // ---- 家长端:录音卡带评测全量(旁注从 heard.json 来);清单上有当天 koubo 花了多少 ----
  const pb2 = (await route('GET', '/api/conversations/koubo-tutor/2026-09-26/board', ctx)).json as { messages: { section?: { cards: (Card & { heard?: { ok: boolean; verdict?: string; chars?: unknown[] } })[] } }[] };
  const pa2 = pb2.messages[0].section!.cards[a];
  check('家长端:录音卡带 heard(判、逐字分);超时那张是没评上', pa2.heard?.ok === true && pa2.heard.verdict === '重录' && (pa2.heard.chars?.length ?? 0) > 0 && pb2.messages[0].section!.cards[b].heard?.ok === false, JSON.stringify(pa2));
  check('孩子端同一张卡没有 heard', !('heard' in (await kidDay()).messages[0].section!.cards[a]));
  const ov = (await route('GET', '/api/overview/2026-09-26', ctx)).json as { tutors: { name: string; kouboYuan?: number }[] };
  check('清单:koubo 花费 = 当天 heard 的 costYuan 加总(两条各 0.02,超时的不算)', ov.tutors.find((t) => t.name === 'koubo-tutor')?.kouboYuan === 0.04 && ov.tutors.every((t) => t.name === 'koubo-tutor' || t.kouboYuan === undefined), JSON.stringify(ov.tutors.map((t) => [t.name, t.kouboYuan])));

  // ---- runKoubo 与队列的单测 ----
  const kcfg = { card: koubo, timeoutMs: 1500 };
  const f = (name: string, body: string) => { const p = join(home, name); writeFileSync(p, body); return p; };
  const props = (text: string) => ({ text, mode: 'sentence' as const });
  const cost = await runKoubo(home, kcfg, f('m.webm', 'x'), props('花钱的一句'), env);
  check('koubo exit 1 + stderr 的 error → 没评上(cost_limit)', cost.ok === false && cost.error === 'cost_limit', JSON.stringify(cost));
  const bad = await runKoubo(home, kcfg, f('j.webm', 'x'), props('乱七八糟'), env);
  check('stdout 不是 JSON → bad_json', bad.ok === false && bad.error === 'bad_json', JSON.stringify(bad));
  const none = await runKoubo(home, { card: ['.cotutor/没有这个', 'card'], timeoutMs: 1500 }, f('n.webm', 'x'), props('一句'), env);
  check('koubo 不在(相对路径按 workspace 根找)→ 没评上', none.ok === false && none.error === 'koubo 不在', JSON.stringify(none));
  const slow = await runKoubo(home, { card: koubo, timeoutMs: 400 }, f('s.webm', 'x'), props('慢'), env);
  check('超时 → timeout', slow.ok === false && slow.error === 'timeout', JSON.stringify(slow));
  const q2 = new KouboQueue(env);
  const lost = f('lost.webm', 'x');
  check('回放:没有 heard 不起新的', (await q2.take(home, kcfg, lost, props('一句'), { noStart: true })) === undefined && !existsSync(lost.replace('.webm', '.heard.json')));
  const caught = await q2.take(home, kcfg, lost, props('一句'));
  check('服务重启过(队列里没有、也没 heard)→ 交的时候现起再等', typeof caught === 'object' && caught.ok === true && existsSync(lost.replace('.webm', '.heard.json')), JSON.stringify(caught));
} finally {
  await ctx.runner.flush();
}
done();
