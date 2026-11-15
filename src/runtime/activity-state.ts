/**
 * 这个话题是从哪个 activity 起的、读它的 activity 文件。
 */
import { readFile } from 'node:fs/promises';
import type { Workspace } from '../schema/index.ts';
import { findActivityFile } from './activities.ts';
import { parseActivity } from './activity.ts';
import { threads } from '../schema/index.ts';
import { type Activity, type ActivityRun, type ConversationMessage } from '../schema/index.ts';

/** 这个话题是从哪个 activity 起的:话题里第一条带 activity 的消息(只记在第一条);没有 → null */
export function threadActivity(messages: readonly ConversationMessage[], thread: string): ActivityRun | null {
  const ths = threads(messages);
  return messages.find((m, i) => ths[i] === thread && m.activity)?.activity ?? null;
}

/** 读 workspace 里那份 activity 文件;不在 → null */
export async function readActivity(ws: Workspace, tutor: string, name: string): Promise<Activity | null> {
  const text = await readFile(findActivityFile(ws.root, tutor, name), 'utf8').catch(() => null);
  return text === null ? null : parseActivity(text).activity;
}
