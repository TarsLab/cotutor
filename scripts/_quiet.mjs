/**
 * 探针别出声(2026-10-09):mock 的孩子端用浏览器合成声念讲稿(页面模式 synth),无头 Chrome 在 macOS 上照样从喇叭念出来,
 * 而且合成声走系统的语音服务,`--mute-audio` 管不到它(只静 <audio> 与 WebAudio);Chrome 被杀了,没念完的那句系统还会接着念。
 * 所以两样都做:起 Chrome 加 QUIET_ARGS;连上页面先 quiet(send),把 speechSynthesis 换成不出声的替身(方法可写:探针自己再盖一层记「念了什么」照样行)——
 * 照样排队、照样发 start / end(按字数算时长,同真念的语速,再除以 rate)、cancel 发 error,页面的播放逻辑看不出差别。
 * 想听声音调试:COTUTOR_PROBE_SOUND=1 node scripts/probe-xxx.mjs
 */
export const LOUD = process.env.COTUTOR_PROBE_SOUND === '1';

export const QUIET_ARGS = LOUD ? [] : ['--mute-audio'];
/** 替身每个字念多久(毫秒):macOS 的 Tingting 实测每字 210–225ms(say -o 量的,含标点);探针的时序是照真念调的(probe-avatar 等「念完点头」) */
const PER_CHAR = Number(process.env.COTUTOR_PROBE_SPEECH_MS) || 220;

export const SILENT_SPEECH = `(() => {
  const ss = window.speechSynthesis;
  if (!ss || ss.__silent) return;
  const queue = []; let cur = null, timer = 0, paused = false;
  const emit = (u, type, extra) => {
    let e;
    try { e = new SpeechSynthesisEvent(type, Object.assign({ utterance: u, charIndex: 0, elapsedTime: 0 }, extra || {})); } catch { e = new Event(type); }
    if (extra && extra.error && !('error' in e)) Object.defineProperty(e, 'error', { value: extra.error });
    u.dispatchEvent(e);
  };
  const ms = (u) => Math.max(${Math.min(1200, PER_CHAR * 5)}, Array.from(String(u.text || '')).length * ${PER_CHAR}) / (u.rate || 1);
  const next = () => {
    cur = queue.shift() || null;
    if (!cur) return;
    const u = cur;
    // 念完先放下 cur 再发 end:页面常在 onend 里 cancel() + speak(下一句),那一句要接得上,念完的这句也不该再收到 canceled
    setTimeout(() => { if (cur !== u) return; emit(u, 'start'); timer = setTimeout(() => { if (cur !== u) return; cur = null; emit(u, 'end'); if (!cur) next(); }, ms(u)); }, 0);
  };
  Object.defineProperties(ss, {
    __silent: { value: true },
    speak: { writable: true, configurable: true, value: (u) => { queue.push(u); if (!cur && !paused) next(); } },
    cancel: { writable: true, configurable: true, value: () => { clearTimeout(timer); const was = [cur, ...queue].filter(Boolean); queue.length = 0; cur = null; for (const u of was) emit(u, 'error', { error: 'canceled' }); } },
    pause: { writable: true, configurable: true, value: () => { paused = true; } },
    resume: { writable: true, configurable: true, value: () => { paused = false; if (!cur) next(); } },
    speaking: { configurable: true, get: () => Boolean(cur) },
    pending: { configurable: true, get: () => queue.length > 0 },
    paused: { configurable: true, get: () => paused },
  });
})();`;

/** 连上页面后先调:以后每次导航(含 iframe)都先换上替身,当前已开着的页面也立刻换 */
export async function quiet(send) {
  if (LOUD) return;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: SILENT_SPEECH });
  await send('Runtime.evaluate', { expression: SILENT_SPEECH });
}
