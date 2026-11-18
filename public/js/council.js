// The Loom projector: the council around the Loom.
(function () {
  'use strict';

  // Owns the projector pieces that make the Loom feel like it is talking to
  // the five council members:
  //   scenes ...... background art per scene, crossfaded through a veil
  //   seats ....... the five characters (portrait, node, score) under the Loom
  //   threads ..... gold threads from the Loom to the seats; they glow when it speaks
  //   loom feed ... everything the Loom says, newest first (right column)
  //   ticker ...... citizens' quotes, one at a time, on the bar at the bottom
  //   scoreboard .. ranked council scores between rounds (left column)
  //   champion .... End Screen: top score with the character's profile + confetti
  // host.js calls transitionTo, pushQuote, resetQuotes and renderChampion; the
  // rest listens to the socket ('council', 'scores', 'loom:line', 'resolution').

  const $ = (id) => document.getElementById(id);
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const IMG = (name) => `img/${encodeURIComponent(name)}`;

  // ---------------------------------------------------------------------------
  // Scenes: one background per view, chosen to fit the moment.
  // ---------------------------------------------------------------------------
  const SCENES = {
    'view-lobby': { src: IMG('ThrivingCivilization.png'), pos: 'center 30%' },
    'view-intro': { src: IMG('The Loom_ A Perfect World.png'), pos: 'center' },
    'view-roles': { src: IMG('Golden Horizon Over the Utopian City.png'), pos: 'center 40%' },
    'view-chamber': { src: IMG('Council.png'), pos: 'center 35%' },
    'view-world': { src: IMG('Society.png'), pos: 'center 40%' },
    'view-finale': { src: IMG('TheLoom.png'), pos: 'center 35%' },
    'view-enact': { src: IMG('TheLoom.png'), pos: 'center 35%' },
    'view-end': { src: IMG('ThrivingCivilization.png'), pos: 'center 30%' }
  };
  // The world you built changes what the world-reveal and end scenes look like.
  const WORLD_SCENES = {
    AA: { src: IMG('ThrivingCivilization.png'), pos: 'center 30%', grade: 'sepia(0.25) saturate(0.9)' },
    AB: { src: IMG('Golden Horizon Over the Utopian City.png'), pos: 'center 40%', grade: 'saturate(0.4) hue-rotate(140deg) brightness(0.85)' },
    BA: { src: IMG('Society.png'), pos: 'center 40%', grade: 'sepia(0.5) hue-rotate(-25deg) saturate(1.4) brightness(0.75)' },
    BB: { src: IMG('Society.png'), pos: 'center 40%', grade: 'grayscale(0.85) brightness(0.6) contrast(1.15)' }
  };
  let worldKey = null;
  let shutdown = false;

  const layers = Array.from(document.querySelectorAll('#scene-bg .scene-layer'));
  let front = 0;
  let currentSrc = null;

  function sceneFor(viewId) {
    if ((viewId === 'view-world' || viewId === 'view-end') && worldKey && WORLD_SCENES[worldKey]) {
      const s = WORLD_SCENES[worldKey];
      if (viewId === 'view-end' && shutdown) return { ...s, grade: 'grayscale(1) brightness(0.45)' };
      return s;
    }
    if (viewId === 'view-end' && shutdown) return { ...SCENES['view-end'], grade: 'grayscale(1) brightness(0.45)' };
    return SCENES[viewId] || SCENES['view-chamber'];
  }

  function setScene(viewId) {
    if (!layers.length) return;
    const scene = sceneFor(viewId);
    const key = `${scene.src}|${scene.grade || ''}`;
    if (key === currentSrc) return;
    currentSrc = key;
    const next = layers[1 - front];
    next.style.backgroundImage = `url("${scene.src}")`;
    next.style.backgroundPosition = scene.pos || 'center';
    next.style.filter = scene.grade || '';
    next.classList.add('is-front');
    layers[front].classList.remove('is-front');
    front = 1 - front;
    document.body.dataset.scene = viewId;
  }

  // ---------------------------------------------------------------------------
  // Transitions: veil in (gold-black), swap view + background, veil out; the
  // incoming view rises in.
  // ---------------------------------------------------------------------------
  const veil = $('scene-veil');
  let veilTimer = null;
  function transitionTo(viewId, swap) {
    // The view swaps at once (screen state always matches the phase); the
    // cut is dressed as a dip from gold-black that fades out while the new
    // view rises in and the background crossfades.
    swap();
    setScene(viewId);
    if (reducedMotion) return;
    const view = $(viewId);
    if (view) {
      view.classList.remove('view-enter');
      void view.offsetWidth;
      view.classList.add('view-enter');
    }
    if (!veil) return;
    clearTimeout(veilTimer);
    veil.classList.add('is-cut');
    void veil.offsetWidth;
    veilTimer = setTimeout(() => veil.classList.remove('is-cut'), 40);
  }

  // ---------------------------------------------------------------------------
  // Seats + Meet the Council cards.
  // ---------------------------------------------------------------------------
  let council = [];
  const scoreByNode = {};
  const roundByNode = {};

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  function portrait(src, className) {
    const img = el('img', className);
    img.alt = '';
    img.decoding = 'async';
    if (src) img.src = src;
    return img;
  }


  const shortName = (n) => String(n || '').replace(/^The\s+/i, '');

  // Seats: tall portrait cards (the whole face), grouped in the bottom-left
  // corner so the council in the chamber art stays in view.
  function renderSeats() {
    const list = $('council-seats');
    if (!list) return;
    list.textContent = '';
    council.forEach((m) => {
      const c = m.character || {};
      const li = document.createElement('li');
      li.className = 'council-seat';
      li.dataset.node = m.node;
      li.dataset.character = c.id || '';
      li.appendChild(portrait(c.portrait, 'seat-portrait'));
      const body = el('div', 'seat-body');
      body.append(
        el('span', 'seat-name', shortName(c.name) || m.node),
        el('span', 'seat-pos', window.councilLabel(m.node))
      );
      const score = el('div', 'seat-score');
      score.append(el('span', 'seat-total mono', scoreByNode[m.node] || 0), el('span', 'seat-round mono', roundByNode[m.node] ? `+${roundByNode[m.node]}` : ''));
      li.append(score, body);
      list.appendChild(li);
    });
  }

  function renderCharacterCards() {
    const list = $('character-cards');
    if (!list) return;
    list.textContent = '';
    council.forEach((m, i) => {
      const c = m.character || {};
      const li = el('li', 'character-card');
      li.style.setProperty('--deal-delay', `${0.25 + i * 0.35}s`);
      li.dataset.character = c.id || '';
      li.appendChild(portrait(c.portrait, 'char-portrait'));
      const body = el('div', 'char-body');
      const gw = Number.isFinite(c.groupWeight) ? Math.round(c.groupWeight * 100) : null;
      body.append(
        el('span', 'char-node mono', window.councilLabel(m.node)),
        el('span', 'char-name', c.name || ''),
        el('span', 'char-motto', c.motto ? `“${c.motto}”` : '')
      );
      if (gw !== null) {
        const bar = el('div', 'char-balance');
        bar.setAttribute('aria-label', `Scores ${gw}% from the council's shared goal, ${100 - gw}% from personal ideals`);
        const fill = el('span', 'char-balance-fill');
        fill.style.width = `${gw}%`;
        bar.appendChild(fill);
        body.append(bar, el('span', 'char-balance-label mono', `${gw}% council goal · ${100 - gw}% personal`));
      }
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------------
  // Scoreboard (left column) and seat scores.
  // ---------------------------------------------------------------------------
  function renderScores(payload) {
    if (!payload || !Array.isArray(payload.rows)) return;
    payload.rows.forEach((r) => { scoreByNode[r.node] = r.total; roundByNode[r.node] = r.round; });
    const list = $('scoreboard');
    if (list) {
      list.textContent = '';
      payload.rows.forEach((r, i) => {
        const li = el('li', 'score-row');
        li.dataset.node = r.node;
        li.append(
          el('span', 'score-rank mono', i + 1),
          portrait(r.character && r.character.portrait, 'score-portrait'),
          el('span', 'score-name', shortName(r.character && r.character.name) || r.node),
          el('span', 'score-node mono', window.councilLabel(r.node)),
          el('span', 'score-round mono', r.round ? `+${r.round}` : ''),
          el('span', 'score-total mono', r.total)
        );
        list.appendChild(li);
      });
    }
    const round = $('scoreboard-round');
    if (round) round.textContent = payload.cycle ? `after ${2120 + payload.cycle}` : '';
    renderSeats();
    document.querySelectorAll('.council-seat').forEach((s) => {
      if (roundByNode[s.dataset.node]) {
        s.classList.remove('is-scored');
        void s.offsetWidth;
        s.classList.add('is-scored');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // The Loom's live feed + threads that glow while it speaks.
  // ---------------------------------------------------------------------------
  const KIND_LABEL = { voice: 'The Loom', crisis: 'Crisis', verdict: 'Verdict', world: 'World', end: 'The record' };
  const FEED_MAX = 8;
  function addLoomLine(line, { quiet = false } = {}) {
    const list = $('loom-feed');
    if (!list || !line || !line.text) return;
    const li = el('li', `loom-feed-item is-${line.kind || 'voice'}`);
    const text = el('p', 'loom-feed-text');
    li.append(el('span', 'loom-feed-meta mono', `${KIND_LABEL[line.kind] || 'The Loom'} · ${line.year || ''}`), text);
    list.prepend(li);
    revealWords(text, line.text, quiet);
    while (list.children.length > FEED_MAX) list.lastElementChild.remove();
    while (list.children.length > 1 && list.scrollHeight > list.clientHeight + 1) list.lastElementChild.remove();
    if (!quiet) pulseThreads();
  }
  // One word at a time, like the Loom speaking (instant for history replays).
  const FEED_WORD_MS = 120;
  function revealWords(target, str, instant) {
    const words = String(str).split(/\s+/).filter(Boolean);
    target.textContent = '';
    const spans = words.map((w, i) => {
      const span = el('span', instant || reducedMotion ? 'feed-word is-in' : 'feed-word', w);
      target.append(span, i < words.length - 1 ? ' ' : '');
      return span;
    });
    if (instant || reducedMotion) return;
    spans.forEach((span, i) => setTimeout(() => span.classList.add('is-in'), i * FEED_WORD_MS));
  }
  let threadTimer = null;
  function pulseThreads() {
    const threads = $('loom-threads');
    if (!threads) return;
    threads.classList.add('is-speaking');
    document.querySelectorAll('.council-seat').forEach((s) => s.classList.add('is-listening'));
    clearTimeout(threadTimer);
    threadTimer = setTimeout(() => {
      threads.classList.remove('is-speaking');
      document.querySelectorAll('.council-seat').forEach((s) => s.classList.remove('is-listening'));
    }, 4500);
  }

  // ---------------------------------------------------------------------------
  // Citizen ticker: one quote at a time, crossfading; loops the current batch.
  // ---------------------------------------------------------------------------
  const QUOTE_MS = 6500;
  let quotes = [];
  let quoteIdx = -1;
  let quoteTimer = null;
  function quoteElement(item) {
    const wrap = el('div', 'ticker-item');
    const who = [item.name || 'Citizen', typeof item.age === 'number' ? item.age : null, item.districtName || item.district].filter((v) => v !== null && v !== undefined && v !== '').join(', ');
    wrap.append(el('span', 'ticker-who mono', who), el('span', 'ticker-text', `“${item.text}”`));
    return wrap;
  }
  function showQuote(i) {
    const box = $('ticker-quote');
    if (!box || !quotes.length) return;
    quoteIdx = i % quotes.length;
    const next = quoteElement(quotes[quoteIdx]);
    // Fade every older quote out first, so two quotes never overlap.
    Array.from(box.children).forEach((old) => {
      if (old.classList.contains('is-leaving')) return;
      old.classList.remove('is-in');
      old.classList.add('is-leaving');
      setTimeout(() => old.remove(), 400);
    });
    box.appendChild(next);
    requestAnimationFrame(() => next.classList.add('is-in'));
  }
  function scheduleQuotes() {
    clearInterval(quoteTimer);
    quoteTimer = setInterval(() => { if (quotes.length > 1) showQuote(quoteIdx + 1); }, QUOTE_MS);
  }
  function pushQuote(item) {
    if (!item || !item.text) return;
    quotes.push(item);
    if (quotes.length > 12) quotes.shift();
    showQuote(quotes.length - 1); // a new voice cuts in straight away
    scheduleQuotes();
  }
  function resetQuotes() {
    quotes = [];
    quoteIdx = -1;
    clearInterval(quoteTimer);
    const box = $('ticker-quote');
    if (box) box.textContent = '';
  }

  // ---------------------------------------------------------------------------
  // End Screen champion + casual confetti.
  // ---------------------------------------------------------------------------
  const IDEA_LABELS = { purpose: 'Purpose', connection: 'Community', health: 'Wellbeing', trust: 'Trust in the Loom', fairness: 'Fairness', autonomy: 'Freedom' };
  function renderChampion(data) {
    const card = $('champion-card');
    if (!card) return;
    shutdown = !!(data && data.shutdown);
    const champ = data && data.champion;
    card.hidden = !champ || !champ.character;
    if (card.hidden) { stopConfetti(); return; }
    const c = champ.character;
    $('champion-portrait').src = c.portrait || '';
    $('champion-character').textContent = c.name || '';
    $('champion-motto').textContent = c.motto ? `“${c.motto}”` : '';
    const ideas = $('champion-ideas');
    ideas.textContent = '';
    Object.entries(c.ideas || {}).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      const li = el('li', 'idea-row');
      const bar = el('span', 'idea-bar');
      const fill = el('span', `idea-fill ${v < 0 ? 'is-neg' : ''}`);
      fill.style.width = `${Math.round(Math.abs(v) * 100)}%`;
      bar.appendChild(fill);
      li.append(el('span', 'idea-name', IDEA_LABELS[k] || k), bar);
      ideas.appendChild(li);
    });
  }

  const confetti = (() => {
    const canvas = $('confetti');
    const ctx = canvas && canvas.getContext && canvas.getContext('2d');
    const COLOURS = ['#9fd3ff', '#c7b6ff', '#ffffff', '#6aa8ff', '#e4dcff', '#7fe3f0'];
    let bits = [];
    let raf = null;
    function spawn(n) {
      for (let i = 0; i < n; i++) {
        bits.push({
          x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.6,
          w: 6 + Math.random() * 8, h: 3 + Math.random() * 5,
          vy: 0.6 + Math.random() * 1.3, vx: (Math.random() - 0.5) * 0.6,
          rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.06,
          sway: Math.random() * Math.PI * 2, c: COLOURS[Math.floor(Math.random() * COLOURS.length)]
        });
      }
    }
    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const b of bits) {
        b.sway += 0.02;
        b.x += b.vx + Math.sin(b.sway) * 0.5;
        b.y += b.vy;
        b.rot += b.vr;
        if (b.y > canvas.height + 20) { b.y = -20; b.x = Math.random() * canvas.width; }
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.sway * 1.3)) + 1);
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    }
    return {
      start() {
        if (!ctx || reducedMotion || raf !== null) return;
        bits = [];
        spawn(90); // casual, not a blizzard
        raf = requestAnimationFrame(frame);
      },
      stop() {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  })();
  function stopConfetti() { confetti.stop(); }

  // Confetti starts with the champion beat (beat 3) and stops when END ends.
  const endView = $('view-end');
  if (endView) {
    new MutationObserver(() => {
      if (endView.classList.contains('beat-3') && !shutdown && !$('champion-card').hidden) confetti.start();
      if (!endView.classList.contains('is-active')) confetti.stop();
    }).observe(endView, { attributes: true, attributeFilter: ['class'] });
  }

  // ---------------------------------------------------------------------------
  // Socket wiring (the socket is created by host.js).
  // ---------------------------------------------------------------------------
  function wire() {
    const host = window.SocietelosHost;
    if (!host || !host.socket) return setTimeout(wire, 50);
    const socket = host.socket;
    socket.on('council', (p) => {
      council = (p && p.members) || [];
      renderSeats();
      renderCharacterCards();
    });
    socket.on('scores', renderScores);
    socket.on('loom:line', (line) => addLoomLine(line));
    socket.on('loom:history', (p) => {
      const list = $('loom-feed');
      if (list) list.textContent = '';
      ((p && p.lines) || []).forEach((line) => addLoomLine(line, { quiet: true }));
    });
    socket.on('resolution', (p) => {
      const a = p && p.result && p.result.approval;
      const num = $('approval-num');
      if (num && a && a.total) num.textContent = `${a.approve} / ${a.total}`;
    });
    // The world (and a shutdown) are known just after the scene changes: re-pick the scene.
    socket.on('world:reveal', (w) => { worldKey = (w && w.worldKey) || null; setScene(document.body.dataset.scene || 'view-world'); });
    socket.on('phase', (p) => {
      if (p.world && p.world.worldKey && p.world.worldKey !== worldKey) { worldKey = p.world.worldKey; setScene(document.body.dataset.scene); }
      if (p.phase === 'LOBBY') {
        worldKey = null; shutdown = false; council = [];
        Object.keys(scoreByNode).forEach((k) => { delete scoreByNode[k]; delete roundByNode[k]; });
        renderSeats(); renderCharacterCards(); resetQuotes();
        const list = $('loom-feed'); if (list) list.textContent = '';
        const sb = $('scoreboard'); if (sb) sb.textContent = '';
        const num = $('approval-num'); if (num) num.textContent = '—';
      }
      if (p.phase === 'INCIDENT') Object.keys(roundByNode).forEach((k) => { roundByNode[k] = 0; });
      if (p.phase === 'INCIDENT') renderSeats();
    });
    socket.on('host:sync', (p) => { if (p && p.worldKey) worldKey = p.worldKey; });
    socket.on('game:end', (d) => { shutdown = !!(d && d.shutdown); if (d && d.worldKey) worldKey = d.worldKey; setScene('view-end'); });
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Lobby bubbles: glassy bubbles rising behind the join screen.
  // ---------------------------------------------------------------------------
  const lobbyBubbles = (() => {
    const view = $('view-lobby');
    if (!view || reducedMotion) return { sync() {} };
    const canvas = document.createElement('canvas');
    canvas.className = 'lobby-bubbles';
    canvas.width = 1920;
    canvas.height = 984;
    canvas.setAttribute('aria-hidden', 'true');
    view.prepend(canvas);
    const ctx = canvas.getContext && canvas.getContext('2d');
    const bubbles = Array.from({ length: 70 }, () => {
      const r = Math.random() < 0.7 ? 4 + Math.random() * 12 : 14 + Math.random() * 26;
      return { x: Math.random() * 1920, y: Math.random() * 984, r, vy: -(0.25 + Math.random() * 0.6) * (16 / (r + 8)) - 0.12, p: Math.random() * 6.3, a: 0.16 + Math.random() * 0.3 };
    });
    let raf = null;
    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const b of bubbles) {
        b.p += 0.02;
        b.x += Math.sin(b.p) * 0.3;
        b.y += b.vy;
        if (b.y < -b.r * 2) { b.y = canvas.height + b.r * 2; b.x = Math.random() * canvas.width; }
        const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
        g.addColorStop(0, `rgba(255, 255, 255, ${b.a * 0.5})`);
        g.addColorStop(0.6, `rgba(170, 205, 255, ${b.a * 0.1})`);
        g.addColorStop(1, `rgba(190, 175, 255, ${b.a * 0.35})`);
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = `rgba(200, 220, 255, ${b.a})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    }
    return {
      sync() {
        const on = view.classList.contains('is-active');
        if (on && raf === null && ctx) raf = requestAnimationFrame(frame);
        if (!on && raf !== null) { cancelAnimationFrame(raf); raf = null; }
      }
    };
  })();
  const lobbyView = $('view-lobby');
  if (lobbyView) new MutationObserver(() => lobbyBubbles.sync()).observe(lobbyView, { attributes: true, attributeFilter: ['class'] });
  lobbyBubbles.sync();

  setScene('view-lobby');
  wire();

  window.LoomCouncil = { transitionTo, setScene, pushQuote, resetQuotes, renderChampion, addLoomLine, renderScores };
})();
