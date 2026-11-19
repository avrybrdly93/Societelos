// Maslow pyramid: a slowly rotating 3D pyramid of the five layers of need,
// each filled to the sample's average score for that need (0-100).
(function () {
  'use strict';
  const LAYERS = [
    { key: 'physiological', label: 'Physiological', sub: 'Health', hue: 8, pick: (n) => n.health },
    { key: 'safety', label: 'Safety', sub: 'Trust', hue: 32, pick: (n) => n.trust },
    { key: 'belonging', label: 'Belonging', sub: 'Connection', hue: 150, pick: (n) => n.connection },
    { key: 'esteem', label: 'Esteem', sub: 'Fairness & autonomy', hue: 200, pick: (n) => ((n.fairness || 0) + (n.autonomy || 0)) / 2 },
    { key: 'actualization', label: 'Self-actualization', sub: 'Purpose', hue: 275, pick: (n) => n.purpose }
  ];
  const GAP = 0.025;
  let canvas, ctx, legend, raf = null, angle = 0.6;
  let shown = [50, 50, 50, 50, 50], target = [50, 50, 50, 50, 50], hasData = false;

  function mount(root) {
    if (!root || canvas) return;
    root.textContent = '';
    const title = document.createElement('p');
    title.className = 'label';
    title.textContent = "Maslow's hierarchy of needs";
    const sub = document.createElement('p');
    sub.className = 'pyramid-sub mono';
    sub.textContent = 'Average of the 500-citizen sample';
    canvas = document.createElement('canvas');
    canvas.className = 'pyramid-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Rotating 3D pyramid of average Maslow need scores');
    legend = document.createElement('ol');
    legend.className = 'pyramid-legend';
    LAYERS.slice().reverse().forEach((l) => {
      const li = document.createElement('li');
      li.dataset.key = l.key;
      li.style.setProperty('--h', l.hue);
      const nm = document.createElement('span'); nm.className = 'pl-name'; nm.textContent = l.label;
      const vl = document.createElement('span'); vl.className = 'pl-val mono';
      li.append(nm, vl);
      li.title = l.sub;
      legend.append(li);
    });
    root.append(title, sub, canvas, legend);
    ctx = canvas.getContext('2d');
    if (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) loop(); else draw();
  }

  function setNeeds(needs) {
    if (!needs || typeof needs !== 'object') return;
    target = LAYERS.map((l) => Math.max(0, Math.min(100, Number(l.pick(needs)) || 0)));
    if (!hasData) { shown = target.slice(); hasData = true; }
    if (!raf) draw();
  }

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(200, Math.round(r.width * dpr)), h = Math.max(200, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w: canvas.width, h: canvas.height };
  }

  function loop() {
    angle += 0.006;
    for (let i = 0; i < 5; i++) shown[i] += (target[i] - shown[i]) * 0.06;
    draw();
    raf = requestAnimationFrame(loop);
  }

  // Frustum between heights y0..y1 of a pyramid with base half-width 1 and height 5.
  function half(y) { return Math.max(0, 1 - y / 5.2); }

  function draw() {
    if (!ctx) return;
    const { w, h } = size();
    ctx.clearRect(0, 0, w, h);
    const tilt = 0.42, cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    const scale = Math.min(w * 0.44, h * 0.19);
    const cx = w / 2, cy = h * 0.93;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const proj = (x, y, z) => {
      const rx = x * cosA - z * sinA, rz = x * sinA + z * cosA;
      const py = y * cosT - rz * sinT;
      return [cx + rx * scale, cy - py * scale, rz * cosT + y * sinT];
    };
    const faces = [];
    LAYERS.forEach((l, i) => {
      const y0 = i + GAP, y1 = i + 1 - GAP;
      const f = Math.max(0, Math.min(1, shown[i] / 100));
      const ym = y0 + (y1 - y0) * f;
      const bands = [[y0, ym, true], [ym, y1, false]];
      for (const [a, b, lit] of bands) {
        if (b - a < 1e-4) continue;
        const wa = half(a), wb = half(b);
        for (let s = 0; s < 4; s++) {
          const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
          const p0 = c[s], p1 = c[(s + 1) % 4];
          const pts = [proj(p0[0] * wa, a, p0[1] * wa), proj(p1[0] * wa, a, p1[1] * wa), proj(p1[0] * wb, b, p1[1] * wb), proj(p0[0] * wb, b, p0[1] * wb)];
          const nx = (p0[0] + p1[0]) / 2, nz = (p0[1] + p1[1]) / 2;
          const facing = (nx * sinA + nz * cosA); // normal depth after rotation (>0 = away)
          faces.push({ pts, depth: pts.reduce((q, p) => q + p[2], 0) / 4, hue: l.hue, lit, shade: 0.55 + 0.45 * (1 - facing) / 2, back: facing > 0.02 });
        }
      }
      // Top cap of each layer reads as the ledge between layers.
      const wt = half(y1);
      const cap = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => proj(x * wt, y1, z * wt));
      faces.push({ pts: cap, depth: -1e3 + y1, hue: l.hue, lit: f > 0.98, shade: 1.1, cap: true });
    });
    faces.sort((a, b) => b.depth - a.depth);
    for (const f of faces) {
      if (f.back && !f.cap) continue;
      ctx.beginPath();
      f.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      const L = f.lit ? 38 + 22 * f.shade : 12 + 6 * f.shade;
      const S = f.lit ? 75 : 25;
      ctx.fillStyle = `hsla(${f.hue},${S}%,${L}%,${f.lit ? 0.96 : 0.55})`;
      ctx.fill();
      ctx.strokeStyle = f.lit ? `hsla(${f.hue},90%,78%,0.85)` : 'rgba(220,230,255,0.22)';
      ctx.lineWidth = Math.max(1, w / 600);
      ctx.stroke();
    }
    if (legend) {
      legend.querySelectorAll('li').forEach((li) => {
        const i = LAYERS.findIndex((l) => l.key === li.dataset.key);
        li.querySelector('.pl-val').textContent = `${Math.round(shown[i])}`;
      });
    }
  }

  window.MaslowPyramid = { mount, setNeeds, LAYERS };
})();
