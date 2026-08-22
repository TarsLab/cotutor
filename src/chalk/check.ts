/**
 * 阶梯层 2–3:schema 校验、语义 lint、确定性布局检查。
 * 纯函数,不碰文件系统;错误信息 = 修复指南(agent-friendly.md)。
 * 层 1(模块求值)在 load-scene.ts;层 4(keyframe 截图)归 snap(规划中)。
 */

import { KNOWN_ELEMENT_TYPES, sceneSchema } from '../schema/scene.ts';
import type { ChalkScene, ChalkSkeleton } from '../player/types.ts';

export interface Finding {
  level: 'error' | 'warning';
  rule: string;
  message: string;
}

export interface CheckResult {
  scene: ChalkScene | null;
  findings: Finding[];
}

export function checkScene(raw: unknown): CheckResult {
  const findings: Finding[] = [];
  const parsed = sceneSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push({ level: 'error', rule: 'schema', message: `${formatPath(issue.path)}:${issue.message}` });
    }
    return { scene: null, findings };
  }
  const scene: ChalkScene = parsed.data;
  lintSemantics(scene, findings);
  lintLayout(scene, findings);
  return { scene, findings };
}

function formatPath(path: readonly PropertyKey[]): string {
  if (!path.length) return '(场景根)';
  return path.reduce<string>((acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)), '');
}

// ---- 层 2:语义 lint ----

function lintSemantics(scene: ChalkScene, findings: Finding[]): void {
  const idSeq = scene.skeletons.map((e) => e.id);

  const seen = new Set<string>();
  for (const id of idSeq) {
    if (seen.has(id)) {
      findings.push({ level: 'error', rule: 'unique-id', message: `元素 id '${id}' 重复;id 是步与元素的对齐键,必须唯一` });
    }
    seen.add(id);
  }

  for (const el of scene.skeletons) {
    if (/animate(Duration|Order):/.test(el.id)) {
      findings.push({ level: 'error', rule: 'clean-id', message: `元素 '${el.id}' 的 id 携带 animate 指令;时长写成 animateDuration 字段,顺序由数组位置决定` });
    }
    if (Array.isArray(el.groupIds) && el.groupIds.length) {
      findings.push({ level: 'error', rule: 'no-group', message: `元素 '${el.id}' 带 groupIds,会破坏逐笔串行调度;去掉 groupIds,顺序用数组表达` });
    }
    if (!(KNOWN_ELEMENT_TYPES as readonly string[]).includes(el.type)) {
      findings.push({ level: 'warning', rule: 'element-type', message: `元素 '${el.id}' 的类型 '${el.type}' 未经引擎验证;已验证类型:${KNOWN_ELEMENT_TYPES.join('、')}` });
    }
    if (el.type === 'text') {
      if (typeof el.text !== 'string' || !el.text) {
        findings.push({ level: 'error', rule: 'text-content', message: `text 元素 '${el.id}' 缺 text 内容(字符串)` });
      }
      if (typeof el.fontSize !== 'number') {
        findings.push({ level: 'error', rule: 'text-content', message: `text 元素 '${el.id}' 缺 fontSize(数字,px)` });
      } else if (el.fontSize < 16) {
        findings.push({ level: 'warning', rule: 'text-size', message: `text 元素 '${el.id}' 的 fontSize ${el.fontSize} 偏小;iPad 上建议 ≥16` });
      }
    }
  }

  scene.steps.forEach((s, i) => {
    if (s.step !== i + 1) {
      findings.push({ level: 'error', rule: 'step-order', message: `第 ${i + 1} 个步的 step 是 ${s.step};step 必须从 1 连续递增` });
    }
  });

  // 笔顺覆盖:steps 的 elementIds 依次拼接后须与 skeletons 顺序完全一致
  const flat = scene.steps.flatMap((s) => s.elementIds);
  const n = Math.max(flat.length, idSeq.length);
  for (let i = 0; i < n; i++) {
    if (flat[i] !== idSeq[i]) {
      findings.push({
        level: 'error',
        rule: 'stroke-cover',
        message:
          `steps 必须按 skeletons 顺序连续覆盖全部元素(笔顺即步序):` +
          `第 ${i + 1} 笔期望 '${idSeq[i] ?? '(无:skeletons 已用尽,steps 多出元素)'}',steps 给的是 '${flat[i] ?? '(缺:steps 提前结束)'}'`,
      });
      break;
    }
  }

  for (const s of scene.steps) {
    if (s.audioSrc && (s.audioSrc.startsWith('/') || /^[a-z]+:/i.test(s.audioSrc))) {
      findings.push({ level: 'warning', rule: 'audio-path', message: `step ${s.step} 的 audioSrc '${s.audioSrc}' 不是相对路径;课包自包含,音频放课包目录内(如 audio/step1.mp3)` });
    }
  }
}

