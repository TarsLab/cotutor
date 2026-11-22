/**
 * 听写「选一课」:课本书后的词语表、写字表怎么读成一课一行(src/memory/textbook-words.ts),和 /api/dictation/book、
 * POST /api/dictation {book} 照书上的词开一次听写、再写一遍里描红那遍不算再写(src/app/dictation/route.ts)。
 * 书是这里造的几页(排法照人教统编语文二上的书后表,2026-11-22 量的字距;字是编的);真书走 scripts/probe-dictation.mjs 前手动看一遍。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import type { BookIndex, BookLesson, BookLine, BookPage } from '../src/schema/index.ts';

const { bookWordTables, charSay, lessonOfRow } = await import('../src/memory/textbook-words.ts');
const { handleDictation } = await import('../src/app/dictation/route.ts');
type Deps = Parameters<typeof handleDictation>[2];

/** 一行:words 是一组一组挨着的字,组和组之间空 gap;lead = 行首的编号(和第一组之间空 lead 那么多) */
function line(y: number, x: number, z: number, words: string[], gap = z, lead?: string): BookLine {
  const chars: BookLine['chars'] = [];
  let cx = x;
  if (lead) { for (const c of lead) { chars.push({ c, x1: cx, x2: cx + z / 2 }); cx += z / 2; } cx += z * 0.8; }
  words.forEach((w, k) => {
    if (k) cx += gap;
    for (const c of w) { chars.push({ c, x1: cx, x2: cx + z }); cx += z; }
  });
  return { text: chars.map((c) => c.c).join(''), x1: x, x2: cx, y1: y - z, y2: y, z, f: 'f', chars };
}
const page = (n: number, printed: number, lines: BookLine[]): BookPage => ({ n, printed, w: 520, h: 736, lines });
const lesson = (title: string, unit: string | null, no: string | null, kind: BookLesson['kind'], pages: [number, number]): BookLesson => ({ title, unit, no, kind, from: pages[0] - 1, to: pages[1] - 1, pages });

const ix: BookIndex = {
  v: 5, file: '语文二年级上册.pdf', sha: 'x', title: '语文二年级上册', layout: 'prose', toc: [1], problems: [],
  lessons: [
    lesson('小鱼吹泡泡', '第一单元·阅读', '1', 'lesson', [2, 3]),
    lesson('古诗两首', '第一单元·阅读', '2', 'lesson', [4, 5]),
    lesson('语文园地一', null, null, 'garden', [6, 7]),
    lesson('场景歌', '第二单元·识字', '1', 'lesson', [8, 9]),
    lesson('写字表', null, null, 'other', [20, 20]),
    lesson('词语表', null, null, 'other', [21, 22]),
  ],
  pages: [
    page(20, 19, [
      line(40, 200, 24, ['写字表'], 0),
      line(80, 86, 14, ['阅读'], 0),
      line(110, 86, 18, ['两', '条', '哪', '宽'], 9, '1'),
      line(140, 86, 18, ['如', '果', '已'], 9, '2'),
      // 园地的字印在「语文园地一」右边,行高一点,读出来在它前面
      line(168, 172, 18, ['转', '夹'], 9),
      line(166, 91, 12, ['语文园地一'], 0),
      line(200, 86, 14, ['识字'], 0),
      line(230, 86, 18, ['处', '块'], 9, '1'),
      line(700, 250, 12, ['19'], 0),
    ]),
    page(21, 20, [
      line(40, 200, 24, ['词语表'], 0),
      line(80, 64, 14, ['阅读'], 0),
      line(110, 64, 16, ['妈妈', '他们', '四海为家'], 16, '1'),
      // 一行放不下:接着的一行缩进、没有编号
      line(140, 88, 16, ['过去', '孩子']),
      line(170, 64, 16, ['如果', '已经'], 16, '2'),
    ]),
    page(22, 21, [
      line(80, 64, 14, ['识字'], 0),
      line(110, 64, 16, ['花园', '飞鸟', '红领巾'], 16, '1'),
      line(140, 200, 14, ['（共10个词）'], 0),
      line(700, 250, 12, ['21'], 0),
    ]),
  ],
};

const t = bookWordTables(ix);
check('词语表:一课一行,编号照栏各自起;接着的一行并进上一课;词照字距切(四海为家是一个词)', t.ci?.title === '词语表' && t.ci.printed === 20 && t.ci.rows.map((r) => `${r.key}:${r.words.join(' ')}`).join('|') === '阅读1:妈妈 他们 四海为家 过去 孩子|阅读2:如果 已经|识字1:花园 飞鸟 红领巾', JSON.stringify(t.ci?.rows));
check('词语表:课名对上目录(阅读 1 是小鱼吹泡泡,识字 1 是场景歌);页码、「(共…)」不进来', t.ci?.rows.map((r) => r.lesson).join() === '小鱼吹泡泡,古诗两首,场景歌');
check('写字表:一个字一项;园地的字和它同一排(读出来在它前面也认得),不并进上一课', t.zi?.rows.map((r) => `${r.key}:${r.words.join('')}`).join('|') === '阅读1:两条哪宽|阅读2:如果已|语文园地一:转夹|识字1:处块' && t.zi.rows[2].garden === true, JSON.stringify(t.zi?.rows));
check('栏 + 编号找课:单元名里带这个栏的那一课', lessonOfRow(ix.lessons, '识字', '1')?.title === '场景歌' && lessonOfRow(ix.lessons, '阅读', '1')?.title === '小鱼吹泡泡' && lessonOfRow(ix.lessons, null, '9') === null);
check('写字表的字怎么念:同一课词语表里带它的词;没有就别的课;都没有不写', charSay('如', t.ci, '阅读2') === '如,如果的如' && charSay('孩', t.ci, '阅读2') === '孩,孩子的孩' && charSay('夹', t.ci, '语文园地一') === undefined);
check('书后没有这两张表:两样都是 null', JSON.stringify(bookWordTables({ ...ix, lessons: ix.lessons.filter((l) => l.kind !== 'other') })) === '{"ci":null,"zi":null}');

