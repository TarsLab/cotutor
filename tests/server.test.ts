/** 路由层纯函数:健康、工作区回报(脱敏)、配置与老师列表、404。 */
import { route } from '../src/server/app.ts';
import { assembleWorkspace, parseConfig } from '../src/cli/workspace.ts';
import { configTemplate, shippedAgents } from '../src/cli/skeleton.ts';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const root = join(homedir(), 'cotutor', 'ming');
const ws = assembleWorkspace(root, 'home-single', parseConfig(JSON.parse(configTemplate({ slug: 'ming', name: '小明', teachers: await shippedAgents() })), join(root, 'cotutor.json')));

check('health', route('GET', '/api/health', ws).json !== undefined && route('GET', '/api/health', ws).status === 200);
const rep = route('GET', '/api/workspace', ws).json as { workspace: string; teachers: string[] };
check('工作区回报脱敏', rep.workspace.startsWith('$HOME') && rep.teachers.length === 5, JSON.stringify(rep));
const cfg = route('GET', '/api/config', ws).json as { title: string; teachers: { name: string; policy: { replyMaxChars: number } }[] };
check('配置接口带老师与政策', cfg.title === '小明的书房' && cfg.teachers.length === 5 && cfg.teachers[0].policy.replyMaxChars === 60);
check('孩子端老师列表不含 hidden', (route('GET', '/api/teachers?kid=1', ws).json as unknown[]).length === 4);
check('首页 html', route('GET', '/', ws).html?.includes('小明的书房') === true);
check('404', route('GET', '/nope', ws).status === 404 && route('POST', '/api/health', ws).status === 405);
done();
