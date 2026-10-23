// Tiny line chart (SVG). One series per chart; tap a week to read its value.
// No libraries, so it works offline.

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Round an axis maximum up to a friendly number.
export function niceMax(v) {
  if (!v || v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// points: [{ label, value (number|null), detail }]
export function lineChart({ title, points, yMin = 0, yMax, format, describe }) {
  const W = 320;
  const H = 150;
  const padL = 34;
  const padR = 10;
  const padT = 10;
  const padB = 22;
  const top = yMax ?? niceMax(Math.max(...points.map((p) => p.value ?? 0)));
  const x = (i) => padL + (points.length === 1 ? 0 : (i * (W - padL - padR)) / (points.length - 1));
  const y = (v) => padT + (1 - (v - yMin) / (top - yMin)) * (H - padT - padB);

  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const head = document.createElement('div');
  head.className = 'chart-title';
  head.textContent = title;
  const readout = document.createElement('div');
  readout.className = 'chart-readout';
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': title });

  // gridlines + y labels
  for (let i = 0; i <= 2; i++) {
    const v = yMin + ((top - yMin) * i) / 2;
    root.append(svg('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid' }));
    const t = svg('text', { x: padL - 6, y: y(v) + 3, 'text-anchor': 'end', class: 'axis-label' });
    t.textContent = format(v);
    root.append(t);
  }
  // x labels: first, middle, last
  const labelAt = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  points.forEach((p, i) => {
    if (!labelAt.has(i)) return;
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    const t = svg('text', { x: x(i), y: H - 6, 'text-anchor': anchor, class: 'axis-label' });
    t.textContent = p.label;
    root.append(t);
  });

  // line, broken where a week has no data
  let d = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p.value == null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
  });
  if (d) root.append(svg('path', { d, class: 'line' }));

  const cursor = svg('line', { y1: padT, y2: H - padB, class: 'cursor', visibility: 'hidden' });
  root.append(cursor);
  const dots = points.map((p, i) => {
    if (p.value == null) return null;
    const c = svg('circle', { cx: x(i), cy: y(p.value), r: 4, class: 'dot' });
    root.append(c);
    return c;
  });

  // tap/hover targets wider than the dots
  const step = points.length > 1 ? (W - padL - padR) / (points.length - 1) : W;
  const select = (i) => {
    dots.forEach((c, j) => c && c.classList.toggle('active', j === i));
    cursor.setAttribute('x1', x(i));
    cursor.setAttribute('x2', x(i));
    cursor.setAttribute('visibility', 'visible');
    readout.textContent = describe(points[i]);
  };
  points.forEach((p, i) => {
    const hit = svg('rect', { x: x(i) - step / 2, y: 0, width: step, height: H, class: 'hit' });
    hit.addEventListener('pointerenter', () => select(i));
    hit.addEventListener('click', () => select(i));
    root.append(hit);
  });

  // start on the latest week that has data
  let last = -1;
  points.forEach((p, i) => p.value != null && (last = i));
  if (last >= 0) select(last);
  else readout.textContent = 'No data yet';

  wrap.append(head, readout, root);
  return wrap;
}
