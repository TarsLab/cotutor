/**
 * cotutor 契约(类型即文档)。每个文件一个契约面:
 *  config        cotutor.json(老师表、政策、运行时、paths 角色)
 *  context-pack  每条消息前的上下文包
 *  conversation  一老师一天一份的对话索引
 *  ledger        观察与产物两本追加式账本
 *  sections      最终文本里的「待裁量」「转交」段
 *  plan          计划文件
 *  timetable     课程表(vault 里的 markdown 表)
 * 运行时校验用 zod,失败信息经 explainIssues 变成修复指南。
 */
export * from './issues.ts';
export * from './config.ts';
export * from './context-pack.ts';
export * from './conversation.ts';
export * from './ledger.ts';
export * from './sections.ts';
export * from './board.ts';
export * from './plan.ts';
export * from './timetable.ts';
export * from './json-schema.ts';
