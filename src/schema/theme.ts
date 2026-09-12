/**
 * 主题清单(themes/<name>/theme.json)的契约。样子的真相在主题里,不在卡的协议里(《卡片重设计评估.md》§七):
 * 卡的底色槽(tints)、字形槽(looks)、五支笔(pens)各是一张表,主题想要几个就几个,每个一个名字 + 一句「给什么用」——
 * 板书后期的提示词从这句现拼,校验 = 名字在表里,不在就落 `default`;所以换主题永远能显示。
 * 颜色的值不在清单里,在旁边的 kid.css 里(同一个名字对应 CSS 里的 data-tint / data-look / mk-<pen>)。
 */
import { z } from 'zod';

export const THEME_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const THEME_MANIFEST_FILE = 'theme.json';
export const THEME_CSS_FILE = 'kid.css';
export const THEMES_DIR = 'themes';
export const DEFAULT_THEME = 'default';

const SlotSchema = z.object({ use: z.string().min(1).describe('给什么用(板书后期照这句挑)') });
const SlotTable = z.record(z.string().regex(THEME_NAME_RE), SlotSchema);

export const ThemeManifestSchema = z
  .object({
    name: z.string().regex(THEME_NAME_RE),
    /** 素版与回退用的底色槽,必须在 tints 里 */
    default: z.string().regex(THEME_NAME_RE),
    tints: SlotTable.refine((t) => Object.keys(t).length > 0, '至少一个底色槽'),
    looks: SlotTable.default({}),
    pens: SlotTable.default({}),
  })
  .superRefine((m, ctx) => {
    if (!(m.default in m.tints)) ctx.addIssue({ code: 'custom', path: ['default'], message: `default 槽 "${m.default}" 不在 tints 里` });
  });
export type ThemeManifest = z.infer<typeof ThemeManifestSchema>;

/** 槽名不在表里 → default(素版与回退都走这里) */
export function tintOrDefault(m: ThemeManifest, name: string | undefined): string {
  return name && name in m.tints ? name : m.default;
}
