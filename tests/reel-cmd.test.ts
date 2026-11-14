/**
 * cotutor reel(src/app/cli/reel.ts):链接认哪几种、时间线怎么写。整条线(读真话题、截图)要真 workspace 与本机 Chrome,不进测试;
 * 2026-11-14 拿 Ray 的 1912-11 跑过:6 轮、24 张截图、50 秒。
 */
import { check, done } from './_check.ts';
import { formatReelReport, parseReelRef, type ReelReport } from '../src/app/cli/reel.ts';

const today = '2026-11-15';
const p1 = parseReelRef(['https://ray.local/parent?tutor=chinese-tutor&date=2026-11-14&thread=1912-11'], today);
check('家长端「复制链接」的链接', JSON.stringify(p1) === JSON.stringify({ tutor: 'chinese-tutor', thread: '1912-11', date: '2026-11-14' }), JSON.stringify(p1));
const p2 = parseReelRef(['/reel?tutor=math-tutor&date=today&thread=0900-1&end=1'], today);
check('孩子屏幕那页(/reel?…,date=today)', 'tutor' in p2 && p2.tutor === 'math-tutor' && p2.date === today && p2.thread === '0900-1', JSON.stringify(p2));
const p3 = parseReelRef(['chinese-tutor', '1833-9'], today);
check('老师 话题:日期缺省今天', 'tutor' in p3 && p3.date === today && p3.thread === '1833-9');
check('写错了回原因(main 报参数错):没参数、链接里没 thread、只给老师', ['error' in parseReelRef([], today), 'error' in parseReelRef(['https://x/parent?tutor=a'], today), 'error' in parseReelRef(['chinese-tutor'], today)].every(Boolean));

const T = Date.parse('2026-11-14T11:12:00Z');
const r: ReelReport = {
  ref: { tutor: 'chinese-tutor', date: '2026-11-14', thread: '1912-11' }, title: '语文老师 · 预习 · 2026-11-14 19:12', screen: [1133, 658], realtime: true,
  startAt: T, endAt: T + 95_000, rounds: 1, failed: 1,
  lines: [
    { at: T, ms: 0, round: 0, kind: 'board', text: '板上铺好:课本《a》目录' },
    { at: T + 2000, ms: 2000, round: 1, kind: 'kid', text: '孩子:「预习」', job: '1912-11', shot: '/tmp/s/01-0m03s.png' },
    { at: T + 92_000, ms: 92_000, round: 1, kind: 'error', text: '老师这一轮没成:api:HTTP 403', job: '1912-11' },
  ],
};
const text = formatReelReport(r);
check('时间线:头两行(屏幕、轮数、没成)、按轮分段、时刻是录像里的位置、截图跟在那一行下面', text.startsWith('语文老师 · 预习 · 2026-11-14 19:12 · 话题 1912-11\n孩子的屏幕 1133×658 · 实时老师 · 录像 1:35 · 孩子开口 1 次 · 1 轮没成') && text.includes('── 开口之前 ──\n 0:00  板上铺好') && text.includes('── 第 1 轮 ──\n 0:02  孩子:「预习」\n       截图 /tmp/s/01-0m03s.png\n 1:32  老师这一轮没成'), text);

done();
