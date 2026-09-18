/**
 * cotutor-analyze 技能的生成部分(2026-09-15):references/命令与文件.md 从 CLI 的用法文本(cli/usage.ts)与对话文件的命名规则(lib/conversation.ts
 * conversationFiles)现生成,scripts/gen-skills.ts 写进包根 skills/cotutor-analyze/,tests/skills.test.ts 断言入库的和生成的一致——
 * 技能里的命令与文件名永远和代码同源。SKILL.md 本体(怎么查、禁区)是手写的。
 */
import { USAGE } from '../cli/usage.ts';
import { conversationFiles } from './conversation.ts';

export const ANALYZE_SKILL = 'cotutor-analyze';

/** 分析用的那几条命令(按用法文本里的第二个词挑) */
const ANALYZE_COMMANDS = ['show', 'pack', 'replay', 'compare', 'trace', 'doctor', 'send', 'rate', 'bookkeep', 'repost'];

export function analyzeReferenceDoc(): string {
  const cmds = USAGE.split('\n').filter((l) => {
    const m = /^\s+cotutor (\S+)/.exec(l);
    return m !== null && ANALYZE_COMMANDS.includes(m[1]);
  });
  const f = conversationFiles('conversations', '<老师>', '<日期>');
  const rows = [
    [f.index, '一天的索引:每条消息物化了 text / kidText / section(卡与讲稿)/ tools(读了什么)/ timing / costUsd / post / warnings / scenes / bookkeeping;顶层 sessions / ratings / booked / costUsd'],
    [f.run('<job>'), '这轮发给老师的:prompt(上下文包 + 消息)、argv(完整命令行)、resume / session、sources(当时的老师文件正文与 hash、技能 SKILL.md 的 hash)'],
    [f.log('<job>'), '老师进程的 stdout 原样(stream-json):每次 tool_use 的完整参数、tool_result 的内容、文本、result(费用、轮数)。最大最全,别整个读,按 job 与关键字 grep'],
    [f.err('<job>'), 'stderr'],
    [f.events('<job>'), '这轮的事件流,一行一条 {t, lane, kind, …}:main 老师 / tts 配音 / post 后期 / ready 就绪 / index / scene 画图作业 / ledger;cotutor trace 读它'],
    [f.post('<job>'), '板书后期每一拍:prompt、raw(模型原始输出)、output、dropped / kept、ms、costUsd'],
    [f.lineAudio('<job>', 9999).replace('9999', '<n>'), '讲稿第 n 句的配音'],
    [f.card('<job>', 9999).replace('9999', '<n>'), '第 n 张卡的状态(孩子在卡上做的):{at, turn, state}'],
    [f.cardAsset('<job>', 9999, '<k>.mp3').replace('9999', '<n>'), '卡的资产(点读段配音)'],
  ];
  return `# 命令与文件(机器生成,别改)

## 分析用的命令(在 workspace 根跑;完整用法 cotutor --help)

\`\`\`
${cmds.join('\n')}
\`\`\`

## 一轮的文件(conversations/ 下;回放的在 evals/ 下,同一套名字)

job 形如 1620-1(时分-当天序号)。

| 文件 | 是什么 |
|---|---|
${rows.map(([p, d]) => `| \`${p}\` | ${d} |`).join('\n')}

上下文包里老师能看到的只有:rules(有脸的老师共同的守则:机器技能 cotutor-tutor 的原文,接在 YAML 块后面的 <cotutor-rules> 里;同一话题续聊没改过的只写「未变」)、semester(当前学期)、profile、entry 与 memory(档案、这位老师的入口文件、它自己的记忆:vault 里按 cotutor: profile / subject / memory 属性找,原文接在 YAML 块后面的 <vault-note> 里,按 entryChars 截;同一话题续聊时没改过的只写「未变」)、refs(这科这学期的教材与两篇里 [[链接]] 的路径,只给路径)、plan(本周计划里这位老师的行,按 planLines 截)、recent(最近 14 天日记里本学科的「- 观察:」行,按 recent 取最新的)、slot(课程表命中的时段)、vault(路径)、cards(孩子上一轮在卡上做的)、photos(这条的作业照片)。别的它都看不到,除非自己 Read。
`;
}

export function analyzeSkillGeneratedFiles(): Record<string, string> {
  return { 'references/命令与文件.md': analyzeReferenceDoc() };
}
