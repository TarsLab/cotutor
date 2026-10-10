/**
 * 拍照认词表(《wip/听写设想.md》拍板 10):孩子端拍课本的写字、词语,或老师发的听写单,交给百炼的视觉模型,
 * 每认出一项回一行:是什么字词、属于哪一栏、在照片上的哪儿(0–1000 的框,页面在照片上画框让人点)、认没认准、老师怎么念。
 * 流式:模型一行一项地吐,收到一行就交给 onItem,孩子端轮询着一个一个画框,不用干等整张认完。
 * 2026-10-10 拿一页仿课本试(识字 9、写字 9、读读写写 6):qwen3.8-max 24 项全对、框都套在字上,第一项 2.8 秒、全部 23 秒;
 * qwen3.5-omni-flash 整张 20 秒但不照一行一项回;qwen-vl-max / qwen3-vl-plus 36–37 秒。
 * key 与 qwen 老师同一份(环境变量 DASHSCOPE_API_KEY,没有就读本机 ~/.qwen/settings.json 的 env),只进请求头。出错、超时都不抛。
 */
import { homedir } from 'node:os';
import { localDashscopeKey } from '../clis/qwen.ts';
import { DICTATION_SAY_MAX, DICTATION_WORD_MAX, HAN } from '../cards/index.ts';

export const VISION_MODEL = 'qwen3.8-max';
export const VISION_TIMEOUT_MS = 90_000;
const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/** 一栏:word 词语(读读写写、词语表)/ char 写字(田字格里的,会写)/ read 识字(会认,不听写)/ list 听写单上的 / other */
export type PhotoKind = 'word' | 'char' | 'read' | 'list' | 'other';
export const PHOTO_KINDS: readonly PhotoKind[] = ['word', 'char', 'read', 'list', 'other'];

export interface PhotoItem {
  text: string;
  kind: PhotoKind;
  /** 在照片上的框 [左, 上, 右, 下],0–1000(按照片宽高的千分比);没给 null */
  box: [number, number, number, number] | null;
  /** 认准了;糊的、反光的、拿不准的 false */
  sure: boolean;
  /** 老师怎么念 */
  say: string | null;
}

export type Recognized = { ok: true; items: PhotoItem[]; lesson: string | null; model: string; ms: number } | { ok: false; error: string; items: PhotoItem[]; lesson: string | null; ms: number };
/** 认一张照片;每认出一项调一次 onItem(lesson 认出来时也调,item 为 null) */
export type Recognize = (image: { data: Buffer; mime: string }, onItem: (item: PhotoItem | null, lesson: string | null) => void) => Promise<Recognized>;

export const PROMPT = `这是一张照片:小学语文课本的一页(写字、词语表、读读写写、识字),或老师发的听写单。把照片上要孩子写或认的字词一个一个找出来。

一行一段 JSON,不要别的字、不要代码块。第一行写课名:
{"lesson": "小蝌蚪找妈妈"}
没有课名就写 {"lesson": null}。之后每认出一项就写一行:
{"text": "脑袋", "kind": "word", "box": [左, 上, 右, 下], "sure": true, "say": "脑袋,小蝌蚪的大脑袋"}

先写 word 和 list,再写 char,最后写 read。

- text:只写汉字,一项一个字或一个词,最多四个字。照片上怎么分就怎么分,不要自己组词。
- kind:「词语表」「读读写写」「词语」写 word;手写或打印的听写单写 list;「写字」那栏(田字格里的)写 char;「识字」那栏(只要会认,通常带拼音或在圈里)写 read;别的写 other。课文正文、标题、页码、拼音、栏目名都不要。
- box:这一项在照片上的位置,按照片宽、高的千分比,0 到 1000 的整数。
- sure:看清了 true;糊、反光、被挡住、拿不准 false,text 写你觉得最可能的字。
- say:听写时老师怎么念给二年级孩子听。先念这一项,再说一个孩子熟悉的短语或短句把它用进去,让同音字分得开;短语里要有别的字,不能只是把它重复一遍。例如「鼓励,老师鼓励我」「灰色,灰色的小蝌蚪」「叶,树叶的叶」。30 字以内。`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** 模型的一行 → 一项;不是一项(形状不对、不是汉字、超过四个字)→ null */
export function parseItem(v: unknown): PhotoItem | null {
  if (!isObj(v)) return null;
  const t = str(v.text)?.replace(/\s+/g, '') ?? '';
  const cs = Array.from(t);
  if (!cs.length || cs.length > DICTATION_WORD_MAX || !cs.every((c) => HAN.test(c))) return null;
  const kind = PHOTO_KINDS.includes(v.kind as PhotoKind) ? (v.kind as PhotoKind) : 'other';
  const b = Array.isArray(v.box) && v.box.length === 4 && v.box.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v.box as number[]).map((x) => Math.max(0, Math.min(1000, Math.round(x)))) : null;
  const box = b && b[2] > b[0] && b[3] > b[1] ? (b as PhotoItem['box']) : null;
  const say = str(v.say);
  return { text: t, kind, box, sure: v.sure !== false, say: say && Array.from(say).length <= DICTATION_SAY_MAX ? say : null };
}

