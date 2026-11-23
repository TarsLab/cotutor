/**
 * 几张 jpeg 拼成一份 PDF:一张一页,A4 竖着,照片照比例放进页边以内、居中。
 * 谁用:家长端导出作业本(src/runtime/homework.ts)。jpeg 原样嵌进去(DCTDecode),不解码、不压缩,所以不用加运行时依赖;
 * 读不出的(不是 jpeg)由调用的那层先挑掉。页上不写字(写字要嵌字体),日期在文件名里。
 */
import { jpegInfo } from './jpeg.ts';

/** A4(pt)与页边 */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 28;

const num = (n: number): string => (Math.round(n * 100) / 100).toString();

/** jpeg 一张一页;一张都没有也给一份只有一页白纸的(PDF 至少一页) */
export function jpegPdf(images: readonly Buffer[]): Buffer {
  const objs: Buffer[] = [];
  const add = (b: Buffer | string): number => { objs.push(typeof b === 'string' ? Buffer.from(b, 'latin1') : b); return objs.length; };
  // 1 目录、2 页树,先占位,页都排好再写
  add('');
  add('');
  const kids: number[] = [];
  const pages = images.map((buf) => ({ buf, info: jpegInfo(buf) })).filter((x): x is { buf: Buffer; info: { w: number; h: number; c: number } } => Boolean(x.info));
  for (const [i, { buf, info }] of pages.entries()) {
    const cs = info.c === 1 ? '/DeviceGray' : info.c === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    // Adobe 的 CMYK jpeg 是反的;照片都是 RGB,遇上了照常见的做法反过来
    const decode = info.c === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    const img = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${info.w} /Height ${info.h} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${buf.length} >>\nstream\n`, 'latin1'), buf, Buffer.from('\nendstream', 'latin1')]));
    const k = Math.min((PAGE_W - 2 * MARGIN) / info.w, (PAGE_H - 2 * MARGIN) / info.h);
    const w = info.w * k, h = info.h * k;
    const draw = `q ${num(w)} 0 0 ${num(h)} ${num((PAGE_W - w) / 2)} ${num((PAGE_H - h) / 2)} cm /Im${i} Do Q`;
    const content = add(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /XObject << /Im${i} ${img} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  if (!kids.length) {
    const content = add('<< /Length 0 >>\nstream\n\nendstream');
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << >> /Contents ${content} 0 R >>`));
  }
  objs[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1');
  objs[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, 'latin1');
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let at = parts[0].length;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(at);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), o, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(b);
    at += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}
