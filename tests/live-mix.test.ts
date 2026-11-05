/**
 * 录像的声音(src/runtime/journal/mix.ts):两边按到达时刻摆成一条、老师的块照孩子端的排法排、flush 截断、老师出声的时段。纯函数。
 * 录像记录(src/runtime/journal/recorder.ts):进出的消息带毫秒、flush 消息记成清队列、开口前垫的块带自己的时刻、屏幕尺寸、finish 拼出 reel.json 与声音。
 * 按段收:cut 收下一段(时刻换成离这一段开始的、尾巴上没动静的截掉)、没动静的一段 stirred = false、头一次有动静丢掉之前的、
 * 哪些不算动静、老师的声音算到放完;页面开着三个钟头,攒着的声音不超过一段;分片混和一口气混一样。
 */
import { check, done } from './_check.ts';

const { MIX_RATE, mixCall, mixCallSliced, playingOf, scheduleTutor } = await import('../src/runtime/journal/mix.ts');
const { CallRecorder, TAKE_LEAD_MS, TAKE_TAIL_MS, renderTake } = await import('../src/runtime/journal/recorder.ts');

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
  const take = await renderTake(rec.finish());
  check('录像记录:消息带离开始的毫秒与方向', JSON.stringify(take.reel.msgs.map((m) => [m[0], m[1], m[2].t])) === '[[500,"i","view"],[1000,"o","tutor"],[1500,"o","flush"]]', JSON.stringify(take.reel.msgs));
  check('录像记录:屏幕尺寸取整、不像样的不记;开始时刻、时长', JSON.stringify(take.reel.view) === '[1180,820]' && take.reel.startedAt === '2026-10-19T10:00:00.000Z' && take.ms === 2000 && take.reel.ms === 2000, JSON.stringify([take.reel.view, take.reel.startedAt, take.ms]));
  // 老师的块 1000 到、1060 起放 200 毫秒;1500 那条 flush 把 1260 之后的截掉(本来就放完了),1600 又清一次
  check('录像记录:flush 消息与页面自己清都截老师的声音;出声时段', JSON.stringify(take.reel.playing) === '[[1060,1260]]', JSON.stringify(take.reel.playing));
  check('录像记录:开口前垫的块按它自己的时刻摆(900 到,声音在 800–900)', at(take.callPcm, 850) === 1000 && at(take.callPcm, 950) === 0, `${at(take.callPcm, 850)} ${at(take.callPcm, 950)}`);
  check('录像记录:声音是混好的一条,通话那么长', take.callPcm.length === 2000 * 48 && !('kidPcm' in take) && !('tutorPcm' in take), String(take.callPcm.length));
}

{
  // 分片混:和一口气混一样(几段孩子、老师的声音,一段 flush,混出来 40 秒,跨过几片)
  const o = {
    kid: Array.from({ length: 300 }, (_, i) => ({ t: 1000 + i * 100, pcm: block(100, (i % 7) * 300 - 900, 16000) })),
    tutor: Array.from({ length: 80 }, (_, i) => ({ t: 20000 + i * 150, pcm: block(200, 1500 + i, MIX_RATE) })),
    flushes: [26000],
    ms: 40000,
  };
  const a = mixCall(o);
  const b = await mixCallSliced(o);
  check('分片混:声音、出声时段、孩子有声时段和一口气混的一字不差', a.pcm.equals(b.pcm) && JSON.stringify([a.playing, a.kidVoice]) === JSON.stringify([b.playing, b.kidVoice]) && a.pcm.length === 40000 * 48);
}

