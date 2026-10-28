/**
 * 探针别出声:起 Chrome 加 QUIET_ARGS(`--mute-audio`,静 <audio> 与 WebAudio)。
 * 2026-10-09 起还要把 speechSynthesis 换成不出声的替身(mock 的孩子端用浏览器合成声念,系统语音服务 --mute-audio 管不到);
 * 10-28 页面里的合成声整个去掉了(mock 的卡也放静音的段),替身跟着删。
 * 想听声音调试:COTUTOR_PROBE_SOUND=1 node scripts/probe-xxx.mjs
 */
export const LOUD = process.env.COTUTOR_PROBE_SOUND === '1';

export const QUIET_ARGS = LOUD ? [] : ['--mute-audio'];
