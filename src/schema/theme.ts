/**
 * 主题清单(themes/<name>/theme.json)的契约:底色槽(tints)一张表,主题想要几个就几个,每个一个名字 + 一句「给什么用」。
 * 颜色的值不在清单里,在旁边的 kid.css 里(--tint-<名>-bg / -line / -head,孩子端页面与首页的牌照它取色)。
 * 字形槽(looks)与笔(pens)是课里卡用的,卡 2026-11-17 删了;旧主题里还写着的读进来就丢。
 */
import { z } from 'zod';

export const THEME_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const THEME_MANIFEST_FILE = 'theme.json';
export const THEME_CSS_FILE = 'kid.css';
export const THEMES_DIR = 'themes';

const SlotSchema = z.object({ use: z.string().min(1).describe('给什么用(写课文件、排版时照这句挑)') });
const SlotTable = z.record(z.string().regex(THEME_NAME_RE), SlotSchema);

export const ThemeManifestSchema = z
  .object({
    name: z.string().regex(THEME_NAME_RE),
    /** 素版与回退用的底色槽,必须在 tints 里 */
    default: z.string().regex(THEME_NAME_RE),
    tints: SlotTable.refine((t) => Object.keys(t).length > 0, '至少一个底色槽'),
  })
  .superRefine((m, ctx) => {
    if (!(m.default in m.tints)) ctx.addIssue({ code: 'custom', path: ['default'], message: `default 槽 "${m.default}" 不在 tints 里` });
  });
export type ThemeManifest = z.infer<typeof ThemeManifestSchema>;

