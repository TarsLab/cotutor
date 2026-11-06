/**
 * 二维码的打印页 /parent/qr:家长端「扫码打开」那块的「打印 ›」开它。每次请求现画,不落文件。
 * 编什么由服务端定(ListenInfo,listen 之后才知道真端口),不看请求的 Host——家长多半是从 localhost 打开这一页的,照抄就编成了 localhost。
 * 默认编 <本机名>.local(不随 Wi-Fi 变);个别设备会把它解析到走不通的 IPv6(一直转圈),页脚有一条换成局域网 IP 的退路(?via=ip)。
 * 两张码:孩子端 `/`(缺省)与家长端 `/parent`(?to=parent),页脚互相换。
 * 没有脚本;打印(⌘P)只留卡面与页脚的品牌标记,可以贴书桌。不在孩子端的入口里。色板同家长端各页。
 */
import { qrNotes, qrSvg } from '../shared/qr-svg.ts';
import { faviconLinks } from '../shared/favicon.ts';
import { BRAND_FOOTER } from '../shared/brand.ts';

export interface ListenInfo {
  /** https://<电脑名>.local/(端口不是 443 时带端口) */
  name: string;
  /** https://<局域网 IPv4>/(同上);没连网 → null */
  ip: string | null;
  https: boolean;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function qrPage(title: string, info: ListenInfo, via: 'name' | 'ip' = 'name', to: 'kid' | 'parent' = 'kid'): string {
  const useIp = via === 'ip' && info.ip !== null;
  const base = useIp ? (info.ip as string) : info.name;
  const url = to === 'parent' ? `${base}parent` : base;
  const svg = qrSvg(url) ?? '<p>地址太长,编不进二维码</p>';
  const q = (v: 'name' | 'ip', t: 'kid' | 'parent'): string => `/parent/qr${v === 'ip' ? '?via=ip' : ''}${t === 'parent' ? (v === 'ip' ? '&' : '?') + 'to=parent' : ''}`;
  const other = useIp
    ? `<a href="${q('name', to)}">换回主机名那张</a>(不随 Wi-Fi 变,适合打印)`
    : info.ip
      ? `扫完一直转圈、打不开?<a href="${q('ip', to)}">换数字地址这张</a>`
      : '';
  // 换到另一张时带上现在真用的那种地址(要了 ip 但没连网 → 仍是主机名,不给 via=ip 的退路)
  const cur = useIp ? 'ip' : 'name';
  const swap = to === 'parent'
    ? `这张是家长用的:看记录、排首页。<a href="${q(cur, 'kid')}">孩子那张</a>`
    : `家长自己的手机扫另一张:<a href="${q(cur, 'parent')}">家长那张</a>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${faviconLinks()}
<title>扫码打开 · ${esc(title)}${to === 'parent' ? ' · 家长' : ''}</title>
<style>
  :root { --paper:#f6f5f1; --ink:#2b2b2b; --dim:#6b675f; --mute:#8a8781; --line:#efece5; --card:#fff; --accent:#b4531f; }
  * { box-sizing:border-box; }
  html, body { margin:0; background:var(--paper); color:var(--ink); font:15px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; }
  body { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:16px; }
  main { background:var(--card); border-radius:16px; padding:32px 36px 28px; max-width:440px; width:100%; box-shadow:0 1px 3px #0000000d, 0 0 0 1px var(--line); }
  h1 { margin:0 0 16px; font-size:24px; font-weight:650; text-align:center; letter-spacing:-.01em; }
  h1 small { display:block; font-size:13.5px; font-weight:400; color:var(--mute); letter-spacing:0; }
  .qr svg { display:block; width:100%; max-width:340px; height:auto; margin:0 auto; }
  .url { margin:10px 0 18px; text-align:center; font:500 14px/1.4 ui-monospace,"SF Mono",Menlo,monospace; word-break:break-all; background:var(--paper); border-radius:8px; padding:8px 12px; }
  ul { margin:0; padding-left:20px; font-size:13.5px; color:var(--dim); }
  li + li { margin-top:4px; }
  .other { margin:16px 0 0; font-size:13px; color:var(--mute); text-align:center; }
  .other a { color:var(--accent); }
  .ct-brand { margin-top:20px; }
  @media print { html, body { background:#fff; } body { min-height:0; } main { box-shadow:none; margin:0 auto; } .url { background:none; } .other { display:none; } }
</style>
</head>
<body>
<main>
  <h1>${esc(title)}${to === 'parent' ? '<small>家长看</small>' : ''}</h1>
  <div class="qr">${svg}</div>
  <p class="url">${esc(url)}</p>
  <ul>${qrNotes(info.https).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
  <p class="other">${swap}</p>
  ${other ? `<p class="other">${other}</p>` : ''}
</main>
${BRAND_FOOTER}
</body>
</html>
`;
}
