/**
 * 家长端「首页」:家长在 iPad / 手机上设孩子的首页。
 * 按钮与听写的词改的是已发布那份首页的原文(editPublished:检查、留历史、发布);开关与几项常改的设置写回 cotutor.json(patchConfig)。
 * 页面每次现读,不缓存:家长也可能同时在编辑器里改 cotutor.json、在编程助手里发布首页。
 *
 *   GET   /api/parent/home                          老师们(按首页的先后)、各自的按钮(带讲法)、听写的词、常驻入口;口语课与孩子端的几项设置
 *   PUT   /api/parent/home/tutors/<老师>/buttons     {buttons: [{kind, label, brief?, until?, date?, thread?, bundle?}]} 换掉这位老师的按钮
 *   PUT   /api/parent/home/tutors/<老师>/dictation   {words: [{chars, say?}]} 这周的词;[] = 删掉
 *   PUT   /api/parent/home/order                    {tutors: [老师…]} 老师的先后(排第一的进首页时在最前)
 *   PATCH /api/parent/settings                      {tutors?: {<老师>: {extras?: [..] | null, hidden?}}, talk?: {note?, minutes?}}
 *   GET   /api/parent/qr                            孩子端与家长端地址的二维码(各有主机名一张、局域网 IP 一张)、是不是 HTTPS、孩子的设备连过几台、上次什么时候;服务没在听(测试走 route)→ {ready: false}
 */
import { DICTATION_EN_MAX, DICTATION_WORD_MAX, DICTATION_WORDS_MAX, TUTOR_BUTTONS_MAX, TutorButtonSchema, dictationWordLang, type DictationLang, type TutorButton } from '../../board/cards/index.ts';
import { existsSync } from 'node:fs';
import { localDate } from '../../shared/time.ts';
import { orderTutors, setTutorButtons, setTutorDictation } from '../../runtime/home/edit.ts';
import { AGENT_NAME_RE, HOME_TILES, HOME_TILE_IDS, TUTOR_EXTRAS, cardVoice, mouthVoice, subjectLang, tutorExtras, tutorTiles, type CotutorConfig, type HomeTileId } from '../../schema/index.ts';
import { findActivityFile } from '../../runtime/activities.ts';
import { REALTIME_VOICES } from '../../realtime/voices.ts';
import { TTS_VOICES } from '../../media/tts.ts';
import type { AppContext, RouteResult } from './app.ts';
import { editPublished, readPublished, usableActivity, type PublishResult } from '../../runtime/home/store.ts';
import { patchConfig } from '../workspace.ts';
import { tutorColors } from '../../ui/shared/tutor-color.ts';
import { wordEmoji } from '../../ui/kid/word-emoji.ts';
import { shownAvatar } from './avatars.ts';
import { qrNotes, qrSvg } from '../../ui/shared/qr-svg.ts';
import { readDevices } from '../../runtime/journal/kid-log.ts';
import { parentSetupRoute } from './parent-setup.ts';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (message: string): RouteResult => ({ status: 400, json: { error: 'bad_request', message } });

/** 家长端列的老师:有脸的(-tutor 结尾)、开着的;藏着的也列(家长要能把他放回首页) */
const faceTutors = (c: CotutorConfig): string[] => Object.entries(c.tutors).filter(([n, t]) => n.endsWith('-tutor') && t.enabled).map(([n]) => n);

export interface ParentHomeTutor {
  name: string;
  display: string;
  avatar: string | null;
  subject: string | null;
  hidden: boolean;
  /** 卡上的常驻入口(按学科补过缺省的);extrasSet = cotutor.json 里写的(没写 = null,走缺省) */
  extras: string[];
  extrasSet: string[] | null;
  /** 常驻的方砖(HOME_TILES 的先后):家里有那个 activity 文件的才列;on = 没关掉,usable = 文件检查过得去(写坏了孩子端不出) */
  tiles: { id: HomeTileId; label: string; on: boolean; usable: boolean }[];
  /** 首页里这位老师的按钮(文件里的,带讲法与留到) */
  buttons: TutorButton[];
  /** 这周的词:写了这位老师的听写卡;没有 = null */
  dictation: { chars: string; say?: string; emoji?: string }[] | null;
  /** 他的听写是哪种:学科是英语(含别名)= en(英文单词),别的 zh */
  lang: DictationLang;
  /** 学科色(src/ui/shared/tutor-color.ts) */
  color: string;
  /** 「样子与声音」那一行:说话的声音、点读的声音叫什么(点开见 ./parent-look.ts);点读没配 = null */
  voices: { mouth: string; card: string | null };
}

