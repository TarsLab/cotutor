/**
 * 配音:老师说完,把 kidText 按 cotutor.json 的 tts 运行时合成到 conversations/<老师>/<日期>.<job>.mp3。
 * 失败不响、不阻塞对话:这条没有音频,孩子端退回浏览器自带的声;原因写进 err.log 供家长看。
 * 音色是人设(tutors[].voice),没配就不合成——「无缺省音色」是 voxtell 的政策,这里照办。
 */
import { execFile } from 'node:child_process';
import { appendFile, stat } from 'node:fs/promises';
import { fillTts, type Tts } from '../schema/index.ts';

export interface TtsResult {
  /** 成功 → 输出文件路径;失败 → null */
  file: string | null;
  error: string | null;
}

export function synthesize(tts: Tts, vars: { text: string; voice: string; out: string }, opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<TtsResult> {
  const argv = fillTts(tts.say, vars);
  return new Promise((resolveResult) => {
    execFile(argv[0], argv.slice(1), { env: opts.env ?? process.env, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 1 << 20 }, async (err, _stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const why = code === 'ENOENT' ? `PATH 里没有 ${argv[0]}` : `${err.message}${stderr ? `\n${String(stderr).trim().slice(-500)}` : ''}`;
        return resolveResult({ file: null, error: why });
      }
      const st = await stat(vars.out).catch(() => null);
      if (!st?.isFile() || st.size === 0) return resolveResult({ file: null, error: `命令跑完了但 ${vars.out} 没有内容` });
      resolveResult({ file: vars.out, error: null });
    });
  });
}

/** 合成一条并把失败原因追加到 err.log;返回文件名(相对 conversations/<老师>/)或 null */
export async function dubReply(tts: Tts, text: string, voice: string, files: { audio: string; err: string }, env?: NodeJS.ProcessEnv): Promise<string | null> {
  const r = await synthesize(tts, { text, voice, out: files.audio }, { env });
  if (r.error) await appendFile(files.err, `cotutor tts: 没合成(${r.error});孩子端用浏览器的声\n`).catch(() => {});
  return r.file ? files.audio.slice(files.audio.lastIndexOf('/') + 1) : null;
}
