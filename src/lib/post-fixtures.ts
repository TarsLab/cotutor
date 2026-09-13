/**
 * 后期的样本(《快模型方案.md》§二 B / C):tests/fixtures/post/<名>/ = section.md(老师原文,与 fixtures/board 同一种写法)+ expect.json
 * (部分匹配:must 该标的、never 不该提的、rows 行、look 底色槽的允许集、maxDropped)+ prompts.md(各拍提示词的渲染快照,测试生成入库;
 * 改骨架 diff 里一眼看到提示词变了什么)+ runs/(真模型评测的留档,gitignore)。
 * 这里是纯函数:读样本、渲染快照、给一次后期结果打分。离线测试在 tests/post-fixtures.test.ts,真模型评测在 scripts/post-eval.ts。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseBoard } from './board.ts';
import { beatsOf, cardTexts, findPhrase, type BoardSection, type Device } from './kid-board.ts';
import { beatPrompt } from './postprocess.ts';
import { parseSections } from './sections.ts';
import { DeviceSchema, type ThemeManifest } from '../schema/index.ts';
import type { PostFile } from '../server/post.ts';

export const PostExpectSchema = z.object({
  _note: z.string().optional(),
  device: DeviceSchema.default('tablet-landscape'),
  /** 该标的:定稿的节里这张卡上要有这个词的标注(谁标的都行) */
  must: z.array(z.object({ card: z.number().int().nonnegative(), phrase: z.string().min(1) })).default([]),
  /** 不该提的:模型提了就算失手(校验丢不丢都算) */
  never: z.array(z.object({ card: z.number().int().nonnegative(), phrase: z.string().min(1) })).default([]),
  /** 行:给了就要一模一样 */
  rows: z.array(z.array(z.number().int().nonnegative())).optional(),
  /** 底色槽:卡号 → 允许的槽名;没给的卡不看 */
  look: z.record(z.string(), z.array(z.string().min(1))).default({}),
  maxDropped: z.number().int().nonnegative().optional(),
});
export type PostExpect = z.infer<typeof PostExpectSchema>;

export interface PostFixture {
  name: string;
  dir: string;
  section: BoardSection;
  expect: PostExpect;
  /** prompts.md 现在的内容;还没生成 → null */
  snapshot: string | null;
}

/** 老师原文 → 节:剥固定段再解析,和 deriveKidView 同一条路(不截句:样本要看全) */
export function sectionFromSource(text: string): BoardSection {
  return parseBoard(parseSections(text).body).section;
}

export function loadPostFixture(dir: string, name: string): PostFixture {
  const section = sectionFromSource(readFileSync(join(dir, 'section.md'), 'utf8'));
  const expect = PostExpectSchema.parse(JSON.parse(readFileSync(join(dir, 'expect.json'), 'utf8')));
  let snapshot: string | null = null;
  try {
    snapshot = readFileSync(join(dir, 'prompts.md'), 'utf8');
  } catch {
    /* 还没生成 */
  }
  return { name, dir, section, expect, snapshot };
}

/** 各拍提示词的快照(有卡的拍,顺序;提示词用样本自己的端与给定的主题 / 骨架) */
export function renderFixturePrompts(section: BoardSection, device: Device, theme: ThemeManifest, template: string | null): string {
  const beats = beatsOf(section).filter((b) => b.card !== null);
  return beats.map((b, k) => `<!-- ===== 拍 ${k}(卡 ${b.card}) ===== -->\n${beatPrompt(section, b, device, theme, template)}`).join('\n\n');
}

/** 期望本身合法:must 的词要在那张卡上、卡号要在;rows 要恰好盖住全部卡 */
export function expectProblems(section: BoardSection, expect: PostExpect): string[] {
  const out: string[] = [];
  for (const m of [...expect.must, ...expect.never]) {
    const c = section.cards[m.card];
    if (!c) out.push(`卡 ${m.card} 不在(只有 ${section.cards.length} 张)`);
    else if (!cardTexts(c).some((t) => findPhrase(t, m.phrase) >= 0)) out.push(`「${m.phrase}」不在卡 ${m.card} 上`);
  }
  if (expect.rows) {
    const flat = expect.rows.flat();
    if (flat.length !== section.cards.length || !flat.every((v, i) => v === i)) out.push(`rows 没有恰好盖住 ${section.cards.length} 张卡各一次`);
  }
  for (const k of Object.keys(expect.look)) if (!section.cards[Number(k)]) out.push(`look 的卡 ${k} 不在`);
  return out;
}

export interface FixtureScore {
  /** 有卡的拍数 / 收到的拍数 */
  beats: number;
  okBeats: number;
  mustHit: number;
  mustTotal: number;
  /** 模型提了不该提的几条 */
  neverHit: number;
  neverTotal: number;
  rowsOk: boolean | null;
  lookOk: number;
  lookTotal: number;
  dropped: number;
  droppedOk: boolean | null;
  ms: number;
  costUsd?: number;
}

/** 一次后期的结果 → 分数(section 是套过后期的节,file 是 .post.json 那份) */
export function scoreFixture(section: BoardSection, file: PostFile, expect: PostExpect): FixtureScore {
  const marks = section.lines.flatMap((l) => l.marks);
  const mustHit = expect.must.filter((m) => marks.some((x) => x.card === m.card && x.phrase === m.phrase)).length;
  const proposed = file.beats.flatMap((b) => (b.output?.marks ?? []).map((m) => ({ card: m.card ?? b.card, phrase: m.phrase })));
  const neverHit = expect.never.filter((n) => proposed.some((p) => p.card === n.card && p.phrase === n.phrase)).length;
  const rowsOk = expect.rows ? JSON.stringify(section.layout?.rows ?? section.cards.map((_c, i) => [i])) === JSON.stringify(expect.rows) : null;
  const lookKeys = Object.keys(expect.look);
  const lookOk = lookKeys.filter((k) => { const tint = section.cards[Number(k)]?.look?.tint; return tint !== undefined && expect.look[k].includes(tint); }).length;
  return {
    beats: file.beats.length,
    okBeats: file.beats.filter((b) => b.ok).length,
    mustHit,
    mustTotal: expect.must.length,
    neverHit,
    neverTotal: expect.never.length,
    rowsOk,
    lookOk,
    lookTotal: lookKeys.length,
    dropped: file.dropped.length,
    droppedOk: expect.maxDropped === undefined ? null : file.dropped.length <= expect.maxDropped,
    ms: file.ms,
    ...(file.costUsd !== undefined ? { costUsd: file.costUsd } : {}),
  };
}
