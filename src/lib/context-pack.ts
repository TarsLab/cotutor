/**
 * 上下文包序列化(《cotutor契约草案.md》§2):固定 YAML 块 + 家长笔记原文段(<vault-note>)+ `---` + 消息原文。
 * 手写 YAML 子集:标量能裸写就裸写,其余 JSON 双引号(合法 YAML);空的 plan / recent 不写。
 */
import { ContextPackSchema, VAULT_PACK_ROLES, type ContextPack } from '../schema/index.ts';

const BARE = /^[A-Za-z0-9_][A-Za-z0-9_\-.:T]*$/;

export function yamlScalar(v: string | number | boolean): string {
  if (typeof v !== 'string') return String(v);
  return BARE.test(v) && !/^(true|false|null|~|yes|no)$/i.test(v) ? v : JSON.stringify(v);
}

export function renderContextPack(pack: ContextPack): string {
  const p = ContextPackSchema.parse(pack);
  const out: string[] = ['cotutor:', `  from: ${p.from}`, `  at: ${yamlScalar(p.at)}`];
  if (p.slot) out.push(`  slot: ${yamlScalar(p.slot)}`);
  if (p.focus?.card) out.push('  focus:', `    card: ${yamlScalar(p.focus.card)}`);
  if (p.semester) out.push(`  semester: ${yamlScalar(p.semester)}`);
  if (p.profile) out.push(`  profile: ${yamlScalar(p.profile)}`);
  if (p.entry) out.push(`  entry: ${yamlScalar(p.entry)}`);
  if (p.memory) out.push(`  memory: ${yamlScalar(p.memory)}`);
  if (p.refs?.length) {
    out.push('  refs:');
    for (const r of p.refs) out.push(`    - ${yamlScalar(r)}`);
  }
  if (p.plan.length) {
    out.push('  plan:');
    for (const l of p.plan) out.push(`    - ${yamlScalar(l)}`);
  }
  if (p.recent.length) {
    out.push('  recent:');
    for (const r of p.recent) out.push(`    - ${yamlScalar(`${r.date} ${r.claim}`)}`);
  }
  // vault 是 workspace 级的,放在每条消息才变的 board / cards / photos 前面
  if (p.vault) {
    out.push('  vault:', `    root: ${yamlScalar(p.vault.root)}`);
    for (const r of VAULT_PACK_ROLES) if (p.vault[r]) out.push(`    ${r}: ${yamlScalar(p.vault[r] as string)}`);
  }
  if (p.board === 'off') out.push('  board: off');
  if (p.cards?.length) {
    out.push('  cards:');
    for (const c of p.cards) out.push(`    - ${yamlScalar(c)}`);
  }
  if (p.photos?.length) {
    out.push('  photos:');
    for (const c of p.photos) out.push(`    - ${yamlScalar(c)}`);
  }
  for (const n of p.notes ?? []) out.push(`<vault-note role="${n.role}" path=${JSON.stringify(n.path)}>`, n.text.replace(/\s+$/, ''), '</vault-note>');
  return out.join('\n');
}

/** 按政策截 plan / recent,再拼成「YAML 块 + 笔记原文 --- 消息」(笔记原文已在取材时按 entryChars 截) */
export function buildContextPack(
  pack: ContextPack,
  message: string,
  limits: { recent: number; planLines: number },
): string {
  const trimmed: ContextPack = {
    ...pack,
    plan: (pack.plan ?? []).slice(0, limits.planLines),
    recent: (pack.recent ?? []).slice(-limits.recent),
  };
  return `${renderContextPack(trimmed)}\n---\n${message.trim()}\n`;
}