// ---- 层 3:确定性布局检查(近似包围盒;真值以 snap 截图为准) ----

export interface Box {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 文本宽度近似:CJK ≈ fontSize,其余 ≈ 0.55 × fontSize;行高 1.3(snap 的元素清单也用它) */
export function bboxOf(el: ChalkSkeleton): Box {
  let w = typeof el.width === 'number' ? el.width : 0;
  let h = typeof el.height === 'number' ? el.height : 0;
  if (el.type === 'text' && typeof el.text === 'string' && typeof el.fontSize === 'number') {
    const lines = el.text.split('\n');
    w = Math.max(
      ...lines.map((line) => [...line].reduce((acc, ch) => acc + ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? el.fontSize as number : (el.fontSize as number) * 0.55), 0)),
    );
    h = lines.length * (el.fontSize as number) * 1.3;
  }
  if (Array.isArray(el.points)) {
    const pts = el.points as [number, number][];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { id: el.id, minX: el.x + Math.min(...xs), minY: el.y + Math.min(...ys), maxX: el.x + Math.max(...xs), maxY: el.y + Math.max(...ys) };
  }
  return { id: el.id, minX: el.x, minY: el.y, maxX: el.x + w, maxY: el.y + h };
}

/** 近似测量留 2px 容差 */
function intersects(a: Box, b: Box, margin = 2): boolean {
  return a.minX + margin < b.maxX - margin && b.minX + margin < a.maxX - margin && a.minY + margin < b.maxY - margin && b.minY + margin < a.maxY - margin;
}

function lintLayout(scene: ChalkScene, findings: Finding[]): void {
  const textBoxes = scene.skeletons.filter((e) => e.type === 'text').map(bboxOf);
  for (let i = 0; i < textBoxes.length; i++) {
    for (let j = i + 1; j < textBoxes.length; j++) {
      if (intersects(textBoxes[i], textBoxes[j])) {
        findings.push({
          level: 'error',
          rule: 'text-overlap',
          message: `文本 '${textBoxes[i].id}' 与 '${textBoxes[j].id}' 包围盒重叠;移开其一或缩小 fontSize(近似测量,最终以 snap 截图为准)`,
        });
      }
    }
  }

  const all = scene.skeletons.map(bboxOf);
  const minX = Math.min(...all.map((b) => b.minX));
  const maxX = Math.max(...all.map((b) => b.maxX));
  const minY = Math.min(...all.map((b) => b.minY));
  const maxY = Math.max(...all.map((b) => b.maxY));
  const w = maxX - minX;
  const h = maxY - minY;
  if (h > 0 && w / h > 5) {
    findings.push({ level: 'warning', rule: 'aspect', message: `画面过宽(${Math.round(w)}×${Math.round(h)});播放器等比缩放后笔画会变小,考虑分行` });
  }
  if (w > 0 && h / w > 3) {
    findings.push({ level: 'warning', rule: 'aspect', message: `画面过高(${Math.round(w)}×${Math.round(h)});播放器等比缩放后笔画会变小,考虑并列` });
  }
}
