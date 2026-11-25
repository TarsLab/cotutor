/**
 * 上下文包序列化:固定 YAML 块 + 老师守则原文(<cotutor-rules>)、家长笔记原文段(<vault-note>)、页上印的字(<page>)+ `---` + 消息原文。
 * 手写 YAML 子集:标量能裸写就裸写,其余 JSON 双引号(合法 YAML);空的 plan / recent 不写。
 */
import { ContextPackSchema, VAULT_PACK_ROLES, type ContextPack } from '../../schema/index.ts';

const BARE = /^[A-Za-z0-9_][A-Za-z0-9_\-.:T]*$/;

export function yamlScalar(v: string | number | boolean): string {
  if (typeof v !== 'string') return String(v);
  return BARE.test(v) && !/^(true|false|null|~|yes|no)$/i.test(v) ? v : JSON.stringify(v);
}

export function renderContextPack(pack: ContextPack): string {
  const p = ContextPackSchema.parse(pack);
  const out: string[] = ['cotutor:', `  at: ${yamlScalar(p.at)}`];
  if (p.slot) out.push(`  slot: ${yamlScalar(p.slot)}`);
  if (p.rules) out.push(`  rules: ${yamlScalar(p.rules)}`);
  if (p.activityGuide) out.push(`  activityGuide: ${yamlScalar(p.activityGuide)}`);
  if (p.semester) out.push(`  semester: ${yamlScalar(p.semester)}`);
  if (p.profile) out.push(`  profile: ${yamlScalar(p.profile)}`);
  if (p.child) out.push(`  child: ${yamlScalar(p.child)}`);
  if (p.entry) out.push(`  entry: ${yamlScalar(p.entry)}`);
  if (p.teacherMemory) out.push(`  teacherMemory: ${yamlScalar(p.teacherMemory)}`);
  if (p.memory) out.push(`  memory: ${yamlScalar(p.memory)}`);
  if (p.lesson) out.push(`  lesson: ${yamlScalar(p.lesson)}`);
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
  if (p.lookup?.length) {
    out.push('  lookup:');
    for (const l of p.lookup) out.push(`    - ${yamlScalar(l)}`);
  }
  // vault 是 workspace 级的,放在每条消息才变的 board / photos 前面
  if (p.vault) {
    out.push('  vault:', `    root: ${yamlScalar(p.vault.root)}`);
    for (const r of VAULT_PACK_ROLES) if (p.vault[r]) out.push(`    ${r}: ${yamlScalar(p.vault[r] as string)}`);
  }
  if (p.home) {
    out.push('  home:', `    button: ${yamlScalar(p.home.button)}`);
    if (p.home.brief) out.push(`    brief: ${yamlScalar(p.home.brief)}`);
  }
  if (p.live) {
    const l = p.live;
    if (!l.caught && l.cut === undefined && !l.echo?.length && !l.mouth?.length && !l.app) out.push('  live: true');
    else {
      out.push('  live:');
      if (l.caught) out.push(`    caught: ${yamlScalar(l.caught)}`);
      if (l.cut !== undefined) out.push(`    cut: ${l.cut}`);
      if (l.app) out.push(`    app: ${l.app}`);
      if (l.echo?.length) {
        out.push('    echo:');
        for (const x of l.echo) out.push(`      - ${yamlScalar(x)}`);
      }
      if (l.mouth?.length) {
        out.push('    mouth:');
        for (const x of l.mouth) out.push(`      - ${yamlScalar(x)}`);
      }
    }
  }
  // 一节课:页此刻的样子(键是给老师看的中文)
  if (p.slate) {
    const b = p.slate;
    out.push('  board:', `    底: ${yamlScalar(b.base)}`);
    if (b.pages) out.push(`    页集: ${yamlScalar(b.pages)}`);
    if (b.drawn) out.push(`    你画的: ${yamlScalar(b.drawn)}`);
    out.push(`    开放: ${yamlScalar(b.ops.length ? b.ops.join('、') : '无')}`);
    if (b.did.length) {
      out.push('    孩子做的:');
      for (const x of b.did) out.push(`      - ${yamlScalar(x)}`);
    }
    if (b.recent) out.push(`    最近点的: ${yamlScalar(b.recent)}`);
    if (b.view) out.push(`    孩子在看: ${yamlScalar(b.view)}`);
    if (b.teacher?.length) {
      out.push('    给老师的:');
      for (const x of b.teacher) out.push(`      - ${yamlScalar(x)}`);
    }
  }
  if (p.photos?.length) {
    out.push('  photos:');
    for (const c of p.photos) out.push(`    - ${yamlScalar(c)}`);
  }
  if (p.photoFiles?.length) {
    out.push('  photoFiles:');
    for (const c of p.photoFiles) out.push(`    - ${yamlScalar(c)}`);
  }
  // activity 放最后、键序固定
  if (p.activity) {
    const a = p.activity;
    out.push('  activity:', `    name: ${yamlScalar(a.name)}`);
    for (const [key, values] of [['params', a.params]] as const) {
      const entries = Object.entries(values);
      if (!entries.length) continue;
      out.push(`    ${key}:`);
      for (const [k, v] of entries) {
        if (!Array.isArray(v)) out.push(`      ${yamlScalar(k)}: ${yamlScalar(v)}`);
        else {
          out.push(`      ${yamlScalar(k)}:`);
          for (const x of v) out.push(`        - ${yamlScalar(x)}`);
        }
      }
    }
  }
  // 守则是出厂的,不是家长的笔记,换个标签;路径相对 workspace 根(家长笔记的相对 vault 根)
  for (const n of p.notes ?? []) {
    const shipped = n.role === 'rules' || n.role === 'activityGuide';
    const tag = n.role === 'rules' ? 'cotutor-rules' : n.role === 'activityGuide' ? 'cotutor-activity' : 'vault-note';
    out.push(shipped ? `<${tag} path=${JSON.stringify(n.path)}>` : `<${tag} role="${n.role}" path=${JSON.stringify(n.path)}>`, n.text.replace(/\s+$/, ''), `</${tag}>`);
  }
  // 页上印的字:第一次看到那一页时给一次
  for (const n of p.pageNotes ?? []) out.push(`<page id=${JSON.stringify(n.id)} name=${JSON.stringify(n.name)}>`, ...n.text, '</page>');
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
