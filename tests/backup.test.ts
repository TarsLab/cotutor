/**
 * 备份(src/app/cli/backup.ts):该进的进、录音和缓存不进;没变的文件不占第二份地方;留几份;磁盘快满不备;中途失败不留半份;
 * 恢复先备现在的、覆盖备份里有的、不删新多出来的、外面的 vault 不动;升级前自动备;doctor 看得出好久没备。
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-backup-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const b = await import('../src/app/cli/backup.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { doctorWorkspace } = await import('../src/app/cli/doctor.ts');
const { homeWorkspaces } = await import('../src/app/workspace.ts');

const FAR = 100 * 1024 ** 3;
const roomy = async (): Promise<number> => FAR;
const put = (p: string, text: string): void => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); };
const at = (s: string): Date => new Date(s);
const opts = (why: 'daily' | 'manual' | 'upgrade' | 'restore', when: string) => ({ why, version: '1.2.3', now: at(when), freeBytes: roomy });

const root = join(home, 'cotutor', 'ming');
put(join(root, 'cotutor.json'), '{"a":1}');
put(join(root, 'ledger', 'artifacts.jsonl'), '账本\n');
put(join(root, 'conversations', 'math-tutor', '2026-11-01.json'), '{"记录":1}');
put(join(root, 'conversations', 'math-tutor', '2026-11-01.j1.log'), '转录');
put(join(root, 'conversations', 'math-tutor', '2026-11-01.j1.wav'), 'x'.repeat(5000));
put(join(root, 'captures', '2026-11-01', 'p.jpg'), '照片');
put(join(root, 'agents', 'math-tutor.md'), '老师');
put(join(root, 'lectures', 'a.mp4'), 'x'.repeat(5000));
put(join(root, 'evals', 'e.json'), '评测');
put(join(root, '.git', 'HEAD'), 'ref');
put(join(root, '.cotutor', 'shipped.json'), '{}');
put(join(root, '.cotutor', 'devices.json'), '{}');
put(join(root, '.cotutor', 'kid-log', '2026-11-01.jsonl'), '流水');
put(join(root, '.cotutor', 'qwen', 'cache.bin'), '缓存');
put(join(root, '.cotutor', 'live-preview', 'v.wav'), '缓存');
mkdirSync(join(root, '.agents', 'skills'), { recursive: true });
put(join(root, '.agents', 'skills', 's.md'), '技能');
mkdirSync(join(root, '.claude'), { recursive: true });
symlinkSync(join(root, '.agents', 'skills'), join(root, '.claude', 'skills'), 'junction');

const dir = b.backupsOf(root);
check('放在 workspace 旁边,一个孩子一个目录', dir === join(home, 'cotutor', '.backups', 'ming'));
const first = await b.makeBackup({ root }, opts('daily', '2026-11-01T03:00:00'));
const one = join(dir, first.name);
const has = (rel: string, name = one): boolean => existsSync(join(name, ...rel.split('/')));
check('该进的都在:配置、账本、记录、转录、照片、老师、设备表、流水、技能', ['cotutor.json', 'ledger/artifacts.jsonl', 'conversations/math-tutor/2026-11-01.json', 'conversations/math-tutor/2026-11-01.j1.log', 'captures/2026-11-01/p.jpg', 'agents/math-tutor.md', '.cotutor/shipped.json', '.cotutor/devices.json', '.cotutor/kid-log/2026-11-01.jsonl', '.agents/skills/s.md'].every((f) => has(f)), readdirSync(one).join());
check('录音、视频课、评测、git、缓存不进', !has('conversations/math-tutor/2026-11-01.j1.wav') && !has('lectures/a.mp4') && !has('evals/e.json') && !has('.git/HEAD') && !has('.cotutor/qwen/cache.bin') && !has('.cotutor/live-preview/v.wav'));
check('链接不跟进去(.claude/skills 指回 workspace)', !has('.claude/skills/s.md'));
check('记下跳过了几个录音、版本、原因', first.audioSkipped === 1 && first.version === '1.2.3' && first.why === 'daily' && first.files >= 10, JSON.stringify(first));
check('没有临时目录留下', !readdirSync(dir).some((n) => n.startsWith('.tmp-')));

// ---- 第二份:没变的不占地方 ----
{
  writeFileSync(join(root, 'ledger', 'artifacts.jsonl'), '账本\n第二行\n');
  const second = await b.makeBackup({ root }, opts('daily', '2026-11-02T03:00:00'));
  const two = join(dir, second.name);
  check('没变的文件:和上一份是同一个文件(硬链接)', statSync(join(one, 'cotutor.json')).ino === statSync(join(two, 'cotutor.json')).ino);
  check('变了的文件:是新的,旧的那份不受影响', statSync(join(one, 'ledger', 'artifacts.jsonl')).ino !== statSync(join(two, 'ledger', 'artifacts.jsonl')).ino && readFileSync(join(one, 'ledger', 'artifacts.jsonl'), 'utf8') === '账本\n' && readFileSync(join(two, 'ledger', 'artifacts.jsonl'), 'utf8') === '账本\n第二行\n');
  check('新占的只算变了的那些', second.newBytes === Buffer.byteLength('账本\n第二行\n') && second.bytes > second.newBytes, JSON.stringify(second));
  check('不和 workspace 里的文件硬链接(workspace 里追加不会改到备份)', statSync(join(root, 'cotutor.json')).ino !== statSync(join(two, 'cotutor.json')).ino);
  check('文件时间留着(下次才比得出没变)', Math.abs(statSync(join(root, 'cotutor.json')).mtimeMs - statSync(join(two, 'cotutor.json')).mtimeMs) < 2);
  const list = await b.listBackups(root);
  check('列出来:新的在前', list[0].name === second.name && list[1].name === first.name);
  check('这一分钟备两次:名字不撞', (await b.makeBackup({ root }, opts('daily', '2026-11-02T03:00:00'))).name !== second.name);
}

// ---- 磁盘快满:不备,说清楚 ----
{
  const before = readdirSync(dir).length;
  let msg = '';
  try { await b.makeBackup({ root }, { why: 'manual', freeBytes: async () => 200 * 1024 ** 2 }); } catch (e) { msg = String(e); }
  check('磁盘快满:不备,说清楚,不留东西', msg.includes('磁盘只剩') && readdirSync(dir).length === before, msg);
}

// ---- 中途失败:不留半份 ----
if (process.platform !== 'win32' && process.getuid?.() !== 0) {
  const secret = join(root, 'agents', 'nope.md');
  put(secret, 'x');
  chmodSync(secret, 0);
  const before = readdirSync(dir).filter((n) => !n.startsWith('.')).length;
  let threw = false;
  try { await b.makeBackup({ root }, opts('manual', '2026-11-03T03:00:00')); } catch { threw = true; }
  check('中途读不了:报错,不留半份', threw && readdirSync(dir).filter((n) => !n.startsWith('.')).length === before && !readdirSync(dir).some((n) => n.startsWith('.tmp-')), readdirSync(dir).join());
  chmodSync(secret, 0o644);
  rmSync(secret);
}

// ---- 留几份 ----
{
  const r2 = join(home, 'cotutor', 'keep');
  put(join(r2, 'cotutor.json'), '{}');
  for (let d = 1; d <= 20; d++) await b.makeBackup({ root: r2 }, opts('daily', `2026-10-${String(d).padStart(2, '0')}T03:00:00`));
  for (let d = 1; d <= 8; d++) await b.makeBackup({ root: r2 }, opts('upgrade', `2026-09-${String(d).padStart(2, '0')}T03:00:00`));
  const list = await b.listBackups(r2);
  check('每天的留 14 份,升级前的留 5 份,留最新的', list.filter((x) => x.why === 'daily').length === 14 && list.filter((x) => x.why === 'upgrade').length === 5 && list.some((x) => x.at.startsWith(new Date(2026, 9, 20, 3).toISOString().slice(0, 10))) && !list.some((x) => x.name.startsWith('2026-10-01')), list.map((x) => x.name).join());
  check('该不该备今天的:20 小时内不备,没有就备;升级前那份不算', b.dailyDue([], Date.now()) && !b.dailyDue(list, Date.parse(list.find((x) => x.why === 'daily')!.at) + 3600_000) && b.dailyDue(list, Date.parse(list.find((x) => x.why === 'daily')!.at) + 21 * 3600_000) && b.dailyDue([{ ...list[0], why: 'upgrade' }], Date.parse(list[0].at) + 1000));
  check('~/cotutor/.backups 不会被当成一个孩子', homeWorkspaces(join(home, 'cotutor')).every((p) => !p.includes('.backups')), homeWorkspaces(join(home, 'cotutor')).join());
}

// ---- 外面的 vault:只拷 md;读不了不拦 ----
{
  const vault = join(home, 'vault');
  put(join(vault, '孩子.md'), '档案');
  put(join(vault, '日记', '2026-11-01.md'), '日记');
  put(join(vault, '附件', 'big.png'), 'x'.repeat(1000));
  put(join(vault, '.obsidian', 'app.md'), '设置');
  const m = await b.makeBackup({ root, vault }, opts('manual', '2026-11-04T03:00:00'));
  const d = join(dir, m.name);
  check('vault 在外面:md 进 _vault,附件和隐藏目录不进', m.vault === 'copied' && has('_vault/孩子.md', d) && has('_vault/日记/2026-11-01.md', d) && !has('_vault/附件/big.png', d) && !has('_vault/.obsidian/app.md', d), JSON.stringify(m));
  const gone = await b.makeBackup({ root, vault: join(home, 'no-such-vault') }, opts('manual', '2026-11-04T04:00:00'));
  check('vault 读不了(macOS 不让后台进程读文稿、vault 不在了):这一份照样成,记一笔', gone.vault === 'unreadable' && has('cotutor.json', join(dir, gone.name)));
  const inside = await b.makeBackup({ root, vault: root }, opts('manual', '2026-11-04T05:00:00'));
  check('vault 就在 workspace 里:不拷两份', inside.vault === 'inside' && !has('_vault', join(dir, inside.name)));
}

// ---- 恢复 ----
{
  const vault = join(home, 'vault');
  const r = join(home, 'cotutor', 'restore');
  put(join(r, 'cotutor.json'), '{"old":true}');
  put(join(r, 'agents', 'a.md'), '原来的老师');
  put(join(r, 'conversations', 't', 'old.wav'), '录音');
  const snap = await b.makeBackup({ root: r, vault }, opts('manual', '2026-11-05T03:00:00'));
  // 弄坏
  writeFileSync(join(r, 'cotutor.json'), '{"broken":true}');
  rmSync(join(r, 'agents', 'a.md'));
  put(join(r, 'conversations', 't', 'new.json'), '恢复之后不能丢的新记录');
  writeFileSync(join(vault, '孩子.md'), '家长后来改的档案');
  const res = await b.restoreBackup({ root: r, vault }, snap.name, { now: at('2026-11-06T03:00:00'), freeBytes: roomy });
  check('改坏的、删掉的:回来了', readFileSync(join(r, 'cotutor.json'), 'utf8') === '{"old":true}' && readFileSync(join(r, 'agents', 'a.md'), 'utf8') === '原来的老师');
  check('之后新多出来的:不删', readFileSync(join(r, 'conversations', 't', 'new.json'), 'utf8') === '恢复之后不能丢的新记录');
  check('录音不受影响', readFileSync(join(r, 'conversations', 't', 'old.wav'), 'utf8') === '录音');
  check('备份自己的说明文件不进 workspace', !existsSync(join(r, 'backup.json')));
  check('外面的 vault 不动,告诉家长那一份在哪', readFileSync(join(vault, '孩子.md'), 'utf8') === '家长后来改的档案' && res.vaultCopy === join(b.backupsOf(r), snap.name, '_vault') && readFileSync(join(res.vaultCopy, '孩子.md'), 'utf8') === '档案');
  const safety = (await b.listBackups(r)).find((x) => x.name === res.safety);
  check('恢复前的样子也留了一份,恢复错了能回来', safety?.why === 'restore' && readFileSync(join(b.backupsOf(r), res.safety, 'cotutor.json'), 'utf8') === '{"broken":true}');
  // 恢复不能把备份改了:拷出去,不是链回来
  writeFileSync(join(r, 'cotutor.json'), '{"after":true}');
  check('恢复后再改 workspace:备份不受影响', readFileSync(join(b.backupsOf(r), snap.name, 'cotutor.json'), 'utf8') === '{"old":true}');
  let msg = '';
  try { await b.restoreBackup({ root: r }, '../../etc', { freeBytes: roomy }); } catch (e) { msg = String(e); }
  check('不是列出来的备份:不认(名字不能拼路径)', msg.includes('没有这份备份'), msg);
}

// ---- 定时 ----
{
  const r = join(home, 'cotutor', 'timer');
  put(join(r, 'cotutor.json'), '{}');
  let busy = true;
  const notes: string[] = [];
  const stop = b.startDailyBackups({ target: () => ({ root: r }), busy: () => busy, version: '1', firstMs: 5, everyMs: 30, freeBytes: roomy, note: (t) => notes.push(t) });
  await new Promise((res) => setTimeout(res, 60));
  check('孩子在通话:往后推', (await b.listBackups(r)).length === 0);
  busy = false;
  await new Promise((res) => setTimeout(res, 120));
  const made = await b.listBackups(r);
  check('通话完了:备一份,不重复备', made.length === 1 && made[0].why === 'daily', made.map((x) => x.name).join());
  stop();
  const noted: string[] = [];
  const s2 = join(home, 'cotutor', 'timer2');
  put(join(s2, 'cotutor.json'), '{}');
  const stop2 = b.startDailyBackups({ target: () => ({ root: s2 }), busy: () => false, version: '1', firstMs: 5, everyMs: 10000, freeBytes: async () => 1, note: (t) => noted.push(t) });
  await new Promise((res) => setTimeout(res, 60));
  stop2();
  check('备份失败:不抛(服务不能被它带倒),进日志', noted.length === 1 && noted[0].includes('磁盘只剩'), noted.join());
  const stop3 = b.startDailyBackups({ target: () => null, busy: () => false, version: '1', firstMs: 5, everyMs: 10000 });
  await new Promise((res) => setTimeout(res, 30));
  stop3();
}

// ---- doctor ----
{
  const { root: ws } = await initWorkspace({ slug: 'docback', name: '测' });
  const by = async (now?: Date) => (await doctorWorkspace(ws, { probeEnv: true, firewall: false, now })).checks.find((c) => c.name === 'backup');
  const none = await by();
  check('doctor:还没备份 → 不算错,能自动修', none?.ok === false && none.required === false && (none.cmd ?? '').startsWith('cotutor backup'), JSON.stringify(none));
  await b.makeBackup({ root: ws }, { why: 'manual', freeBytes: roomy });
  check('doctor:刚备过 → 过', (await by())?.ok === true);
  check('doctor:好几天没备 → 提醒', (await by(new Date(Date.now() + 4 * 24 * 3600_000)))?.ok === false);
}

// ---- 时间不对时不把文件当没变 ----
{
  const r = join(home, 'cotutor', 'mtime');
  const f = join(r, 'cotutor.json');
  put(f, 'aaaa');
  await b.makeBackup({ root: r }, opts('manual', '2026-11-07T01:00:00'));
  writeFileSync(f, 'bbbb');
  utimesSync(f, new Date(2020, 0, 1), new Date(2020, 0, 1));
  const m = await b.makeBackup({ root: r }, opts('manual', '2026-11-07T02:00:00'));
  check('一样大但时间不同:算变了,拷新的', readFileSync(join(b.backupsOf(r), m.name, 'cotutor.json'), 'utf8') === 'bbbb');
}

done();
