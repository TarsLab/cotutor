/**
 * 假 CLI:模仿 claude / qwen 的 stream-json 无头输出,给 runner 测试用(不花钱、不联网)。
 * 用法(运行时模板里):node --experimental-strip-types _fake-cli.ts [--resume <id>] [--agent <name>] [--fail] [--stream] <prompt>
 * --stream:最终文本先按行以 stream_event(content_block_delta)吐出来,每行歇 80ms(模仿 claude --include-partial-messages),再发 assistant 与 result。
 * 行为:回显 prompt 的最后一行;上下文包里有 cards 段就把那几行回显在前面(「看到卡:…」);prompt 含「段在前」就在最终文本前加一段「## 记账」;含「画场景」出一张带题面 / 讲法的新场景卡,「放旧课包」出一张只有 id 的场景卡;含「板书」出两张卡(「坏卡」再加一张解析不出的,「点读」再加一张两段的点读卡,「图片」再加一张 vault/pic.png 的图片卡);含「家长段」加「## 家长」;
 * --resume 时 session_id 沿用给的 id,否则新造;--fail 出 error_max_turns。
 */
export {};
const argv = process.argv.slice(2);
let session: string | null = null;
let fail = false;
let stream = false;
let agent = '';
let body = '';
let outputFormat = 'stream-json';
const rest: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--resume') session = argv[++i];
  else if (argv[i] === '--agent') agent = argv[++i];
  else if (argv[i] === '--body') body = argv[++i];
  else if (argv[i] === '--fail') fail = true;
  else if (argv[i] === '--stream') stream = true;
  else if (argv[i] === '--output-format') outputFormat = argv[++i];
  else if (argv[i] === '--model' || argv[i] === '--disallowedTools' || argv[i] === '--max-budget-usd' || argv[i] === '--setting-sources' || argv[i] === '--tools' || argv[i] === '--system-prompt' || argv[i] === '--append-system-prompt-file') i++;
  else if (argv[i] === '--disable-slash-commands') continue;
  else rest.push(argv[i]);
}
// 出厂的老师守则(<cotutor-rules>)是固定文字,里头的「板书」「## 记忆」不该触发下面的关键词:先剥掉
const prompt = rest.join(' ').replace(/<cotutor-rules[^>]*>[\s\S]*?<\/cotutor-rules>\n?/g, '');
const sid = session ?? `fake-${process.pid}-${Date.now()}`;
const emit = (o: unknown): void => void process.stdout.write(`${JSON.stringify(o)}\n`);
const lastLine = prompt.trim().split('\n').filter(Boolean).pop() ?? '';

// 板书后期(--output-format json,一拍一次):模仿 claude 的整块 JSON 壳,正文是这一拍的提案——这拍的卡上标第一个词(圈)、再标一个越界的卡 99;
// 卡 0 给 sky + emoji,卡 1 给不存在的槽 nope;卡 2 接上一行(same),其余另起;提示词里有「后期慢」就拖 3 秒(测超时),有「后期坏」就吐不是 JSON 的话(测解析失败)
if (outputFormat === 'json' && /class="c [^"]*\bnow\b/.test(prompt)) {
  // HTML 方言(提示词里有 class 带 now 的卡):板书里 class 带 now 的是这一拍;补丁标它标题的头一个词(圈;没有标题的卡就标「三角形」,多半不在卡上)、再标一个越界的卡 99;卡 0 sky + emoji,卡 1 不存在的槽,卡 2 接上一行
  const now = /<(?:div|pre|figure) class="c [^"]*\bnow\b[^"]*" id="c(\d+)"[^>]*>(?:<h3>([^<]{1,4}))?/.exec(prompt);
  const cardNo = now ? Number(now[1]) : 0;
  const firstWord = now?.[2] ?? '三角形';
  const look = cardNo === 0 ? ' data-tint="sky" data-emoji="📐"' : cardNo === 1 ? ' data-tint="nope"' : '';
  const patch = `<div class="c" id="c${cardNo}" data-row="${cardNo === 2 ? 'same' : 'new'}"${look}><mark data-pen="circle">${firstWord}</mark><mark data-pen="box" data-card="c99">越界</mark></div>`;
  const text = prompt.includes('后期坏') ? '我觉得这节挺好的,不用改。' : patch;
  if (prompt.includes('后期慢')) await new Promise((r) => setTimeout(r, 3000));
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sid, num_turns: 1, total_cost_usd: 0.0021, duration_ms: 900, result: text });
  process.exit(0);
}
if (outputFormat === 'json') {
  const cardLine = /^卡 (\d+)\. (\S+?)[(:]/m.exec(prompt.split('\n## 这一拍\n')[1] ?? '');
  const cardNo = cardLine ? Number(cardLine[1]) : 0;
  const firstWord = /^卡 \d+\. text[^:]*:(?:标题「[^」]*」;)?(\S{2,4})/m.exec(prompt.split('\n## 这一拍\n')[1] ?? '')?.[1] ?? '三角形';
  const proposal = { row: cardNo === 2 ? 'same' : 'new', look: cardNo === 0 ? { tint: 'sky', emoji: '📐' } : cardNo === 1 ? { tint: 'nope' } : undefined, marks: [{ line: 0, phrase: firstWord, pen: 'circle' }, { line: 0, card: 99, phrase: '越界', pen: 'box' }], anchors: [] };
  const text = prompt.includes('后期坏') ? '我觉得这节挺好的,不用改。' : JSON.stringify(proposal);
  if (prompt.includes('后期慢')) await new Promise((r) => setTimeout(r, 3000));
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sid, num_turns: 1, total_cost_usd: 0.0021, duration_ms: 900, result: text });
  process.exit(0);
}

