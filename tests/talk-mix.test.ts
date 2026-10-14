/**
 * 口语课录像的声音(src/talk/lib/mix.ts,《wip/口语课设想.md》§8.3):两边按到达时刻摆成一条、老师的块照孩子端的排法排、flush 截断、老师出声的时段。纯函数。
 */
import { check, done } from './_check.ts';

const { MIX_RATE, mixCall, playingOf, scheduleTutor } = await import('../src/talk/lib/mix.ts');

/** 一块 PCM16:n 毫秒、值 v(rate 采样率) */
const block = (ms: number, v: number, rate: number): Buffer => { const n = Math.round((ms * rate) / 1000); const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(v, i * 2); return b; };
const at = (pcm: Buffer, ms: number): number => pcm.readInt16LE(Math.round((ms * MIX_RATE) / 1000) * 2);

{
  // 老师的块:到达 1000、1010、1020(各 200 毫秒的声),排成 1060–1260、1260–1460、1460–1660
  const segs = scheduleTutor([{ t: 1000, pcm: block(200, 1, MIX_RATE) }, { t: 1010, pcm: block(200, 1, MIX_RATE) }, { t: 1020, pcm: block(200, 1, MIX_RATE) }], []);
  check('老师的块照孩子端排:到达 + 60 毫秒起,一块接一块', segs.map((s) => [Math.round(s.start), Math.round(s.end)]).join(' ') === '1060,1260 1260,1460 1460,1660', JSON.stringify(segs.map((s) => [s.start, s.end])));
  const cut = scheduleTutor([{ t: 1000, pcm: block(200, 1, MIX_RATE) }, { t: 1010, pcm: block(200, 1, MIX_RATE) }, { t: 2000, pcm: block(100, 1, MIX_RATE) }], [1300]);
  check('flush:放到一半的截到那一刻,还没放的丢掉,之后的块从头排', cut.map((s) => [Math.round(s.start), Math.round(s.end)]).join(' ') === '1060,1260 1260,1300 2060,2160' && cut[1].pcm.length === Math.round(0.04 * MIX_RATE) * 2, JSON.stringify(cut.map((s) => [s.start, s.end, s.pcm.length])));
  check('出声的时段:挨着的并起来', JSON.stringify(playingOf([{ start: 0, end: 100 }, { start: 150, end: 300 }, { start: 1000, end: 1200 }])) === '[[0,300],[1000,1200]]');
}
{
  // 孩子的块(16k,100 毫秒)到达 500:声音在 400–500;老师的块到达 1000:在 1060–1260;一共 2000 毫秒
  const m = mixCall({ kid: [{ t: 500, pcm: block(100, 1000, 16000) }], tutor: [{ t: 1000, pcm: block(200, 2000, MIX_RATE) }], flushes: [], ms: 2000 });
  check('混成一条 24k:长度就是通话那么长', m.pcm.length === 2000 * 24 * 2, String(m.pcm.length));
  check('孩子的块往前挪一块的长度、升到 24k', at(m.pcm, 350) === 0 && at(m.pcm, 450) === 1000 && at(m.pcm, 510) === 0, `${at(m.pcm, 350)} ${at(m.pcm, 450)} ${at(m.pcm, 510)}`);
  check('老师的块在到达 + 60 毫秒', at(m.pcm, 1050) === 0 && at(m.pcm, 1100) === 2000 && at(m.pcm, 1270) === 0 && JSON.stringify(m.playing) === '[[1060,1260]]', JSON.stringify(m.playing));
  const end = mixCall({ kid: [], tutor: [{ t: 900, pcm: block(400, 2000, MIX_RATE) }], flushes: [], ms: 1000 });
  check('挂断那一刻还没放完的不要;出声的时段截到挂断', end.pcm.length === 1000 * 48 && JSON.stringify(end.playing) === '[[960,1000]]', JSON.stringify(end.playing));
  const loud = mixCall({ kid: [{ t: 100, pcm: block(100, 30000, 16000) }], tutor: [{ t: 0, pcm: block(200, 30000, MIX_RATE) }], flushes: [], ms: 300 });
  check('两边叠在一起削顶,不绕回', at(loud.pcm, 80) === 32767, String(at(loud.pcm, 80)));
}

done();
