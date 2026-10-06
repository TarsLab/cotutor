/**
 * 阶梯层 2–3:schema 校验、语义 lint、确定性布局检查。
 * 纯函数,不碰文件系统;错误信息 = 修复指南(README「Design principles」)。
 * 层 1(类型,内嵌 tsc)在 typecheck.ts,模块求值在 load-scene.ts;层 4(keyframe 截图)归 snap。
 */

import { KNOWN_ELEMENT_TYPES, sceneSchema } from '../schema/scene.ts';
import type { ChalkScene, ChalkSkeleton, ChalkStep } from '../player/types.ts';
import { elementBounds } from '../core/geometry.ts';

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

function relativeAudioOk(src: string): boolean {
  return !src.startsWith('/') && !/^[a-z]+:/i.test(src);
}

/**
 * 一幅画面(skeletons + steps)的语义 lint,主场景与每个子场景各跑一遍。
 * ctx 是消息前缀(主场景为空,子场景形如「子场景 'blend-ram' 」)。
 * steps 为空 = 静态画面,跳过覆盖检查;「空得合不合法」由 template 一致性规则单独判。
 */
function lintDrawing(skeletons: readonly ChalkSkeleton[], steps: readonly ChalkStep[], findings: Finding[], ctx = ''): void {
  const idSeq = skeletons.map((e) => e.id);

  const seen = new Set<string>();
  for (const id of idSeq) {
    if (seen.has(id)) {
      findings.push({ level: 'error', rule: 'unique-id', message: `${ctx}元素 id '${id}' 重复;id 是步与元素的对齐键,必须唯一` });
    }
    seen.add(id);
  }

  for (const el of skeletons) {
    if (/animate(Duration|Order):/.test(el.id)) {
      findings.push({ level: 'error', rule: 'clean-id', message: `${ctx}元素 '${el.id}' 的 id 携带 animate 指令;时长写成 animateDuration 字段,顺序由数组位置决定` });
    }
    if (Array.isArray(el.groupIds) && el.groupIds.length) {
      findings.push({ level: 'error', rule: 'no-group', message: `${ctx}元素 '${el.id}' 带 groupIds,会破坏逐笔串行调度;去掉 groupIds,顺序用数组表达` });
    }
    if (!(KNOWN_ELEMENT_TYPES as readonly string[]).includes(el.type)) {
      findings.push({ level: 'warning', rule: 'element-type', message: `${ctx}元素 '${el.id}' 的类型 '${el.type}' 未经引擎验证;已验证类型:${KNOWN_ELEMENT_TYPES.join('、')}` });
    }
    if (el.type === 'text') {
      if (typeof el.text !== 'string' || !el.text) {
        findings.push({ level: 'error', rule: 'text-content', message: `${ctx}text 元素 '${el.id}' 缺 text 内容(字符串)` });
      }
      if (typeof el.fontSize !== 'number') {
        findings.push({ level: 'error', rule: 'text-content', message: `${ctx}text 元素 '${el.id}' 缺 fontSize(数字,px)` });
      } else if (el.fontSize < 16) {
        findings.push({ level: 'warning', rule: 'text-size', message: `${ctx}text 元素 '${el.id}' 的 fontSize ${el.fontSize} 偏小;iPad 上建议 ≥16` });
      }
    }
  }

  steps.forEach((s, i) => {
    if (s.step !== i + 1) {
      findings.push({ level: 'error', rule: 'step-order', message: `${ctx}第 ${i + 1} 个步的 step 是 ${s.step};step 必须从 1 连续递增` });
    }
  });

  // 笔顺覆盖:steps 的 elementIds 依次拼接后须与 skeletons 顺序完全一致(静态画面无 steps,跳过)
  if (steps.length) {
    const flat = steps.flatMap((s) => s.elementIds);
    const n = Math.max(flat.length, idSeq.length);
    for (let i = 0; i < n; i++) {
      if (flat[i] !== idSeq[i]) {
        findings.push({
          level: 'error',
          rule: 'stroke-cover',
          message:
            `${ctx}steps 必须按 skeletons 顺序连续覆盖全部元素(笔顺即步序):` +
            `第 ${i + 1} 笔期望 '${idSeq[i] ?? '(无:skeletons 已用尽,steps 多出元素)'}',steps 给的是 '${flat[i] ?? '(缺:steps 提前结束)'}'`,
        });
        break;
      }
    }
  }

  for (const s of steps) {
    if (s.audioSrc && !relativeAudioOk(s.audioSrc)) {
      findings.push({ level: 'warning', rule: 'audio-path', message: `${ctx}step ${s.step} 的 audioSrc '${s.audioSrc}' 不是相对路径;课包自包含,音频放课包目录内(如 audio/step1.mp3)` });
    }
  }
}