// ---- 接口 ----
const root = mkdtempSync(join(tmpdir(), 'cotutor-dict-book-'));
let hasBook = true;
const deps: Deps = {
  root, now: () => new Date(2026, 10, 22, 19, 30),
  card: async () => null,
  reader: (x) => x ?? 'chinese-tutor',
  display: () => '语文老师', face: () => null, say: async () => null, voiced: () => true, medians: async () => null,
  recognize: async () => ({ ok: false, items: [], lesson: null, full: [], ms: 0, error: 'no' }) as never,
  book: async (tutor) => (hasBook && tutor === 'chinese-tutor' ? { title: ix.title, tables: t, last: '阅读2' } : null),
};
type J = Record<string, any>;
const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: J }> => {
  const r = await handleDictation(method, new URL('http://x' + path), deps, body);
  return { status: r?.status ?? 0, json: (r as { json?: J })?.json ?? {} };
};

const g = await call('GET', '/api/dictation/book?tutor=chinese-tutor');
check('GET book:册名、两张表、上次翻到的那一行', g.status === 200 && g.json.book === ix.title && g.json.last === '阅读2' && g.json.ci.rows.length === 3 && g.json.zi.rows.length === 4);
hasBook = false;
check('没有课本:{book: null}(页面直接拍照)', (await call('GET', '/api/dictation/book?tutor=chinese-tutor')).json.book === null);
hasBook = true;

const s1 = await call('POST', '/api/dictation', { book: { table: 'ci', key: '阅读1', skip: [1] }, tutor: 'chinese-tutor' });
check('照书上开一次:词是服务端从表里现读的,划掉的不写;课名、哪张表哪一行记下来;交卷前孩子端拿不到字', s1.status === 201 && JSON.stringify(s1.json.sizes) === '[2,4,2,2]' && s1.json.lesson === '小鱼吹泡泡' && s1.json.book.key === '阅读1' && s1.json.book.printed === 20 && !JSON.stringify(s1.json).includes('妈妈'), JSON.stringify(s1.json));
const s2 = await call('POST', '/api/dictation', { book: { table: 'zi', key: '阅读2' }, tutor: 'chinese-tutor' });
const full2 = await call('GET', `/api/dictation/${s2.json.id}`);
check('写字表开一次:一个字一个词,念法带上词', s2.status === 201 && full2.json.words.map((w: J) => w.chars + '/' + (w.say ?? '')).join(' ') === '如/如,如果的如 果/果,如果的果 已/已,已经的已');
check('表里没有这一行 404;全划掉 400', (await call('POST', '/api/dictation', { book: { table: 'ci', key: '阅读9' } })).status === 404 && (await call('POST', '/api/dictation', { book: { table: 'ci', key: '阅读2', skip: [0, 1] } })).status === 400);

// 再写一遍:描红那遍(trace)不算再写,对一对看的是没描红的那遍
const id = s2.json.id;
const one = { chars: [{ strokes: [[[100, 100, 1], [200, 200, 2]]], undos: 0 }] };
for (let i = 0; i < 3; i++) await call('PUT', `/api/dictation/${id}/first/${i}`, one);
await call('POST', `/api/dictation/${id}/check`);
const tr = await call('POST', `/api/dictation/${id}/rewrites/0`, { ...one, chars: [{ strokes: [[[300, 300, 5], [310, 310, 6]]], undos: 0 }], trace: true });
const a0 = tr.json.answers[0];
check('描红那遍:traced 有笔、不算再写(rewrote false),ink 还是第一遍', tr.status === 200 && a0.traced?.[0]?.[0]?.[0]?.[0] === 300 && a0.rewrote === false && a0.ink[0][0][0][0] === 100 && a0.first[0][0][0][0] === 100);
const fr = await call('POST', `/api/dictation/${id}/rewrites/0`, { chars: [{ strokes: [[[500, 500, 9], [510, 510, 10]]], undos: 0 }], self: true });
const b0 = fr.json.answers[0];
check('自己写的那遍:算再写,ink 换成它;first 还是第一遍', b0.rewrote === true && b0.ink[0][0][0][0] === 500 && b0.first[0][0][0][0] === 100);
const list = await call('GET', '/api/dictation');
const row = list.json.sessions.find((x: J) => x.id === id);
check('家长的列表:带课本那一行;描红不算「又写过」', row.book?.key === '阅读2' && row.lesson === '古诗两首');

done();
