/**
 * 扫码页 /qr:在这台电脑上打开,iPad / iPhone 用相机扫,不用输地址。每次请求现画,不落文件。
 * 编什么由服务端定(ListenInfo,listen 之后才知道真端口),不看请求的 Host——家长多半是从 localhost 打开这一页的,照抄就编成了 localhost。
 * 默认编 <本机名>.local(不随 Wi-Fi 变);个别设备会把它解析到走不通的 IPv6(一直转圈),页脚有一条换成局域网 IP 的退路(?via=ip)。
 * 两张码:孩子端 `/`(缺省)与家长板书页 `/parent/board`(?to=parent,《家长板书页设计.md》§2.1),页脚互相换。
 * 没有脚本;打印(⌘P)只留卡面,可以贴书桌。不在孩子端的入口里。
 */
import { qrNotes, qrSvg } from '../lib/qr-svg.ts';

export interface ListenInfo {
  /** https://<本机名>.local:<端口>/ */
  name: string;
  /** https://<局域网 IPv4>:<端口>/;没连网 → null */
  ip: string | null;
  https: boolean;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function qrPage(title: string, info: ListenInfo, via: 'name' | 'ip' = 'name', to: 'kid' | 'parent' = 'kid'): string {
  const useIp = via === 'ip' && info.ip !== null;
  const base = useIp ? (info.ip as string) : info.name;
  const url = to === 'parent' ? `${base}parent/board` : base;
  const svg = qrSvg(url) ?? '<p>地址太长,编不进二维码</p>';
  const q = (v: 'name' | 'ip', t: 'kid' | 'parent'): string => `/qr${v === 'ip' ? '?via=ip' : ''}${t === 'parent' ? (v === 'ip' ? '&' : '?') + 'to=parent' : ''}`;
  const other = useIp
    ? `<a href="${q('name', to)}">换回主机名那张</a>(不随 Wi-Fi 变,适合打印)`
    : info.ip
      ? `扫完一直转圈、打不开?<a href="${q('ip', to)}">换数字地址这张</a>`
      : '';
  // 换到另一张时带上现在真用的那种地址(要了 ip 但没连网 → 仍是主机名,不给 via=ip 的退路)
  const cur = useIp ? 'ip' : 'name';
  const swap = to === 'parent'
    ? `这张是家长看的(板书、答案、给家长的话,只读)。<a href="${q(cur, 'kid')}">孩子那张</a>`
    : `家长在 iPad 上看孩子的板书:<a href="${q(cur, 'parent')}">家长那张</a>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>扫码打开 · ${esc(title)}${to === 'parent' ? ' · 家长' : ''}</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#f4f1ea; color:#222; font:16px/1.6 -apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif; }
  main { background:#fff; border-radius:20px; padding:32px 36px; margin:16px; max-width:420px; box-shadow:0 2px 16px rgba(0,0,0,.08); }
  h1 { margin:0 0 12px; font-size:24px; text-align:center; }
  h1 small { display:block; font-size:14px; font-weight:400; color:#777; }
  .qr svg { display:block; width:100%; max-width:340px; height:auto; margin:0 auto; }
  .url { margin:4px 0 16px; text-align:center; font:15px/1.4 ui-monospace, Menlo, monospace; word-break:break-all; }
  ul { margin:0; padding-left:20px; font-size:14px; color:#555; }
  li + li { margin-top:4px; }
  .other { margin:16px 0 0; font-size:13px; color:#777; text-align:center; }
  a { color:#b3541e; }
  @media print { body { background:#fff; min-height:0; } main { box-shadow:none; margin:0 auto; } .other { display:none; } }
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
</body>
</html>
`;
}