/** 音色 id → 官方的中文名(没在表里的照写 id) */
function voiceNames(c: CotutorConfig, name: string): { mouth: string; card: string | null } {
  const mouth = mouthVoice(c.live, name);
  const card = cardVoice(c.tutors, name);
  return { mouth: REALTIME_VOICES.find((v) => v.voice === mouth)?.name ?? mouth, card: card ? (TTS_VOICES.find((v) => v.voice === card)?.name ?? card) : null };
}

export async function parentHome(ctx: AppContext): Promise<Record<string, unknown>> {
  const c = ctx.ws.config;
  const { home } = await readPublished(ctx.ws);
  const cards = home?.cards ?? [];
  const names = faceTutors(c);
  const colors = tutorColors(c.tutors);
  // 先后 = 首页里老师卡的先后,没写卡的照 cotutor.json 的顺序排在后面
  const written = cards.filter((x) => x.kind === 'tutor').map((x) => String(x.props.tutor)).filter((n, i, a) => names.includes(n) && a.indexOf(n) === i);
  const order = [...written, ...names.filter((n) => !written.includes(n))];
  const tilesOf = async (name: string): Promise<ParentHomeTutor['tiles']> => {
    const on = tutorTiles(c.tutors[name]);
    const out: ParentHomeTutor['tiles'] = [];
    for (const t of HOME_TILES) {
      if (!existsSync(findActivityFile(ctx.ws.root, name, t.activity))) continue;
      out.push({ id: t.id, label: t.activity, on: on.includes(t.id), usable: Boolean(await usableActivity(ctx.ws, name, t.activity)) });
    }
    return out;
  };
  const tiles = new Map<string, ParentHomeTutor['tiles']>();
  for (const name of order) tiles.set(name, await tilesOf(name));
  const tutors: ParentHomeTutor[] = order.map((name) => {
    const t = c.tutors[name];
    const card = cards.find((x) => x.kind === 'tutor' && x.props.tutor === name);
    const dict = cards.find((x) => x.kind === 'dictation' && x.props.tutor === name);
    return {
      name,
      display: t.display,
      avatar: shownAvatar(t),
      subject: t.subject ?? null,
      hidden: t.hidden,
      extras: tutorExtras(t, c.talk.enabled),
      extrasSet: t.extras ?? null,
      tiles: tiles.get(name) ?? [],
      buttons: ((card?.props.buttons ?? []) as TutorButton[]),
      dictation: dict ? ((dict.props.words ?? []) as { chars: string; say?: string; emoji?: string }[]) : null,
      lang: subjectLang(t.subject),
      color: colors[name],
      voices: voiceNames(c, name),
    };
  });
  return {
    title: c.title,
    kid: c.kid.name ?? '',
    today: localDate(ctx.now()),
    home: home ? { id: home.id, publishedAt: home.publishedAt } : null,
    tutors,
    talk: { enabled: c.talk.enabled, note: c.talk.note ?? '', minutes: c.talk.minutes },
    extrasAll: TUTOR_EXTRAS,
  };
}

/** 表单交来的按钮:形状照老师卡的协议;最多 TUTOR_BUTTONS_MAX 个 */
function parseButtons(v: unknown): TutorButton[] | string {
  if (!Array.isArray(v)) return '要 {buttons: [...]}';
  if (v.length > TUTOR_BUTTONS_MAX) return `按钮最多 ${TUTOR_BUTTONS_MAX} 个(「新话题」不算)`;
  const out: TutorButton[] = [];
  for (const b of v) {
    const r = TutorButtonSchema.safeParse(isObj(b) ? Object.fromEntries(Object.entries(b).filter(([, x]) => x !== '' && x !== null)) : b);
    if (!r.success) return `按钮不对:${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(';')}`;
    if (/\n/.test(r.data.label)) return '按钮的字只写一行';
    out.push(r.data);
  }
  return out;
}

/** 这周的词:语文老师一到四个汉字;英语老师(学科「英语」)一个英文单词 */
function parseWords(v: unknown, lang: DictationLang): { chars: string; say?: string }[] | string {
  if (!Array.isArray(v)) return '要 {words: [{chars, say?}]}';
  if (v.length > DICTATION_WORDS_MAX) return `一次最多 ${DICTATION_WORDS_MAX} 个词`;
  const out: { chars: string; say?: string }[] = [];
  for (const w of v) {
    if (!isObj(w) || typeof w.chars !== 'string') return '每个词要 {chars, say?}';
    const chars = lang === 'en' ? w.chars.trim() : w.chars.replace(/\s+/g, '');
    if (dictationWordLang(chars) !== lang) return lang === 'en' ? `「${w.chars}」:一行一个英文单词(只要字母,最多 ${DICTATION_EN_MAX} 个)` : `「${w.chars}」:一个词一到 ${DICTATION_WORD_MAX} 个汉字`;
    const say = typeof w.say === 'string' ? w.say.replace(/\s+/g, ' ').trim() : '';
    out.push({ chars, ...(say ? { say } : {}) });
  }
  return out;
}

