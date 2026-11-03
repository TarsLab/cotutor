/**
 * 家长端「样子与声音」(家长端首页点一位老师的那一行):头像、说话的声音(嘴,全部 56 个)、点读的声音(卡的配音,全部 597 个),点了就存。
 * 声音全给,页面上点「换一个」开弹窗挑:搜、按男女 / 口音 / 中英 / 年纪 / 场景筛;现在用的排最前、出厂的那个标出来。手填头像路径在工作台。
 *
 *   GET  /api/parent/tutors/<老师>/look                          现在用的与可选的(头像、嘴、卡的配音)
 *   PUT  /api/parent/tutors/<老师>/look                          {avatar?: string | null, mouth?: string, voice?: string};回 GET 那份
 *   GET  /api/parent/tutors/<老师>/look/avatar?k=factory|image   选项里那两张图:包里的出厂头像、workspace 里 figshot 画的
 *   GET  /api/parent/tutors/<老师>/look/preview?kind=mouth|card&voice=…   试听,念的句子服务端定(./voice-preview.ts,有缓存)
 *
 * 头像只收选项里的值(不让页面往 cotutor.json 写任意路径);avatar null = 用出厂的(三门主科是木钉娃娃,别的显示学科首字)。
 * 挑回出厂的那个声音就删掉那一项,cotutor.json 里不留和缺省一样的值。
 */
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { REALTIME_VOICES, isRealtimeVoice } from '../../realtime/voices.ts';
import { TTS_VOICES } from '../../media/tts.ts';
import { SHIPPED_CARD_VOICES, SHIPPED_MOUTHS, canonicalSubject, cardVoice, mouthVoice, type CotutorConfig } from '../../schema/index.ts';
import { patchConfig } from '../workspace.ts';
import type { AppContext, RouteResult } from './app.ts';
import { ownAvatar, subjectAvatarFile } from './avatars.ts';
import { cardPreview, mouthPreview } from './voice-preview.ts';

/** 不放 📚 🧮 🔤:旧版 init 写的出厂 emoji,当作没写(avatars.ts) */
const EMOJI = ['📖', '✏️', '🌱', '🦉', '🐼', '⭐'];
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
/** 试听念的句子:学科的口吻 */
const MOUTH_SAMPLE: Readonly<Record<string, string>> = { 语文: '你好呀,今天我们读哪一课?', 数学: '你好呀,今天想算点什么?', 英语: 'Hello! 今天我们学哪几个单词?' };
const CARD_SAMPLE: Readonly<Record<string, string>> = { 语文: '小蝌蚪找妈妈', 数学: '二十八加十五等于四十三', 英语: 'apple, banana, orange' };

/**
 * 一个声音:页面拿这些字段画男女(圆里一个字)、语言口音、年纪、场景的标签与筛选。
 * 嘴的 lang 是口音(普通话 / 粤语 / 四川话……),卡的配音的 lang 是中文 / 英文;age、scene 只有卡的配音有;
 * warn 是要提醒家长的一句(中英夹着说时中文带英文腔,英语老师的讲稿就是这样)。
 */
interface VoiceOption { voice: string; name: string; gender: string; lang: string; trait: string; age?: number; scene?: string; warn?: string; shipped: boolean }
interface AvatarOption { value: string | null; label: string; img?: string; text?: string }

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const bad = (message: string): RouteResult => ({ status: 400, json: { error: 'bad_request', message } });

/** 现在用的排最前,出厂的其次,别的照表里的先后 */
const ranked = <T extends { voice: string }>(all: readonly T[], current: string | undefined, shipped: string | undefined): T[] => {
  const rank = (v: T): number => (v.voice === current ? 0 : v.voice === shipped ? 1 : 2);
  return [...all].sort((a, b) => rank(a) - rank(b));
};

/** 表里十几种「某某型客服」并成一个场景,筛的时候不占一排 */
const sceneOf = (scene: string): string => (scene.endsWith('客服') ? '客服' : scene);

function mouthOptions(c: CotutorConfig, name: string): VoiceOption[] {
  const current = mouthVoice(c.live, name);
  const known = REALTIME_VOICES.some((v) => v.voice === current) ? [] : [{ voice: current, name: current, gender: '', trait: '', lang: '普通话' }];
  return ranked([...known, ...REALTIME_VOICES], current, SHIPPED_MOUTHS[name]).map((v) => {
    // 表里的「(缺省)」是说 realtime 模型自己的缺省,家长用不着;「;中英夹着说……」拆成 warn
    const [trait, extra = ''] = v.trait.replace(/\(缺省\)$/, '').split(';');
    return { voice: v.voice, name: v.name, gender: v.gender, lang: v.lang, trait, ...(extra.includes('英文腔') ? { warn: '中英夹着说带英文腔' } : {}), shipped: SHIPPED_MOUTHS[name] === v.voice };
  });
}

function cardOptions(c: CotutorConfig, name: string): VoiceOption[] {
  const current = cardVoice(c.tutors, name);
  const known = !current || TTS_VOICES.some((v) => v.voice === current) ? [] : [{ voice: current, name: current, gender: '', age: 0, trait: '', scene: '', lang: '中文' }];
  return ranked([...known, ...TTS_VOICES], current, SHIPPED_CARD_VOICES[name]).map((v) => ({
    voice: v.voice, name: v.name, gender: v.gender === '女' || v.gender === '男' ? v.gender : '', lang: v.lang, trait: v.trait,
    ...(v.age ? { age: v.age } : {}), ...(v.scene ? { scene: sceneOf(v.scene) } : {}), shipped: SHIPPED_CARD_VOICES[name] === v.voice,
  }));
}