emit({ type: 'system', subtype: 'init', session_id: sid, cwd: process.cwd(), agent: agent || undefined, bodyLen: body.length });
emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'text', text: '我先看看上下文包' }] } });
emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_read1', name: 'Read', input: { file_path: '../../ledger/artifacts.jsonl' } }] } });
emit({ type: 'user', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_read1', content: '{"kind":"observation"}\n' }] } });
emit({ type: 'assistant', session_id: sid, parent_tool_use_id: 'toolu_sub', message: { content: [{ type: 'text', text: '子代理在干活' }] } });
if (fail) {
  emit({ type: 'result', subtype: 'error_max_turns', is_error: true, session_id: sid, num_turns: 3 });
} else {
  const parts: string[] = [];
  if (prompt.includes('段在前')) parts.push('## 记账\nthread: 0000-1\nname: 重讲');
  if (prompt.includes('画场景')) parts.push('```scene\n2026-09-09-guilv\n我去把这道题画出来。\n题面:找规律填数 75、70、65、__\n讲法:每次少 5;用交错数列分行讲\n```\n\n等我画好。');
  if (prompt.includes('放旧课包')) parts.push('```scene\n2026-09-09-guilv\n```\n\n我们再看一遍。');
  if (prompt.startsWith('cotutor:') && /\n---\n场景作业\(/.test(prompt)) parts.push('课包 2026-09-09-guilv 做好了,6 步');
  if (prompt.includes('板书')) parts.push('```text\n# 三角形\n拼一拼\n```\n\n先看[三角形]。\n\n```choice\n三角形有几个角?\n- [x] 三个\n- [ ] 四个\n```\n\n三角形有几个角?' + (prompt.includes('坏卡') ? '\n\n```choice\n没选项\n```' : '') + (prompt.includes('点读') ? '\n\n```read\napple 苹果\nbanana 香蕉\n```\n\n点一下听一下。' : '') + (prompt.includes('图片') ? '\n\n```image\nvault/pic.png\n看这张图\n```' : ''));
  // 作业照片(R5):上下文包有 photos: 段就「看图」——回显看到了哪张,板书 image 卡引用原图、canvas 卡照片做底
  const photosAt = prompt.indexOf('\n  photos:\n');
  if (photosAt >= 0) {
    const ps = prompt.slice(photosAt + 11).split('\n').filter((l) => l.startsWith('    - ')).map((l) => { const v = l.slice(6); return v.startsWith('"') ? (JSON.parse(v) as string) : v; });
    emit({ type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: `../../${ps[0]}` } }] } });
    parts.push(`看到照片:${ps.join(' | ')},是第 12 页第 3 题。\n\n\`\`\`image\n${ps[0]}\n你拍的作业\n\`\`\`\n\n\`\`\`canvas\n${ps[0]}\n把算错的那道圈出来。\n\`\`\`\n\n哪道算错了?`);
  }
  const cardsAt = prompt.indexOf('\n  cards:\n');
  if (cardsAt >= 0) {
    const seen = prompt.slice(cardsAt + 10).split('\n').filter((l) => l.startsWith('    - ')).map((l) => { const v = l.slice(6); return v.startsWith('"') ? (JSON.parse(v) as string) : v; });
    parts.push(`看到卡:${seen.join(' | ')}`);
  }
  parts.push(`${session ? '接着说:' : '第一次说:'}${lastLine}`);
  if (prompt.includes('家长段')) parts.push('## 家长\n他其实会了。');
  // 记账后整理记忆(runner.tidyMemory 发的):改一条、删一条(家长手写的)、加一条、再删一条找不到的
  if (prompt.includes('把你的记忆整理一遍')) parts.push('## 记忆\n- 改:凑十他懂 → 凑十熟练了\n- 删:家长写的别出选择题\n- 整理时新记的\n- 删:没有这句话');
  if (prompt.includes('记住它')) parts.push('## 记忆\n- 讲角用手指比划他马上懂\n- 家长说别出选择题\n- 第三条会被丢掉');
  // 记账任务(runner.bookkeep 发的):回一段固定形状的「## 记账」;prompt 里有「记账坏」就少写 name(应用该报 warning、日记不写)
  const bk = /给刚才这个话题记账\(话题 (\S+?)[,,]/.exec(prompt);
  if (bk) parts.push(prompt.includes('记账坏') ? `## 记账\n- thread: ${bk[1]}\n  summary: 没名字` : `## 记账\n- thread: ${bk[1]}\n  name: 三角形的角\n  textbook: 人教数学一下#1 认识图形(二)\n  summary: 讲了三角形有三个角,孩子一开始说四个。\n  steps: 看图 → 数角 → 选一选\n  observations:\n    - 角和边会混`);
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
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sid, num_turns: 2, total_cost_usd: 0.05, result });
}
process.stderr.write('fake-cli done\n');