/**
 * 英文单词配 emoji(只在对一对时出):已发布的那张卡上同一个单词配过的照用,剩下的问一次 qwen3.8-flash;问不到就不配。
 * COTUTOR_EMOJI_ENDPOINT:测试与探针指到假的千问
 */
async function withEmoji(ctx: AppContext, name: string, words: { chars: string; say?: string }[]): Promise<{ chars: string; say?: string; emoji?: string }[]> {
  const { home } = await readPublished(ctx.ws);
  const had = new Map<string, string>();
  for (const c of home?.cards ?? []) if (c.kind === 'dictation' && c.props.tutor === name) for (const w of (c.props.words ?? []) as { chars: string; emoji?: string }[]) if (w.emoji) had.set(w.chars, w.emoji);
  const ask = [...new Set(words.map((w) => w.chars).filter((w) => !had.has(w)))];
  const fake = process.env.COTUTOR_EMOJI_ENDPOINT;
  const got = ask.length ? await wordEmoji(ask, fake ? { endpoint: fake } : {}) : {};
  return words.map((w) => { const e = had.get(w.chars) ?? got[w.chars]; return e ? { ...w, emoji: e } : w; });
}

/** 发布的结果:有「要改」的不发,把检查说的回给页面 */
function published(r: PublishResult | null): RouteResult {
  if (r && !r.ok) return { status: 400, json: { error: 'home_check', message: r.check.issues.filter((i) => i.level === 'fix').map((i) => i.text).join(';') || '首页检查没过' } };
  return { status: 200, json: { ok: true, home: r?.home ? { id: r.home.id, publishedAt: r.home.publishedAt } : null, changed: Boolean(r) } };
}

/** 首页上「扫码打开」那块:孩子的平板一张(孩子端 /)、家长自己的手机一张(家长端 /parent);编什么地址由服务端定(同 /parent/qr,不看请求的 Host);连过的设备拿来定这块缺省开着还是收着 */
async function kidQr(ctx: AppContext): Promise<Record<string, unknown>> {
  const info = ctx.listen?.() ?? null;
  if (!info) return { ready: false };
  const devices = Object.values(await readDevices(ctx.ws));
  const last = devices.map((d) => d.last).sort().at(-1) ?? null;
  const parent = { url: `${info.name}parent`, ip: info.ip ? `${info.ip}parent` : null };
  return {
    ready: true, https: info.https, url: info.name, svg: qrSvg(info.name), ip: info.ip, svgIp: info.ip ? qrSvg(info.ip) : null,
    parent: { ...parent, svg: qrSvg(parent.url), svgIp: parent.ip ? qrSvg(parent.ip) : null },
    notes: qrNotes(info.https).slice(1), devices: devices.length, last,
  };
}

