/**
 * 笔顺里的动作(《重新设计.md》第 3 步):erase 擦掉前面画过的几样,board 换一块画板(旧板上的连背景图一起擦干净)。
 * 动作和画一笔一样占时间、被步覆盖;这里只管「谁擦了谁、谁在第几块画板」,时钟、bake、check、圈住了什么都用这一份。
 * 纯函数,不抛:引用不对的记进 problems(check 报),其余照样算。
 */

import type { ChalkBackground, ChalkSkeleton } from '../player/types.ts';

export const isAction = (e: { type?: unknown }): boolean => e.type === 'erase' || e.type === 'board';

export interface ResolvedBoard {
  /** 换到这块画板的 board 动作;第一块(场景本身)= null */
  id: string | null;
  background?: ChalkBackground;
}

export interface ResolvedActions {
  /** 每个元素(含动作)在第几块画板(0 起);board 动作本身算在它擦掉的那块(旧板)上 */
  boardOf: Map<string, number>;
  /** 被擦掉的元素 → 擦它的动作 id */
  erasedBy: Map<string, string>;
  /** 动作 → 它擦掉的元素(erase:targets 里引用对的;board:旧板上还没擦掉的、画的元素,按笔顺) */
  targets: Map<string, string[]>;
  boards: ResolvedBoard[];
  /** 引用不对的地方(动作 id + 怎么改) */
  problems: { id: string; message: string }[];
}

export function resolveActions(skeletons: readonly ChalkSkeleton[], background?: ChalkBackground): ResolvedActions {
  const boardOf = new Map<string, number>();
  const erasedBy = new Map<string, string>();
  const targets = new Map<string, string[]>();
  const boards: ResolvedBoard[] = [{ id: null, ...(background ? { background } : {}) }];
  const problems: { id: string; message: string }[] = [];
  const all = new Map(skeletons.map((e) => [e.id, e]));
  const seen = new Set<string>();
  // 当前这块板上、还没擦掉的画的元素(按笔顺)
  let onBoard: string[] = [];
  for (const e of skeletons) {
    const board = boards.length - 1;
    boardOf.set(e.id, board);
    if (e.type === 'erase') {
      const got: string[] = [];
      const list = Array.isArray(e.targets) ? (e.targets as unknown[]) : [];
      if (!list.length) problems.push({ id: e.id, message: `擦除 '${e.id}' 没写 targets;写上要擦掉的元素 id(前面画过的)` });
      for (const t of list) {
        const id = String(t);
        const what = all.get(id);
        if (!what) problems.push({ id: e.id, message: `擦除 '${e.id}' 要擦的 '${id}' 不存在;targets 写 skeletons 里的元素 id` });
        else if (!seen.has(id)) problems.push({ id: e.id, message: `擦除 '${e.id}' 要擦的 '${id}' 在它后面才画;只能擦前面画过的` });
        else if (isAction(what)) problems.push({ id: e.id, message: `擦除 '${e.id}' 要擦的 '${id}' 是动作,不是画的东西` });
        else if (erasedBy.has(id)) problems.push({ id: e.id, message: `擦除 '${e.id}' 要擦的 '${id}' 已经被 '${erasedBy.get(id)}' 擦掉了${boardOf.get(id) !== board ? '(换画板时)' : ''}` });
        else if (got.includes(id)) problems.push({ id: e.id, message: `擦除 '${e.id}' 的 targets 里 '${id}' 写了两遍` });
        else got.push(id);
      }
      for (const id of got) erasedBy.set(id, e.id);
      onBoard = onBoard.filter((id) => !got.includes(id));
      targets.set(e.id, got);
    } else if (e.type === 'board') {
      for (const id of onBoard) erasedBy.set(id, e.id);
      targets.set(e.id, onBoard);
      onBoard = [];
      const bg = e.background as ChalkBackground | undefined;
      boards.push({ id: e.id, ...(bg ? { background: bg } : {}) });
    } else onBoard.push(e.id);
    seen.add(e.id);
  }
  return { boardOf, erasedBy, targets, boards, problems };
}

/**
 * 课讲完时画面上还留着的:最后一块画板上没擦掉的画的元素,与那块板的背景图。
 * 应用把课包当底图放进编辑器(画板卡)用它;动作不交给 excalidraw。
 */
export function finalBoard<T extends ChalkSkeleton>(skeletons: readonly T[], background?: ChalkBackground): { skeletons: T[]; background?: ChalkBackground } {
  const r = resolveActions(skeletons, background);
  const last = r.boards.length - 1;
  const bg = r.boards[last].background;
  return { skeletons: skeletons.filter((e) => !isAction(e) && !r.erasedBy.has(e.id) && r.boardOf.get(e.id) === last), ...(bg ? { background: bg } : {}) };
}
