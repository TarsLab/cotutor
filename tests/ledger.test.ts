/** 账本:逐行解析报行号、按 id 折叠后者为准、retracted 追加行、产物首行要全。 */
import { mergeArtifacts, mergeObservations, nextObservationId, parseArtifactEvents, parseObservations } from '../src/lib/ledger.ts';
import { check, done } from './_check.ts';

const OBS = [
  '{"id":"o-20260908-001","date":"2026-09-08","author":"math-teacher","subject":"数学","claim":"借位忘了","evidence":{"conversation":"math-teacher/2026-09-08","job":"1620-1"}}',
  '{"id":"o-20260908-002","date":"2026-09-08","author":"reading-teacher","claim":"th 发音混"}',
  '',
  '{"id":"o-20260908-001","retracted":true,"by":"parent","date":"2026-09-09"}',
  '{"id":"o-20260908-003","date":"2026-09-08","author":"math-teacher"}',
].join('\n');
{
  const p = parseObservations(OBS);
  check('三行好、一行坏且点名第 5 行', p.rows.length === 3 && p.errors.length === 1 && p.errors[0].includes('第 5 行') && p.errors[0].includes('claim'), p.errors.join(' | '));
  const merged = mergeObservations(p.rows);
  check('纠错行把 001 标 retracted', merged.find((o) => o.id === 'o-20260908-001')?.retracted === true && merged.find((o) => o.id === 'o-20260908-002')?.retracted === false);
  check('顺序按首次出现', merged.map((o) => o.id).join(',') === 'o-20260908-001,o-20260908-002');
  check('下一个 id 顺延', nextObservationId('2026-09-08', merged.map((o) => o.id)) === 'o-20260908-003');
  check('新的一天从 001', nextObservationId('2026-09-09', merged.map((o) => o.id)) === 'o-20260909-001');
}
const ART = [
  '{"id":"2026-09-08-退位","kind":"课包","by":"math-teacher","at":"2026-09-08T16:30","status":"ready","path":"bundles/x","hash":"sha256:1"}',
  '{"id":"2026-09-08-退位","status":"accepted","by":"parent","at":"2026-09-08T20:00"}',
  '{"id":"孤儿","status":"ready","at":"2026-09-08T21:00"}',
].join('\n');
{
  const p = parseArtifactEvents(ART);
  check('事件行都合法', p.errors.length === 0 && p.rows.length === 3, p.errors.join(' | '));
  const m = mergeArtifacts(p.rows);
  check('折叠后者为准、保留首行字段', m.artifacts.length === 1 && m.artifacts[0].status === 'accepted' && m.artifacts[0].path === 'bundles/x' && m.artifacts[0].updatedAt === '2026-09-08T20:00' && m.artifacts[0].by === 'parent');
  check('首行不全的产物报错', m.errors.length === 1 && m.errors[0].includes('孤儿'));
}
done();