function lintSemantics(scene: ChalkScene, findings: Finding[]): void {
  lintDrawing(scene.skeletons, scene.steps, findings);

  // 模板与 steps 一致性:static 必空,讲解三档必非空
  if (scene.template === 'static' && scene.steps.length) {
    findings.push({ level: 'error', rule: 'static-steps', message: `template 'static' 是无时间轴的静态场景,steps 必须为空;要逐步讲解请换讲解模板(paper-strict / camera-free / motion)` });
  }
  if (scene.template !== 'static' && !scene.steps.length) {
    findings.push({ level: 'error', rule: 'steps-required', message: `template '${scene.template}' 是讲解模板,steps 不能为空;静态点读/圈读页请用 template 'static'` });
  }

  if (scene.background && !relativeAudioOk(scene.background.src)) {
    findings.push({ level: 'warning', rule: 'background-path', message: `background.src '${scene.background.src}' 不是相对路径;写成相对场景文件的路径,build 会把图拷进课包` });
  }

  lintInteractions(scene, findings);
  lintGroups(scene, findings);
}

/** groups 的引用完整性:id 不重、成员都在场景里、一组里不重复 */
function lintGroups(scene: ChalkScene, findings: Finding[]): void {
  const els = new Set(scene.skeletons.map((e) => e.id));
  const seen = new Set<string>();
  for (const g of scene.groups ?? []) {
    if (seen.has(g.id)) findings.push({ level: 'error', rule: 'group-id', message: `groups 里 id '${g.id}' 重复;每组一个 id` });
    seen.add(g.id);
    const missing = g.elementIds.filter((id) => !els.has(id));
    if (missing.length) findings.push({ level: 'error', rule: 'group-ref', message: `group '${g.id}'(${g.label})引用了不存在的元素 ${missing.join(', ')};elementIds 写 skeletons 里的 id` });
    if (new Set(g.elementIds).size !== g.elementIds.length) findings.push({ level: 'warning', rule: 'group-dup', message: `group '${g.id}' 的 elementIds 有重复` });
  }
}

