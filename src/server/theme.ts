/**
 * 孩子端的主题文件:/kid/theme.css 与 /kid/theme.json,按 cotutor.json 的 kid.theme 从 workspace 的 themes/<name>/ 现读(mtime 缓存,热的)。
 * 主题读不到或坏了 → 退回包里的出厂 default(孩子端永远有样子;坏在哪 doctor 说);mock 直接给出厂的。
 * 舞台包(iframe)也 link 同一份 css,变量两边一致。
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { THEME_CSS_FILE, THEME_MANIFEST_FILE, type ThemeManifest } from '../schema/index.ts';
import { packageTheme, readTheme, themeDir, type LoadedTheme } from '../cli/themes.ts';
import { cardsCss } from '../cards/docs.ts';

export interface ThemeFiles {
  css: string;
  manifest: ThemeManifest;
  /** 用的是哪份:workspace 里的,还是退回了包里的出厂件(读不到 / 坏了) */
  source: 'workspace' | 'fallback';
  /** 退回时的原因 */
  error?: string;
}

interface Cached extends ThemeFiles {
  key: string;
}

let cache: Cached | null = null;

async function mtimeKey(dir: string): Promise<string> {
  const a = await stat(join(dir, THEME_MANIFEST_FILE)).catch(() => null);
  const b = await stat(join(dir, THEME_CSS_FILE)).catch(() => null);
  return `${dir}|${a?.mtimeMs ?? 'x'}|${b?.mtimeMs ?? 'x'}`;
}

/** workspace 根 + 主题名 → css 与清单;缓存按两个文件的 mtime */
export async function themeFiles(root: string, name: string): Promise<ThemeFiles> {
  const dir = themeDir(root, name);
  const key = await mtimeKey(dir);
  if (cache && cache.key === key) return cache;
  let loaded: LoadedTheme;
  let source: ThemeFiles['source'] = 'workspace';
  let error: string | undefined;
  try {
    loaded = await readTheme(dir);
  } catch (err) {
    loaded = await packageTheme('default');
    source = 'fallback';
    error = err instanceof Error ? err.message : String(err);
  }
  // 各种卡的结构样式(包里 cards/<kind>/card.css)在前,主题在后:主题写同名选择器就能盖
  cache = { key, css: `${cardsCss()}\n\n/* ---- 主题 ${name} ---- */\n${loaded.css}`, manifest: loaded.manifest, source, ...(error ? { error } : {}) };
  return cache;
}

/** 测试用:清缓存 */
export function resetThemeCache(): void {
  cache = null;
}
