/** 产物账本:逐行解析报行号、按 id 折叠后者为准、产物首行要全。(观察 2026-09-14 起在日记里,见 diary.test) */
import { mergeArtifacts, parseArtifactEvents, parseJsonl } from '../src/lib/ledger.ts';
import { ArtifactEventSchema } from '../src/schema/index.ts';
import { check, done } from './_check.ts';

{
  const p = parseJsonl('{"id":"a","kind":"课包","by":"x","at":"t"}\n\n坏行\n{"id":"b"}\n', ArtifactEventSchema, 'x.jsonl');
  check('坏行点名行号、空行跳过、缺 at 的行也点名', p.rows.length === 1 && p.errors.length === 2 && p.errors[0].includes('第 3 行') && p.errors[1].includes('第 4 行'), p.errors.join(' | '));
}
const ART = [
  '{"id":"2026-09-08-退位","kind":"课包","by":"math-tutor","at":"2026-09-08T16:30","status":"ready","path":"bundles/x","hash":"sha256:1"}',
  '{"id":"2026-09-08-退位","status":"accepted","by":"parent","at":"2026-09-08T20:00"}',
  '{"id":"孤儿","status":"ready","at":"2026-09-08T21:00"}',
  '{"id":"2026-09-08-退位","at":"2026-09-08T20:05","costUsd":0.56,"durationMs":258000,"source":{"conversation":"scene-maker/2026-09-08","job":"1630-1"}}',
].join('\n');
{
  const p = parseArtifactEvents(ART);
  check('事件行都合法', p.errors.length === 0 && p.rows.length === 4, p.errors.join(' | '));
  const m = mergeArtifacts(p.rows);
  check('折叠后者为准、保留首行字段', m.artifacts.length === 1 && m.artifacts[0].status === 'accepted' && m.artifacts[0].path === 'bundles/x' && m.artifacts[0].updatedAt === '2026-09-08T20:05' && m.artifacts[0].by === 'parent');
  check('费用行只带 costUsd / durationMs / source,折叠进来', m.artifacts[0].costUsd === 0.56 && m.artifacts[0].durationMs === 258000 && m.artifacts[0].source?.conversation === 'scene-maker/2026-09-08');
  check('首行不全的产物报错', m.errors.length === 1 && m.errors[0].includes('孤儿'));
}
done();