/** blocks / subscenes 的引用完整性与触发语义 */
function lintInteractions(scene: ChalkScene, findings: Finding[]): void {
  const blocks = scene.blocks ?? [];
  const subscenes = scene.subscenes ?? [];
  const elById = new Map(scene.skeletons.map((e) => [e.id, e]));
  const subIds = new Set<string>();

  for (const sub of subscenes) {
    if (subIds.has(sub.id)) {
      findings.push({ level: 'error', rule: 'unique-id', message: `子场景 id '${sub.id}' 重复;blocks[].subsceneId 靠它寻址,必须唯一` });
    }
    subIds.add(sub.id);
    lintDrawing(sub.skeletons, sub.steps ?? [], findings, `子场景 '${sub.id}' `);
    if (sub.audioSrc && !relativeAudioOk(sub.audioSrc)) {
      findings.push({ level: 'warning', rule: 'audio-path', message: `子场景 '${sub.id}' 的 audioSrc '${sub.audioSrc}' 不是相对路径;课包自包含,音频放课包目录内` });
    }
  }

  const blockIds = new Set<string>();
  const referencedSubs = new Set<string>();
  for (const b of blocks) {
    if (blockIds.has(b.id)) {
      findings.push({ level: 'error', rule: 'unique-id', message: `块 id '${b.id}' 重复;事件记录靠它区分词条,必须唯一` });
    }
    blockIds.add(b.id);
    for (const id of b.elementIds) {
      if (!elById.has(id)) {
        findings.push({ level: 'error', rule: 'block-element', message: `块 '${b.id}' 引用元素 '${id}',skeletons 中不存在;块锚在底层元素上,先修元素 id` });
      }
    }
    if (b.subsceneId) {
      referencedSubs.add(b.subsceneId);
      if (!subIds.has(b.subsceneId)) {
        findings.push({ level: 'error', rule: 'block-subscene', message: `块 '${b.id}' 引用子场景 '${b.subsceneId}',subscenes 中不存在;现有:${[...subIds].join('、') || '(无)'}` });
      }
    }
    if (!b.audioSrc && !b.subsceneId) {
      findings.push({ level: 'warning', rule: 'block-trigger', message: `块 '${b.id}' 既无 audioSrc 也无 subsceneId,圈中后无事发生;给一个触发,或删掉这个块` });
    }
    if (b.audioSrc && !relativeAudioOk(b.audioSrc)) {
      findings.push({ level: 'warning', rule: 'audio-path', message: `块 '${b.id}' 的 audioSrc '${b.audioSrc}' 不是相对路径;课包自包含,音频放课包目录内(如 audio/tokens/ram.mp3)` });
    }
    // 词条文本与元素文本一致性(重点字母色拆分后 r + am 拼回 ram)
    const joined = b.elementIds
      .map((id) => elById.get(id))
      .filter((e): e is ChalkSkeleton => !!e && e.type === 'text' && typeof e.text === 'string')
      .map((e) => e.text as string)
      .join('');
    if (joined && joined !== b.text) {
      findings.push({ level: 'warning', rule: 'block-text', message: `块 '${b.id}' 的 text 是 '${b.text}',但所引 text 元素拼起来是 '${joined}';两者应一致,否则事件记录与画面脱节` });
    }
  }

  for (const sub of subscenes) {
    if (!referencedSubs.has(sub.id)) {
      findings.push({ level: 'warning', rule: 'subscene-orphan', message: `子场景 '${sub.id}' 没有任何块引用,永远不会被触发;接到某个 blocks[].subsceneId,或删掉它` });
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

/**
 * 包围盒:core/geometry 的 elementBounds(文字按真播放器量出来的字宽表;元素带的 width 更宽以它为准)。
 * snap 的元素清单、build 落进 scene.json 的 bounds 都是这一份。
 */
export function bboxOf(el: ChalkSkeleton): Box {
  return { id: el.id, ...elementBounds(el) };
}

/** 近似测量留 2px 容差 */
function intersects(a: Box, b: Box, margin = 2): boolean {
  return a.minX + margin < b.maxX - margin && b.minX + margin < a.maxX - margin && a.minY + margin < b.maxY - margin && b.minY + margin < a.maxY - margin;
}

/** 一幅画面的布局检查;主场景与每个子场景各自独立的坐标系,分开跑,互不误报 */
function lintLayoutOf(skeletons: readonly ChalkSkeleton[], findings: Finding[], ctx = ''): void {
  const textBoxes = skeletons.filter((e) => e.type === 'text').map(bboxOf);
  for (let i = 0; i < textBoxes.length; i++) {
    for (let j = i + 1; j < textBoxes.length; j++) {
      if (intersects(textBoxes[i], textBoxes[j])) {
        findings.push({
          level: 'error',
          rule: 'text-overlap',
          message: `${ctx}文本 '${textBoxes[i].id}' 与 '${textBoxes[j].id}' 包围盒重叠;移开其一或缩小 fontSize(近似测量,最终以 snap 截图为准)`,
        });
      }
    }
  }

  const all = skeletons.map(bboxOf);
  const minX = Math.min(...all.map((b) => b.minX));
  const maxX = Math.max(...all.map((b) => b.maxX));
  const minY = Math.min(...all.map((b) => b.minY));
  const maxY = Math.max(...all.map((b) => b.maxY));
  const w = maxX - minX;
  const h = maxY - minY;
  if (h > 0 && w / h > 5) {
    findings.push({ level: 'warning', rule: 'aspect', message: `${ctx}画面过宽(${Math.round(w)}×${Math.round(h)});播放器等比缩放后笔画会变小,考虑分行` });
  }
  if (w > 0 && h / w > 3) {
    findings.push({ level: 'warning', rule: 'aspect', message: `${ctx}画面过高(${Math.round(w)}×${Math.round(h)});播放器等比缩放后笔画会变小,考虑并列` });
  }
}

function lintLayout(scene: ChalkScene, findings: Finding[]): void {
  lintLayoutOf(scene.skeletons, findings);
  // 有背景图时画板 = 图片,出界的笔迹会被裁掉
  const bg = scene.background;
  if (bg) {
    for (const b of scene.skeletons.map(bboxOf)) {
      if (b.minX < 0 || b.minY < 0 || b.maxX > bg.width || b.maxY > bg.height) {
        findings.push({ level: 'warning', rule: 'background-bounds', message: `元素 '${b.id}' 超出背景图范围(0,0)–(${bg.width},${bg.height});画板即图片,图外的笔迹会被裁掉` });
      }
    }
  }
  for (const sub of scene.subscenes ?? []) {
    lintLayoutOf(sub.skeletons, findings, `子场景 '${sub.id}' `);
  }
}
