/**
 * 课本封面(首页课本那张卡,设计稿 https://claude.ai/artifact/KJFiRZD6E45YEKGQBbw98Q):服务端只读文字层,画不出图;
 * 孩子端首页(家长端首页里的预览也是它)见这一册还没有封面,空闲时用 pdf.js 画第 1 页(长边 480 的 jpeg,src/ui/stage/pdf.ts)交上来,存 `.cotutor/covers/<指纹>.jpg`。
 * 画好之前是学科色 + 书名的占位(kid-page 画,字从 coverText 来)。
 * 指纹 = 文件名 + 大小 + 改动时间:首页 5 秒刷一轮,不能每次读整本 PDF 算内容的指纹;PDF 换了(或碰过)就再画一张。能重新生成,不进备份、不拷进 sandbox。
 */
import { createHash } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jpegFromDataUrl } from '../shared/jpeg.ts';
import { bookFile } from './textbook-pdf.ts';

/** 交上来的封面 base64 最多多长(长边 480 的 jpeg 几十 KB) */
const COVER_B64_MAX = 400_000;

/** 一册的封面指纹;册子不在 = null */
async function coverKey(dir: string, name: string): Promise<string | null> {
  const file = await bookFile(dir, name);
  const st = file ? await stat(file).catch(() => null) : null;
  return st ? createHash('sha1').update(`${name}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 16) : null;
}

/** 这一册画好的封面:路径和指纹(孩子端拿指纹破缓存);册子不在、还没画 = null。cacheDir = `<workspace>/.cotutor/covers` */
export async function readCover(dir: string, cacheDir: string, name: string): Promise<{ file: string; key: string } | null> {
  const key = await coverKey(dir, name);
  if (!key) return null;
  const file = join(cacheDir, `${key}.jpg`);
  return (await stat(file).catch(() => null))?.isFile() ? { file, key } : null;
}

/** 存孩子端画的封面(jpeg 的 data URL);册子不在、不是 jpeg、太大 → false */
export async function saveCover(dir: string, cacheDir: string, name: string, image: unknown): Promise<boolean> {
  const buf = jpegFromDataUrl(image, COVER_B64_MAX);
  const key = buf ? await coverKey(dir, name) : null;
  if (!buf || !key) return false;
  await mkdir(cacheDir, { recursive: true });
  const file = join(cacheDir, `${key}.jpg`);
  await writeFile(`${file}.${process.pid}.tmp`, buf);
  await rename(`${file}.${process.pid}.tmp`, file);
  return true;
}

/** 占位封面上的字:学科(文件名里有就用它)+「二年级 上册」(文件名「语文二年级上册-人教统编版.pdf」里认的;认不出 = 空) */
export function coverText(name: string, subject: string | null): { title: string; sub: string } {
  const base = name.replace(/\.pdf$/i, '');
  const m = /([一二三四五六七八九]年级)\s*([上下]册)?/.exec(base);
  const title = subject && base.includes(subject) ? subject : (m ? base.slice(0, m.index) : base.split(/[-_ ]/)[0]).trim() || base;
  return { title, sub: m ? [m[1], m[2]].filter(Boolean).join(' ') : '' };
}
