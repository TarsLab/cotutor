/**
 * 千问两套账的路由(src/shared/qianwen.ts):Token Plan 有这个模型、本机有它的 key 就走它,否则百炼按量;两把 key 只认 ~/.config/cotutor/ 的两个文件,放错格怎么认。
 * 配音(src/media/tts.ts)发到哪:模型看音色前缀,Token Plan 走它的域名,按量走业务空间的域名。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { keysHome } from './_keys.ts';
import { compatibleLine, qianwenKeys, qianwenLine, DASHSCOPE_HOST, TOKEN_PLAN_HOST } from '../src/shared/qianwen.ts';
import { ttsModelOf, ttsTarget } from '../src/media/tts.ts';

const both = { plan: 'sk-sp-p', payg: 'sk-ws-g' };

check('Token Plan 有的模型(qwen3.8-max、画图 3.0-pro、配音)走 Token Plan', ['qwen3.8-max', 'qwen-image-3.0-pro', 'qwen-audio-3.0-tts-plus'].every((m) => qianwenLine(m, both)?.host === TOKEN_PLAN_HOST && qianwenLine(m, both)?.key === 'sk-sp-p'));
check('Token Plan 没有的(omni、qwen-image-2.0-pro)走按量', ['qwen3.8-omni-flash', 'qwen-image-2.0-pro'].every((m) => qianwenLine(m, both)?.host === DASHSCOPE_HOST && qianwenLine(m, both)?.key === 'sk-ws-g'));
check('只有按量的 key:全走按量', qianwenLine('qwen3.8-max', { plan: null, payg: 'sk-ws-g' })?.plan === false);
check('只有 Token Plan 的 key:它没有的模型拿不到线', qianwenLine('qwen3.8-omni-flash', { plan: 'sk-sp-p', payg: null }) === null && qianwenLine('qwen3.8-max', { plan: 'sk-sp-p', payg: null })?.plan === true);

const home = keysHome({ payg: 'sk-ws-b', workspaceId: 'llm-x', plan: 'sk-sp-a' });
const k1 = qianwenKeys({ HOME: home });
check('两个文件各归各:bailian.json 是按量,token-plan.json 是 Token Plan', k1.plan === 'sk-sp-a' && k1.payg === 'sk-ws-b', JSON.stringify(k1));
const k2 = qianwenKeys({ HOME: keysHome({ payg: 'sk-sp-c', workspaceId: 'llm-x' }) });
check('bailian.json 里是 sk-sp-:认作 Token Plan,按量那格空着', k2.plan === 'sk-sp-c' && k2.payg === null, JSON.stringify(k2));
const k3 = qianwenKeys({ HOME: keysHome({ plan: 'sk-ws-oops' }) });
check('token-plan.json 里不是 sk-sp-:不认', k3.plan === null && k3.payg === null, JSON.stringify(k3));
const stray = keysHome();
mkdirSync(join(stray, '.config', 'voxtell'), { recursive: true });
writeFileSync(join(stray, '.config', 'voxtell', 'config.json'), JSON.stringify({ apiKey: 'sk-ws-vox', workspaceId: 'llm-v' }));
mkdirSync(join(stray, '.qwen'), { recursive: true });
writeFileSync(join(stray, '.qwen', 'settings.json'), JSON.stringify({ env: { DASHSCOPE_API_KEY: 'sk-ws-qwen' } }));
const k4 = qianwenKeys({ HOME: stray, DASHSCOPE_API_KEY: 'sk-ws-env', QWENCLOUD_TOKEN_PLAN_API_KEY: 'sk-sp-env' });
check('环境变量、qwen、voxtell 的配置都不看', k4.plan === null && k4.payg === null, JSON.stringify(k4));

// 老师的脑(兼容接口):Token Plan 有这个模型就走它;按量知道业务空间 id 走它的域名,不知道走公网域名
const cl1 = compatibleLine('qwen3.8-max', { HOME: home });
check('脑:Token Plan 有的模型 → token-plan 的端点与 key', cl1?.plan === true && cl1.baseURL === `https://${TOKEN_PLAN_HOST}/compatible-mode/v1` && cl1.key === 'sk-sp-a', JSON.stringify(cl1));
const cl2 = compatibleLine('qwen3.6-plus', { HOME: home });
check('脑:Token Plan 没有的模型 → 按量,业务空间的域名', cl2?.plan === false && cl2.baseURL === 'https://llm-x.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' && cl2.key === 'sk-ws-b', JSON.stringify(cl2));
const cl3 = compatibleLine('qwen3.8-max', { HOME: keysHome({ payg: 'sk-ws-b' }) });
check('脑:只有按量 key、没有业务空间 id → 公网域名', cl3?.plan === false && cl3.baseURL === `https://${DASHSCOPE_HOST}/compatible-mode/v1`, JSON.stringify(cl3));
check('脑:一把都没有 → null', compatibleLine('qwen3.8-max', { HOME: keysHome() }) === null);

check('配音的模型看音色前缀:plus / flash;没前缀的老短名走 plus', ttsModelOf('qwen-audio-3.0-tts-plus-longcanzhuyue') === 'qwen-audio-3.0-tts-plus' && ttsModelOf('qwen-audio-3.0-tts-flash-longxiaochun') === 'qwen-audio-3.0-tts-flash' && ttsModelOf('longanlingxin') === 'qwen-audio-3.0-tts-plus');
const tts = (u: string): string => `https://${u}/api/v1/services/audio/tts/SpeechSynthesizer`;
const t1 = ttsTarget('qwen-audio-3.0-tts-plus', { HOME: home });
check('配音:Token Plan 有这个模型 → 它的域名与 key', 'url' in t1 && t1.url === tts(TOKEN_PLAN_HOST) && t1.key === 'sk-sp-a' && t1.plan, JSON.stringify(t1));
const t2 = ttsTarget('qwen-audio-3.0-tts-flash', { HOME: home });
check('配音:Token Plan 没有 → 按量那把,业务空间的域名', 'url' in t2 && t2.url === tts('llm-x.cn-beijing.maas.aliyuncs.com') && t2.key === 'sk-ws-b' && !t2.plan, JSON.stringify(t2));
const bare = keysHome();
const t4 = ttsTarget('qwen-audio-3.0-tts-plus', { HOME: keysHome({ payg: 'sk-ws-b' }) });
check('配音:按量没有业务空间 id → 说要它', 'error' in t4 && t4.error.includes('业务空间'), JSON.stringify(t4));
const t5 = ttsTarget('qwen-audio-3.0-tts-plus', { HOME: bare });
check('配音:一把 key 都没有 → 说去家长端填', 'error' in t5 && t5.error.includes('没有百炼的 key'), JSON.stringify(t5));
const t6 = ttsTarget('qwen-audio-3.0-tts-plus', { HOME: bare, COTUTOR_TTS_ENDPOINT: 'http://127.0.0.1:1/tts' });
check('配音:COTUTOR_TTS_ENDPOINT(测试)直接用它,没 key 也行', 'url' in t6 && t6.url === 'http://127.0.0.1:1/tts', JSON.stringify(t6));

done();
