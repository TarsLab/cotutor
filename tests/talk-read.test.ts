/**
 * 跟我读不用按(src/talk/lib/read-flow.ts,《口语课设计.md》§8.1):响度判开口 / 停、读到了多少、一句的状态机。纯函数,不起服务。
 */
import { check, done } from './_check.ts';

const { READ_RULES, coverage, readInit, readLeft, readStep, vadInit, vadStep, wordsOf } = await import('../src/talk/lib/read-flow.ts');
type Vad = ReturnType<typeof vadInit>;
type St = ReturnType<typeof readInit>;

// ---- 开口 / 停 ----
{
  const feed = (levels: number[], v: Vad = vadInit()): { v: Vad; evs: string[] } => {
    const evs: string[] = [];
    for (const [i, l] of levels.entries()) { const r = vadStep(v, l, 100, 900); v = r.v; if (r.ev) evs.push(`${r.ev}@${i}`); }
    return { v, evs };
  };
  check('静的不开口;一下响(100 毫秒)不算', feed(Array(20).fill(0.002)).evs.length === 0 && feed([0.002, 0.2, 0.002, 0.002]).evs.length === 0);
  const a = feed([0.002, 0.1, 0.1, 0.1, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002]);
  check('响 200 毫秒算开口;静 900 毫秒算停', a.evs.join(' ') === 'start@2 stop@12', a.evs.join(' '));
  const b = feed([0.1, 0.1, 0.1, 0.002, 0.002, 0.002, 0.002, 0.1, 0.1, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002]);
  check('句中停 400 毫秒不算停(It\'s a… red car)', b.evs.join(' ') === 'start@1 stop@17', b.evs.join(' '));
  // 底噪高(风扇):门限跟着抬,底噪本身不算开口;比底噪响得多的才算
  const noisy = feed(Array(40).fill(0.012));
  check('底噪 0.012 不算开口,门限跟上去', noisy.evs.length === 0 && noisy.v.floor > 0.008, String(noisy.v.floor));
  const over = feed([0.1, 0.1, 0.1], noisy.v);
  check('底噪之上响得多的照样开口', over.evs[0] === 'start@1', over.evs.join(' '));
}

// ---- 读到了多少 ----
{
  check('wordsOf:小写、去标点、展开缩写', wordsOf("It's a RED car!").join(' ') === 'it is a red car' && wordsOf('I’m Ray.').join(' ') === 'i am ray');
  check('coverage:单词', coverage('red', 'Red!') === 1 && coverage('red', 'bread') === 0 && coverage('apple', 'apples') === 1 && coverage('colour', 'color') === 1);
  check('coverage:句子按词、不分先后、缩写两种写法一样', coverage("It's a red car.", 'it is a red car') === 1 && coverage("It's a red car.", 'red car') === 2 / 5 && coverage("It's a red car.", "it's a red") === 4 / 5);
  check('coverage:短词差一个字母不算(car / cat)、空的是 0', coverage('car', 'cat') === 0 && coverage('', 'x') === 0 && coverage('red', '') === 0);
}

