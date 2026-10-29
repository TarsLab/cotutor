/**
 * 一老师一天的对话在 conversations/ 下的文件布局、卡的 id 与资产名、卡的状态文件(落盘的契约;读写在 runtime/journal/)。
 */
export interface ConversationFiles {
  index: string;
  log: (job: string) => string;
  err: (job: string) => string;
  /** 这一轮真发出去的东西:上下文包 + 完整命令行(家长端「看原文」第一站;跑完就丢的话,「老师为什么没看见」永远查不了) */
  run: (job: string) => string;
  /** 这一轮的事件流 <date>.<job>.events.jsonl(runtime/journal/events.ts;控制台与时间线的唯一来源) */
  events: (job: string) => string;
  /** 录像的实录 <date>.<job>.play.jsonl:孩子端报上来的记在话题当时的末条 job 上,卡的每次存记在卡所在那轮;删话题一起删 */
  play: (job: string) => string;
  /** 实时那一轮嘴照念的声音 <date>.<job>.mouth.wav 与每句的起点 .mouth.json(字幕重放,src/runtime/journal/mouth-index.ts;删话题时按 <date>.<job>.* 一起删) */
  mouth: (job: string, ext: 'wav' | 'json') => string;
  /** 这一轮各张卡的状态目录 <date>.<job>.cards/ */
  cardsDir: (job: string) => string;
  /** 第 n 张卡(0 起)的状态文件 <date>.<job>.cards/<n>.json */
  card: (job: string, n: number) => string;
  /** 第 n 张卡的资产目录 <date>.<job>.cards/<n>/ */
  cardAssetsDir: (job: string, n: number) => string;
  /** 第 n 张卡的一个资产文件(点读第 k 段 = <k>.mp3) */
  cardAsset: (job: string, n: number, file: string) => string;
  /** API 运行时这个话题的模型历史 <date>.<话题>.brain.jsonl(src/brain/api.ts;话题 id 就是第一轮的 job,删话题按 <date>.<job>.* 一起删) */
  brain: (thread: string) => string;
}

/** conversations/<tutor>/<date>.json 与 <date>.<job>.log / .err.log / .mp3(整段配音)/ .<n>.mp3(讲稿第 n 句)/ .cards/<n>.json(卡的状态) */
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
    cardsDir: (job) => `${base}.${job}.cards`,
    card: (job, n) => `${base}.${job}.cards/${n}.json`,
    cardAssetsDir: (job, n) => `${base}.${job}.cards/${n}`,
    cardAsset: (job, n, file) => `${base}.${job}.cards/${n}/${file}`,
    brain: (thread) => `${base}.${thread}.brain.jsonl`,
  };
}

/** 资产在孩子端的名字:相对 conversations/<老师>/,/api/audio 认它 */
export function cardAssetName(date: string, job: string, n: number, file: string): string {
  return `${date}.${job}.cards/${n}/${file}`;
}

/** 卡的 id:<job>/<n>(n 是节里的下标,0 起);页面、上下文包、状态文件名都用它 */
export function cardId(job: string, n: number): string {
  return `${job}/${n}`;
}

/** 一张卡的状态文件:孩子做的事 + 什么时候做的 + 做的时候最后一轮是谁(下一条消息只带「上一轮之后改过的」) */
export interface CardStateFile {
  at: string;
  /** 存的时候索引里最后一条消息的 job;下一条消息发出时 turn === 当时的末条 → 这张卡要带上 */
  turn: string;
  state: unknown;
}

/** 索引里每条消息 job → 它那节里卡下标 → 状态文件(没做过的卡不在) */
export type CardStates = Record<string, Record<number, CardStateFile>>;

/** job → 卡下标 → 已生成好的资产名(相对 conversations/<老师>/) */
export type CardAssets = Record<string, Record<number, string[]>>;
