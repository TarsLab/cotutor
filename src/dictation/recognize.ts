/**
 * 拍照认词表(《wip/听写设想.md》拍板 10、12):孩子端拍课本(课文、写字、词语、识字)或老师发的听写单,交给百炼的视觉模型,一次回齐:
 * 挑出的字词(是什么、哪一栏、在照片上的哪儿、默认选不选、认没认准、老师怎么念),再是正文全文(分好词,孩子端能点着加)。
 * 「认哪些、默认选哪些、怎么念」在听写 activity 文件的「认字收到什么」(`{{格式}}` 插槽由这里的 FORMAT 填,《wip/activity设计.md》拍板 21);
 * 老 workspace 改过 cotutor.json 的 dictation.prompt / promptEn 的,以它为准,FORMAT 接在后面。改要求不会把解析改坏。
 * 流式:模型一行一段地吐,收到一行就交出到这时为止认出的全部,孩子端轮询着一个一个画框,不用干等整张认完。
 * 2026-10-10 拿一页仿课本试(识字 9、写字 9、读读写写 6):qwen3.8-max 24 项全对、框都套在字上,第一项 2.8 秒、全部 23 秒;
 * qwen3.5-omni-flash 整张 20 秒但不照一行一段回;qwen-vl-max / qwen3-vl-plus 36–37 秒。
 * key 与 qwen 老师同一份(环境变量 DASHSCOPE_API_KEY,没有就读本机 ~/.qwen/settings.json 的 env),只进请求头。出错、超时都不抛。
 */
import { homedir } from 'node:os';
import { localDashscopeKey } from '../clis/qwen.ts';
import { DICTATION_PROMPT_DEFAULT, DICTATION_PROMPT_EN_DEFAULT, DICTATION_DEFAULT } from '../schema/index.ts';
import { fillSlots } from '../lib/activity.ts';
import { DICTATION_SAY_MAX, dictationWordLang, type DictationLang } from '../cards/index.ts';

export const VISION_TIMEOUT_MS = 120_000;
const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/** 一栏:char 写字(田字格里的)/ word 词语表、读读写写 / mark 课文里课本标出来的 / list 听写单上的 / read 识字(会认就行)/ other */
export type PhotoKind = 'char' | 'word' | 'mark' | 'list' | 'read' | 'other';
export const PHOTO_KINDS: readonly PhotoKind[] = ['char', 'word', 'mark', 'list', 'read', 'other'];
/** 模型没说默认选不选时,这几栏选上 */
const PICK_BY_KIND: readonly PhotoKind[] = ['char', 'word', 'mark', 'list'];

export interface PhotoItem {
  text: string;
  kind: PhotoKind;
  /** 默认选上(模型的判断;没说就按栏) */
  pick: boolean;
  /** 在照片上的框 [左, 上, 右, 下],0–1000(按照片宽高的千分比);没给 null */
  box: [number, number, number, number] | null;
  /** 认准了;糊的、反光的、拿不准的 false */
  sure: boolean;
  /** 老师怎么念 */
  say: string | null;
}

/** 认到这时为止的全部:挑出的字词、课名、全文(一行一个字符串,词之间空一格) */
export interface PhotoProgress {
  items: PhotoItem[];
  lesson: string | null;
  full: string[];
}

export type Recognized = ({ ok: true; model: string } | { ok: false; error: string }) & PhotoProgress & { ms: number };
/** 认一张照片;每收到一行调一次 onProgress;lang = en 认英文单词(英语老师卡上的拍照听写) */
export type Recognize = (image: { data: Buffer; mime: string }, onProgress: (p: PhotoProgress) => void, lang?: DictationLang) => Promise<Recognized>;

/** 回什么格式:接在家长的要求后面,解析靠它 */
export const FORMAT = `回答的格式:一行一段 JSON,不要别的字、不要代码块。按这个顺序写:
1. 第一行写课名:{"lesson": "小蝌蚪找妈妈"},没有课名写 {"lesson": null}。
2. 挑出的字词,一项一行,默认选上的先写:
{"text": "脑袋", "kind": "word", "pick": true, "box": [左, 上, 右, 下], "sure": true, "say": "脑袋,小蝌蚪的大脑袋"}
   - text:只写汉字,一个字或一个词,最多四个字;照片上怎么分就怎么分。
   - kind:「写字」栏写 char;「词语表」「读读写写」写 word;课文里课本标出来的写 mark;听写单上的写 list;「识字」栏写 read;别的写 other。
   - pick:默认选不选(true / false)。
   - box:这一项在照片上的位置,按照片宽、高的千分比,0 到 1000 的整数。
   - sure:看清了 true;糊、反光、被挡住、拿不准写 false,text 写你觉得最可能的字。
   - say:念法。
3. 最后是全文:照片上的正文照原样一行写一行 {"full": "冬天来啦!一场大雪过后"};不要拼音、页码、栏目名。`;

