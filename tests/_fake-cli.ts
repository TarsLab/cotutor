/**
 * 假 CLI:模仿 claude / qwen 的 stream-json 无头输出,给 runner 测试用(不花钱、不联网)。
 * 用法(运行时模板里):node --experimental-strip-types _fake-cli.ts [--resume <id>] [--agent <name>] [--fail] [--stream] <prompt>
 * --stream:最终文本先按行以 stream_event(content_block_delta)吐出来,每行歇 80ms(模仿 claude --include-partial-messages),再发 assistant 与 result。
 * 行为:回显 prompt 的最后一行;含「录音卡」出三张录音卡(第二张的句子带「慢」);上下文包里有 cards 段就把那几行回显在前面(「看到卡:…」);prompt 含「段在前」就在最终文本前加一段「## 记账」;含「想要小课堂」出一张写着 scene 的旧式卡(场景卡删了,该当代码卡)和一段「## 想要小课堂」;含「板书」出两张卡(「坏卡」再加一张解析不出的,「点读」再加一张两段的点读卡,「图片」再加一张 vault/pic.png 的图片卡);含「家长段」加「## 家长」;含「记住它」「改记忆」回「## 记忆」(加两条 / 改一条删一条);
 * --resume 时 session_id 沿用给的 id,否则新造;--fail 出 error_max_turns。
 * --input-format stream-json(预热,2026-09-29):消息不在 argv,从 stdin 读第一行 {"type":"user","message":{"content":…}};读到之前一个字节不吐(同真 claude),
 * init 带 waitedMs(起来到收到消息等了多久);回完 result 等 stdin 关了才退。
 * 含「断流」/「一直断」/「工具慢」的见下面断流那段(stall.test)。
 * qwen 方言(命令行里有 --core-tools,qwen 适配器的 {toolArgs} 展开出来的):init 报工具表(核心工具按 --core-tools 留、非核心的照带,再减 --exclude-tools;
 * 环境变量 FAKE_QWEN_LEAK 里的工具总在,模仿关不掉的)、带 QWEN_HOME 与思考量配置的路径,每轮一条 goal_state 与一段思考增量,收尾没有钱数只有 token;
 * 消息含「超时」就以 55 退出、不吐 result(同 qwen 的 --max-wall-time)。
 */
export {};
const argv = process.argv.slice(2);
let session: string | null = null;
let fail = false;
let stream = false;
let agent = '';
let body = '';
let outputFormat = 'stream-json';
let inputFormat = 'text';
let coreTools: string[] | null = null;
let excludeTools: string[] = [];
const rest: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--resume') session = argv[++i];
  else if (argv[i] === '--agent') agent = argv[++i];
  else if (argv[i] === '--body') body = argv[++i];
  else if (argv[i] === '--fail') fail = true;
  else if (argv[i] === '--stream') stream = true;
  else if (argv[i] === '--output-format') outputFormat = argv[++i];
  else if (argv[i] === '--input-format') inputFormat = argv[++i];
  else if (argv[i] === '--core-tools') coreTools = argv[++i].split(',').filter(Boolean);
  else if (argv[i] === '--exclude-tools') excludeTools = argv[++i].split(',').filter(Boolean);
  else if (argv[i] === '-m' || argv[i] === '--approval-mode' || argv[i] === '--max-wall-time') i++;
  else if (argv[i] === '--model' || argv[i] === '--disallowedTools' || argv[i] === '--max-budget-usd' || argv[i] === '--setting-sources' || argv[i] === '--tools' || argv[i] === '--effort' || argv[i] === '--system-prompt' || argv[i] === '--append-system-prompt-file') i++;
  else if (argv[i] === '--disable-slash-commands') continue;
  else rest.push(argv[i]);
}
const bornAt = Date.now();
const viaStdin = inputFormat === 'stream-json';
const stdinPrompt = viaStdin
  ? await new Promise<string>((res) => {
      let buf = '';
      const onData = (c: Buffer): void => {
        buf += c.toString('utf8');
        const at = buf.indexOf('\n');
        if (at < 0) return;
        process.stdin.off('data', onData);
        process.stdin.pause();
        res((JSON.parse(buf.slice(0, at)) as { message: { content: string } }).message.content);
      };
      process.stdin.on('data', onData);
    })
  : null;
