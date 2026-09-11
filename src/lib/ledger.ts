/**
 * 账本读写的纯函数部分:逐行 JSON + zod,坏行报行号不中断;按 id 折叠,后者为准。
 */
import type { z } from 'zod';
import {
  ArtifactEventSchema,
  ObservationLineSchema,
  type Artifact,
  type ArtifactEvent,
  type Observation,
  type ObservationLine,
  explainIssues,
} from '../schema/index.ts';

export interface JsonlParse<T> {
  rows: T[];
  errors: string[];
}

export function parseJsonl<T>(text: string, schema: z.ZodType<T>, file = 'jsonl'): JsonlParse<T> {
  const rows: T[] = [];
  const errors: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      errors.push(`${file} 第 ${i + 1} 行:不是合法 JSON`);
      return;
    }
    const r = schema.safeParse(raw);
    if (r.success) rows.push(r.data);
    else errors.push(`${file} 第 ${i + 1} 行:${explainIssues(r.error.issues).join(';')}`);
  });
  return { rows, errors };
}

export const parseObservations = (text: string): JsonlParse<ObservationLine> =>
  parseJsonl(text, ObservationLineSchema, 'observations.jsonl');
export const parseArtifactEvents = (text: string): JsonlParse<ArtifactEvent> =>
  parseJsonl(text, ArtifactEventSchema, 'artifacts.jsonl');

/** 完整行建条目,纠错行改 retracted;顺序按首次出现 */
export function mergeObservations(lines: ObservationLine[]): Observation[] {
  const byId = new Map<string, Observation>();
  for (const l of lines) {
    if ('claim' in l) {
      const prev = byId.get(l.id);
      byId.set(l.id, prev ? { ...prev, ...l, retracted: prev.retracted || l.retracted } : { ...l });
    } else {
      const prev = byId.get(l.id);
      if (prev) prev.retracted = true;
    }
  }
  return [...byId.values()];
}

/** 折叠产物事件;首行缺 kind / by 的产物报错(不进结果) */
export function mergeArtifacts(events: ArtifactEvent[]): { artifacts: Artifact[]; errors: string[] } {
  const byId = new Map<string, Artifact>();
  const errors: string[] = [];
  for (const e of events) {
    const prev = byId.get(e.id);
    if (!prev) {
      if (!e.kind || !e.by) {
        errors.push(`产物 ${e.id} 的第一条事件要带 kind 与 by`);
        continue;
      }
      byId.set(e.id, {
        id: e.id,
        kind: e.kind,
        by: e.by,
        at: e.at,
        status: e.status ?? 'draft',
        path: e.path,
        source: e.source,
        hash: e.hash,
        costUsd: e.costUsd,
        durationMs: e.durationMs,
        updatedAt: e.at,
      });
      continue;
    }
    if (e.kind) prev.kind = e.kind;
    if (e.by) prev.by = e.by;
    if (e.status) prev.status = e.status;
    if (e.path) prev.path = e.path;
    if (e.source) prev.source = e.source;
    if (e.hash) prev.hash = e.hash;
    if (e.costUsd !== undefined) prev.costUsd = e.costUsd;
    if (e.durationMs !== undefined) prev.durationMs = e.durationMs;
    prev.updatedAt = e.at;
  }
  return { artifacts: [...byId.values()], errors };
}

/** o-YYYYMMDD-NNN,同日顺延 */
export function nextObservationId(date: string, existing: Iterable<string>): string {
  const day = date.replaceAll('-', '').slice(0, 8);
  let n = 0;
  for (const id of existing) {
    const m = new RegExp(`^o-${day}-(\\d{3,})$`).exec(id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `o-${day}-${String(n + 1).padStart(3, '0')}`;
}

/** 上下文包的 recent:未撤回、本学科(没配 subject 就全量)的最近 n 条,按日期与出现顺序,只带 date + claim */
export function recentObservations(obs: Observation[], opts: { subject?: string; n: number }): { date: string; claim: string }[] {
  return obs
    .filter((o) => !o.retracted && (!opts.subject || o.subject === opts.subject))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-opts.n)
    .map((o) => ({ date: o.date, claim: o.claim }));
}