/** 英文单词的格式:一项一个单词;kind 只分 word(单词表、要会写的)与 read(会认就行)、other */
export const FORMAT_EN = `回答的格式:一行一段 JSON,不要别的字、不要代码块。按这个顺序写:
1. 第一行写单元名:{"lesson": "Unit 3 Colours"},没有写 {"lesson": null}。
2. 挑出的单词,一项一行,默认选上的先写:
{"text": "yellow", "kind": "word", "pick": true, "box": [左, 上, 右, 下], "sure": true, "say": "yellow, a yellow bus"}
   - text:一个英文单词,只写字母(可以带 - 和 '),不带空格;照课本的大小写。
   - kind:要会写的单词写 word;只要会认、会读的写 read;别的写 other。
   - pick:默认选不选(true / false)。
   - box:这一项在照片上的位置,按照片宽、高的千分比,0 到 1000 的整数。
   - sure:看清了 true;糊、反光、被挡住、拿不准写 false。
   - say:念法,英文。
3. 最后是全文:照片上的正文照原样一行写一行 {"full": "What colour is it? It's yellow."};不要页码、栏目名。`;

/** 交给模型的整段:cotutor.json 的要求 + 格式 */
export function photoPrompt(prompt: readonly string[] = DICTATION_PROMPT_DEFAULT, lang: DictationLang = 'zh'): string {
  return `${prompt.join('\n')}\n\n${lang === 'en' ? FORMAT_EN : FORMAT}`;
}

/** 交给模型的整段:听写 activity 文件「认字收到什么」的模板填好 {{格式}} */
export function photoPromptFrom(template: string, lang: DictationLang = 'zh'): string {
  return fillSlots(template, { 格式: lang === 'en' ? FORMAT_EN : FORMAT });
}

/** cotutor.json 的 dictation.prompt / promptEn 改过(和出厂的不一样):老 workspace 家长改的要求,以它为准 */
export function dictationPromptCustom(prompt: readonly string[] | undefined, lang: DictationLang = 'zh'): boolean {
  return prompt !== undefined && JSON.stringify(prompt) !== JSON.stringify(lang === 'en' ? DICTATION_PROMPT_EN_DEFAULT : DICTATION_PROMPT_DEFAULT);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

const ZH_WORDS = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
/**
 * 全文的一行分成词(词之间空一格),孩子端一个词一个词点。不靠模型分:2026-10-10 同一张真照片,qwen3.8-max 一次整行连着回、
 * 一次每个字之间都空一格;所以去掉空格,一律用 Intl.Segmenter 的中文分词(Node 与 Safari 都有),分得准不准都一个样。
 */
export function splitWords(line: string, lang: DictationLang = 'zh'): string {
  // 英文:只留单词(去掉标点),词之间空一格
  if (lang === 'en') return (line.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).join(' ');
  const t = line.replace(/\s+/g, '');
  if (!ZH_WORDS) return t;
  return [...ZH_WORDS.segment(t)].map((x) => x.segment.trim()).filter(Boolean).join(' ');
}

/** 模型的一行 → 一项;不是一项(形状不对、不是汉字、超过四个字;lang = en:不是一个英文单词)→ null */
export function parseItem(v: unknown, lang: DictationLang = 'zh'): PhotoItem | null {
  if (!isObj(v)) return null;
  const t = lang === 'en' ? (str(v.text) ?? '') : (str(v.text)?.replace(/\s+/g, '') ?? '');
  if (dictationWordLang(t) !== lang) return null;
  const kind = PHOTO_KINDS.includes(v.kind as PhotoKind) ? (v.kind as PhotoKind) : 'other';
  const b = Array.isArray(v.box) && v.box.length === 4 && v.box.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v.box as number[]).map((x) => Math.max(0, Math.min(1000, Math.round(x)))) : null;
  const box = b && b[2] > b[0] && b[3] > b[1] ? (b as PhotoItem['box']) : null;
  const say = str(v.say);
  const pick = typeof v.pick === 'boolean' ? v.pick : PICK_BY_KIND.includes(kind);
  return { text: t, kind, pick, box, sure: v.sure !== false, say: say && Array.from(say).length <= DICTATION_SAY_MAX ? say : null };
}