const waitedMs = Date.now() - bornAt;
// 出厂的老师守则(<cotutor-rules>)是固定文字,里头的「板书」「## 记忆」不该触发下面的关键词:先剥掉
const prompt = (stdinPrompt ?? rest.join(' ')).replace(/<cotutor-rules[^>]*>[\s\S]*?<\/cotutor-rules>\n?/g, '');
const sid = session ?? `fake-${process.pid}-${Date.now()}`;
const emit = (o: unknown): void => void process.stdout.write(`${JSON.stringify(o)}\n`);
const lastLine = prompt.trim().split('\n').filter(Boolean).pop() ?? '';

// 整块 JSON 出(--output-format json):模仿 claude 的壳,正文原样回提示词的最后一行
if (outputFormat === 'json') {
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sid, num_turns: 1, total_cost_usd: 0.0021, duration_ms: 900, result: lastLine });
  process.exit(0);
}

const qwenish = coreTools !== null;
// qwen 的工具表:核心工具只留 --core-tools 里的,非核心的(agent / skill / get_goal…)照带,再减 --exclude-tools
const qwenTools = qwenish ? [...new Set([...['read_file', 'glob', 'grep_search', 'run_shell_command', 'edit', 'write_file'].filter((t) => coreTools!.includes(t)), 'agent', 'skill', 'get_goal', ...(process.env.FAKE_QWEN_LEAK ?? '').split(',').filter(Boolean)])].filter((t) => !excludeTools.includes(t) || (process.env.FAKE_QWEN_LEAK ?? '').split(',').includes(t)) : [];
emit({ type: 'system', subtype: 'init', session_id: sid, cwd: process.cwd(), agent: agent || undefined, bodyLen: body.length, proxy: process.env.HTTPS_PROXY, ...(viaStdin ? { waitedMs } : {}), ...(qwenish ? { tools: qwenTools, qwenHome: process.env.QWEN_HOME, effortFile: process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH, key: Boolean(process.env.DASHSCOPE_API_KEY), openai: Boolean(process.env.OPENAI_MODEL) } : {}) });
if (qwenish) {
  emit({ type: 'stream_event', event: { type: 'goal_state', goal_state: { v: 2, goal: null, activity: 'idle' } }, session_id: sid, parent_tool_use_id: null });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想一想' } }, session_id: sid, parent_tool_use_id: null });
  if (prompt.includes('超时')) { process.stderr.write('Run aborted: wall-clock budget exceeded\n'); process.exit(55); }
}
// 「起就卡」:头一次吐了 init(带会话 id)就挂住,模型一个事件没回(会话没落盘,resume 不了);第二次起(cwd 里有记号)照常回
if (prompt.includes('起就卡')) {
  const { existsSync, writeFileSync } = await import('node:fs');
  if (session) { emit({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sid, num_turns: 0 }); process.exit(1); }
  if (!existsSync('.stalled-once')) { writeFileSync('.stalled-once', ''); await new Promise(() => void setInterval(() => {}, 1 << 30)); }
}
// 断流(policy.stall):消息里有「断流」就吐半句后一声不吭(挂着不退),等 runner 杀掉再 resume;resume 来的「(应用注)」带着那半句就接上收尾。
// 「一直断」每次都挂(次数用完);「工具慢」是工具在跑时静默 1 秒(不该当断流)
{
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const hang = (): Promise<never> => new Promise(() => void setInterval(() => {}, 1 << 30));
  const delta = (text: string): void => emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id: sid, parent_tool_use_id: null });
  const start = (): void => emit({ type: 'stream_event', event: { type: 'message_start', message: { role: 'assistant', content: [] } }, session_id: sid, parent_tool_use_id: null });
  if (prompt.includes('(应用注)') && prompt.includes('总断')) { start(); delta('总断'); await hang(); }
  if (prompt.includes('(应用注)') && prompt.includes('半截')) {
    const text = '句话接上了。';
    start(); delta(text);
    emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } });
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sid, num_turns: 1, total_cost_usd: 0.01, result: text });
    process.exit(0);
  }
  if (prompt.includes('工具慢')) {
    emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_slow', name: 'Bash', input: { command: 'sleep 1' } }] } });
    await sleep(1000);
    emit({ type: 'user', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_slow', content: 'ok' }] } });
  } else if (prompt.includes('一直断')) { start(); delta('总断。\n'); await hang(); }
  else if (prompt.includes('断流')) { start(); delta('断流前这句。\n'); delta('半截'); await hang(); }
}
emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'text', text: '我先看看上下文包' }] } });
emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_read1', name: 'Read', input: { file_path: '../../ledger/artifacts.jsonl' } }] } });
emit({ type: 'user', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_read1', content: '{"kind":"observation"}\n' }] } });
emit({ type: 'assistant', session_id: sid, parent_tool_use_id: 'toolu_sub', message: { content: [{ type: 'text', text: '子代理在干活' }] } });
if (fail) {
  emit({ type: 'result', subtype: 'error_max_turns', is_error: true, session_id: sid, num_turns: 3 });
} else {
  const parts: string[] = [];
  // 触发词只看消息正文(最后一个 --- 之后):上下文包里现在可能带着整篇「板书怎么写」(<cotutor-board>),在整个提示词里找「板书」会条条命中
  const cut = prompt.lastIndexOf('\n---\n');
  const msg = cut >= 0 ? prompt.slice(cut + 5) : prompt;
  // 回读检查:模拟老师不听劝、又用 Skill 工具读了一遍板书写法
  if (msg.includes('回读板书')) emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_skill1', name: 'Skill', input: { skill: 'cotutor-board' } }] } });
  if (msg.includes('段在前')) parts.push('## 记账\nthread: 0000-1\nname: 重讲');
  if (msg.includes('想要小课堂')) parts.push('```scene\n2026-09-09-guilv\n```\n\n```text\n# 找规律\n75、70、65、__\n```\n\n每次少几?\n\n## 想要小课堂\n- 题面: 找规律填数 75、70、65、__\n  讲法: 每次少 5;用交错数列分行讲');
  // 录音卡(口播老师):三张;第二张的句子带「慢」,假 koubo 会拖过超时
  if (msg.includes('录音卡')) parts.push('```record focus=sh_s\n老师上【山】看【树】\n```\n\n```record\n慢慢读这一句\n```\n\n```record pinyin\nshi2 si4\n【十】四\n```\n\n一句一句录,录完交给我。');
  if (msg.includes('板书')) parts.push('```text\n# 三角形\n拼一拼\n```\n\n先看[三角形]。\n\n```choice\n三角形有几个角?\n- [x] 三个\n- [ ] 四个\n```\n\n三角形有几个角?' + (msg.includes('坏卡') ? '\n\n```choice\n没选项\n```' : '') + (msg.includes('点读') ? '\n\n```read\napple 苹果\nbanana 香蕉\n```\n\n点一下听一下。' : '') + (msg.includes('图片') ? '\n\n```image\nvault/pic.png\n看这张图\n```' : ''));
  // 作业照片(R5):上下文包有 photos: 段就「看图」——回显看到了哪张,板书 image 卡引用原图、canvas 卡照片做底
  const photosAt = prompt.indexOf('\n  photos:\n');
  if (photosAt >= 0) {
    // 只取紧跟在键后面的那一段列表(后面还有 photoFiles: 的列表,别吞进来);Read 像真老师一样用 photoFiles 的绝对路径
    const listAfter = (key: string): string[] => {
      const at = prompt.indexOf(`\n  ${key}:\n`);
      if (at < 0) return [];
      const out: string[] = [];
      for (const l of prompt.slice(at + key.length + 5).split('\n')) {
        if (!l.startsWith('    - ')) break;
        const v = l.slice(6);
        out.push(v.startsWith('"') ? (JSON.parse(v) as string) : v);
      }
      return out;
    };
    const ps = listAfter('photos');
    const files = listAfter('photoFiles');
    emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: files[0] ?? `../../${ps[0]}` } }] } });
    parts.push(`看到照片:${ps.join(' | ')},是第 12 页第 3 题。\n\n\`\`\`image\n${ps[0]}\n你拍的作业\n\`\`\`\n\n\`\`\`canvas\n${ps[0]}\n把算错的那道圈出来。\n\`\`\`\n\n哪道算错了?`);
  }
  const cardsAt = prompt.indexOf('\n  cards:\n');
  if (cardsAt >= 0) {
    const seen = prompt.slice(cardsAt + 10).split('\n').filter((l) => l.startsWith('    - ')).map((l) => { const v = l.slice(6); return v.startsWith('"') ? (JSON.parse(v) as string) : v; });
    parts.push(`看到卡:${seen.join(' | ')}`);
  }
  parts.push(`${session ? '接着说:' : '第一次说:'}${lastLine}`);
  if (msg.includes('家长段')) parts.push('## 家长\n他其实会了。');
  // 记账后整理记忆(runner.tidyMemory 发的):改一条、删一条(家长手写的)、加一条、再删一条找不到的
  if (msg.includes('把你的记忆整理一遍')) parts.push('## 记忆\n- 改:凑十他懂 → 凑十熟练了\n- 删:家长写的别出选择题\n- 整理时新记的\n- 删:没有这句话');
  if (msg.includes('记住它')) parts.push('## 记忆\n- 讲角用手指比划他马上懂\n- 家长说别出选择题\n- 第三条会被丢掉');
  // 讲课的轮也会改、删记忆(删话题时要撤回去)
  if (msg.includes('改记忆')) parts.push('## 记忆\n- 改:讲慢点他跟得上 → 讲慢点才跟得上\n- 删:爱用手指数');
  // 记账任务(runner.bookkeep 发的):回一段固定形状的「## 记账」;prompt 里有「记账坏」就少写 name(应用该报 warning、日记不写)
  const bk = /给刚才这个话题记账\(话题 (\S+?)[,,]/.exec(prompt);
  if (bk) parts.push(msg.includes('记账坏') ? `## 记账\n- thread: ${bk[1]}\n  summary: 没名字` : `## 记账\n- thread: ${bk[1]}\n  name: 三角形的角\n  textbook: 人教数学一下#1 认识图形(二)\n  summary: 讲了三角形有三个角,孩子一开始说四个。\n  steps: 看图 → 数角 → 选一选\n  observations:\n    - 角和边会混`);
  const result = parts.join('\n\n');
  if (stream) {
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const delta = (text: string, parent: string | null = null): void => emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id: sid, parent_tool_use_id: parent });
    // 子代理的增量要被忽略
    emit({ type: 'stream_event', event: { type: 'message_start', message: { role: 'assistant', content: [] } }, session_id: sid, parent_tool_use_id: 'toolu_sub' });
    delta('子代理说的不算', 'toolu_sub');
    emit({ type: 'stream_event', event: { type: 'message_start', message: { role: 'assistant', content: [] } }, session_id: sid, parent_tool_use_id: null });
    for (const line of result.split('\n')) {
      delta(`${line}\n`);
      await sleep(80);
    }
    emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'text', text: result }] } });
    emit({ type: 'stream_event', event: { type: 'message_stop' }, session_id: sid, parent_tool_use_id: null });
  }
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sid, num_turns: 2, ...(qwenish ? { usage: { input_tokens: 2000, output_tokens: 120, cache_read_input_tokens: 500, total_tokens: 2620 } } : { total_cost_usd: 0.05 }), result });
}
process.stderr.write('fake-cli done\n');
// 消息走 stdin 的:同真 claude,回完还等下一条,stdin 关了才退
if (viaStdin) {
  process.stdin.resume();
  await new Promise((r) => process.stdin.once('end', r));
}
