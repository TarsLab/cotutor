/**
 * 假老师:API 运行时的流程测试经 COTUTOR_BRAIN_ENDPOINT 指到它(假百炼 _fake-bailian-chat.ts + 这里的脚本),不花钱、不联网。
 * 模型名定怎么回:fake 照常回;fake-stream 一行一行吐、每行歇 80ms(看流式板书);fake-fail 回 400(这轮没成)。
 * 只看最后一条用户消息(孩子的话连上下文包),触发词只看正文(最后一个 --- 之后),老师守则(<cotutor-rules>)先剥掉:
 * 回显那条消息的最后一行(前面有老师的回复就「接着说:」,不然「第一次说:」);上下文包里有 cards 段就把那几行回显在前面(「看到卡:…」);
 * 含「段在前」在最前面加一段「## 记账」;含「想要小课堂」出一张写着 scene 的旧式卡和一段「## 想要小课堂」;含「节头」先出一张只有一行 # 标题的文字卡;
 * 含「板书」出两张卡(「坏卡」再加一张解析不出的,「点读」再加一张两段的点读卡,「图片」再加一张 vault/pic.png 的图片卡);含「画图」出一张四幅的画图卡;
 * 含「放课」出一张小课堂卡(讲稿带 [[play]]);含「整段」出一张三行的点读卡;含「热身」或「口语课」出口语课的热身(两拍 [[echo]]、一拍 [[say]]、[[call]]),
 * 「直接打电话」回一句带 [[call]],「(打电话)」回英文开场;含「家长段」加「## 家长」;含「记住它」「改记忆」回「## 记忆」(加三条 / 改一条删一条),
 * 「带证据」回两条带证据的(一条抄孩子的话、一条抄老师自己的),「记孩子」回一条 孩子: 开头的和一条普通的;记忆整理任务改一条删两条加一条;
 * 记账任务回固定形状的「## 记账」(「记账坏」或 FAKE_BOOKKEEP_BAD=1 少写 name;FAKE_BOOKKEEP_ASKED 里 | 分开的几句当 asked);
 * 上下文包有 photos 段就「看图」:请求带了工具先 read_file 那张照片,再回 image 卡与 canvas 卡;含「回读板书」先 read_file 板书写法(回读检查)。
 */
import { startFakeChat, type ChatBody, type FakeReply } from './_fake-bailian-chat.ts';

const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).join('\n') : '');

/** 上下文包里 `  <key>:` 后面紧跟的那段列表 */
function listAfter(prompt: string, key: string): string[] {
  const at = prompt.indexOf(`\n  ${key}:\n`);
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of prompt.slice(at + key.length + 5).split('\n')) {
    if (!l.startsWith('    - ')) break;
    const v = l.slice(6);
    out.push(v.startsWith('"') ? (JSON.parse(v) as string) : v);
  }
  return out;
}

