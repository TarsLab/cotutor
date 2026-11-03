/**
 * 家长端「样子与声音」(src/app/http/parent-look.ts):出厂的点读声音照 Ray 的配置;声音全给(现在用的排最前、出厂的其次);点了就存,挑回出厂的那个就删掉那一项;
 * 头像只收选项里的值;figshot 画的图在 workspace 里就多一格;两张图取得到;试听念服务端定的句子(假百炼,不花钱)。
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-look-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
const { startFakeTts } = await import('./_fake-tts.ts');
const tts = await startFakeTts();
process.env.COTUTOR_TTS_ENDPOINT = tts.url;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
const { cardVoice, SHIPPED_CARD_VOICES } = await import('../src/schema/index.ts');

type Opt = { voice: string; name: string; gender: string; lang: string; trait: string; age?: number; scene?: string; warn?: string; shipped: boolean };
type Look = { tutor: { name: string; display: string }; avatar: { current: string | null; options: { value: string | null; label: string; img?: string; text?: string }[] }; mouth: { current: string; options: Opt[] }; card: { current: string | null; options: Opt[] } };

try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ctx = createContext(loadWorkspace(root));
  const call = (method: string, p: string, body?: unknown) => route(method, p, ctx, body);
  const get = async (): Promise<Look> => (await call('GET', '/api/parent/tutors/chinese-tutor/look')).json as Look;
  const cfg = (): Record<string, any> => JSON.parse(readFileSync(join(root, 'cotutor.json'), 'utf8'));

  // ---- 出厂的点读声音:cotutor.json 不写,三位各一个(照 Ray 的) ----
  check('出厂的点读声音:照 Ray 的,不写进 cotutor.json', cardVoice(ctx.ws.config.tutors, 'chinese-tutor') === 'qwen-audio-3.0-tts-plus-longfengyutong' && cardVoice(ctx.ws.config.tutors, 'math-tutor') === 'qwen-audio-3.0-tts-plus-longyingsongliu' && cardVoice(ctx.ws.config.tutors, 'english-tutor') === 'qwen-audio-3.0-tts-plus-loongnorahu' && !('voice' in cfg().tutors['chinese-tutor']));
  check('别的老师没配就不配音', cardVoice({ 'science-tutor': {} }, 'science-tutor') === undefined && Object.keys(SHIPPED_CARD_VOICES).length === 3);

  // ---- 读 ----
  const l0 = await get();
  check('头像:没写(用出厂的);第一格木钉娃娃(值 null),有学科字与几个 emoji(不含旧版出厂的 📚);还没有 figshot 画的', l0.avatar.current === null && l0.avatar.options[0].value === null && l0.avatar.options[0].img?.endsWith('?k=factory') === true && l0.avatar.options.some((o) => o.value === '语' && o.label === '学科字') && l0.avatar.options.some((o) => o.value === '📖') && !l0.avatar.options.some((o) => o.value === '📚') && !l0.avatar.options.some((o) => o.label === 'figshot 画的'), JSON.stringify(l0.avatar));
  check('说话的声音:全部 56 个;现在是出厂的苏瑶(Serena),排第一、标出厂', l0.mouth.current === 'Serena' && l0.mouth.options.length === 56 && l0.mouth.options[0].voice === 'Serena' && l0.mouth.options[0].shipped && l0.mouth.options[0].name === '苏瑶' && l0.mouth.options.filter((o) => o.shipped).length === 1, JSON.stringify(l0.mouth.options[0]));
  const tina = l0.mouth.options.find((o) => o.voice === 'Tina');
  const sichuan = l0.mouth.options.find((o) => o.voice === 'Sunny');
  const mia = l0.mouth.options.find((o) => o.voice === 'Mia');
  check('说话的声音:特点不带表里的「(缺省)」;lang 是口音;每个都标了男女', tina?.trait === '甜美温暖,解决问题果断' && tina.gender === '女' && sichuan?.lang === '四川话' && l0.mouth.options.find((o) => o.voice === 'Raymond')?.gender === '男' && l0.mouth.options.every((o) => o.gender === '男' || o.gender === '女'), JSON.stringify([tina, sichuan]));
  check('说话的声音:中英夹着说带英文腔的拆成 warn(舒然、詹妮弗),别的没有', mia?.trait === '细腻,生活美学风格的温柔博主' && mia.warn === '中英夹着说带英文腔' && l0.mouth.options.filter((o) => o.warn).map((o) => o.voice).sort().join() === 'Jennifer,Mia', JSON.stringify(mia));
  const c0 = l0.card.options[0];
  check('点读的声音:全部 597 个;现在是出厂的龙凤雨桐,排第一、标出厂;男女、年纪、特点、场景各一栏', l0.card.current === 'qwen-audio-3.0-tts-plus-longfengyutong' && l0.card.options.length === 597 && c0.shipped && c0.gender === '女' && c0.age === 27 && c0.trait === '标准播音音' && c0.scene === '新闻播报' && c0.lang === '中文', JSON.stringify(c0));
  check('点读的声音:十几种「某某型客服」并成一个场景「客服」', l0.card.options.some((o) => o.scene === '客服') && !l0.card.options.some((o) => o.scene && o.scene !== '客服' && o.scene.endsWith('客服')));
  const lm = (await call('GET', '/api/parent/tutors/english-tutor/look')).json as Look;
  check('英语老师:出厂的予安、Nora Hu 排第一;英文的音色 lang 是英文', lm.mouth.options[0].voice === 'Theo Calm' && lm.card.options[0].name === 'Nora Hu' && lm.card.options[0].lang === '英文');
  check('不是老师 → 404', (await call('GET', '/api/parent/tutors/nobody-tutor/look')).status === 404);

  // ---- 存 ----
  const s1 = (await call('PUT', '/api/parent/tutors/chinese-tutor/look', { mouth: 'Maia', voice: 'qwen-audio-3.0-tts-plus-longliuxulan', avatar: '📖' })).json as Look;
  check('点了就存:说话、点读、头像都写进 cotutor.json,回新的', s1.mouth.current === 'Maia' && s1.card.current === 'qwen-audio-3.0-tts-plus-longliuxulan' && s1.avatar.current === '📖' && cfg().live.voices['chinese-tutor'] === 'Maia' && cfg().tutors['chinese-tutor'].voice === 'qwen-audio-3.0-tts-plus-longliuxulan' && cfg().tutors['chinese-tutor'].avatar === '📖', JSON.stringify(cfg().tutors['chinese-tutor']));
  check('热重载了:服务里用的也是新的', ctx.ws.config.live.voices['chinese-tutor'] === 'Maia');
  const s2 = (await call('PUT', '/api/parent/tutors/chinese-tutor/look', { mouth: 'Serena', voice: 'qwen-audio-3.0-tts-plus-longfengyutong', avatar: null })).json as Look;
  check('挑回出厂的:那几项从 cotutor.json 删掉,不留和缺省一样的值', s2.mouth.current === 'Serena' && s2.avatar.current === null && !('chinese-tutor' in (cfg().live?.voices ?? {})) && !('voice' in cfg().tutors['chinese-tutor']) && !('avatar' in cfg().tutors['chinese-tutor']), JSON.stringify({ live: cfg().live, t: cfg().tutors['chinese-tutor'] }));
  const badA = await call('PUT', '/api/parent/tutors/chinese-tutor/look', { avatar: '../../etc/x.png' });
  check('头像只收选项里的值:别的 400,说去工作台', badA.status === 400 && String((badA.json as { message: string }).message).includes('工作台'));
  check('不认的声音 400', (await call('PUT', '/api/parent/tutors/chinese-tutor/look', { mouth: 'Bella' })).status === 400 && (await call('PUT', '/api/parent/tutors/chinese-tutor/look', { voice: 'qwen-audio-3.0-tts-plus-nope' })).status === 400);
  const cindy = (await call('PUT', '/api/parent/tutors/chinese-tutor/look', { mouth: 'Cindy' })).json as Look;
  check('换了以后:现在用的排第一,出厂的苏瑶第二', cindy.mouth.options[0].voice === 'Cindy' && cindy.mouth.options[1].voice === 'Serena' && cindy.mouth.options.length === 56);

  // ---- figshot 画的图:workspace 里有就多一格,换走了也还能选回来 ----
  mkdirSync(join(root, 'avatars'), { recursive: true });
  writeFileSync(join(root, 'avatars', 'chinese-tutor.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5G8AAAAASUVORK5CYII=', 'base64'));
  const l1 = await get();
  const fig = l1.avatar.options.find((o) => o.label === 'figshot 画的');
  check('figshot 画的那张多一格,值是 workspace 里的相对路径', fig?.value === 'avatars/chinese-tutor.png' && fig.img?.endsWith('?k=image') === true, JSON.stringify(fig));
  check('选它就存那个路径', ((await call('PUT', '/api/parent/tutors/chinese-tutor/look', { avatar: 'avatars/chinese-tutor.png' })).json as Look).avatar.current === 'avatars/chinese-tutor.png');
  const imgF = await call('GET', '/api/parent/tutors/chinese-tutor/look/avatar?k=factory');
  const imgI = await call('GET', '/api/parent/tutors/chinese-tutor/look/avatar?k=image');
  check('两张图都取得到:出厂的 webp、figshot 的 png', imgF.status === 200 && imgF.contentType === 'image/webp' && imgI.status === 200 && imgI.contentType === 'image/png');

  // ---- 试听:念服务端定的句子(学科的口吻),不收页面给的字 ----
  const pv = await call('GET', `/api/parent/tutors/chinese-tutor/look/preview?kind=card&voice=${encodeURIComponent('qwen-audio-3.0-tts-plus-longliuxulan')}&text=${encodeURIComponent('随便一句')}`);
  check('试听点读的声音:合成服务端定的那句', pv.status === 200 && pv.contentType === 'audio/mpeg' && tts.requests.at(-1)?.text === '小蝌蚪找妈妈', JSON.stringify(tts.requests.at(-1)));
  check('试听:说话的声音不认的 400', (await call('GET', '/api/parent/tutors/chinese-tutor/look/preview?kind=mouth&voice=Bella')).status === 400);

  // ---- 页面 ----
  const page = (await call('GET', '/parent/home')).html ?? '';
  check('家长端首页:有「样子与声音」,走 /api/parent/tutors/<老师>/look', page.includes('样子与声音') && page.includes("'/look'"));
} finally {
  await tts.close();
}
done();