export async function parentHomeRoute(method: string, p: string, ctx: AppContext, body: unknown): Promise<RouteResult | null> {
  const care = await parentSetupRoute(method, p, ctx, body);
  if (care) return care;
  if (p === '/api/parent/home' && method === 'GET') return { status: 200, json: await parentHome(ctx) };
  if (p === '/api/parent/qr' && method === 'GET') return { status: 200, json: await kidQr(ctx) };
  const names = faceTutors(ctx.ws.config);
  const tb = /^\/api\/parent\/home\/tutors\/([^/]+)\/(buttons|dictation)$/.exec(p);
  if (tb) {
    if (method !== 'PUT') return { status: 405, json: { error: 'method_not_allowed' } };
    const name = decodeURIComponent(tb[1]);
    if (!names.includes(name)) return { status: 404, json: { error: 'no_such_tutor' } };
    const b = isObj(body) ? body : {};
    if (tb[2] === 'buttons') {
      const buttons = parseButtons(b.buttons);
      if (typeof buttons === 'string') return bad(buttons);
      return published(await editPublished(ctx.ws, (md) => setTutorButtons(md, name, buttons), ctx.now()));
    }
    const lang = subjectLang(ctx.ws.config.tutors[name].subject);
    const parsed = parseWords(b.words, lang);
    if (typeof parsed === 'string') return bad(parsed);
    const words = lang === 'en' ? await withEmoji(ctx, name, parsed) : parsed;
    return published(await editPublished(ctx.ws, (md) => setTutorDictation(md, name, words), ctx.now()));
  }
  if (p === '/api/parent/home/order') {
    if (method !== 'PUT') return { status: 405, json: { error: 'method_not_allowed' } };
    const list = isObj(body) && Array.isArray(body.tutors) ? body.tutors : null;
    if (!list || list.some((n) => typeof n !== 'string' || !names.includes(n))) return bad('要 {tutors: [老师…]}(cotutor.json 里开着的、-tutor 结尾的)');
    return published(await editPublished(ctx.ws, (md) => orderTutors(md, list as string[]), ctx.now()));
  }
  if (p === '/api/parent/settings') {
    // 设置页(/parent/settings)读的:孩子的平板上按住说话那一栏放哪边(kid.hand;缺省 right = 栏在左边)
    if (method === 'GET') return { status: 200, json: { title: ctx.ws.config.title, hand: ctx.ws.config.kid.hand ?? 'right' } };
    if (method !== 'PATCH') return { status: 405, json: { error: 'method_not_allowed' } };
    if (!isObj(body)) return bad('要一个 JSON 对象');
    const patch: Record<string, unknown> = {};
    if (body.tutors !== undefined) {
      if (!isObj(body.tutors)) return bad('tutors 要 {<老师>: {extras?, hidden?, tiles?}}');
      const tp: Record<string, unknown> = {};
      for (const [name, v] of Object.entries(body.tutors)) {
        if (!names.includes(name) || !AGENT_NAME_RE.test(name) || !isObj(v)) return bad(`没有这位老师:${name}`);
        const one: Record<string, unknown> = {};
        if (v.extras !== undefined) {
          if (v.extras !== null && (!Array.isArray(v.extras) || v.extras.some((x) => !(TUTOR_EXTRAS as readonly unknown[]).includes(x)))) return bad(`extras 只认 ${TUTOR_EXTRAS.join(' / ')}(null = 按学科的缺省)`);
          one.extras = v.extras;
        }
        if (v.hidden !== undefined) {
          if (typeof v.hidden !== 'boolean') return bad('hidden 要 true / false');
          one.hidden = v.hidden;
        }
        // 方砖:{preview?: true/false, …};cotutor.json 只记关掉的(开 = 删掉那一项)
        if (v.tiles !== undefined) {
          if (!isObj(v.tiles) || Object.entries(v.tiles).some(([k, x]) => !(HOME_TILE_IDS as readonly string[]).includes(k) || typeof x !== 'boolean')) return bad(`tiles 要 {${HOME_TILE_IDS.join(' / ')}: true / false}`);
          const off = { ...(ctx.ws.config.tutors[name].tiles ?? {}), ...Object.fromEntries(Object.entries(v.tiles).map(([k, x]) => [k, x ? undefined : false])) };
          const left = Object.entries(off).filter(([, x]) => x === false);
          // 全开着 = 整个 tiles 删掉(null);不然只留关掉的那几项(开了的写 null 删掉)
          one.tiles = left.length ? Object.fromEntries(Object.keys(off).map((k) => [k, off[k as HomeTileId] === false ? false : null])) : null;
        }
        tp[name] = one;
      }
      patch.tutors = tp;
    }
    if (body.talk !== undefined) {
      if (!isObj(body.talk)) return bad('talk 要 {note?, minutes?}');
      const t: Record<string, unknown> = {};
      if (body.talk.note !== undefined) {
        if (typeof body.talk.note !== 'string') return bad('talk.note 要一段字');
        t.note = body.talk.note.trim() ? body.talk.note.trim() : null;
      }
      if (body.talk.minutes !== undefined) t.minutes = body.talk.minutes;
      patch.talk = t;
    }
    // 孩子的平板(设置页):只收 kid.hand;缺省的 right 不写进文件
    if (body.kid !== undefined) {
      if (!isObj(body.kid) || Object.keys(body.kid).some((k) => k !== 'hand') || (body.kid.hand !== 'left' && body.kid.hand !== 'right')) return bad('kid 只收 {hand: left / right}');
      patch.kid = { hand: body.kid.hand === 'left' ? 'left' : null };
    }
    try {
      await patchConfig(ctx.ws, patch, { also: ['talk', 'kid'] });
    } catch (err) {
      return bad(err instanceof Error ? err.message : String(err));
    }
    await ctx.reload();
    return { status: 200, json: await parentHome(ctx) };
  }
  return null;
}
