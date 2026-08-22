/**
 * 四线三格的度量(大小写共用)。
 *
 * 归一化到 x 高 = 1、基线 = 0、y 向上为负:
 *
 *   y = -2   top      升部顶(b d f h k l t)与**大写顶**
 *   y = -1   xTop     x 高顶
 *   y =  0   base     基线
 *   y = +1   bottom   降部底(g j p q y)
 *
 * 实测 Excalifont:升部 2.005、降部 0.948——ASC/DESC 与之吻合。
 * 大写另有一说:Excalifont 的 cap height 只有 1.653(排版惯例,大写略低于升部),
 * 但四线三格的教学惯例是**大写顶第一线**,孩子照着写才有参照线。
 * 字形包是示范字,故取 CAP = ASC = 2;代价是与字体混排时大写偏大约 21%。
 * 要改成排版惯例,把 CAP 改成 -1.65 即可,字形按比例自适应。
 */

/** 升部顶 / 大写顶 */
export const ASC = -2;
/** 大写顶(教学惯例:与升部同高、顶第一线) */
export const CAP = ASC;
/** x 高顶 */
export const XT = -1;
/** 基线 */
export const BASE = 0;
/** 降部底 */
export const DESC = 1;

/** 四线三格的归一化线位,消费方画格子用 */
export const GUIDES = { top: ASC, xTop: XT, base: BASE, bottom: DESC } as const;
