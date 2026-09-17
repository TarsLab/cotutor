/**
 * 日记与档案的纯函数(《obsidian仓库设计.md》§3 / §6 / §7):vault 是长期记忆,机器只新建或追加,形状由这里保证。
 *  - 记账:老师回「## 记账」段(sections.ts 解析),应用按话题渲染成日记里的一段 `## 学科 · 话题名`:
 *    孩子问的话总是记(callout,一行一问);摘要 + 星 + 教材单元链接 + 课包 id、`骨架:` 行只在话题打分 ≥ keepScore 时有;
 *    `- 观察:` 行是上下文包「最近观察」的来源——家长在 Obsidian 里改一句、删一行,下次对话就变(观察的真相在日记,账本 jsonl 退役)。
 *  - 抽取:`extractObservations` 从最近几天的日记抽「- 观察:」行(按 H2 的学科过滤)。
 *  - 老师(LLM)不直接写 vault 文件;`bookkeepingPrompt` 是记账任务的消息正文,教材目录(册#节)列在里面让它原样挑。
 */
import type { Bookkeeping, BookkeepingEntry, ConversationMessage } from '../schema/index.ts';
import { threads } from './conversation.ts';

export interface DiaryTopic {
  /** H2 的前半:学科(老师没配学科就用显示名) */
  subject: string;
  /** H2 的后半:话题名 */
  name: string;
  /** 孩子在这个话题里说的话,原话 */
  questions: string[];
  /** 家长打的星;没打 = undefined */
  rating?: number;
  /** 打分够时才有:摘要、骨架、教材单元(wikilink 目标「册#节」) */
  summary?: string;
  steps?: string;
  textbook?: string;
  /** 这个话题里做出来的课包 id */
  bundles: string[];
  observations: string[];
}

/** 孩子在这个话题里说的话:from: kid、不是「继续」/ 交答案这种动作、非空;多行并成一行 */
export function kidQuestions(messages: readonly Pick<ConversationMessage, 'job' | 'from' | 'thread' | 'text' | 'action'>[], thread: string): string[] {
  const ths = threads(messages);
  const out: string[] = [];
  messages.forEach((m, i) => {
    if (ths[i] !== thread || m.from !== 'kid' || m.action) return;
    const text = m.text.replace(/\s+/g, ' ').trim();
    if (text && text !== '继续') out.push(text);
  });
  return out;
}

/** 这个话题里做出来的课包(消息的 artifacts) */
export function threadBundles(messages: readonly Pick<ConversationMessage, 'job' | 'from' | 'thread' | 'artifacts'>[], thread: string): string[] {
  const ths = threads(messages);
  const out = new Set<string>();
  messages.forEach((m, i) => {
    if (ths[i] === thread) for (const a of m.artifacts) out.add(a);
  });
  return [...out];
}

/** 把记账段的一条与索引里的话题拼成日记的素材;打分不够就丢掉摘要与骨架(老师多写了也不进) */
export function diaryTopic(
  index: { messages: readonly Pick<ConversationMessage, 'job' | 'from' | 'thread' | 'text' | 'action' | 'artifacts'>[]; ratings: Record<string, number> },
  entry: BookkeepingEntry,
  opts: { subject: string; keepScore: number },
): DiaryTopic {
  const rating = index.ratings[entry.thread];
  const keep = rating !== undefined && rating >= opts.keepScore;
  return {
    subject: opts.subject,
    name: entry.name.trim(),
    questions: kidQuestions(index.messages, entry.thread),
    rating,
    ...(keep && entry.summary ? { summary: entry.summary.trim() } : {}),
    ...(keep && entry.steps ? { steps: entry.steps.trim() } : {}),
    ...(keep && entry.textbook ? { textbook: entry.textbook.trim().replace(/^\[\[|\]\]$/g, '') } : {}),
    bundles: keep ? threadBundles(index.messages, entry.thread) : [],
    observations: entry.observations.map((o) => o.trim()).filter(Boolean),
  };
}

const stars = (n: number | undefined): string => (n ? '★'.repeat(n) : '');

/** 一个话题在日记里的一段;什么都没有(没问、没摘要、没观察)→ null,日记不出现它 */
export function renderDiaryBlock(t: DiaryTopic): string | null {
  const lines: string[] = [`## ${t.subject} · ${t.name}`];
  if (t.questions.length) {
    lines.push('', '> [!question] 孩子问', ...t.questions.map((q) => `> ${q}`));
  }
  if (t.summary) {
    const tail = [stars(t.rating), t.textbook ? `→ [[${t.textbook}]]` : '', t.bundles.length ? `课包 ${t.bundles.join('、')}` : ''].filter(Boolean).join(' ');
    lines.push('', `${t.summary}${tail ? ` ${tail}` : ''}`);
    if (t.steps) lines.push(`骨架:${t.steps}`);
  }
  if (t.observations.length) lines.push('', ...t.observations.map((o) => `- 观察:${o}`));
  if (lines.length === 1) return null;
  return `${lines.join('\n')}\n`;
}

