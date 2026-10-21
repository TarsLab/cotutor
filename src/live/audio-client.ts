/**
 * 孩子端的声音(口语课与实时老师共用,插进各页的内联脚本):getUserMedia → AudioWorklet 降到 16k PCM16,100 毫秒一块交给 onChunk(静音时不交);
 * 下来的 24k PCM16 一块块排进 AudioContext 放(上一块放完或现在 + 60 毫秒,取晚的;录像的混音 lib/mix.ts 照这个排法)。
 * makeAudio() 回一个对象:open()(要在一次点击里调,Safari 才给起 AudioContext 与麦)、play(ArrayBuffer)、playing()、flush()、close(),
 * 回调 onChunk(ArrayBuffer) / onLevel(0–1),muted 缺省 true(连上了再放开)。没有 AudioWorklet 的退到 ScriptProcessor。
 * duck(v):放出来的声音压到 v(0–1,一直听时孩子开口先压低嘴,1 恢复);放声都过一个总的 GainNode,后面一个 AnalyserNode,outLevel() 回放出去的音量(0–1 左右,压低之前的)。
 * 页面自己开着麦克风的(孩子端老师页的常开那路)不用 open:点击里先 wake()(只起 AudioContext),拿到那路再 use(stream)——
 * iPad 上再 getUserMedia 一次会把先开的那路弄哑;use 的那路不归它管,close 不停它,换了一路就换源。
 * 脚本里不写反斜杠、反引号、美元加花括号(插进去的地方是模板字符串,见 CLAUDE.md「坑」)。
 */
export const AUDIO_CLIENT_JS = `
  const WORKLET = 'class P extends AudioWorkletProcessor { constructor() { super(); this.buf = []; this.n = 0; this.acc = 0; } process(inputs) { const ch = inputs[0] && inputs[0][0]; if (!ch) return true; const ratio = sampleRate / 16000; const out = []; for (let i = 0; i < ch.length; i++) { this.acc += 1; if (this.acc >= ratio) { this.acc -= ratio; out.push(ch[i]); } } for (const v of out) { this.buf.push(v); } if (this.buf.length >= 1600) { const n = 1600; const pcm = new Int16Array(n); let s = 0; for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, this.buf[i])); pcm[i] = v < 0 ? v * 32768 : v * 32767; s += v * v; } this.buf = this.buf.slice(n); this.port.postMessage({ pcm: pcm.buffer, rms: Math.sqrt(s / n) }, [pcm.buffer]); } return true; } } registerProcessor("cotutor-pcm16", P);';
  function makeAudio() {
    const A = { ctx: null, stream: null, own: false, src: null, node: null, nodeReady: null, playAt: 0, sources: [], onChunk: null, onLevel: null, muted: true, out: null, level: 1 };
    const out = () => { if (!A.out || A.out.context !== A.ctx) { A.out = A.ctx.createGain(); A.out.gain.value = A.level; A.an = A.ctx.createAnalyser(); A.an.fftSize = 512; A.out.connect(A.an); A.an.connect(A.ctx.destination); } return A.out; };
    // 放出去的音量(老师在说时按钮旁那三道小弧的深浅,src/server/voice-ui.ts):总 GainNode 后面接一个 AnalyserNode,取的是压低之前的
    A.outLevel = () => {
      if (!A.an || !A.ctx || A.an.context !== A.ctx || !A.playing()) return 0;
      const d = A.anBuf || (A.anBuf = new Uint8Array(A.an.fftSize));
      A.an.getByteTimeDomainData(d);
      let s = 0;
      for (let i = 0; i < d.length; i++) { const v = (d[i] - 128) / 128; s += v * v; }
      return Math.sqrt(s / d.length) / Math.max(0.05, A.level);
    };
    A.duck = (v) => { A.level = v; if (A.out && A.ctx && A.out.context === A.ctx) { try { A.out.gain.setTargetAtTime(v, A.ctx.currentTime, 0.05); } catch (e) { A.out.gain.value = v; } } };
    A.wake = () => { if (!A.ctx) A.ctx = new (window.AudioContext || window.webkitAudioContext)(); return A.ctx.resume(); };
    const node = () => A.nodeReady || (A.nodeReady = (async () => {
      if (A.ctx.audioWorklet) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await A.ctx.audioWorklet.addModule(url);
        A.node = new AudioWorkletNode(A.ctx, 'cotutor-pcm16', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        A.node.port.onmessage = (e) => { if (A.onLevel) A.onLevel(e.data.rms); if (!A.muted && A.onChunk) A.onChunk(e.data.pcm); };
        const sink = A.ctx.createGain(); sink.gain.value = 0; A.node.connect(sink); sink.connect(A.ctx.destination);
      } else {
        const sp = A.ctx.createScriptProcessor(4096, 1, 1);
        let buf = [], acc = 0;
        sp.onaudioprocess = (e) => {
          const ch = e.inputBuffer.getChannelData(0); const ratio = A.ctx.sampleRate / 16000;
          for (let i = 0; i < ch.length; i++) { acc += 1; if (acc >= ratio) { acc -= ratio; buf.push(ch[i]); } }
          while (buf.length >= 1600) { const pcm = new Int16Array(1600); let s = 0; for (let i = 0; i < 1600; i++) { const v = Math.max(-1, Math.min(1, buf[i])); pcm[i] = v < 0 ? v * 32768 : v * 32767; s += v * v; } buf = buf.slice(1600); if (A.onLevel) A.onLevel(Math.sqrt(s / 1600)); if (!A.muted && A.onChunk) A.onChunk(pcm.buffer); }
        };
        const sink = A.ctx.createGain(); sink.gain.value = 0; sp.connect(sink); sink.connect(A.ctx.destination);
        A.node = sp;
      }
    })());
    A.use = async (stream) => {
      await A.wake(); await node();
      if (stream === A.stream) return;
      if (A.src) { try { A.src.disconnect(); } catch (e) {} }
      if (A.own && A.stream) for (const t of A.stream.getTracks()) t.stop();
      A.stream = stream; A.own = false;
      A.src = A.ctx.createMediaStreamSource(stream); A.src.connect(A.node);
    };
    A.open = async () => {
      await A.wake();
      const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      await A.use(st); A.own = true;
    };
    A.play = (ab) => {
      if (!A.ctx) return;
      const i16 = new Int16Array(ab); const n = i16.length; if (!n) return;
      const buf = A.ctx.createBuffer(1, n, 24000); const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = i16[i] / 32768;
      const s = A.ctx.createBufferSource(); s.buffer = buf; s.connect(out());
      const now = A.ctx.currentTime; if (A.playAt < now + 0.06) A.playAt = now + 0.06;
      s.start(A.playAt); A.playAt += buf.duration; A.sources.push(s);
      s.onended = () => { const k = A.sources.indexOf(s); if (k >= 0) A.sources.splice(k, 1); };
    };
    A.playing = () => Boolean(A.ctx) && A.playAt > A.ctx.currentTime + 0.02;
    A.flush = () => { for (const s of A.sources) { try { s.stop(); } catch (e) {} } A.sources = []; A.playAt = 0; };
    A.close = () => { A.flush(); if (A.own && A.stream) for (const t of A.stream.getTracks()) t.stop(); if (A.ctx) { try { A.ctx.close().catch(() => {}); } catch (e) {} } A.ctx = null; A.stream = null; A.src = null; A.node = null; A.nodeReady = null; A.out = null; A.an = null; };
    return A;
  }
`;