/** figshot 画的图:现在用着的那张,或 workspace 里 avatars/<老师>.png 之类(换回别的以后还能选回来) */
function imageAvatar(ctx: AppContext, name: string): string | null {
  const own = ownAvatar(ctx.ws.config.tutors[name]);
  if (own && IMAGE_RE.test(own)) return own;
  for (const ext of ['png', 'webp', 'jpg']) if (existsSync(join(ctx.ws.root, 'avatars', `${name}.${ext}`))) return `avatars/${name}.${ext}`;
  return null;
}

function avatarOptions(ctx: AppContext, name: string): AvatarOption[] {
  const t = ctx.ws.config.tutors[name];
  const base = `/api/parent/tutors/${name}/look/avatar`;
  const out: AvatarOption[] = [];
  if (subjectAvatarFile(t.subject)) out.push({ value: null, label: '木钉娃娃', img: `${base}?k=factory` });
  const img = imageAvatar(ctx, name);
  if (img) out.push({ value: img, label: 'figshot 画的', img: `${base}?k=image` });
  const ch = (t.subject || t.display || '?').slice(0, 1);
  out.push({ value: ch, label: '学科字', text: ch });
  for (const e of EMOJI) out.push({ value: e, label: '', text: e });
  return out;
}

function look(ctx: AppContext, name: string): Record<string, unknown> {
  const c = ctx.ws.config;
  const t = c.tutors[name];
  const own = ownAvatar(t);
  return {
    tutor: { name, display: t.display },
    // 没写的、写的值不在选项里(工作台手填的)都照实给,页面只是哪格都不亮
    avatar: { current: own, options: avatarOptions(ctx, name) },
    mouth: { current: mouthVoice(c.live, name), options: mouthOptions(c, name) },
    card: { current: cardVoice(c.tutors, name) ?? null, options: cardOptions(c, name) },
  };
}

export async function parentLookRoute(method: string, p: string, url: URL, ctx: AppContext, body: unknown): Promise<RouteResult | null> {
  const m = /^\/api\/parent\/tutors\/([a-z0-9][a-z0-9-]*)\/look(?:\/(avatar|preview))?$/.exec(p);
  if (!m) return null;
  const [, name, sub] = m;
  const t = ctx.ws.config.tutors[name];
  if (!t || !name.endsWith('-tutor')) return { status: 404, json: { error: 'no_such_tutor' } };
  const subject = canonicalSubject(t.subject) ?? '';
  if (sub === 'avatar') {
    if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
    if (url.searchParams.get('k') === 'factory') {
      const file = subjectAvatarFile(t.subject);
      return file ? { status: 200, file, contentType: 'image/webp', cacheControl: 'max-age=86400' } : { status: 404, json: { error: 'not_found' } };
    }
    const rel = imageAvatar(ctx, name);
    const file = rel ? resolve(ctx.ws.root, rel) : '';
    if (!rel || !file.startsWith(ctx.ws.root + sep) || !existsSync(file)) return { status: 404, json: { error: 'not_found' } };
    const ext = (IMAGE_RE.exec(rel)?.[1] ?? '').toLowerCase();
    return { status: 200, file, contentType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', cacheControl: 'no-cache' };
  }
  if (sub === 'preview') {
    if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
    const voice = url.searchParams.get('voice')?.trim() ?? '';
    return url.searchParams.get('kind') === 'card' ? cardPreview(ctx.ws, voice, CARD_SAMPLE[subject] ?? CARD_SAMPLE.语文) : mouthPreview(ctx.ws, voice, MOUTH_SAMPLE[subject] ?? MOUTH_SAMPLE.语文);
  }
  if (method === 'GET') return { status: 200, json: look(ctx, name) };
  if (method !== 'PUT') return { status: 405, json: { error: 'method_not_allowed' } };
  if (!isObj(body)) return bad('要 {avatar?, mouth?, voice?}');
  const tutor: Record<string, unknown> = {};
  const patch: Record<string, unknown> = { tutors: { [name]: tutor } };
  if ('avatar' in body) {
    const ok = avatarOptions(ctx, name).some((o) => o.value === body.avatar);
    if (!ok) return bad('头像只能从给的几个里挑;别的(图片路径、别的 emoji)到工作台的「老师团」改');
    tutor.avatar = body.avatar;
  }
  if (body.mouth !== undefined) {
    if (typeof body.mouth !== 'string' || !isRealtimeVoice(body.mouth)) return bad(`说话的声音不认「${String(body.mouth)}」`);
    patch.live = { voices: { [name]: body.mouth === SHIPPED_MOUTHS[name] ? null : body.mouth } };
  }
  if (body.voice !== undefined) {
    if (typeof body.voice !== 'string' || !TTS_VOICES.some((v) => v.voice === body.voice)) return bad(`点读的声音不认「${String(body.voice)}」`);
    tutor.voice = body.voice === SHIPPED_CARD_VOICES[name] ? null : body.voice;
  }
  try {
    await patchConfig(ctx.ws, patch);
  } catch (err) {
    return bad(err instanceof Error ? err.message : String(err));
  }
  await ctx.reload();
  return { status: 200, json: look(ctx, name) };
}
