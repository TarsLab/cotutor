/**
 * 舞台包的静态文件:dist/stage/(esbuild 打的 stage.js / stage.css / index.html)+ /stage/fonts/(excalidraw 的字体,从 node_modules 现取,不进 npm 包)。
 * serve 与 mock 共用;没打包(开发时没跑 pnpm run build:stage)→ null,页面开重卡舞台时什么都不出现,doctor 点名。
 */
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STAGE_DIR = fileURLToPath(new URL('../../dist/stage/', import.meta.url));
export const FONTS_DIR = fileURLToPath(new URL('../../node_modules/@excalidraw/excalidraw/dist/prod/fonts/', import.meta.url));

export const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  png: 'image/png',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
};

export const ext = (p: string): string => p.slice(p.lastIndexOf('.') + 1).toLowerCase();

export function stageBuilt(): boolean {
  return existsSync(join(STAGE_DIR, 'stage.js')) && existsSync(join(STAGE_DIR, 'index.html'));
}

export interface StaticFile {
  file: string;
  contentType: string;
}

/** 根目录以内的一个文件(越界、不存在、不是文件 → null) */
export async function fileUnder(root: string, rel: string): Promise<StaticFile | null> {
  const base = resolve(root);
  const file = resolve(base, rel);
  if (!rel || rel.includes('\0') || (file !== base && !file.startsWith(base + sep))) return null;
  const type = MIME[ext(file)];
  if (!type) return null;
  if (!(await stat(file).catch(() => null))?.isFile()) return null;
  return { file, contentType: type };
}

/** /stage/ → index.html;/stage/stage.js|css;/stage/fonts/<路径> → excalidraw 的字体目录 */
export async function stageAsset(pathname: string): Promise<StaticFile | null> {
  if (!pathname.startsWith('/stage/')) return null;
  const rel = pathname.slice('/stage/'.length);
  if (rel.startsWith('fonts/')) return fileUnder(FONTS_DIR, rel.slice('fonts/'.length));
  return fileUnder(STAGE_DIR, rel === '' ? 'index.html' : rel);
}

/** 课包文件 /api/bundles/<id>/<路径> → <bundles>/<id>/<路径>(id 只认小写字母数字连字符) */
export async function bundleAsset(bundlesDir: string, pathname: string): Promise<StaticFile | null> {
  const m = /^\/api\/bundles\/([a-z0-9][a-z0-9-]*)\/(.+)$/.exec(pathname);
  if (!m) return null;
  return fileUnder(join(bundlesDir, m[1]), m[2]);
}