// ---- 一句的状态机 ----
{
  const R = READ_RULES;
  const run = (evs: Parameters<typeof readStep>[1][], s: St = readInit()): { s: St; acts: string[] } => {
    const acts: string[] = [];
    for (const e of evs) { const r = readStep(s, e, R); s = r.s; if (r.act) acts.push(r.act); }
    return { s, acts };
  };
  const target = 'red';
  const ok = run([{ e: 'cue', t: 0, fresh: true }, { e: 'idle', t: 1000 }, { e: 'start', t: 2000 }, { e: 'stop', t: 2600 }, { e: 'text', t: 2900, text: 'Red!', target }]);
  check('老师读完 → 等 → 开口 → 停了 commit → 读到了 → next', ok.acts.join(' ') === 'commit next' && ok.s.mode === 'tutor', ok.acts.join(' '));
  check('老师还在读时开口不理(声音没放完)', run([{ e: 'cue', t: 0, fresh: true }, { e: 'start', t: 100 }, { e: 'stop', t: 900 }]).acts.length === 0);
  const quiet = run([{ e: 'cue', t: 0, fresh: true }, { e: 'idle', t: 1000 }, { e: 'tick', t: 5999 }, { e: 'tick', t: 6000 }]);
  check('等 5 秒没开口 → 再读一遍(自动的记一次)', quiet.acts.join(' ') === 'again' && quiet.s.again === 1 && quiet.s.mode === 'tutor', JSON.stringify(quiet.s));
  check('等着时离再读还有多久;老师在读时没有', readLeft({ mode: 'listen', since: 1000, again: 0 }, 3000, R) === 3000 && readLeft({ mode: 'tutor', since: 0, again: 0 }, 3000, R) === null);
  const twice = run([{ e: 'idle', t: 1000 }, { e: 'tick', t: 6000 }, { e: 'cue', t: 6000, fresh: false }, { e: 'idle', t: 7000 }, { e: 'tick', t: 12000 }, { e: 'cue', t: 12000, fresh: false }, { e: 'idle', t: 13000 }, { e: 'tick', t: 18000 }, { e: 'tick', t: 60000 }]);
  check('再读两遍还不出声 → 不再催,等着(wait),没有倒计时', twice.acts.join(' ') === 'again again' && twice.s.mode === 'wait' && readLeft(twice.s, 60000, R) === null, JSON.stringify(twice));
  const late = run([{ e: 'start', t: 70000 }, { e: 'stop', t: 71000 }, { e: 'text', t: 71200, text: 'red', target }], twice.s);
  check('等着的时候开口照样走', late.acts.join(' ') === 'commit next');
  const off = run([{ e: 'idle', t: 0 }, { e: 'start', t: 100 }, { e: 'stop', t: 900 }, { e: 'text', t: 1000, text: '我不会', target }]);
  check('读的跟这句不沾 → 老师再读一遍(记一次)', off.acts.join(' ') === 'commit again' && off.s.again === 1);
  const half = run([{ e: 'idle', t: 0 }, { e: 'start', t: 100 }, { e: 'stop', t: 900 }, { e: 'text', t: 1000, text: 'red car', target: "It's a red car." }]);
  check('读了不到一半 → 老师再读一遍(不另等,《口语课设想》§8.5 待定 2 定了不要)', half.acts.join(' ') === 'commit again');
  const used = run([{ e: 'idle', t: 0 }, { e: 'start', t: 100 }, { e: 'stop', t: 900 }, { e: 'text', t: 1000, text: 'hello', target }], { mode: 'tutor', since: 0, again: 2 });
  check('自动再读用完了还不沾 → 往下走(不卡在一句上)', used.acts.join(' ') === 'commit next');
  const blank = run([{ e: 'idle', t: 0 }, { e: 'start', t: 100 }, { e: 'stop', t: 900 }, { e: 'text', t: 1000, text: '  ', target }]);
  check('转写是空的(咳嗽、碰桌子)→ 接着等,不算一次', blank.acts.join(' ') === 'commit' && blank.s.mode === 'listen' && blank.s.again === 0 && blank.s.since === 1000);
  const lost = run([{ e: 'idle', t: 0 }, { e: 'start', t: 100 }, { e: 'stop', t: 900 }, { e: 'tick', t: 5899 }, { e: 'tick', t: 5900 }]);
  check('转写一直不回来 → 5 秒后当读完', lost.acts.join(' ') === 'commit next');
  const manual = run([{ e: 'cue', t: 0, fresh: false }], { mode: 'listen', since: 0, again: 1 });
  check('换句重新数,同一句(点「再听一遍」)不重数', manual.s.again === 1 && run([{ e: 'cue', t: 0, fresh: true }], { mode: 'listen', since: 0, again: 2 }).s.again === 0);
}

done();
