/**
 * 全屏课页和工作台样张共用的压纸效果。位移图描述从按钮中心的谷底到页中线的峰顶，
 * 随高度移动纸上的字；光影只取坡度。每个方向的 SVG 滤镜使用固定纹理，换手时切换滤镜。
 */
const paperWidth = 560, paperHeight = 320, paperOrigin = 115, paperSlope = 175;
let paperSequence = 0;

function paperSmooth(t: number) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

function paperSurface(right: boolean) {
  const map = document.createElement('canvas'), light = document.createElement('canvas');
  map.width = light.width = paperWidth;
  map.height = light.height = paperHeight;
  const m = map.getContext('2d')!, l = light.getContext('2d')!;
  const offset = m.createImageData(paperWidth, paperHeight), shade = l.createImageData(paperWidth, paperHeight);
  // 多算一圈高度，求坡度时直接取相邻点。
  const stride = paperWidth + 2, heights = new Float32Array(stride * (paperHeight + 2));
  for (let x = -1; x <= paperWidth; x++) {
    const t = ((right ? paperWidth - 1 - x : x) - paperOrigin) / paperSlope;
    const profile = t < 0 ? -.96 * paperSmooth(1 + t / .65)
      : t > 1 ? .76 * (1 - paperSmooth((t - 1) / 1.35))
      : -.96 + 1.72 * paperSmooth(t + .17 * Math.sin(Math.PI * t));
    const band = 64 + 34 * paperSmooth(t);
    for (let row = -1; row <= paperHeight; row++) {
      const y = row - paperHeight / 2;
      heights[(row + 1) * stride + x + 1] = profile * Math.exp(-((y / band) ** 2)) * (1 - paperSmooth((Math.abs(y) - 130) / 29));
    }
  }
  for (let row = 0; row < paperHeight; row++) for (let x = 0; x < paperWidth; x++) {
    const j = (row + 1) * stride + x + 1, z = heights[j];
    const dx = (heights[j + 1] - heights[j - 1]) / 2, dy = (heights[j + stride] - heights[j - stride]) / 2;
    const i = 4 * (row * paperWidth + x);
    offset.data[i] = 128 + 590 * dx;
    offset.data[i + 1] = 128 + 118 * z;
    offset.data[i + 2] = 128;
    offset.data[i + 3] = 255 * Math.min(1, 60 * (Math.abs(z) + Math.abs(dx) + Math.abs(dy)));
    const tone = 2.1 * dy + 1.3 * dx;
    shade.data[i] = tone < 0 ? 50 : 255;
    shade.data[i + 1] = tone < 0 ? 46 : 255;
    shade.data[i + 2] = tone < 0 ? 42 : 250;
    shade.data[i + 3] = 255 * Math.min(.055, Math.abs(tone));
  }
  m.putImageData(offset, 0, 0);
  l.putImageData(shade, 0, 0);
  return { map: map.toDataURL(), light: light.toDataURL() };
}

let paperTextures: ReturnType<typeof paperSurface>[] | undefined;

export function paperPress(page: HTMLElement) {
  paperTextures ??= [paperSurface(false), paperSurface(true)];
  const id = 'voice-paper-' + ++paperSequence;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  const light = document.createElement('img');
  light.alt = '';
  light.className = 'paper-light';
  light.hidden = true;
  page.after(svg, light);
  const filters = paperTextures.map((texture, index) => {
    const filter = document.createElementNS(svg.namespaceURI!, 'filter');
    filter.id = id + '-' + index;
    // 合并回原图使页边及变形以外的细字保持清晰。
    filter.innerHTML = '<feImage preserveAspectRatio="none" result="local"/><feFlood flood-color="#808080" result="neutral"/><feMerge result="offset"><feMergeNode in="neutral"/><feMergeNode in="local"/></feMerge><feDisplacementMap in="SourceGraphic" in2="offset" xChannelSelector="R" yChannelSelector="G" result="warped"/><feComposite in="warped" in2="local" operator="in" result="patch"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="patch"/></feMerge>';
    for (const [attr, value] of Object.entries({ x: '0%', y: '0%', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB', primitiveUnits: 'userSpaceOnUse' })) filter.setAttribute(attr, value);
    svg.append(filter);
    const map = filter.querySelector('feImage')!;
    map.setAttribute('href', texture.map);
    return { id: filter.id, map, shift: filter.querySelector('feDisplacementMap')!, light: texture.light };
  });
  let active = filters[0], depth = 0, goal = 0, height = 0, frame = 0;
  let anchor: HTMLElement | undefined;
  const place = () => {
    if (!anchor) return;
    const bounds = page.getBoundingClientRect(), face = anchor.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !face.width || !face.height) return;
    const w = page.clientWidth, h = page.clientHeight;
    const x = (face.left + face.width / 2 - bounds.left) * w / bounds.width;
    const y = (face.top + face.height / 2 - bounds.top) * h / bounds.height;
    const right = x > w / 2;
    const scale = Math.max(1, Math.abs(w / 2 - x)) / paperSlope;
    // 纹理的分辨率固定；把两侧的缓坡按当前页高投影，上下四分之一页仍有可见的位移。
    const extent = h * 1.2;
    active = filters[Number(right)];
    const left = x - (right ? paperWidth - paperOrigin : paperOrigin) * scale;
    const top = y - extent / 2;
    for (const [attr, value] of Object.entries({ x: left, y: top, width: paperWidth * scale, height: extent })) active.map.setAttribute(attr, String(value));
    if (light.src !== active.light) light.src = active.light;
    Object.assign(light.style, { left: page.offsetLeft + left + 'px', top: page.offsetTop + top + 'px', width: paperWidth * scale + 'px', height: extent + 'px' });
    height = Math.max(9, Math.min(22, w * .042));
    return true;
  };
  const render = (value: number) => {
    depth = value;
    page.classList.toggle('paper-folded', value > 0);
    page.style.filter = value ? 'url(#' + active.id + ')' : '';
    active.shift.setAttribute('scale', String(2 * height * value));
    light.hidden = !value;
    light.style.opacity = String(value);
  };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const set = (down: boolean) => {
    const next = Number(down);
    if (goal === next) return;
    goal = next;
    cancelAnimationFrame(frame);
    if (motion.matches) { render(goal); return; }
    const from = depth, start = performance.now(), duration = down ? 120 : 200;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      render(t === 1 ? goal : from + (goal - from) * (1 - (1 - t) ** 2));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    tick(start + 1);
  };
  const resize = new ResizeObserver(() => { if (depth || goal) { place(); render(depth); } });
  resize.observe(page);
  const motionChanged = () => { cancelAnimationFrame(frame); render(goal); };
  motion.addEventListener('change', motionChanged);
  return {
    start(element: HTMLElement) {
      anchor = element;
      if (!place()) return;
      set(true);
      render(depth);
    },
    set,
    dispose() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      motion.removeEventListener('change', motionChanged);
      page.classList.remove('paper-folded');
      page.style.filter = '';
      svg.remove(); light.remove();
    },
    reset() { cancelAnimationFrame(frame); goal = 0; render(0); },
  };
}
