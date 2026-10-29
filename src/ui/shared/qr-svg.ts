/**
 * 扫码页(/qr)用的两样:二维码的内联 SVG,与码下面那几行说明(同一个 Wi-Fi、证书)。纯函数,字符串进字符串出。
 * 不落文件:页面每次现画,标题、端口、HTTP / HTTPS 永远是当下的。
 */
import { encodeQR } from './qr.ts';

/** 二维码本身(连四格静区,白底黑格);装不下(地址长得离谱)返回 null */
export function qrSvg(text: string): string | null {
  const qr = encodeQR(text);
  if (!qr) return null;
  const n = qr.size + 8;
  let path = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      // 同一行连着的黑格并成一段
      let run = 1;
      while (x + run < qr.size && qr.modules[y][x + run]) run++;
      path += `M${x + 4} ${y + 4}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="二维码"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

export function qrNotes(https: boolean): string[] {
  const wifi = 'iPad / iPhone 和这台电脑连同一个 Wi-Fi,用相机扫';
  if (!https) return [wifi, '现在是 HTTP:能看板书,按住说话用不了;要用就在电脑上跑 cotutor cert,再重启服务'];
  return [wifi, '第一次用的设备先信任根证书:设置 › 通用 › 关于本机 › 证书信任设置(docs/iPad与iPhone.md)', '提示「不安全」:在电脑上重跑 cotutor cert,再重启服务'];
}
