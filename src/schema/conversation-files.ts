/**
 * 一老师一天的对话在 conversations/ 下的文件布局(落盘的契约;读写在 runtime/journal/)。以前记录里卡的状态目录 <date>.<job>.cards/ 不读了(删话题照 <date>.<job>.* 一起删)。
 */
export interface ConversationFiles {
  index: string;
  log: (job: string) => string;
  err: (job: string) => string;
  /** 这一轮真发出去的东西:上下文包 + 完整命令行(家长端「看原文」第一站;跑完就丢的话,「老师为什么没看见」永远查不了) */
  run: (job: string) => string;
  /** 这一轮的事件流 <date>.<job>.events.jsonl(runtime/journal/events.ts;控制台与时间线的唯一来源) */
  events: (job: string) => string;
  /** 录像的实录 <date>.<job>.play.jsonl:孩子端报上来的记在话题当时的末条 job 上;删话题一起删 */
  play: (job: string) => string;
  /** 实时那一轮嘴照念的声音 <date>.<job>.mouth.wav 与每句的起点 .mouth.json(字幕重放,src/runtime/journal/mouth-index.ts;删话题时按 <date>.<job>.* 一起删) */
  mouth: (job: string, ext: 'wav' | 'json') => string;
  /** API 运行时这个话题的模型历史 <date>.<话题>.brain.jsonl(src/brain/api.ts;话题 id 就是第一轮的 job,删话题按 <date>.<job>.* 一起删) */
  brain: (thread: string) => string;
  /** 一节课里板的日志 <date>.<话题>.board.jsonl(src/runtime/journal/board-log.ts):孩子在板上做的事一件一行,应用记的(交给老师到哪了)也在;删话题按 <date>.<job>.* 一起删 */
  board: (thread: string) => string;
  /** 课本做底时窗里最新的那张图 <date>.<话题>.shot.jpg;交给老师的那一轮挪成 shot(job) 那张 <date>.<job>.shot.jpg(附给脑的就是它) */
  shot: (threadOrJob: string) => string;
  /** 话题的预览图 <date>.<话题>.preview.jpg:孩子端板停下来时舞台导的一张小图,首页「今天」那一格用它;只留最新一张 */
  preview: (thread: string) => string;
  /** 一节课的状态 <date>.<话题>.lesson.json(src/runtime/journal/lesson-store.ts):页集、窗、每页老师的一层、孩子的一层、开放的 */
  lesson: (thread: string) => string;
}

/** conversations/<tutor>/<date>.json 与 <date>.<job>.log / .err.log / .mp3(整段配音)/ .<n>.mp3(讲稿第 n 句) */
export function conversationFiles(conversationsDir: string, tutor: string, date: string): ConversationFiles {
  const base = `${conversationsDir}/${tutor}/${date}`;
  return {
    index: `${base}.json`,
    log: (job) => `${base}.${job}.log`,
    err: (job) => `${base}.${job}.err.log`,
    run: (job) => `${base}.${job}.run.json`,
    events: (job) => `${base}.${job}.events.jsonl`,
    play: (job) => `${base}.${job}.play.jsonl`,
    mouth: (job, ext) => `${base}.${job}.mouth.${ext}`,
    brain: (thread) => `${base}.${thread}.brain.jsonl`,
    board: (thread) => `${base}.${thread}.board.jsonl`,
    shot: (id) => `${base}.${id}.shot.jpg`,
    preview: (thread) => `${base}.${thread}.preview.jpg`,
    lesson: (thread) => `${base}.${thread}.lesson.json`,
  };
}
