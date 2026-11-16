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

  // Policy comparison cards: shown from DEBATE through VOTE.
  let currentOptions = null;
  function renderPolicies(payload) {
    if (payload.options) currentOptions = payload.options;
    if (payload.phase === 'INCIDENT' || payload.phase === 'CHAMBER') currentOptions = null;
    const panel = document.getElementById('policy-panel');
    const show = !!currentOptions && ['DEBATE', 'VOTE', 'RESOLUTION'].includes(payload.phase);
    panel.hidden = !show;
    if (!show) return;
    for (const key of ['A', 'B']) {
      const o = currentOptions[key] || {};
      document.getElementById(`policy-${key.toLowerCase()}-name`).textContent = o.name || `Policy ${key}`;
      document.getElementById(`policy-${key.toLowerCase()}-text`).textContent = o.text || o.summary || '';
    }
  }
  socket.on('phase', renderPolicies);

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
    }
    state.remainingMs = remaining;
    timerEl.classList.toggle('is-low', remaining !== null && remaining > 0 && remaining < LOW_TIME_MS);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------------------------------------------------------------------------
  // Debug mock tester: drive layouts without a live backend, from the console.
  //   debugTriggerPhase('DEBATE')              -> fake phase with mock crisis
  //   debugTriggerPhase('CHAMBER', { seconds: 10 })
  //   debugTriggerEvent('lobby:update', { players: [...] })
  // ---------------------------------------------------------------------------
  const MOCK_CRISIS = {
    id: 'mock', title: 'Crisis 01: Who Owns the Loom?', subtitle: 'Economic Distribution',
    incident: 'Dividend riots are erupting across District 4 Eastworks.',
    loomIntro: 'I produce everything. Who should own me?'
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

  window.SocietelosHost = { socket, state, fetchQR, renderLobby, onPhase, showView, revealChamber };
})();