/**
 * 一行一行地收:吐出来的字攒着,遇到换行就认一行;同一栏同一个字词只留第一个。
 * 课名、一项、一行全文都算一行;每认出一行调一次 onProgress。
 */
export class LineReader implements PhotoProgress {
  items: PhotoItem[] = [];
  lesson: string | null = null;
  full: string[] = [];
  private buf = '';
  private seen = new Set<string>();
  private onProgress: (p: PhotoProgress) => void;
  private lang: DictationLang;
  constructor(onProgress: (p: PhotoProgress) => void = () => {}, lang: DictationLang = 'zh') {
    this.onProgress = onProgress;
    this.lang = lang;
  }
  push(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      this.line(this.buf.slice(0, i));
      this.buf = this.buf.slice(i + 1);
    }
  }
  end(): void {
    this.line(this.buf);
    this.buf = '';
  }
  snapshot(): PhotoProgress {
    return { items: [...this.items], lesson: this.lesson, full: [...this.full] };
  }
  private line(raw: string): void {
    const s = raw.trim().replace(/,$/, '');
    if (!s.startsWith('{') || !s.endsWith('}')) return;
    let v: unknown;
    try {
      v = JSON.parse(s);
    } catch {
      return;
    }
    if (!isObj(v)) return;
    if ('lesson' in v && !('text' in v)) {
      this.lesson = str(v.lesson);
    } else if ('full' in v && !('text' in v)) {
      const f = str(v.full);
      if (!f) return;
      this.full.push(splitWords(f, this.lang));
    } else {
      const it = parseItem(v, this.lang);
      if (!it) return;
      const key = `${it.kind}\n${it.text}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
      this.items.push(it);
    }
    this.onProgress(this.snapshot());
  }
}

/** 兼容接口的流(data: {...} 一行一块)里的一块 → delta.content;不是内容块 → '' */
function deltaOf(line: string): string {
  const s = line.trim();
  if (!s.startsWith('data:') || s === 'data: [DONE]') return '';
  try {
    const j = JSON.parse(s.slice(5)) as { choices?: { delta?: { content?: unknown } }[] };
    const c = j.choices?.[0]?.delta?.content;
    return typeof c === 'string' ? c : '';
  } catch {
    return '';
  }
}

/** 认一张照片(流式);出错、超时都不抛,回 {ok: false} 并带上已经认出的 */
export async function recognizePhoto(
  image: { data: Buffer; mime: string },
  onProgress: (p: PhotoProgress) => void = () => {},
  opts: { env?: NodeJS.ProcessEnv; endpoint?: string; model?: string; prompt?: readonly string[]; text?: string; timeoutMs?: number; lang?: DictationLang } = {},
): Promise<Recognized> {
  const env = opts.env ?? process.env;
  const t0 = Date.now();
  const ms = (): number => Date.now() - t0;
  const reader = new LineReader(onProgress, opts.lang);
  const fail = (error: string): Recognized => ({ ok: false, error, ...reader.snapshot(), ms: ms() });
  const key = env.DASHSCOPE_API_KEY?.trim() || localDashscopeKey(env.HOME || homedir());
  if (!key) return fail('no_key');
  const model = opts.model ?? DICTATION_DEFAULT.model;
  try {
    const res = await fetch(opts.endpoint ?? ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.1,
        enable_thinking: false,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data.toString('base64')}` } }, { type: 'text', text: opts.text ?? photoPrompt(opts.prompt, opts.lang) }] }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? VISION_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) return fail(`http_${res.status}`);
    const dec = new TextDecoder();
    let sse = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      sse += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = sse.indexOf('\n')) >= 0) {
        const d = deltaOf(sse.slice(0, i));
        sse = sse.slice(i + 1);
        if (d) reader.push(d);
      }
    }
    reader.push(deltaOf(sse));
    reader.end();
    if (!reader.items.length && !reader.full.length) return fail('nothing');
    return { ok: true, model, ...reader.snapshot(), ms: ms() };
  } catch (err) {
    return fail(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network');
  }
}
