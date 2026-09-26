/**
 * 录音卡(《口播老师设计.md》§2):一句要读的话 + 示范音;孩子在舞台里按住录,录音存进这张卡的资产目录,状态只留路径与秒数。
 * 评测(koubo)在存录音时由服务端后台起,结果落在录音旁边的 heard.json,不进状态——孩子端拿不到判;
 * 交给老师时 runner 把 heard 接在 describe 那一行后面(describeCard 的 extra),老师照 koubo-coach 用话说。
 */
import { z } from 'zod';
import { bodyLines, type CardKind } from './kind.ts';

/** SOE 句子模式一句的上限:汉字数(句子模式)/ 音节数(拼音模式) */
export const RECORD_MAX = 30;
/** 一条录音最长秒数(页面到点自动停;服务端也按它收) */
export const RECORD_MAX_SECONDS = 60;
/** 录音文件:相对 workspace 根,conversations/<老师>/<日期>.<job>.cards/<n>/rec-<k>.<ext> */
export const RECORD_AUDIO_RE = /^conversations\/[a-z0-9][a-z0-9-]*\/\d{4}-\d{2}-\d{2}\.\d{4}-\d+\.cards\/\d+\/rec-\d+\.(webm|m4a|mp4|ogg|wav)$/;

export const RecordPropsSchema = z.object({
  /** 送评的参考文本:句子模式是汉字(【】已剥),拼音模式是 shi4 si4 这样的音节串 */
  text: z.string().min(1),
  /** 给人看的字(拼音模式的第二行;句子模式没有,看 text) */
  show: z.string().min(1).optional(),
  /** 风险字在「给人看的字」里的下标(按字,不按 UTF-16) */
  risk: z.array(z.number().int().nonnegative()).optional(),
  mode: z.enum(['sentence', 'pinyin']),
  /** 风险组(koubo 的 --pairs);没有 = koubo 按混淆表自己找 */
  focus: z.array(z.string().regex(/^[a-z]+_[a-z]+$/)).optional(),
});
export type RecordProps = z.infer<typeof RecordPropsSchema>;

export const RecordStateSchema = z.object({
  audio: z.string().regex(RECORD_AUDIO_RE),
  seconds: z.number().positive().max(RECORD_MAX_SECONDS + 1),
});
export type RecordState = z.infer<typeof RecordStateSchema>;

/** koubo card 的结果落盘(rec-<k>.heard.json);家长端旁注读全量,老师那一行只用判、原因、take */
export const HeardSchema = z.union([
  z.object({
    ok: z.literal(true),
    take: z.string(),
    verdict: z.enum(['过', '可救', '重录']),
    reasons: z.array(z.string()),
    accuracy: z.number().optional(),
    charsPerMin: z.number().optional(),
    chars: z.array(z.object({ ch: z.string(), phone: z.string(), score: z.number(), ok: z.boolean(), missing: z.boolean().optional(), risk: z.array(z.string()).optional(), readAs: z.string().optional() })).default([]),
    costYuan: z.number().default(0),
    cached: z.boolean().optional(),
    ms: z.number().optional(),
  }),
  z.object({ ok: z.literal(false), error: z.string(), ms: z.number().optional() }),
]);
export type Heard = z.infer<typeof HeardSchema>;
/** describe 的第三个参数:评好了的 heard,或 'pending'(等超了还没回来) */
export type RecordExtra = Heard | 'pending' | undefined;

const HAN = /\p{Script=Han}/u;
const SYLLABLE = /^[a-zü]+[1-5]$/;
/** 老师那一行里原因最多几条、整行最多几个字 */
const REASONS_MAX = 6;
const LINE_MAX = 300;

/** 剥掉【】,记下括住的字在剥完之后的下标 */
export function stripRisk(raw: string): { text: string; risk: number[] } {
  const out: string[] = [];
  const risk: number[] = [];
  let open = false;
  for (const ch of Array.from(raw)) {
    if (ch === '【') open = true;
    else if (ch === '】') open = false;
    else {
      if (open && HAN.test(ch)) risk.push(out.length);
      out.push(ch);
    }
  }
  return { text: out.join('').trim(), risk };
}

const hanCount = (s: string): number => Array.from(s).filter((c) => HAN.test(c)).length;

/** 给老师那一行的评测半句:「;判 重录:…;take=…」/「;没评上(timeout)」/「;还没评完」 */
export function heardTail(extra: RecordExtra): string {
  if (!extra) return '';
  if (extra === 'pending') return ';还没评完';
  if (!extra.ok) return `;没评上(${extra.error})`;
  if (extra.verdict === '过') return `;判 过;take=${extra.take}`;
  const rs = extra.reasons.slice(0, REASONS_MAX);
  const more = extra.reasons.length > REASONS_MAX ? `;…还有 ${extra.reasons.length - REASONS_MAX} 条` : '';
  return `;判 ${extra.verdict}:${rs.join(';')}${more};take=${extra.take}`;
}

export const record: CardKind<RecordProps, RecordState> = {
  name: 'record',
  props: RecordPropsSchema,
  parse(body, mods) {
    const lower = mods.map((m) => m.toLowerCase());
    const pinyin = lower.includes('pinyin') || lower.includes('mode=pinyin');
    const focusMod = lower.find((m) => m.startsWith('focus='));
    const focus = focusMod ? focusMod.slice(6).split(',').map((s) => s.trim()).filter(Boolean) : [];
    const lines = bodyLines(body);
    if (!lines.length) throw new Error('没有要读的句子');
    const withFocus = focus.length ? { focus } : {};
    if (!pinyin) {
      if (lines.length > 1) throw new Error('一张录音卡一句;要读几句就放几张');
      const { text, risk } = stripRisk(lines[0]);
      const n = hanCount(text);
      if (!n) throw new Error('句子里没有汉字(拼音题在标签后写 pinyin)');
      if (n > RECORD_MAX) throw new Error(`${n} 个字,一句最多 ${RECORD_MAX} 个;拆成两张`);
      return { text, mode: 'sentence', ...(risk.length ? { risk } : {}), ...withFocus };
    }
    if (lines.length > 2) throw new Error('拼音题两行:第一行拼音,第二行给人看的字');
    const syl = lines[0].toLowerCase().replace(/v/g, 'ü').split(/\s+/).filter(Boolean);
    if (!syl.every((x) => SYLLABLE.test(x))) throw new Error('第一行要是带调号数字的拼音,如 shi4 si4');
    if (syl.length > RECORD_MAX) throw new Error(`${syl.length} 个音节,最多 ${RECORD_MAX} 个`);
    const shown = lines[1] ? stripRisk(lines[1]) : null;
    return { text: syl.join(' '), mode: 'pinyin', ...(shown?.text ? { show: shown.text } : {}), ...(shown?.risk.length ? { risk: shown.risk } : {}), ...withFocus };
  },
  state: RecordStateSchema,
  describe(p, s, extra) {
    void p;
    const line = `已录 ${s.seconds.toFixed(1)} 秒${heardTail(extra as RecordExtra)}`;
    const cps = Array.from(line);
    return cps.length > LINE_MAX ? `${cps.slice(0, LINE_MAX - 1).join('')}…` : line;
  },
  assets(p) {
    // 示范音念给人看的字;拼音模式没写字就不配(念不出 shi4)
    const say = p.show ?? (p.mode === 'sentence' ? p.text : '');
    return say ? [{ file: '1.mp3', text: say }] : [];
  },
};
