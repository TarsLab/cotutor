/**
 * 千问两套账的路由(src/shared/qianwen.ts):Token Plan 有这个模型、本机有它的 key 就走它,否则百炼按量;两把 key 从哪找、放错格怎么认。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { qianwenKeys, qianwenLine, DASHSCOPE_HOST, TOKEN_PLAN_HOST } from '../src/shared/qianwen.ts';
import { voxtellEnv } from '../src/media/tts.ts';

const home = mkdtempSync(join(tmpdir(), 'cotutor-qianwen-'));
const both = { plan: 'sk-sp-p', payg: 'sk-ws-g' };

check('Token Plan 有的模型(qwen3.8-max、画图 3.0-pro、配音)走 Token Plan', ['qwen3.8-max', 'qwen-image-3.0-pro', 'qwen-audio-3.0-tts-plus'].every((m) => qianwenLine(m, both)?.host === TOKEN_PLAN_HOST && qianwenLine(m, both)?.key === 'sk-sp-p'));
check('Token Plan 没有的(omni、qwen-image-2.0-pro)走按量', ['qwen3.8-omni-flash', 'qwen-image-2.0-pro'].every((m) => qianwenLine(m, both)?.host === DASHSCOPE_HOST && qianwenLine(m, both)?.key === 'sk-ws-g'));
check('只有按量的 key:全走按量', qianwenLine('qwen3.8-max', { plan: null, payg: 'sk-ws-g' })?.plan === false);
check('只有 Token Plan 的 key:它没有的模型拿不到线', qianwenLine('qwen3.8-omni-flash', { plan: 'sk-sp-p', payg: null }) === null && qianwenLine('qwen3.8-max', { plan: 'sk-sp-p', payg: null })?.plan === true);

const k1 = qianwenKeys({ HOME: home, QWENCLOUD_TOKEN_PLAN_API_KEY: 'sk-sp-a', DASHSCOPE_API_KEY: 'sk-ws-b' });
check('两个环境变量各归各', k1.plan === 'sk-sp-a' && k1.payg === 'sk-ws-b', JSON.stringify(k1));
const k2 = qianwenKeys({ HOME: home, DASHSCOPE_API_KEY: 'sk-sp-c' });
check('DASHSCOPE_API_KEY 里是 sk-sp-:认作 Token Plan,按量那格空着', k2.plan === 'sk-sp-c' && k2.payg === null, JSON.stringify(k2));
mkdirSync(join(home, '.config', 'voxtell'), { recursive: true });
writeFileSync(join(home, '.config', 'voxtell', 'config.json'), JSON.stringify({ apiKey: 'sk-ws-vox', workspaceId: 'llm-x' }));
const k3 = qianwenKeys({ HOME: home, DASHSCOPE_API_KEY: 'sk-sp-c' });
check('按量那格空着时找 voxtell 的配置', k3.plan === 'sk-sp-c' && k3.payg === 'sk-ws-vox', JSON.stringify(k3));

const say = ['voxtell', 'say', '{text}', '--voice', '{voice}', '--json', '-o', '{out}'];
const v1 = voxtellEnv(say, { HOME: home, QWENCLOUD_TOKEN_PLAN_API_KEY: 'sk-sp-a', DASHSCOPE_API_KEY: 'sk-ws-b' });
check('voxtell 缺省模型 Token Plan 有:注它的端点与 key', v1.DASHSCOPE_API_KEY === 'sk-sp-a' && v1.VOXTELL_TTS_ENDPOINT === `https://${TOKEN_PLAN_HOST}/api/v1/services/audio/tts/SpeechSynthesizer`, JSON.stringify(v1));
const v2 = voxtellEnv([...say, '--model', 'cosyvoice-v3'], { HOME: home, QWENCLOUD_TOKEN_PLAN_API_KEY: 'sk-sp-a', DASHSCOPE_API_KEY: 'sk-ws-b' });
check('voxtell 指了 Token Plan 没有的模型:按量那把,不改端点', v2.DASHSCOPE_API_KEY === 'sk-ws-b' && v2.VOXTELL_TTS_ENDPOINT === undefined);
const v3 = voxtellEnv(['other-tts', '{text}'], { HOME: home, DASHSCOPE_API_KEY: 'sk-sp-c' });
check('不是 voxtell:环境原样', v3.DASHSCOPE_API_KEY === 'sk-sp-c' && v3.VOXTELL_TTS_ENDPOINT === undefined);

done();
