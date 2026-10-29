#!/usr/bin/env python3
"""
板书底纹的学科字:三门主科照课本封面,把学科名烤成 SVG 轮廓写进 src/ui/kid/board-mark-art.ts(生成的,别手改)。
孩子端不加载字体:iPad 不碰外网,三个词是死的,烤一次进仓就行。

- 语文:马善政毛笔楷(Ma Shan Zheng,OFL)「语文」,竖排,转 −2°
- 数学:思源宋体最粗一档(Noto Serif SC Black,OFL)「数学」,竖排
- 英语:Barlow SemiBold(OFL)「ENGLISH」,字距 0.08em,侧着(同 CSS vertical-rl 里的拉丁字:顺时针转 90°,从上往下读)

字体从 Google Fonts 只取这几个字的子集(css2 的 text=),烤完不留字体文件。
单位:中文一个字的字号 = 1(页面里乘 --bm-s);ENGLISH 字号 = 0.44(同中文一个字宽的四成多)。路径坐标是这个单位的千分之一,y 朝下。
用法:python3 scripts/bake-board-marks.py   (要 fonttools:pip install fonttools;要联网)
"""
import io
import math
import re
import urllib.parse
import urllib.request
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

OUT = Path(__file__).resolve().parent.parent / 'src' / 'server' / 'board-mark-art.ts'
# 老一点的 UA,Google Fonts 回 WOFF(fontTools 直接读)而不是 woff2(要 brotli)
UA = 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Safari/534.30'

MARKS = [
    # id、字体(css2 的 family)、字、排法、字号、转角、字距(em)
    dict(id='yuwen', family='Ma+Shan+Zheng', text='语文', font='Ma Shan Zheng', mode='stack', size=1.0, turn=-2.0, track=0.0),
    dict(id='shuxue', family='Noto+Serif+SC:wght@900', text='数学', font='Noto Serif SC Black', mode='stack', size=1.0, turn=0.0, track=0.0),
    dict(id='english', family='Barlow:wght@600', text='ENGLISH', font='Barlow SemiBold', mode='sideways', size=0.44, turn=0.0, track=0.08),
]


def fetch_font(family: str, text: str) -> TTFont:
    url = f'https://fonts.googleapis.com/css2?family={family}&text={urllib.parse.quote(text)}'
    css = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA})).read().decode()
    src = re.search(r'url\((https://[^)]+)\)', css)
    if not src:
        raise SystemExit(f'Google Fonts 没给字体:{family}')
    data = urllib.request.urlopen(urllib.request.Request(src.group(1), headers={'User-Agent': UA})).read()
    return TTFont(io.BytesIO(data))


def mul(a, b):
    """仿射矩阵 (xx, xy, yx, yy, dx, dy) 相乘:先 b 后 a"""
    xx, xy, yx, yy, dx, dy = a
    bxx, bxy, byx, byy, bdx, bdy = b
    return (xx * bxx + yx * bxy, xy * bxx + yy * bxy, xx * byx + yx * byy, xy * byx + yy * byy,
            xx * bdx + yx * bdy + dx, xy * bdx + yy * bdy + dy)


def bake(m: dict) -> dict:
    font = fetch_font(m['family'], m['text'])
    upm = font['head'].unitsPerEm
    os2 = font['OS/2']
    asc = os2.sTypoAscender / upm  # 基线离 em 框顶多远(CJK 是 0.88)
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    k = m['size'] / upm
    # 每个字:字形坐标(y 朝上、字体单位)→ 排好的坐标(y 朝下、字号单位)
    placed = []
    if m['mode'] == 'stack':
        for i, ch in enumerate(m['text']):
            placed.append((cmap[ord(ch)], (k, 0, 0, -k, 0, (i + asc) * m['size'])))
    else:
        x = 0.0
        for ch in m['text']:
            g = cmap[ord(ch)]
            # 横排一行,基线在 asc;再整体顺时针转 90°:(x, y) → (−y, x)
            placed.append((g, mul((0, 1, -1, 0, 0, 0), (k, 0, 0, -k, x, asc * m['size']))))
            x += gs[g].width * k + m['track'] * m['size']
    # 转角:绕整体中心
    if m['turn']:
        bp = BoundsPen(gs)
        for g, t in placed:
            gs[g].draw(TransformPen(bp, t))
        x0, y0, x1, y1 = bp.bounds
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        a = math.radians(m['turn'])
        rot = mul((1, 0, 0, 1, cx, cy), mul((math.cos(a), math.sin(a), -math.sin(a), math.cos(a), 0, 0), (1, 0, 0, 1, -cx, -cy)))
        placed = [(g, mul(rot, t)) for g, t in placed]
    # 贴紧的外框,挪到原点,放大一千倍取整
    bp = BoundsPen(gs)
    for g, t in placed:
        gs[g].draw(TransformPen(bp, t))
    x0, y0, x1, y1 = bp.bounds
    pen = SVGPathPen(gs, ntos=lambda v: str(round(v)))
    for g, t in placed:
        gs[g].draw(TransformPen(pen, mul((1000, 0, 0, 1000, -x0 * 1000, -y0 * 1000), t)))
    return dict(id=m['id'], text=m['text'], font=m['font'], w=round(x1 - x0, 3), h=round(y1 - y0, 3), d=pen.getCommands())


def main():
    baked = [bake(m) for m in MARKS]
    lines = [
        '/**',
        ' * 板书底纹的学科字轮廓:scripts/bake-board-marks.py 生成的,别手改(改字体、排法改那个脚本再跑一遍)。',
        ' * 单位:中文一个字的字号 = 1;w、h 是贴紧的外框,d 的坐标是这个单位的千分之一(viewBox 0 0 w*1000 h*1000),y 朝下。',
        ' * 字体都是 SIL Open Font License 1.1(见仓根 NOTICE)。',
        ' */',
        'export interface BoardMarkArt {',
        '  /** 写的是什么 */',
        '  text: string;',
        '  /** 照哪款字体烤的 */',
        '  font: string;',
        '  w: number;',
        '  h: number;',
        '  d: string;',
        '}',
        '',
        'export const BOARD_MARK_ART = {',
    ]
    for b in baked:
        lines.append(f"  {b['id']}: {{ text: '{b['text']}', font: '{b['font']}', w: {b['w']}, h: {b['h']}, d: '{b['d']}' }},")
    lines += ['} as const satisfies Record<string, BoardMarkArt>;', '']
    OUT.write_text('\n'.join(lines), encoding='utf-8')
    for b in baked:
        print(f"{b['id']}: {b['w']} × {b['h']},路径 {len(b['d'])} 字")


if __name__ == '__main__':
    main()
