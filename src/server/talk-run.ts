/**
 * 口语课交给英语老师的实时页:口语课页拍好、改好的那份口语单 → activity「口语课」的参数。
 * 只读口语课的数据文件(talk/<id>/talk.json),不引用 src/talk/(那个模块只往这边引用);口语课页不在了,这条路自然走不通。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workspace } from '../cli/workspace.ts';
import { activityFile } from '../cli/activities.ts';
import { parseActivity, resolveParams } from '../lib/activity.ts';
import type { ActivityRun } from '../schema/index.ts';

/** 口语单交给哪个 activity(英语老师的家里那份) */
export const TALK_ACTIVITY = '口语课';
/** 同 src/talk/store.ts 的 ID_RE */
const TALK_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{4}(?:-\d{1,2})?$/;

interface Item { en: string; zh?: string; emoji?: string; chunks?: string[] }

/** 口语单写成一段字:单词一行一个(emoji、英文、中文、拼读分段),句子一行一句(英文、中文) */
export function talkListText(list: { words: readonly Item[]; sentences: readonly Item[] }): string {
  const words = list.words.filter((w) => w.en.trim()).map((w) => [w.emoji, w.en.trim(), w.zh, w.chunks && w.chunks.length > 1 ? w.chunks.join('-') : ''].filter(Boolean).join(' '));
  const sentences = list.sentences.filter((s) => s.en.trim()).map((s) => [s.en.trim(), s.zh].filter(Boolean).join(' '));
  return [...(words.length ? ['单词:', ...words] : []), ...(sentences.length ? ['句子:', ...sentences] : [])].join('\n');
}

/** body.talk = {id}:那份口语单在、有词或句子、这位老师有「口语课」activity → 这个话题的 activity;不然 null */
export async function talkRun(ws: Workspace, tutor: string, talk: unknown): Promise<{ run: ActivityRun; id: string } | null> {
  const id = typeof talk === 'object' && talk !== null && typeof (talk as { id?: unknown }).id === 'string' ? (talk as { id: string }).id : '';
  if (!TALK_ID_RE.test(id)) return null;
  const meta = await readFile(join(ws.root, 'talk', id, 'talk.json'), 'utf8').then((t) => JSON.parse(t) as { list?: { words?: Item[]; sentences?: Item[] } }, () => null);
  const text = meta?.list ? talkListText({ words: meta.list.words ?? [], sentences: meta.list.sentences ?? [] }) : '';
  if (!text) return null;
  const file = await readFile(activityFile(ws.root, tutor, TALK_ACTIVITY), 'utf8').catch(() => null);
  if (file === null) return null;
  const { talk: cfg } = ws.config;
  const r = resolveParams(parseActivity(file).activity, { 口语单: text, 打电话几分钟: String(cfg.minutes), ...(cfg.note ? { 家长的话: cfg.note } : {}) });
  return r.issues.length ? null : { run: { name: TALK_ACTIVITY, params: r.values }, id };
}
