/**
 * 上下文包里从 vault 来的那几段(从 runner.gatherContext 拆出来,2026-10-29,行为不变):
 * 课程表命中的时段、当前学期、档案 / 入口文件 / 记忆的原文(按 entryChars 截;记忆留最近的)、参考路径、本周计划里本老师的行、
 * 最近 14 天日记里本学科的「- 观察:」行(《obsidian仓库设计.md》§7)。都是现读的:家长改了这些文件,下一轮取材就是新的。
 * 有脸的老师的守则(机器技能的原文)不在 vault 里,runner 自己加在这几条笔记前面。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localDate } from '../lib/conversation.ts';
import { extractObservations, recentDiaryDates } from '../lib/diary.ts';
import { isoWeek, parsePlan, planLinesFor } from '../lib/plan.ts';
import { currentSlot, parseTimetable, slotLabel } from '../lib/timetable.ts';
import { clipNote, missingEntry, pickNotes } from '../lib/vault-notes.ts';
import type { ContextPack } from '../schema/index.ts';
import { readDiaries, scanVault, type Vault } from './vault.ts';

const MANY = 100_000;

/**
 * 上下文包的来源清单(2026-09-15,`cotutor pack` 干跑用):每段来自哪个文件、那里一共有多少、按政策带了几条。
 * 家长改了档案 / 入口文件 / 日记 / 计划,不起模型就能看到老师下一轮会看见什么、什么被截掉了。
 */
export interface PackReport {
  timetable: { file: string; found: boolean; slot: string | null };
  vault: { root: string; semester: string | null; profile: string | null; extraProfiles: string[]; entry: string | null; extraEntries: string[]; memory: string | null; extraMemories: string[]; subject: string | null; refs: string[]; limit: number; chars: { profile: number; entry: number; memory: number } };
  plan: { file: string; found: boolean; total: number; kept: number; limit: number };
  recent: { dir: string; days: number; filesFound: string[]; total: number; kept: number; limit: number; subject: string | null };
}

export interface LearningContext {
  slot?: string;
  semester?: string;
  /** 档案、入口文件、记忆的原文(截过) */
  notes: NonNullable<ContextPack['notes']>;
  /** 上下文包里那几行:路径(截了注明)或「缺:…」「还没有」 */
  profile: string;
  entry?: string;
  memory: string;
  refs?: string[];
  plan: string[];
  recent: ContextPack['recent'];
}

/**
 * 这一轮从 vault 取的材。agent = 记忆认谁的(activity 话题是 <老师>/<activity>,档案、入口文件、日记观察照旧共用);
 * teacher = 这位是有脸的老师(没有入口文件时写「缺」);display = 计划里认他的名字(不在 tutors 里就不带计划)
 */
export async function learningContext(
  v: Vault,
  o: { at: Date; agent: string; subject?: string; display?: string; teacher: boolean; limits: { entryChars: number; planLines: number; recent: number } },
  report?: PackReport,
): Promise<LearningContext> {
  const out: LearningContext = { notes: [], profile: '', memory: '', plan: [], recent: [] };
  if (report) report.timetable = { file: v.paths.timetable, found: false, slot: null };
  try {
    const slot = currentSlot(parseTimetable(await readFile(v.paths.timetable, 'utf8')).entries, o.at);
    if (report) report.timetable.found = true;
    if (slot) out.slot = slotLabel(slot);
    if (report) report.timetable.slot = out.slot ?? null;
  } catch {
    /* 没有课程表:不带 slot */
  }
  const { notes, files } = await scanVault(v);
  const pick = pickNotes(notes, files, { date: localDate(o.at), subject: o.subject, agent: o.agent });
  const limit = o.limits.entryChars;
  if (pick.semester) out.semester = pick.semester;
  const labels: Partial<Record<'profile' | 'entry' | 'memory', string>> = {};
  for (const [role, n] of [['profile', pick.profile], ['entry', pick.entry], ['memory', pick.memory]] as const) {
    if (!n) continue;
    const clip = clipNote(n.text, limit, role === 'memory' ? 'tail' : 'head');
    labels[role] = clip.cut ? `${n.path}(原文 ${n.text.length} 字,${role === 'memory' ? `只带最近 ${limit}` : `截到 ${limit}`})` : n.path;
    out.notes.push({ role, path: n.path, text: clip.text });
  }
  out.profile = labels.profile ?? '缺:vault 里没有 cotutor: profile 的档案';
  const entry = labels.entry ?? (o.teacher ? missingEntry(o.subject, pick) : undefined);
  if (entry !== undefined) out.entry = entry;
  out.memory = labels.memory ?? '还没有';
  if (pick.refs.length) out.refs = pick.refs.map((r) => join(v.paths.vault, r));
  if (report) report.vault = { root: v.paths.vault, semester: pick.semester, profile: pick.profile?.path ?? null, extraProfiles: pick.extraProfiles, entry: pick.entry?.path ?? null, extraEntries: pick.extraEntries, memory: pick.memory?.path ?? null, extraMemories: pick.extraMemories, subject: o.subject ?? null, refs: pick.refs, limit, chars: { profile: pick.profile?.text.length ?? 0, entry: pick.entry?.text.length ?? 0, memory: pick.memory?.text.length ?? 0 } };
  const planFile = join(v.paths.plans, `${isoWeek(o.at)}.md`);
  if (report) report.plan = { file: planFile, found: false, total: 0, kept: 0, limit: o.limits.planLines };
  try {
    const { plan } = parsePlan(await readFile(planFile, 'utf8'));
    if (report) report.plan.found = true;
    if (plan && o.display !== undefined) {
      out.plan = planLinesFor(plan, o.display, o.limits.planLines);
      if (report) report.plan = { ...report.plan, total: planLinesFor(plan, o.display, MANY).length, kept: out.plan.length };
    }
  } catch {
    /* 没有本周计划,或读不到:上下文包不带 plan */
  }
  const dates = recentDiaryDates(localDate(o.at), 14);
  const diaries = await readDiaries(v, dates);
  out.recent = extractObservations(diaries, { subject: o.subject, n: o.limits.recent });
  if (report) report.recent = { dir: v.paths.diary, days: dates.length, filesFound: diaries.map((d) => d.date).sort(), total: extractObservations(diaries, { subject: o.subject, n: MANY }).length, kept: out.recent.length, limit: o.limits.recent, subject: o.subject ?? null };
  return out;
}
