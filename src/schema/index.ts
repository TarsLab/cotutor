/**
 * cotutor 契约(类型即文档)。每个文件一个契约面:
 *  config        cotutor.json(老师表、政策、运行时、paths 角色)
 *  context-pack  每条消息前的上下文包
 *  conversation  一老师一天一份的对话索引;conversation-files 它在 conversations/ 下的文件布局
 *  ledger        产物账本(追加式)
 *  events        一轮运行的事件(events.jsonl)
 *  sections      最终文本里的「记账」「记忆」段
 *  plan          计划文件
 *  timetable     课程表(vault 里的 markdown 表)
 *  theme         主题清单(themes/<name>/theme.json:底色槽、字形槽、笔)
 *  activity      activity 文件(agents/<老师>/activities/<名>.md:家长填的、应用算的、应用拦的、老师怎么带、工具人收到什么)
 * 运行时校验用 zod,失败信息经 explainIssues 变成修复指南。
 */
export * from './issues.ts';
export * from './config.ts';
export * from './workspace.ts';
export * from './context-pack.ts';
export * from './conversation.ts';
export * from './conversation-files.ts';
export * from './ledger.ts';
export * from './events.ts';
export * from './sections.ts';
export * from './board.ts';
export * from './plan.ts';
export * from './timetable.ts';
export * from './json-schema.ts';
export * from './theme.ts';
export * from './home.ts';
export * from './activity.ts';