{
  // 切段:一轮(按下、松手、turn、老师的声音、read)→ 安静 → cut;下一段接着
  let clock = Date.parse('2026-11-06T10:00:00.000Z');
  const rec = new CallRecorder(() => new Date(clock));
  rec.out({ t: 'ready' });
  rec.in({ t: 'view', w: 1180, h: 820 });
  rec.view(1180, 820);
  check('不算动静:连上、报屏幕尺寸', !rec.stirred && rec.quietMs() === 0);
  clock += 60_000;
  check('没动静:多久没动静从这一段开始算', !rec.stirred && rec.quietMs() === 60_000 && rec.takeMs() === 60_000);
  rec.in({ t: 'hold' });
  check('按下算动静', rec.stirred && rec.quietMs() === 0);
  clock += 1000; rec.kid(block(100, 1000, 16000)); rec.in({ t: 'release', body: {} });
  clock += 500; rec.out({ t: 'turn', job: 'j1' });
  clock += 100; rec.out({ t: 'read', job: 'j1', line: 0 }); rec.tutor(block(3000, 2000, MIX_RATE));
  check('老师的声音算到它在孩子端放完(到达 + 60 毫秒起放 3 秒)', rec.quietMs() === -3060, String(rec.quietMs()));
  clock += 10_000;
  rec.out({ t: 'swap', input: 3000, why: 'tokens' });
  check('不算动静:换连接(只记不发的)', rec.quietMs() === 10_000 - 3060, String(rec.quietMs()));
  clock += 5 * 60_000;
  const a = rec.cut();
  // 第一次动静(按下)在 60 000:这一段从 58 000 起,连上、屏幕尺寸那两条丢掉;最后一次动静是老师的声音放完 64 660,尾巴留 2 秒
  check('头一次有动静:TAKE_LEAD_MS 之前的丢掉,这一段从那里开始', a.stirred && a.startedAt.toISOString() === '2026-11-06T10:00:58.000Z' && a.msgs[0][2].t === 'hold' && a.msgs[0][0] === TAKE_LEAD_MS, JSON.stringify([a.startedAt, a.msgs.slice(0, 2)]));
  check('收一段:时刻换成离这一段开始的,尾巴上没动静的截掉(最后一次动静 + TAKE_TAIL_MS)', a.ms === 64_660 - 58_000 + TAKE_TAIL_MS && a.msgs.find((m) => m[2].t === 'turn')?.[0] === 3500 && a.kid[0].t === 3000 && a.tutor[0].t === 3600, JSON.stringify([a.ms, a.msgs.map((m) => [m[0], m[2].t]), a.kid.map((c) => c.t), a.tutor.map((c) => c.t)]));
  check('收一段:屏幕尺寸带着(切段不丢)', JSON.stringify(a.view) === '[1180,820]');
  const take = await renderTake(a);
  check('收一段:混出来的声音就是这一段那么长,老师的声音落在 3660 起', take.callPcm.length === a.ms * 48 && at(take.callPcm, 3650) === 0 && at(take.callPcm, 3700) === 2000 && JSON.stringify(take.reel.playing) === '[[3660,6660]]', JSON.stringify(take.reel.playing));
  check('切完:新的一段从现在起,没动静,时钟不动', !rec.stirred && rec.takeMs() === 0 && rec.ms() === 61_600 + 10_000 + 5 * 60_000, String(rec.ms()));
  const empty = rec.cut();
  check('没动静的一段收下来 stirred = false', !empty.stirred && empty.msgs.length === 0);
  clock += 30_000;
  rec.in({ t: 'send', body: { text: '我回来了' } });
  clock += 1000;
  const b = rec.finish();
  check('下一段:头一次动静之前 TAKE_LEAD_MS 起;挂了收最后一段', b.stirred && b.startedAt.getTime() === clock - 1000 - TAKE_LEAD_MS && b.msgs.length === 1 && b.msgs[0][0] === TAKE_LEAD_MS && b.ms === TAKE_LEAD_MS + 1000, JSON.stringify([b.startedAt, b.ms, b.msgs]));
}

{
  // 补记的开口(一直听:hold 记回开口那一刻)落在这一段开始之前:记在这一段的 0
  let clock = Date.parse('2026-11-06T10:00:00.000Z');
  const rec = new CallRecorder(() => new Date(clock));
  rec.in({ t: 'hold' });
  clock += 10 * 60_000;
  rec.cut();
  clock += 100;
  rec.in({ t: 'hold', vad: true }, rec.ms() - 500);
  rec.in({ t: 'release', vad: true }, rec.ms());
  const r = rec.finish();
  check('开口记在这一段开始之前的:时刻记 0,不是负的', r.msgs[0][0] === 0 && r.msgs[1][0] === 100, JSON.stringify(r.msgs));
}

{
  // 页面开着三个钟头(一直听,孩子端一直推静音,100 毫秒一块),中间每二十分钟说一轮;心跳 30 秒,没动静 5 分钟就切
  let clock = Date.parse('2026-11-06T09:00:00.000Z');
  const rec = new CallRecorder(() => new Date(clock));
  const silent = Buffer.alloc(3200);
  const takes: { stirred: boolean; ms: number; kidBytes: number; msgs: number }[] = [];
  let maxKidBytes = 0;
  for (let ms = 0; ms < 3 * 3600_000; ms += 100) {
    clock += 100;
    rec.kid(silent);
    if (ms % (20 * 60_000) === 10 * 60_000) { rec.in({ t: 'hold' }); rec.in({ t: 'release', body: {} }); rec.out({ t: 'turn', job: `j${ms}` }); rec.tutor(block(2000, 1000, MIX_RATE)); }
    if (ms % 30_000 === 0 && rec.quietMs() >= 5 * 60_000) {
      const t = rec.cut();
      const kidBytes = t.kid.reduce((s, c) => s + c.pcm.length, 0);
      maxKidBytes = Math.max(maxKidBytes, kidBytes);
      takes.push({ stirred: t.stirred, ms: t.ms, kidBytes, msgs: t.msgs.length });
    }
  }
  const kept = takes.filter((t) => t.stirred);
  check('开着三个钟头:说了九轮,收下九段有动静的,每段几秒(头尾各留 2 秒)', kept.length === 9 && kept.every((t) => t.ms < 10_000 && t.msgs === 3), JSON.stringify(kept));
  // 一段攒着的孩子的声音:没动静 5 分钟 + 一次心跳 + 头上留的 2 秒和老师那句(16k 单声道 32 KB/秒);不切的话是三个钟头 345 MB
  check('开着三个钟头:攒着的孩子的声音不超过 6 分钟', maxKidBytes <= 6 * 60 * 32_000, String(maxKidBytes));
}

done();
