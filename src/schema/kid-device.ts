/**
 * 孩子端的设备:服务端种的一枚 cookie 算一台,编号是随机的 12 位十六进制。
 * 自动标签由浏览器信息算:「iPad · Safari 27 · 主屏幕」。纯函数,离屏可测。
 */

/** 设备 cookie 的名字;活 400 天(浏览器允许的最长) */
export const DEVICE_COOKIE = 'cotutor_kid';
export const DEVICE_COOKIE_DAYS = 400;
export { DEVICE_ID_RE } from './conversation.ts';

/** 认设备要的那几样:浏览器信息、触点数、是不是从主屏幕打开 */
export interface DeviceHint {
  ua: string;
  touch?: number;
  standalone?: boolean;
}

/**
 * 「iPad · Safari 27 · 主屏幕」。
 * iPad 的 Safari 缺省请求桌面网站,浏览器信息写 Macintosh,要看触点数;新版 iOS 浏览器信息里的系统版本冻住了,只写浏览器的版本。
 * 从主屏幕图标打开的 iOS 页面浏览器信息里没有 Safari 版本,只写「主屏幕」。
 */
export function deviceLabel(d: DeviceHint): string {
  const ua = d.ua;
  const mac = /Macintosh/.test(ua);
  const kind = /iPad/.test(ua) || (mac && (d.touch ?? 0) > 1) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android 手机' : 'Android 平板')
    : mac ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  const major = (re: RegExp): string => re.exec(ua)?.[1] ?? '';
  const browser = /EdgiOS|Edg\//.test(ua) ? `Edge ${major(/(?:EdgiOS|Edg)\/(\d+)/)}`
    : /CriOS|Chrome\//.test(ua) ? `Chrome ${major(/(?:CriOS|Chrome)\/(\d+)/)}`
    : /FxiOS|Firefox\//.test(ua) ? `Firefox ${major(/(?:FxiOS|Firefox)\/(\d+)/)}`
    : /Safari\//.test(ua) && /Version\//.test(ua) ? `Safari ${major(/Version\/(\d+)/)}`
    : '';
  const parts = [kind, browser.trim(), d.standalone ? '主屏幕' : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : '不认得的浏览器';
}