/** 追加到当天的日记:文件不在就是这一段;在就空一行接上(家长自己写的行永不动) */
export function appendDiary(existing: string | null, block: string): string {
  if (!existing || !existing.trim()) return block;
  return `${existing.replace(/\s+$/, '')}\n\n${block}`;
}

const H2 = /^##\s+(.+?)\s*$/;
const OBS = /^-\s*观察[::]\s*(.+?)\s*$/;

/**
 * 上下文包的 recent:最近几天日记里的「- 观察:」行,按日期升序取最后 n 条。
 * 段的 H2 是「学科 · 名」时按学科过滤(subject 没配 → 全量);不在任何 H2 下的(家长写在文件头的)总是算。
 */
export function extractObservations(diaries: readonly { date: string; text: string }[], opts: { subject?: string; n: number }): { date: string; claim: string }[] {
  const out: { date: string; claim: string }[] = [];
  for (const d of [...diaries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    let subject: string | null = null;
    let fence = false;
    for (const line of d.text.split('\n')) {
      if (/^\s*```/.test(line)) fence = !fence;
      if (fence) continue;
      const h = H2.exec(line);
      if (h) {
        subject = h[1].split(/\s+·\s+/)[0].trim();
        continue;
      }
      const m = OBS.exec(line);
      if (!m) continue;
      if (opts.subject && subject !== null && subject !== opts.subject) continue;
      out.push({ date: d.date, claim: m[1] });
    }
  }
  return out.slice(-opts.n);
}

/** 教材目录的可引用条目:每册文件的每个 H2 → 「册#节标题」(wikilink 的目标;文件名不带 .md) */
export function textbookHeadings(files: readonly { name: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const book = f.name.replace(/\.md$/, '');
    let fence = false;
    for (const line of f.text.split('\n')) {
      if (/^\s*```/.test(line)) fence = !fence;
      if (fence) continue;
      const h = H2.exec(line);
      if (h) out.push(`${book}#${h[1]}`);
    }
  }
  return out;
}

/** 日记里最近 days 天的文件名(含今天) */
export function recentDiaryDates(today: string, days: number): string[] {
  const [y, m, d] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const t = new Date(y, m - 1, d - i);
    out.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
  }
  return out;
}

/**
 * 记账任务的消息正文(上下文包由 runner 照常拼在前面;这轮 resume 那个话题的会话,老师记得聊了什么)。
 * 打分够:要 name / textbook / summary / steps / observations;不够或没打:只要 name / textbook / observations。
 */
export function bookkeepingPrompt(opts: { thread: string; rating?: number; keepScore: number; headings: string[]; /** 这个话题里孩子拍了几张作业照片(R5):有就让摘要把图上的东西写成文字 */ photos?: number }): string {
  const keep = opts.rating !== undefined && opts.rating >= opts.keepScore;
  const graded = opts.rating === undefined ? '家长还没打分' : `家长打了 ${opts.rating} 星${keep ? '' : `(不到 ${opts.keepScore} 星,摘要不进日记)`}`;
  const lines = [
    `学习结束,给刚才这个话题记账(话题 ${opts.thread},${graded})。只回一段「## 记账」,别的一个字都不用写,不用工具:`,
    '',
    '## 记账',
    `- thread: ${opts.thread}`,
    '  name: 这个话题叫什么(不超过 12 字,像日记里的小标题)',
    opts.headings.length ? '  textbook: 属于哪册哪节——从下面的教材目录里挑一条原样抄;都不是就不写这行' : '  textbook: 属于哪册哪节,写成「册#节」;认不出就不写这行',
    ...(keep ? [`  summary: 一到三句,讲了什么、难点在哪、孩子哪里卡住${opts.photos ? ';这个话题里有 ' + opts.photos + ' 张作业照片,把你认出的册子 / 页 / 题号 / 题面写成文字(日记不存图、不写照片路径)' : ''}`, '  steps: 讲解的骨架,一行,步骤用 → 连'] : []),
    '  observations:',
    '    - 关于孩子、值得别的老师下次知道的一句话(0–3 条;没有就不写 observations)',
  ];
  if (opts.headings.length) lines.push('', '教材目录:', ...opts.headings.map((h) => `- ${h}`));
  return lines.join('\n');
}

/** 记账段里对上这个话题的那条(老师只该回一条;thread 写错了但只有一条也认) */
export function entryFor(b: Bookkeeping, thread: string): BookkeepingEntry | null {
  return b.entries.find((e) => e.thread === thread) ?? (b.entries.length === 1 ? { ...b.entries[0], thread } : null);
}
