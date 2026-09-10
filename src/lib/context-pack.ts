/**
 * 上下文包序列化(《cotutor契约草案.md》§2):固定 YAML 块 + `---` + 消息原文。
 * 手写 YAML 子集:标量能裸写就裸写,其余 JSON 双引号(合法 YAML);空的 plan / recent 不写。
 */
import { ContextPackSchema, type ContextPack } from '../schema/index.ts';

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
  if (p.plan.length) {
    out.push('  plan:');
    for (const l of p.plan) out.push(`    - ${yamlScalar(l)}`);
  }
  if (p.recent.length) {
    out.push('  recent:');
    for (const r of p.recent) out.push(`    - ${yamlScalar(`${r.date} ${r.claim}`)}`);
  }
  if (p.board === 'off') out.push('  board: off');
  if (p.cards?.length) {
    out.push('  cards:');
    for (const c of p.cards) out.push(`    - ${yamlScalar(c)}`);
  }
  return out.join('\n');
}

/** 按政策截 plan / recent,再拼成「YAML 块 --- 消息」 */
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
