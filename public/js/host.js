// Societelos — host projector client.
// Renders server state only; the server owns every timer and decision.
(function () {
  'use strict';

  // Reconnect to the same room after a refresh.
  const savedRoom = (() => {
    try { return sessionStorage.getItem('societelos.hostRoom'); } catch (e) { return null; }
  })();

  // Scale the fixed 1920x1080 stage to the projector, centred and letterboxed.
  const STAGE_W = 1920;
  const STAGE_H = 1080;
  function fitStage() {
    const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    const x = (window.innerWidth - STAGE_W * scale) / 2;
    const y = (window.innerHeight - STAGE_H * scale) / 2;
    document.body.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }
  document.documentElement.classList.add('host-stage');
  window.addEventListener('resize', fitStage);
  fitStage();

  const socket = window.io({ auth: { clientType: 'host', roomCode: savedRoom || undefined } });

  const state = { roomCode: null, gameId: null, phase: 'LOBBY', cycle: 0, endsAt: null };

  socket.on('connect', () => console.log('[host] connected'));
  socket.on('disconnect', (reason) => console.warn('[host] disconnected:', reason));

  socket.on('host:room', (info) => {
    state.roomCode = info.roomCode;
    state.gameId = info.gameId;
    try { sessionStorage.setItem('societelos.hostRoom', info.roomCode); } catch (e) { /* storage unavailable */ }
    document.getElementById('room-code').textContent = info.roomCode;
    document.getElementById('lobby-room-code').textContent = info.roomCode;
  });

  // Load the join QR code and LAN URL for the lobby.
  async function fetchQR() {
    const img = document.getElementById('qr-image');
    const placeholder = document.getElementById('qr-placeholder');
    const urlEl = document.getElementById('join-url');
    try {
      const res = await fetch('/api/qr');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { joinUrl, dataUrl } = await res.json();
      img.src = dataUrl;
      img.hidden = false;
      placeholder.hidden = true;
      urlEl.textContent = joinUrl;
    } catch (err) {
      console.error('[host] QR fetch failed', err);
      placeholder.textContent = 'QR unavailable';
      urlEl.textContent = `${location.protocol}//${location.host}/mobile`;
    }
  }

  fetchQR();

  const NODE_IDS = ['NODE-01', 'NODE-02', 'NODE-03', 'NODE-04', 'NODE-05'];

  // lobby:update { players: [{ node, ready, connected }] } -> light up node cards.
  function renderLobby(players) {
    const byNode = {};
    players.forEach((p) => { byNode[p.node] = p; });
    NODE_IDS.forEach((node) => {
      const card = document.querySelector(`.node-card[data-node="${node}"]`);
      if (!card) return;
      const p = byNode[node];
      const status = card.querySelector('.node-status');
      card.classList.toggle('is-connected', !!(p && p.connected));
      card.classList.toggle('is-ready', !!(p && p.connected && p.ready));
      card.classList.toggle('is-disconnected', !!(p && !p.connected));
      status.textContent = !p ? 'Offline' : !p.connected ? 'Signal lost' : p.ready ? 'Ready' : 'Connected';
    });
    const joined = players.length;
    document.getElementById('lobby-count').textContent = `${joined}/5`;
    const startBtn = document.getElementById('btn-start');
    startBtn.disabled = joined < NODE_IDS.length;
    document.getElementById('start-hint').textContent = joined < NODE_IDS.length
      ? `Waiting for ${NODE_IDS.length - joined} more node${NODE_IDS.length - joined === 1 ? '' : 's'}…`
      : 'All five nodes synchronised.';
  }

  socket.on('lobby:update', (payload) => renderLobby((payload && payload.players) || []));

  // START COUNCIL SESSION -> host:start
  const startBtn = document.getElementById('btn-start');
  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    socket.emit('host:start', {}, (res) => {
      if (!res || !res.ok) {
        startBtn.disabled = false;
        document.getElementById('start-hint').textContent = `Cannot start: ${(res && res.reason) || 'no response'}`;
      }
    });
  });

  // Which screen section each server phase shows.
  const PHASE_VIEWS = {
    LOBBY: 'view-lobby',
    INTRO: 'view-intro',
    ROLE_ASSIGN: 'view-roles',
    WORLD_REVEAL: 'view-world',
    END: 'view-end'
  };
  const PHASE_LABELS = {
    LOBBY: 'Lobby', INTRO: 'Transmission', ROLE_ASSIGN: 'Role assignment', CHAMBER: 'Council chamber',
    INCIDENT: 'Incident', INTEL: 'Intel drop', DEBATE: 'Debate', VOTE: 'Blind vote', RESOLUTION: 'Resolution',
    WORLD_REVEAL: 'World reveal', FINALE_WRITE: 'Write policy', FINALE_MOD: 'Loom moderation',
    FINALE_DEBATE: 'Finale debate', FINALE_RANK: 'Ranking', FINALE_ENACT: 'Enactment', END: 'Session end'
  };

  function showView(id) {
    document.querySelectorAll('#host-main > .view').forEach((v) => v.classList.toggle('is-active', v.id === id));
  }

  // phase { cycle, phase, endsAt, crisis } -> switch sections and update the top bar.
  function onPhase(payload) {
    state.phase = payload.phase;
    state.cycle = payload.cycle || 0;
    state.endsAt = payload.endsAt || null;
    showView(PHASE_VIEWS[payload.phase] || 'view-chamber');
    document.body.dataset.phase = payload.phase;
    document.getElementById('cycle-indicator').textContent = `CYCLE ${state.cycle}/5`;
    document.getElementById('phase-name').textContent = PHASE_LABELS[payload.phase] || payload.phase;
  }

  // CHAMBER reveal: colour the map at the baseline (W = 0.40, GDW 25%) unless
  // the server sent per-district wellbeing.
  const BASELINE_WELLBEING = 0.40;
  function revealChamber(payload) {
    const region = payload.region || {};
    const districts = (region.districts || []).map((d) => ({
      id: d.id,
      wellbeing: typeof d.wellbeing === 'number' ? d.wellbeing : BASELINE_WELLBEING
    }));
    const map = window.SocietelosMap;
    if (map) map.renderDistricts(districts.length ? districts : map.DISTRICT_IDS.map((id) => ({ id, wellbeing: BASELINE_WELLBEING })));
    const total = region.population || 250000;
    document.getElementById('citizens-online').textContent = `${total.toLocaleString('en-US')} CITIZENS ONLINE`;
  }

  socket.on('phase', onPhase);

  // One feed card: avatar badge (initials), name, age, district tag, message.
  function feedItemElement(item) {
    const name = item.name || item.citizenId || 'Citizen';
    const li = document.createElement('li');
    li.className = 'feed-item';
    if (item.district) li.dataset.district = item.district;
    if (item.sentiment) li.dataset.sentiment = item.sentiment;
    const avatar = document.createElement('span');
    avatar.className = 'feed-avatar mono';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const body = document.createElement('div');
    body.className = 'feed-body';
    const meta = document.createElement('p');
    meta.className = 'feed-meta';
    const who = document.createElement('span');
    who.className = 'feed-name';
    who.textContent = name;
    meta.appendChild(who);
    if (typeof item.age === 'number') {
      const age = document.createElement('span');
      age.className = 'feed-age muted';
      age.textContent = `, ${item.age}`;
      meta.appendChild(age);
    }
    if (item.district) {
      const tag = document.createElement('span');
      tag.className = 'feed-district mono';
      tag.textContent = item.district;
      meta.appendChild(tag);
    }
    const text = document.createElement('p');
    text.className = 'feed-text';
    text.textContent = item.text;
    body.append(meta, text);
    li.append(avatar, body);
    return li;
  }

  // Citizen feed (newest at the top, capped so the column never overflows).
  const FEED_MAX = 6;
  function resetFeed() {
    document.getElementById('citizen-feed').textContent = '';
  }
  function addFeedItem(item) {
    if (!item || !item.text) return;
    const list = document.getElementById('citizen-feed');
    list.prepend(feedItemElement(item));
    while (list.children.length > FEED_MAX) list.lastElementChild.remove();
  }

  // Incident banner: crisis title and the Loom's intro line.
  function renderIncident(payload) {
    const banner = document.getElementById('incident-banner');
    const crisis = payload.crisis;
    if (!crisis) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    document.getElementById('incident-cycle').textContent = `Cycle ${payload.cycle}`;
    document.getElementById('incident-title').textContent = crisis.title || '';
    document.getElementById('incident-subtitle').textContent = crisis.subtitle || '';
    document.getElementById('incident-text').textContent = crisis.incident || '';
    const loom = document.getElementById('incident-loom');
    loom.textContent = crisis.loomIntro ? `"${crisis.loomIntro}"` : '';
    loom.hidden = !crisis.loomIntro;
    banner.classList.toggle('is-alert', payload.phase === 'INCIDENT');
  }
  socket.on('phase', renderIncident);

  // Incident feed: the crisis's citizen posts scroll in one by one during
  // INCIDENT; the feed then stays up through the cycle.
  let feedCrisisId = null;
  let feedTimers = [];
  const FEED_STAGGER_MS = 1800;
  function clearFeedTimers() {
    feedTimers.forEach(clearTimeout);
    feedTimers = [];
  }
  function playIncidentFeed(payload) {
    const crisis = payload.crisis;
    if (!crisis) return;
    if (payload.phase !== 'INCIDENT' || crisis.id === feedCrisisId) return;
    feedCrisisId = crisis.id;
    clearFeedTimers();
    resetFeed();
    (crisis.feed || []).forEach((item, i) => {
      feedTimers.push(setTimeout(() => addFeedItem(item), 400 + i * FEED_STAGGER_MS));
    });
  }
  socket.on('phase', playIncidentFeed);

  // Policy comparison cards: shown from DEBATE through VOTE.
  let currentOptions = null;
  let currentForecasts = null;
  // Forecast preview badge (only when the server sends forecasts, i.e.
  // showForecastBeforeVote is on): end-of-cycle median and 90% band.
  function renderForecastBadge(key) {
    const el = document.getElementById(`policy-${key.toLowerCase()}-forecast`);
    const f = currentForecasts && currentForecasts[key];
    const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);
    const median = f && last(f.median);
    el.hidden = typeof median !== 'number';
    if (el.hidden) return;
    const lo = last(f.p5);
    const hi = last(f.p95);
    const risk = typeof f.pCollapse === 'number' && f.pCollapse > 0 ? ` · collapse ${Math.round(f.pCollapse * 100)}%` : '';
    el.textContent = `FORECAST ${median.toFixed(1)}% · ${lo.toFixed(0)}–${hi.toFixed(0)}%${risk}`;
    el.classList.toggle('is-down', median < (state.gdw || 25));
  }
  function renderPolicies(payload) {
    if (payload.options) currentOptions = payload.options;
    if (payload.phase === 'DEBATE') currentForecasts = payload.forecasts || null;
    if (payload.phase === 'INCIDENT' || payload.phase === 'CHAMBER') { currentOptions = null; currentForecasts = null; }
    const panel = document.getElementById('policy-panel');
    const show = !!currentOptions && ['DEBATE', 'VOTE'].includes(payload.phase);
    panel.hidden = !show;
    if (!show) return;
    for (const key of ['A', 'B']) {
      const o = currentOptions[key] || {};
      document.getElementById(`policy-${key.toLowerCase()}-name`).textContent = o.name || `Policy ${key}`;
      document.getElementById(`policy-${key.toLowerCase()}-text`).textContent = o.text || o.summary || '';
      renderForecastBadge(key);
    }
  }
  socket.on('phase', renderPolicies);

  // Debate: a giant countdown and the crisis's debate hook beside A vs B.
  const DEFAULT_HOOKS = [
    'Who benefits from each option, and who pays?',
    'Which option would you choose if you did not know your own district?'
  ];
  function renderDebate(payload) {
    const debating = payload.phase === 'DEBATE';
    document.getElementById('debate-panel').hidden = !debating;
    document.getElementById('incident-banner').classList.toggle('is-compact', ['DEBATE', 'VOTE', 'RESOLUTION'].includes(payload.phase));
    if (!debating) return;
    const crisis = payload.crisis || {};
    document.getElementById('debate-hook').textContent = crisis.debateHook || DEFAULT_HOOKS[(payload.cycle || 0) % DEFAULT_HOOKS.length];
  }
  socket.on('phase', renderDebate);

  // World reveal (10 s after Cycle 2): fullscreen takeover naming the world.
  function renderWorldReveal(world) {
    if (!world || !world.worldKey) return;
    document.getElementById('world-key').textContent = `WORLD ${world.worldKey}`;
    document.getElementById('world-name').textContent = world.name || world.worldKey;
    document.getElementById('world-tagline').textContent = world.tagline || '';
    document.getElementById('world-problem').textContent = (world.problemLeft || 'unknown').toUpperCase();
  }
  socket.on('phase', (payload) => { if (payload.phase === 'WORLD_REVEAL') renderWorldReveal(payload.world); });

  // world:reveal { worldKey, name, ... }: title the world and apply its colour
  // theme for the rest of the game (body.world-aa and body[data-world="AA"]).
  const WORLD_KEYS = ['AA', 'AB', 'BA', 'BB'];
  function applyWorldTheme(worldKey) {
    WORLD_KEYS.forEach((k) => document.body.classList.toggle(`world-${k.toLowerCase()}`, k === worldKey));
    if (WORLD_KEYS.includes(worldKey)) document.body.dataset.world = worldKey;
    else delete document.body.dataset.world;
    if (window.SocietelosMap && window.SocietelosMap.setWorld) window.SocietelosMap.setWorld(worldKey);
  }
  socket.on('world:reveal', (world) => {
    if (!world || !world.worldKey) return;
    state.worldKey = world.worldKey;
    renderWorldReveal(world);
    applyWorldTheme(world.worldKey);
  });
  // A new game (back in the lobby) drops the old world's theme.
  socket.on('phase', (payload) => { if (payload.phase === 'LOBBY' && state.worldKey) { state.worldKey = null; applyWorldTheme(null); } });

  // ---------------------------------------------------------------------------
  // Resolution: map | Loom commentary + forecast chart | citizen reactions.
  // ---------------------------------------------------------------------------
  function showResolutionPanel(payload) {
    const resolving = payload.phase === 'RESOLUTION';
    document.getElementById('resolution-panel').hidden = !resolving;
    if (resolving) {
      document.getElementById('resolution-policy').textContent = 'The Loom is simulating 12 months';
      document.getElementById('resolution-loom').textContent = '…';
    }
  }
  socket.on('phase', showResolutionPanel);

  // "LOOM FORECAST: XX% CHANCE OF STABILITY | P(UNREST): YY%": stability is
  // the share of the 500 forecast runs ending at or above the 15% unrest line.
  function renderForecastBanner(forecast) {
    const el = document.getElementById('forecast-banner');
    const pUnrest = forecast && typeof forecast.pUnrest === 'number' ? forecast.pUnrest : null;
    if (pUnrest === null) {
      el.textContent = 'LOOM FORECAST: --% CHANCE OF STABILITY | P(UNREST): --%';
      el.className = 'forecast-banner mono';
      return;
    }
    const stability = Math.round((1 - pUnrest) * 100);
    const unrest = Math.round(pUnrest * 100);
    el.textContent = `LOOM FORECAST: ${stability}% CHANCE OF STABILITY | P(UNREST): ${unrest}%`;
    el.className = `forecast-banner mono ${unrest >= 25 ? 'is-danger' : unrest >= 5 ? 'is-warn' : 'is-ok'}`;
  }

  // Called as the realized line reaches each month (1-12).
  const RESOLUTION_MONTH_MS = 1000; // 12 months play over 12 s
  function onResolutionMonth(month, gdw, payload) {
    state.resolutionMonth = month;
    if (window.SocietelosMap) window.SocietelosMap.showMonth(month);
  }

  function renderResolution(payload) {
    if (!payload || !payload.result) return;
    const r = payload.result;
    document.getElementById('resolution-policy').textContent = `Policy ${r.winner}: ${r.policy || ''}`;
    document.getElementById('resolution-loom').textContent = payload.loomLine ? `"${payload.loomLine}"` : '';
    // Reactions replace the incident posts and appear one by one, spread
    // across the 12 simulated months as they play out.
    clearFeedTimers();
    resetFeed();
    const messages = payload.messages || [];
    const span = RESOLUTION_MONTH_MS * 12;
    messages.forEach((m, i) => {
      const at = Math.round(((i + 0.5) / messages.length) * span);
      feedTimers.push(setTimeout(() => addFeedItem(m), at));
    });
    // The map replays the 12 months in step with the realized line.
    if (window.SocietelosMap) window.SocietelosMap.startPlayback(payload.districts || [], RESOLUTION_MONTH_MS, (payload.realized && payload.realized.shocks) || []);
    renderForecastBanner(payload.forecast);
    const charts = window.SocietelosCharts;
    if (charts) {
      // Fan first, then the realized line plays month by month over 12 s.
      charts.drawForecastFan(payload.forecast, document.getElementById('forecast-chart'));
      charts.animateRealizedLine(payload.realized, (month, gdw) => onResolutionMonth(month, gdw, payload), { durationMs: RESOLUTION_MONTH_MS * 12 });
    }
  }
  socket.on('resolution', renderResolution);

  // Vote pips: which nodes have locked in, never what they chose.
  function renderVotePips(voted) {
    const set = new Set(voted || []);
    document.querySelectorAll('.vote-pip').forEach((pip) => pip.classList.toggle('is-locked', set.has(pip.dataset.node)));
    document.getElementById('vote-count').textContent = `${set.size}/5`;
  }
  socket.on('phase', (payload) => {
    const voting = payload.phase === 'VOTE';
    document.getElementById('vote-status').hidden = !voting;
    if (voting) renderVotePips([]);
  });
  socket.on('vote:progress', (payload) => renderVotePips(payload && payload.voted));
  socket.on('phase', (payload) => { if (payload.phase === 'CHAMBER') revealChamber(payload); });

  // Countdown: recomputed every frame from the server's endsAt timestamp, so
  // the display never drifts from the authoritative server timer.
  const timerEl = document.getElementById('phase-timer');
  let lastShown = '';
  const LOW_TIME_MS = 5000;
  function formatClock(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  function tick() {
    const remaining = state.endsAt ? Math.max(0, state.endsAt - Date.now()) : null;
    const text = remaining === null ? '--:--' : formatClock(remaining);
    if (text !== lastShown) {
      timerEl.textContent = text;
      lastShown = text;
      // Giant debate clock mirrors the top-bar timer as m:ss.
      document.getElementById('debate-clock').textContent = remaining === null ? '--' : text.replace(/^0/, '');
    }
    document.getElementById('debate-clock').classList.toggle('is-low', remaining !== null && remaining > 0 && remaining < 10000);
    state.remainingMs = remaining;
    timerEl.classList.toggle('is-low', remaining !== null && remaining > 0 && remaining < LOW_TIME_MS);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------------------------------------------------------------------------
  // GDW meter: animated readout, stability label and progress bar.
  // ---------------------------------------------------------------------------
  const GDW_BANDS = [
    { max: 0, band: 'critical', label: 'SHUTDOWN' },
    { max: 15, band: 'critical', label: 'CRITICAL' },
    { max: 35, band: 'unstable', label: 'UNSTABLE' },
    { max: 60, band: 'stable', label: 'STABLE' },
    { max: 100, band: 'thriving', label: 'THRIVING' }
  ];
  function gdwBand(gdw) {
    return GDW_BANDS.find((b) => gdw <= b.max) || GDW_BANDS[GDW_BANDS.length - 1];
  }
  const gdwMeter = { shown: 25, target: 25, from: 25, start: 0, frame: null };
  const GDW_TWEEN_MS = 1200;
  function paintGdw(value) {
    const v = Math.max(0, Math.min(100, value));
    document.getElementById('gdw-readout').textContent = `${v.toFixed(1)}%`;
    document.getElementById('gdw-badge').textContent = `${Math.round(v)}%`;
  }
  function setGdw(gdw) {
    if (typeof gdw !== 'number' || !Number.isFinite(gdw)) return;
    const target = Math.max(0, Math.min(100, gdw));
    state.gdw = target;
    const band = gdwBand(target);
    const meter = document.getElementById('gdw-meter');
    meter.dataset.band = band.band;
    meter.setAttribute('aria-valuenow', target.toFixed(1));
    document.getElementById('gdw-status').textContent = band.label;
    document.getElementById('gdw-fill').style.width = `${target}%`;
    document.getElementById('gdw-badge').classList.toggle('is-critical', band.band === 'critical');
    gdwMeter.from = gdwMeter.shown;
    gdwMeter.target = target;
    gdwMeter.start = performance.now();
    if (gdwMeter.frame) cancelAnimationFrame(gdwMeter.frame);
    const step = (now) => {
      const t = Math.min(1, (now - gdwMeter.start) / GDW_TWEEN_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      gdwMeter.shown = gdwMeter.from + (gdwMeter.target - gdwMeter.from) * eased;
      paintGdw(gdwMeter.shown);
      gdwMeter.frame = t < 1 ? requestAnimationFrame(step) : null;
    };
    gdwMeter.frame = requestAnimationFrame(step);
  }
  setGdw(25);
  socket.on('resolution', (payload) => { if (payload) setGdw(payload.gdw); });

  // ---------------------------------------------------------------------------
  // Debug mock tester: drive layouts without a live backend, from the console.
  //   debugTriggerPhase('DEBATE')              -> fake phase with mock crisis
  //   debugTriggerPhase('CHAMBER', { seconds: 10 })
  //   debugTriggerEvent('lobby:update', { players: [...] })
  // ---------------------------------------------------------------------------
  const MOCK_CRISIS = {
    id: 'mock', title: 'Crisis 01: Who Owns the Loom?', subtitle: 'Economic Distribution',
    incident: 'Dividend riots are erupting across District 4 Eastworks.',
    loomIntro: 'I produce everything. Who should own me?',
    debateHook: 'When machines create all wealth, who should own them?',
    feed: [
      { citizenId: 'ruth', name: 'Ruth', age: 79, district: 'D4', text: 'We built these factories. Now the drones lock us out.', sentiment: 'outraged' },
      { citizenId: 'kai', name: 'Kai', age: 22, district: 'D2', text: 'just deliver my food on time', sentiment: 'complacent' }
    ]
  };
  const MOCK_OPTIONS = {
    A: { key: 'A', name: 'The Commons', text: 'The Loom becomes public property; every citizen gets an equal share.' },
    B: { key: 'B', name: 'The Charter', text: 'Owners keep title but pay a robot dividend to everyone.' }
  };

  function debugTriggerEvent(event, payload) {
    socket.listeners(event).forEach((fn) => fn(payload));
  }

  function debugTriggerPhase(phase, { seconds = 30, cycle = 1, ...extra } = {}) {
    const payload = {
      cycle: phase === 'LOBBY' || phase === 'INTRO' || phase === 'ROLE_ASSIGN' ? 0 : cycle,
      phase,
      endsAt: seconds ? Date.now() + seconds * 1000 : null,
      crisis: ['LOBBY', 'INTRO', 'ROLE_ASSIGN', 'CHAMBER'].includes(phase) ? null : MOCK_CRISIS,
      ...(phase === 'DEBATE' ? { options: MOCK_OPTIONS } : {}),
      ...(phase === 'CHAMBER' ? { region: { population: 250000, districts: [] } } : {}),
      ...extra
    };
    debugTriggerEvent('phase', payload);
    return payload;
  }

  window.debugTriggerPhase = debugTriggerPhase;
  window.debugTriggerEvent = debugTriggerEvent;

  window.SocietelosHost = { socket, state, fetchQR, renderLobby, onPhase, showView, revealChamber, setGdw, applyWorldTheme };
})();
