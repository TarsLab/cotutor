/**
 * 测试用的一份通用 activity「聊」:不以板为主、卡都带,「老师怎么带」只有人设、第一句与收。
 * 2026-11-16 起新话题都从一个 activity 开始(没有自由话题);测试要「随便一轮」时开这个,孩子的话照原样交给老师
 * (孩子端点按钮会把字换成按钮上的,所以经 Runner 直接开:同 cotutor send --activity)。不是出厂件。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../src/app/http/app.ts';
import type { SendInput } from '../src/runtime/runner.ts';

export const CHAT = '聊';
export const CHAT_RUN = { name: CHAT, params: {} };

export function chatActivity(display = '老师'): string {
  return [
    '---',
    `name: ${CHAT}`,
    'description: 测试用:孩子说什么就聊什么',
    'cards: text read choice image tianzige word photo code',
    '---',
    '',
    '## 老师怎么带',
    '',
    `你是这个家的${display},对面是一个孩子。`,
    '',
    '第一句: 接着孩子的话说。',
    '',
    '收: 孩子说停就停。',
    '',
  ].join('\n');
}

/** 给 workspace 里这几位老师各写一份「聊」 */
export function writeChat(root: string, tutors: readonly string[]): void {
  for (const t of tutors) {
    const dir = join(root, 'agents', t, 'activities');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${CHAT}.md`), chatActivity());
  }
}

/** 开一个「聊」的话题:孩子的这句话照原样(实时轮,live: {});回的形状同 tests/_kid-send.ts 收下时的 202 */
export async function chatStart(ctx: AppContext, tutor: string, body: Omit<SendInput, 'from' | 'newThread' | 'activity'> & { from?: SendInput['from'] }): Promise<{ status: number; json: { tutor: string; date: string; job: string; thread: string } }> {
  const started = await ctx.runner.send(tutor, { from: 'kid', live: {}, ...body, newThread: true, activity: CHAT_RUN });
  return { status: 202, json: { tutor, date: started.date, job: started.job, thread: started.thread } };
}