export function teacherReply(body: ChatBody): FakeReply {
  const lastUser = body.messages.map((m) => m.role).lastIndexOf('user');
  const prompt = textOf(body.messages[lastUser]?.content).replace(/<cotutor-rules[^>]*>[\s\S]*?<\/cotutor-rules>\n?/g, '');
  const resumed = body.messages.slice(0, lastUser).some((m) => m.role === 'assistant');
  const lastLine = prompt.trim().split('\n').filter(Boolean).pop() ?? '';
  const cut = prompt.lastIndexOf('\n---\n');
  const msg = cut >= 0 ? prompt.slice(cut + 5) : prompt;
  const parts: string[] = [];
  let tool: FakeReply['tool'];
  if (msg.includes('段在前')) parts.push('## 记账\nthread: 0000-1\nname: 重讲');
  if (msg.includes('想要小课堂')) parts.push('```scene\n2026-09-09-guilv\n```\n\n```text\n# 找规律\n75、70、65、__\n```\n\n每次少几?\n\n## 想要小课堂\n- 题面: 找规律填数 75、70、65、__\n  讲法: 每次少 5;用交错数列分行讲');
  if (msg.includes('画图')) parts.push('说得真清楚,画家开始画了。\n\n```paint\n题: 图上画了谁?他们在干什么?\n词: 播种、羞愧\n角色: 小熊:棕色,戴黄草帽\n1. 早上,小熊在地里播种。\n2. 中午,小猴躺在树下睡大觉。\n3. 夏天,小熊的地里结满西瓜。\n4. 小猴低着头,脸红红的。\n```\n\n你猜画家会怎么画?');
  if (msg.includes('放课')) parts.push('```lecture\n2026-09-18-po13-jian-8 0:19-0:30\n再看一遍拆开那一捆。\n```\n\n我们回到那里再看一遍。[[play]]\n\n拿走 8 根,这一捆还剩几根?');
  if (msg.includes('热身') || msg.includes('口语课')) parts.push('```word\n🦆 duck\nd-u-ck\n```\n\n我们先热热身!我先来:duck! [[echo duck]]\n\n小声一点:duck… [[echo duck]]\n\n你先说:鸭子英文怎么说? [[say duck]]\n\n热身好啦!老师给你打个电话。 [[call]]\n\n这句不该念。');
  if (msg.includes('直接打电话')) parts.push('好,那我们现在就打电话! [[call]]');
  if (msg.includes('(打电话)')) parts.push('Hello Ray! Where are the ducks?');
  if (msg.includes('整段')) parts.push('```read\n小熊种西瓜。\n小猴睡大觉。\n西瓜熟了。\n```\n\n你看着连起来说一遍?');
  if (msg.includes('节头')) parts.push('```text\n# 认识三角形\n```');
  if (msg.includes('板书')) parts.push('```text\n# 三角形\n拼一拼\n```\n\n先看[三角形]。\n\n```choice\n三角形有几个角?\n- [x] 三个\n- [ ] 四个\n```\n\n三角形有几个角?' + (msg.includes('坏卡') ? '\n\n```choice\n没选项\n```' : '') + (msg.includes('点读') ? '\n\n```read\napple 苹果\nbanana 香蕉\n```\n\n点一下听一下。' : '') + (msg.includes('图片') ? '\n\n```image\nvault/pic.png\n看这张图\n```' : ''));
  const ps = listAfter(prompt, 'photos');
  if (ps.length) {
    tool = { name: 'read_file', args: { file_path: ps[0] } };
    parts.push(`看到照片:${ps.join(' | ')},是第 12 页第 3 题。\n\n\`\`\`image\n${ps[0]}\n你拍的作业\n\`\`\`\n\n\`\`\`canvas\n${ps[0]}\n把算错的那道圈出来。\n\`\`\`\n\n哪道算错了?`);
  }
  // 回读检查:老师不听劝、又去读了一遍板书写法(请求带了工具才读得到)
  if (msg.includes('回读板书')) tool = { name: 'read_file', args: { file_path: '.agents/skills/cotutor-board/SKILL.md' } };
  const seen = listAfter(prompt, 'cards');
  if (seen.length) parts.push(`看到卡:${seen.join(' | ')}`);
  parts.push(`${resumed ? '接着说:' : '第一次说:'}${lastLine}`);
  if (msg.includes('家长段')) parts.push('## 家长\n他其实会了。');
  if (msg.includes('把你的记忆整理一遍')) parts.push('## 记忆\n- 改:凑十他懂 → 凑十熟练了\n- 删:家长写的别出选择题\n- 整理时新记的\n- 删:没有这句话');
  if (msg.includes('记住它')) parts.push('## 记忆\n- 讲角用手指比划他马上懂\n- 家长说别出选择题\n- 第三条会被丢掉');
  if (msg.includes('改记忆')) parts.push('## 记忆\n- 改:讲慢点他跟得上 → 讲慢点才跟得上\n- 删:爱用手指数');
  if (msg.includes('记孩子')) parts.push('## 记忆\n- 孩子:卡住时会先说我不会,先肯定他做对的部分。证据:「我不会」\n- 讲角用手指比划');
  if (msg.includes('带证据')) parts.push('## 记忆\n- 阵列题先伸手指定行数,再一行点一个。证据:「我数成35了」\n- 他自己说会了竖式。证据:「第一次说」');
  const bk = /给刚才这个话题记账\(话题 (\S+?)[,,]/.exec(prompt);
  const asked = (process.env.FAKE_BOOKKEEP_ASKED ?? '').split('|').filter(Boolean);
  if (bk) parts.push(msg.includes('记账坏') || process.env.FAKE_BOOKKEEP_BAD === '1' ? `## 记账\n- thread: ${bk[1]}\n  summary: 没名字` : `## 记账\n- thread: ${bk[1]}\n  name: 三角形的角\n  textbook: 人教数学一下#1 认识图形(二)\n${asked.length ? `  asked:\n${asked.map((q) => `    - ${q}`).join('\n')}\n` : ''}  summary: 讲了三角形有三个角,孩子一开始说四个。\n  steps: 看图 → 数角 → 选一选\n  observations:\n    - 角和边会混`);
  if (body.model === 'fake-fail') return { text: '', status: 400 };
  return { text: parts.join('\n\n'), reasoning: '想一想', ...(tool ? { tool } : {}), ...(body.model === 'fake-stream' ? { lineMs: 80 } : {}) };
}

/** 起假老师;回的 baseURL 给 COTUTOR_BRAIN_ENDPOINT */
export const startFakeTeacher = (): ReturnType<typeof startFakeChat> => startFakeChat({ reply: teacherReply });

/** 运行时:fake 照常、stream 逐行吐、broken 回 400 */
export const FAKE_RUNTIMES = {
  default: 'fake',
  fake: { api: 'bailian', model: 'fake' },
  stream: { api: 'bailian', model: 'fake-stream' },
  broken: { api: 'bailian', model: 'fake-fail' },
} as const;