/**
 * 一行一行地收:吐出来的字攒着,遇到换行就认一行;同一栏同一个字词只留第一个。
 * push(片段) 返回这一下新认出的项;lesson 认出来存在 lesson 上。
 */
export class LineReader {
  items: PhotoItem[] = [];
  lesson: string | null = null;
  private buf = '';
  private seen = new Set<string>();
  push(chunk: string, onItem?: (item: PhotoItem | null, lesson: string | null) => void): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      this.line(this.buf.slice(0, i), onItem);
      this.buf = this.buf.slice(i + 1);
    }
  }
  end(onItem?: (item: PhotoItem | null, lesson: string | null) => void): void {
    this.line(this.buf, onItem);
    this.buf = '';
  }
  private line(raw: string, onItem?: (item: PhotoItem | null, lesson: string | null) => void): void {
    const s = raw.trim().replace(/,$/, '');
    if (!s.startsWith('{') || !s.endsWith('}')) return;
    let v: unknown;
    try {
      v = JSON.parse(s);
    } catch {
      return;
    }
    if (isObj(v) && 'lesson' in v && !('text' in v)) {
      this.lesson = str(v.lesson);
      onItem?.(null, this.lesson);
      return;
    }
    const it = parseItem(v);
    if (!it) return;
    const key = `${it.kind}\n${it.text}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push(it);
    onItem?.(it, this.lesson);
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

/** 认一张照片(流式);出错、超时都不抛,回 {ok: false} 并带上已经认出的项 */
export async function recognizePhoto(image: { data: Buffer; mime: string }, onItem: (item: PhotoItem | null, lesson: string | null) => void = () => {}, opts: { env?: NodeJS.ProcessEnv; endpoint?: string; model?: string; timeoutMs?: number } = {}): Promise<Recognized> {
  const env = opts.env ?? process.env;
  const t0 = Date.now();
  const ms = (): number => Date.now() - t0;
  const reader = new LineReader();
  const fail = (error: string): Recognized => ({ ok: false, error, items: reader.items, lesson: reader.lesson, ms: ms() });
  const key = env.DASHSCOPE_API_KEY?.trim() || localDashscopeKey(env.HOME || homedir());
  if (!key) return fail('no_key');
  const model = opts.model ?? VISION_MODEL;
  try {
    const res = await fetch(opts.endpoint ?? ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.1,
        enable_thinking: false,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data.toString('base64')}` } }, { type: 'text', text: PROMPT }] }],
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
        if (d) reader.push(d, onItem);
      }
    }
    reader.push(deltaOf(sse), onItem);
    reader.end(onItem);
    if (!reader.items.length) return fail('nothing');
    return { ok: true, items: reader.items, lesson: reader.lesson, model, ms: ms() };
  } catch (err) {
    return fail(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network');
  }
}
