/**
 * 上下文包序列化(《cotutor契约草案.md》§2):固定 YAML 块 + `---` + 消息原文。
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
  if (p.focus && (p.focus.artifact || p.focus.step !== undefined || p.focus.circled?.length || p.focus.card)) {
    out.push('  focus:');
    if (p.focus.artifact) out.push(`    artifact: ${yamlScalar(p.focus.artifact)}`);
    if (p.focus.step !== undefined) out.push(`    step: ${p.focus.step}`);
    if (p.focus.circled?.length) out.push(`    circled: [${p.focus.circled.map(yamlScalar).join(', ')}]`);
    if (p.focus.card) out.push(`    card: ${yamlScalar(p.focus.card)}`);
  }
  if (p.profile.length) {
    out.push('  profile:');
    for (const l of p.profile) out.push(`    - ${yamlScalar(l)}`);
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
  return out.join('\n');
}

/** 按政策截 profile / plan / recent,再拼成「YAML 块 --- 消息」 */
export function buildContextPack(
  pack: ContextPack,
  message: string,
  limits: { recent: number; planLines: number; profileLines?: number },
): string {
  const trimmed: ContextPack = {
    ...pack,
    profile: (pack.profile ?? []).slice(0, limits.profileLines ?? 8),
    plan: (pack.plan ?? []).slice(0, limits.planLines),
    recent: (pack.recent ?? []).slice(-limits.recent),
  };
  return `${renderContextPack(trimmed)}\n---\n${message.trim()}\n`;
}
