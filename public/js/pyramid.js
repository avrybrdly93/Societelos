// Wellness HUD: an isometric volumetric Maslow pyramid (five slabs sized by
// volume) plus Self-Determination gauges and the 50/50 Foundation/Agency split.
//   wireframe shell = raw potential S_i, solid blue fill = effective E_i
//   (E_i is S_i throttled by the tier below, so weak foundations pinch the top).
(function () {
  'use strict';
  const TIERS = [
    { key: 'physiological', label: 'Physiological', sub: 'Health' },
    { key: 'safety', label: 'Safety', sub: 'Trust in the Loom' },
    { key: 'belonging', label: 'Belonging', sub: 'Connection' },
    { key: 'esteem', label: 'Esteem', sub: 'Fairness' },
    { key: 'actualization', label: 'Self-actualization', sub: 'Purpose' }
  ];
  const SDT = [
    { key: 'autonomy', label: 'Autonomy' },
    { key: 'competence', label: 'Competence' },
    { key: 'relatedness', label: 'Relatedness' }
  ];
  const DEFAULT_WEIGHTS = [0.488, 0.296, 0.152, 0.056, 0.008];
  const RIGHT = '#2f5fe8', ROYAL = '#1d46c8', ICE = '#cfe3ff';
  const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0));
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function create(root, opts) {
    opts = opts || {};
    if (!root) return null;
    root.textContent = '';
    root.classList.add('wellness-hud');
    const compact = !!opts.compact;
    const view = { raw: [60, 60, 60, 60, 60], eff: [60, 60, 60, 60, 60], sdt: [50, 50, 50], maslow: 50, sdtScore: 50, wellness: 50 };
    const tgt = { raw: view.raw.slice(), eff: view.eff.slice(), sdt: view.sdt.slice(), maslow: 50, sdtScore: 50, wellness: 50 };
    let weights = DEFAULT_WEIGHTS.slice(), shares = { maslow: 0.5, sdt: 0.5 }, hasData = false, raf = null;

    const head = el('div', 'wh-head');
    head.append(el('p', 'label', '3D Maslow pyramid'), el('p', 'pyramid-sub mono', 'Volume = weight · shell = potential · fill = effective'));
    const canvas = el('canvas', 'pyramid-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Isometric volumetric pyramid of the five Maslow tiers');
    const legend = el('ol', 'pyramid-legend');
    const legendRows = TIERS.slice().reverse().map((t) => {
      const li = el('li'); li.title = t.sub;
      const nm = el('span', 'pl-name', t.label), vl = el('span', 'pl-val mono');
      li.append(nm, vl); legend.append(li);
      return { key: t.key, vl };
    });

    const sdtBox = el('div', 'sdt-box');
    sdtBox.append(el('p', 'label', 'Self-determination'));
    const sdtRows = SDT.map((s) => {
      const row = el('div', 'sdt-row');
      const top = el('div', 'sdt-top'); const v = el('span', 'sdt-val mono');
      top.append(el('span', 'sdt-name', s.label), v);
      const bar = el('div', 'sdt-bar'); const fill = el('i'); bar.append(fill);
      row.append(top, bar); sdtBox.append(row);
      return { v, fill };
    });

    const split = el('div', 'split-box');
    const mkSplit = (cls, name) => {
      const row = el('div', `split-row ${cls}`);
      const top = el('div', 'split-top'); const nm = el('span', 'split-name', name); const pts = el('span', 'split-pts mono');
      top.append(nm, pts);
      const bar = el('div', 'split-bar'); const fill = el('i'); bar.append(fill);
      row.append(top, bar); split.append(row);
      return { nm, pts, fill };
    };
    const sFound = mkSplit('is-foundation', 'Foundation 50%');
    const sAgency = mkSplit('is-agency', 'Agency 50%');
    const total = el('div', 'split-total');
    const tv = el('span', 'split-total-val mono');
    total.append(el('span', 'split-total-label', 'Wellness'), tv); split.append(total);

    if (compact) root.classList.add('is-compact');
    root.append(head, canvas, legend, sdtBox, split);
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function setNeeds(n) {
      if (!n || !Array.isArray(n.tiers) || n.tiers.length !== 5) return;
      weights = n.tiers.map((t, i) => Number(t.weight) || DEFAULT_WEIGHTS[i]);
      tgt.raw = n.tiers.map((t) => clamp(t.raw));
      tgt.eff = n.tiers.map((t) => clamp(t.effective));
      tgt.sdt = SDT.map((s) => clamp(n.sdt && n.sdt[s.key]));
      tgt.maslow = clamp(n.maslow); tgt.sdtScore = clamp(n.sdtScore); tgt.wellness = clamp(n.wellness);
      if (n.shares) shares = { maslow: Number(n.shares.maslow) || 0.5, sdt: Number(n.shares.sdt) || 0.5 };
      if (!hasData || reduce) { copy(); hasData = true; }
      kick();
    }
    function copy() {
      view.raw = tgt.raw.slice(); view.eff = tgt.eff.slice(); view.sdt = tgt.sdt.slice();
      view.maslow = tgt.maslow; view.sdtScore = tgt.sdtScore; view.wellness = tgt.wellness;
    }
    function kick() { if (!raf) raf = requestAnimationFrame(tick); }
    function tick() {
      raf = null;
      let moving = false;
      const ease = (a, b) => { const d = b - a; if (Math.abs(d) < 0.05) return b; moving = true; return a + d * 0.1; };
      view.raw = view.raw.map((v, i) => ease(v, tgt.raw[i]));
      view.eff = view.eff.map((v, i) => ease(v, tgt.eff[i]));
      view.sdt = view.sdt.map((v, i) => ease(v, tgt.sdt[i]));
      view.maslow = ease(view.maslow, tgt.maslow); view.sdtScore = ease(view.sdtScore, tgt.sdtScore); view.wellness = ease(view.wellness, tgt.wellness);
      draw(); readouts();
      if (moving) raf = requestAnimationFrame(tick);
    }

    function size() {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const w = Math.max(200, Math.round(r.width * dpr)), h = Math.max(160, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return { w: canvas.width, h: canvas.height };
    }

    // Slab i spans heights i..i+1 of a pyramid with base half-width 1 and height 5.
    const halfAt = (y) => Math.max(0, 1 - y / 5);
    function draw() {
      const { w, h } = size();
      ctx.clearRect(0, 0, w, h);
      const U = Math.min(w * 0.30, h * 0.26);        // world unit in px
      const cx = w / 2, cy = h * 0.88;
      const C = Math.cos(Math.PI / 6), S = Math.sin(Math.PI / 6);
      const P = (x, y, z) => [cx + (x - z) * C * U, cy + (x + z) * S * U - y * U * 0.78];
      const poly = (pts, fill, stroke, lw) => {
        ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
      };
      const lw = Math.max(1, w / 520);
      // Faint silhouette of the ideal pyramid.
      poly([P(-1, 0, 1), P(1, 0, 1), P(1, 0, -1), P(0, 5, 0)], null, 'rgba(207,227,255,.16)', lw);
      const slab = (i, k, mode) => {
        const y0 = i, y1 = i + 1, a = halfAt(y0) * k, b = halfAt(y1) * k;
        const bl = P(-a, y0, a), br = P(a, y0, a), fr = P(a, y0, -a);
        const tl = P(-b, y1, b), tr = P(b, y1, b), tf = P(b, y1, -b), tb = P(-b, y1, -b);
        if (mode === 'solid') {
          const g = ctx.createLinearGradient(0, tl[1], 0, bl[1]);
          g.addColorStop(0, '#6f97ff'); g.addColorStop(1, RIGHT);
          poly([bl, br, tr, tl], g, 'rgba(235,243,255,.9)', lw);                 // left-front face
          poly([br, fr, tf, tr], ROYAL, 'rgba(235,243,255,.9)', lw);              // right face
          poly([tl, tr, tf, tb], '#e9f1ff', 'rgba(255,255,255,.95)', lw);         // top cap
        } else {
          ctx.setLineDash([4, 4]);
          poly([bl, br, tr, tl], null, 'rgba(207,227,255,.5)', lw);
          poly([br, fr, tf, tr], null, 'rgba(207,227,255,.5)', lw);
          poly([tl, tr, tf, tb], null, 'rgba(207,227,255,.5)', lw);
          ctx.setLineDash([]);
        }
      };
      const kOf = (pct) => Math.cbrt(Math.max(0, pct) / 100); // uniform scale: volume ~ k^3
      for (let i = 0; i < 5; i++) {
        slab(i, Math.max(0.04, kOf(view.raw[i])), 'wire');
        slab(i, Math.max(0.03, kOf(view.eff[i])), 'solid');
      }
    }

    function readouts() {
      legendRows.forEach((r, idx) => {
        const i = 4 - idx;
        r.vl.textContent = `${Math.round(view.eff[i])}`;
        r.vl.title = `Effective ${Math.round(view.eff[i])} of raw ${Math.round(view.raw[i])} · weight ${(weights[i] * 100).toFixed(1)}%`;
      });
      sdtRows.forEach((r, i) => { r.v.textContent = `${Math.round(view.sdt[i])}`; r.fill.style.width = `${view.sdt[i]}%`; });
      const f = shares.maslow * view.maslow, a = shares.sdt * view.sdtScore;
      sFound.nm.textContent = `Foundation ${Math.round(shares.maslow * 100)}%`;
      sAgency.nm.textContent = `Agency ${Math.round(shares.sdt * 100)}%`;
      sFound.pts.textContent = `${view.maslow.toFixed(0)} → ${f.toFixed(1)} pts`;
      sAgency.pts.textContent = `${view.sdtScore.toFixed(0)} → ${a.toFixed(1)} pts`;
      sFound.fill.style.width = `${view.maslow}%`; sAgency.fill.style.width = `${view.sdtScore}%`;
      tv.textContent = `${view.wellness.toFixed(1)}`;
    }

    // Briefing highlight: 'foundation' | 'weave' | 'both' | null.
    function highlight(mode) {
      root.dataset.hl = mode || '';
    }
    readouts();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { draw(); }).observe(canvas); else draw();
    return { setNeeds, highlight, redraw: draw };
  }

  // Default instance for the chamber sidebar (keeps the old mount/setNeeds API).
  let main = null;
  function mount(root) { if (!main) main = create(root); return main; }
  function setNeeds(n) { if (main) main.setNeeds(n); }

  window.MaslowPyramid = { create, mount, setNeeds, TIERS, SDT };
})();
