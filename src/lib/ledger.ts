/**
 * 产物账本的纯函数部分:逐行 JSON + zod,坏行报行号不中断;按 id 折叠,后者为准。
 * (观察不在账本里了,2026-09-14:真相在 vault 的日记,见 lib/diary.ts)
 */
import type { z } from 'zod';
import { ArtifactEventSchema, type Artifact, type ArtifactEvent, explainIssues } from '../schema/index.ts';

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

export const parseArtifactEvents = (text: string): JsonlParse<ArtifactEvent> =>
  parseJsonl(text, ArtifactEventSchema, 'artifacts.jsonl');

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
