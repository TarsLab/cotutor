/**
 * 录像的声音(src/runtime/journal/mix.ts):两边按到达时刻摆成一条、老师的块照孩子端的排法排、flush 截断、老师出声的时段。纯函数。
 * 录像记录(src/runtime/journal/recorder.ts):进出的消息带毫秒、flush 消息记成清队列、开口前垫的块带自己的时刻、屏幕尺寸、finish 拼出 reel.json 与声音。
 */
import { check, done } from './_check.ts';

const { MIX_RATE, mixCall, playingOf, scheduleTutor } = await import('../src/runtime/journal/mix.ts');
const { CallRecorder } = await import('../src/runtime/journal/recorder.ts');

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

{
  // 假钟:每一步自己拨
  let clock = Date.parse('2026-10-19T10:00:00.000Z');
  const rec = new CallRecorder(() => new Date(clock));
  clock += 500; rec.in({ t: 'view', w: 1180.4, h: 820 });
  rec.view(1180.4, 820);
  rec.view(-1, 'x');
  clock += 500; rec.out({ t: 'tutor', delta: '你好' });
  rec.tutor(block(200, 2000, MIX_RATE));
  clock += 300; rec.kid(block(100, 1000, 16000), 900);
  clock += 200; rec.out({ t: 'flush' });
  clock += 100; rec.flush();
  clock += 400;
  const take = rec.finish();
  check('录像记录:消息带离开始的毫秒与方向', JSON.stringify(take.reel.msgs.map((m) => [m[0], m[1], m[2].t])) === '[[500,"i","view"],[1000,"o","tutor"],[1500,"o","flush"]]', JSON.stringify(take.reel.msgs));
  check('录像记录:屏幕尺寸取整、不像样的不记;开始时刻、时长', JSON.stringify(take.reel.view) === '[1180,820]' && take.reel.startedAt === '2026-10-19T10:00:00.000Z' && take.ms === 2000 && take.reel.ms === 2000, JSON.stringify([take.reel.view, take.reel.startedAt, take.ms]));
  // 老师的块 1000 到、1060 起放 200 毫秒;1500 那条 flush 把 1260 之后的截掉(本来就放完了),1600 又清一次
  check('录像记录:flush 消息与页面自己清都截老师的声音;出声时段', JSON.stringify(take.reel.playing) === '[[1060,1260]]', JSON.stringify(take.reel.playing));
  check('录像记录:开口前垫的块按它自己的时刻摆(900 到,声音在 800–900)', at(take.callPcm, 850) === 1000 && at(take.callPcm, 950) === 0, `${at(take.callPcm, 850)} ${at(take.callPcm, 950)}`);
  check('录像记录:两边各自首尾相接的原声', take.kidPcm.length === 100 * 16 * 2 && take.tutorPcm.length === 200 * 24 * 2 && take.callPcm.length === 2000 * 48);
}

done();
