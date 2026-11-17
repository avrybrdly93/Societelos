// Societelos — phone controller client.
// Phones only render server state and send inputs.
(function () {
  'use strict';

  // Session persistence: the assigned node id and private reconnect token are
  // kept in sessionStorage so a page refresh drops the phone back in its seat.
  const STORAGE_KEY = 'societelos.session';
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || null; } catch (e) { return null; }
  }
  function saveSession(session) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch (e) { /* storage unavailable */ }
  }
  function clearSession() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* storage unavailable */ }
  }

  const saved = loadSession();
  const requestedRoom = new URLSearchParams(window.location.search).get('room');
  // auth is a function so every (re)connect sends the latest saved token: a
  // phone that joined after page load keeps its seat across a network drop.
  // Socket.IO target: LOOM_CONFIG.socketUrl (the Render server when the
  // frontend is on Vercel), else the server that served this page, under
  // /the-loom when reverse-proxied at that subpath.
  const socketUrl = (window.LOOM_CONFIG && window.LOOM_CONFIG.socketUrl) || '';
  const basePath = window.location.pathname.startsWith('/the-loom') ? '/the-loom' : '';
  const socket = window.io(socketUrl || undefined, {
    path: socketUrl ? '/socket.io' : `${basePath}/socket.io`,
    auth: (cb) => {
      const current = loadSession();
      cb({ clientType: 'phone', token: (current && current.token) || undefined, roomCode: (current && current.roomCode) || requestedRoom || undefined });
    }
  });

  const state = { node: saved ? saved.node : null, roomCode: (saved && saved.roomCode) || requestedRoom || null, phase: 'LOBBY', cycle: 0, endsAt: null, role: null, spectator: false };

  // Brief drops (Wi-Fi blip, screen lock): show a top banner instead of
  // tearing down the screen. Socket.IO reconnects on its own; the server
  // then replays this seat's state (state:sync, role, phase, intel, ballot)
  // and the normal handlers repaint the active view.
  const reconnectBanner = document.getElementById('m-reconnect');
  let reconnectTimer = null;
  function setReconnecting(on) {
    clearTimeout(reconnectTimer);
    if (!on) {
      reconnectBanner.hidden = true;
      document.body.classList.remove('is-reconnecting');
      return;
    }
    // A short grace period so a sub-second blip never flashes the banner.
    reconnectTimer = setTimeout(() => {
      reconnectBanner.hidden = false;
      document.body.classList.add('is-reconnecting');
    }, 700);
  }
  socket.on('connect', () => { console.debug('[mobile] connected'); setReconnecting(false); });
  socket.on('disconnect', (reason) => {
    console.warn('[mobile] disconnected:', reason);
    if (reason !== 'io client disconnect') setReconnecting(true);
  });
  socket.io.on('reconnect_attempt', () => { if (!socket.connected) setReconnecting(true); });

  // A stale token (server restarted, new game) means starting from the join form.
  socket.on('session:invalid', () => {
    clearSession();
    state.node = null;
  });
  socket.on('session:resumed', (info) => {
    state.node = info.node;
    setNodeLabel(info.node);
    renderRole(info.role);
    onPhase({ phase: info.phase, cycle: info.cycle, endsAt: info.endsAt });
    state.roomCode = info.roomCode;
    const current = loadSession();
    saveSession({ node: info.node, token: (current && current.token) || (saved && saved.token), roomCode: info.roomCode });
  });

  // ---------------------------------------------------------------------------
  // Screen lock / wake resilience: students look up at the projector for the
  // 90 s debate. Ask for a Screen Wake Lock while seated (where supported),
  // and when the page becomes visible again re-acquire it, reconnect if the
  // socket dropped, and re-sync state with the server.
  // ---------------------------------------------------------------------------
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible' || !state.node) return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { wakeLock = null; /* denied, low battery or unsupported */ }
  }
  function resyncAfterWake() {
    if (document.visibilityState !== 'visible') return;
    requestWakeLock();
    if (!socket.connected) {
      socket.connect(); // the handshake carries the token; the server resumes the seat
      return;
    }
    const current = loadSession();
    if (current && current.token) socket.emit('session:resume', { token: current.token });
  }
  document.addEventListener('visibilitychange', resyncAfterWake);
  window.addEventListener('pageshow', resyncAfterWake);
  // Wake locks need a user gesture on some browsers: retry on the first taps.
  document.addEventListener('click', requestWakeLock);

  // Screen switching.
  function showView(id) {
    document.querySelectorAll('#m-main > .m-view').forEach((v) => v.classList.toggle('is-active', v.id === id));
  }

  function setNodeLabel(node) {
    document.getElementById('m-node-label').textContent = node || 'NOT CONNECTED';
    document.getElementById('wait-node').textContent = node || 'NODE-0?';
    document.getElementById('intel-node').textContent = node || 'NODE-0?';
  }

  // Join form -> lobby:join { name }
  const JOIN_ERRORS = {
    ROOM_FULL: 'The council is full. All five nodes are taken.',
    NO_ROOM: 'No council session found. Is the projector open?',
    GAME_IN_PROGRESS: 'A session is already running.',
    BAD_PAYLOAD: 'Enter a name (up to 24 characters).'
  };
  const joinForm = document.getElementById('join-form');
  const joinError = document.getElementById('join-error');
  const joinSubmit = document.getElementById('join-submit');
  const spectateSubmit = document.getElementById('spectate-submit');
  const PHASE_NAMES = { LOBBY: 'LOBBY', INTRO: 'TRANSMISSION', ROLE_ASSIGN: 'ROLE ASSIGNMENT', CHAMBER: 'COUNCIL CHAMBER', INCIDENT: 'CRISIS', INTEL: 'INTEL DROP', DEBATE: 'DEBATE', VOTE: 'VOTE', RESOLUTION: 'RESOLUTION', FINALE_WRITE: 'FINALE WRITING', FINALE_MOD: 'POLICY REVIEW', FINALE_DEBATE: 'FINALE DEBATE', FINALE_RANK: 'RANKING', FINALE_ENACT: 'COUNCIL PACKAGE', END: 'SESSION COMPLETE' };
  function updateSpectator(payload = {}) {
    const phase = payload.phase || state.phase || 'LOBBY';
    document.getElementById('spectator-phase').textContent = `CURRENT PHASE: ${PHASE_NAMES[phase] || phase}`;
    document.getElementById('spectator-cycle').textContent = payload.cycle ? `CYCLE ${payload.cycle} / 5` : 'Waiting for the projector.';
  }
  spectateSubmit.addEventListener('click', () => {
    spectateSubmit.disabled = true;
    socket.emit('spectate:join', { room: state.roomCode || undefined }, (res) => {
      spectateSubmit.disabled = false;
      if (res && res.ok) {
        state.roomCode = res.roomCode;
        state.spectator = true;
        updateSpectator(res);
        showView('m-view-spectator');
      } else {
        joinError.textContent = JOIN_ERRORS[res && res.reason] || 'Could not open spectator mode.';
        joinError.hidden = false;
      }
    });
  });
  socket.on('spectate:joined', (payload) => { state.spectator = true; updateSpectator(payload); showView('m-view-spectator'); });
  socket.on('spectate:error', () => {
    joinError.textContent = 'No council session is available to watch.';
    joinError.hidden = false;
  });
  socket.on('phase', (payload) => updateSpectator(payload));
  socket.on('game:end', () => updateSpectator({ phase: 'END', cycle: state.cycle }));
  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.getElementById('join-name').value.trim();
    if (!name || joinSubmit.disabled) return; // Enter + tap can't double-submit
    joinSubmit.disabled = true;
    joinError.hidden = true;
    // Never leave the button dead if the server never answers.
    const retry = setTimeout(() => { joinSubmit.disabled = false; }, 8000);
    socket.emit('lobby:join', { name, room: state.roomCode || undefined }, (res) => {
      clearTimeout(retry);
      joinSubmit.disabled = false;
      if (!res || !res.ok) {
        joinError.textContent = JOIN_ERRORS[res && res.reason] || 'Connection refused. Try again.';
        joinError.hidden = false;
        spectateSubmit.hidden = !(res && ['ROOM_FULL', 'GAME_IN_PROGRESS'].includes(res.reason));
        return;
      }
      state.node = res.node;
      state.roomCode = res.roomCode;
      saveSession({ node: res.node, token: res.token, roomCode: res.roomCode });
      setNodeLabel(res.node);
      showView('m-view-wait');
    });
  });

  // lobby:update -> confirm our NODE label in the header and show how many
  // nodes have joined while we wait.
  socket.on('lobby:update', (payload) => {
    const players = (payload && payload.players) || [];
    const me = players.find((p) => p.node === state.node);
    if (me) setNodeLabel(me.node);
    else if (state.phase === 'LOBBY' && state.node) {
      state.node = null;
      clearSession();
      setNodeLabel(null);
      showView('m-view-join');
    }
    const status = document.getElementById('wait-status');
    if (status && state.phase === 'LOBBY') {
      status.textContent = players.length >= 5
        ? 'All five nodes connected. Waiting for the projector…'
        : `${players.length}/5 nodes connected. Waiting for the council to assemble…`;
    }
  });

  // role:assigned { role } -> fill the secret role card and the agenda drawer.
  function renderRole(role) {
    if (!role) return;
    state.role = role;
    const roleIcon = document.getElementById('role-icon');
    roleIcon.textContent = '';
    const iconPaths = { artisan: 'M4 20h16M7 17l8-8m-4-4 5 5-2 2-5-5z', lotus: 'M12 20c-5-2-8-6-8-10 4 0 7 3 8 7 1-4 4-7 8-7 0 4-3 8-8 10zM12 17V5m0 0L9 8m3-3 3 3', assimilator: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l3 3m6 6 3 3m0-12-3 3m-6 6-3 3M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0z', ghost: 'M12 21c-5-3-8-7-8-12a8 8 0 0 1 16 0c0 5-3 9-8 12zM12 8v8m-3-5 3-3 3 3', catalyst: 'M13 2 5 13h6l-1 9 9-12h-6z' };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', iconPaths[role.key] || iconPaths.catalyst);
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.7'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path); roleIcon.appendChild(svg);
    document.getElementById('role-card').dataset.role = role.key || '';
    document.getElementById('role-title').textContent = role.name || 'Unknown role';
    document.getElementById('role-flavor').textContent = role.cardText || '';
    document.getElementById('role-goal').textContent = role.goal || '';
    document.getElementById('role-win').textContent = role.winCondition || '';
    document.getElementById('drawer-role-name').textContent = role.name || '';
    document.getElementById('drawer-goal').textContent = role.goal || '';
    document.getElementById('drawer-win').textContent = role.winCondition || '';
    document.getElementById('role-drawer').hidden = false;
  }

  socket.on('role:assigned', (payload) => {
    renderRole(payload && payload.role);
    showView('m-view-role');
  });

  // phase -> switch phone screens in lockstep with the server state machine.
  // Phases without a phone screen show the waiting view with a status line.
  const PHASE_SCREENS = {
    ROLE_ASSIGN: 'm-view-role',
    INTEL: 'm-view-intel',
    DEBATE: 'm-view-debate',
    VOTE: 'm-view-vote',
    RESOLUTION: 'm-view-result',
    WORLD_REVEAL: 'm-view-world',
    FINALE_WRITE: 'm-view-finale-write',
    FINALE_MOD: 'm-view-finale-wait',
    FINALE_RANK: 'm-view-finale-rank',
    END: 'm-view-end'
  };
  const WAIT_MESSAGES = {
    LOBBY: 'Waiting for the council to assemble…',
    INTRO: 'Incoming transmission. Watch the projector.',
    CHAMBER: 'The region is coming online. Watch the projector.',
    INCIDENT: 'A crisis is unfolding. Watch the projector.',
    RESOLUTION: 'The Loom is simulating your decision. Watch the projector.',
    WORLD_REVEAL: 'Your world is taking shape. Watch the projector.',
    FINALE_WRITE: 'Finale in progress. Watch the projector.',
    FINALE_MOD: 'The Loom is reviewing policies…',
    FINALE_DEBATE: 'Debate the policies on the projector.',
    FINALE_RANK: 'Ranking in progress…',
    FINALE_ENACT: 'The Loom is enacting your policies. Watch the projector.',
    END: 'Session complete. Look at the projector.'
  };

  let debateReadyTimer = null;
  function handleDebateReady(phase) {
    const btn = document.getElementById('btn-debate-ready');
    const status = document.getElementById('debate-ready-status');
    if (debateReadyTimer) {
      clearTimeout(debateReadyTimer);
      debateReadyTimer = null;
    }
    if (btn) {
      btn.hidden = true;
      btn.disabled = false;
      btn.classList.remove('is-ready');
      btn.textContent = 'READY TO VOTE';
    }
    if (status) status.hidden = true;
    if (phase !== 'DEBATE') return;

    const isFast = (state.endsAt && (state.endsAt - Date.now()) < 5000);
    const delay = isFast ? 20 : 5000;
    debateReadyTimer = setTimeout(() => {
      if (state.phase === 'DEBATE' && btn) {
        btn.hidden = false;
      }
    }, delay);
  }

  function onPhase(payload) {
    if (!payload || !payload.phase) return;
    const previousPhase = state.phase;
    if (previousPhase === 'END' && payload.phase === 'LOBBY') {
      state.score = 0;
      state.endData = null;
      state.lastVote = null;
      state.voteLockedCycle = null;
      state.overrideUsed = false;
      state.finaleSubmitted = null;
      state.finaleCycle = null;
      state.sync = null;
      document.getElementById('role-drawer').hidden = true;
      document.getElementById('intel-drawer').hidden = true;
      document.getElementById('shield-role').checked = false;
      document.getElementById('shield-intel').checked = false;
      resetResult(0);
      document.getElementById('result-gdw').textContent = '--%';
      document.getElementById('result-gdw-delta').textContent = '';
      document.getElementById('result-total').textContent = '';
      document.getElementById('end-score').textContent = '—';
      document.getElementById('end-breakdown').textContent = '';
    }
    state.phase = payload.phase;
    state.cycle = payload.cycle || 0;
    state.endsAt = payload.endsAt || null;
    state.sessionEndsAt = payload.sessionEndsAt || null;
    state.sessionTimerEnabled = !!payload.sessionTimerEnabled;
    document.body.dataset.phase = payload.phase;
    if (state.spectator) { updateSpectator(payload); return showView('m-view-spectator'); }
    handleDebateReady(payload.phase);
    if (!state.node) return showView('m-view-join');
    const screen = PHASE_SCREENS[payload.phase];
    if (screen) return showView(screen);
    document.getElementById('wait-status').textContent = WAIT_MESSAGES[payload.phase] || 'Stand by.';
    return showView('m-view-wait');
  }

  const btnDebateReady = document.getElementById('btn-debate-ready');
  if (btnDebateReady) {
    btnDebateReady.addEventListener('click', () => {
      btnDebateReady.disabled = true;
      btnDebateReady.classList.add('is-ready');
      btnDebateReady.textContent = '✓ READY TO VOTE';
      const status = document.getElementById('debate-ready-status');
      if (status) {
        status.hidden = false;
        status.textContent = 'Waiting for council to be ready…';
      }
      socket.emit('debate:ready', { ready: true });
    });
  }

  socket.on('debate:progress', (payload) => {
    const status = document.getElementById('debate-ready-status');
    if (status && payload && typeof payload.count === 'number') {
      status.hidden = false;
      status.textContent = `Council readiness: ${payload.count}/${payload.total || 5} ready`;
    }
  });

  socket.on('phase', onPhase);

  // Cycle 5 fallback: if Gemini fails during moderation the server sends the
  // write-in crisis through DEBATE with authored A/B options. The phone has
  // already switched to the debate screen (PHASE_SCREENS); explain why.
  // The server reports the crisis as "binary" once it falls back, so a cycle
  // that went through FINALE_WRITE / FINALE_MOD and then reaches DEBATE is it.
  let writeinCycle = null;
  socket.on('phase', (payload) => {
    if (!payload) return;
    if (['LOBBY', 'INCIDENT'].includes(payload.phase)) writeinCycle = null;
    if (['FINALE_WRITE', 'FINALE_MOD'].includes(payload.phase)) writeinCycle = payload.cycle;
    const fallback = writeinCycle !== null && payload.cycle === writeinCycle && ['DEBATE', 'VOTE'].includes(payload.phase);
    document.getElementById('m-finale-fallback').hidden = !(fallback && payload.phase === 'DEBATE');
  });

  // Subtle haptics (Android Chrome; silently ignored where unsupported, e.g. iOS).
  function buzz(pattern = 50) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) { /* not allowed before a user gesture on some browsers */ }
  }
  // Audio-free cue: the screen edges pulse when the in-person debate ends and
  // the blind vote opens on the phone.
  let previousPhase = null;
  socket.on('phase', (payload) => {
    if (!payload) return;
    if (payload.phase === 'VOTE' && previousPhase !== 'VOTE') {
      document.body.classList.remove('edge-pulse');
      void document.body.offsetWidth; // restart the animation
      document.body.classList.add('edge-pulse');
      setTimeout(() => document.body.classList.remove('edge-pulse'), 2600);
    }
    previousPhase = payload.phase;
  });
  let lastBuzzPhase = null;
  socket.on('phase', (payload) => {
    if (!payload || !state.node || payload.phase === lastBuzzPhase) return;
    lastBuzzPhase = payload.phase;
    buzz(payload.phase === 'VOTE' ? [60, 60, 60] : 50);
  });

  // Countdown bar (and the debate clock), recomputed each frame from the
  // server's endsAt so every phone stays in step with the projector.
  const countdownFill = document.getElementById('m-countdown-fill');
  const debateClock = document.getElementById('debate-clock');
  let phaseDurationMs = 0;
  let durationFor = null;
  // Finale timer bars (write screen, resubmit modal): a thick bar and the
  // seconds left, from the same endsAt as the header countdown. Amber under
  // 15 s, crimson under 5 s.
  const finaleTimers = Array.from(document.querySelectorAll('.finale-timer'));
  function renderFinaleTimers(fraction, secs, remaining) {
    const on = !!state.endsAt;
    finaleTimers.forEach((el) => {
      el.querySelector('.finale-timer-fill').style.transform = `scaleX(${on ? fraction.toFixed(4) : 0})`;
      const secsEl = el.querySelector('.finale-timer-secs');
      const secsText = on ? String(secs) : '--';
      if (secsEl.textContent !== secsText) secsEl.textContent = secsText;
      el.classList.toggle('is-warn', on && remaining > 0 && remaining < 15000);
      el.classList.toggle('is-low', on && remaining > 0 && remaining < 5000);
    });
  }
  function tick() {
    const remaining = state.endsAt ? Math.max(0, state.endsAt - Date.now()) : 0;
    if (durationFor !== state.endsAt) {
      // New phase: its full length is whatever was left when it arrived.
      durationFor = state.endsAt;
      phaseDurationMs = remaining;
    }
    const fraction = phaseDurationMs > 0 ? remaining / phaseDurationMs : 0;
    countdownFill.style.transform = `scaleX(${fraction.toFixed(4)})`;
    const secs = Math.ceil(remaining / 1000);
    // Text is written only when it changes (a same-value write still forces
    // a layout every frame on the phone).
    const clockText = state.endsAt ? `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}` : '--:--';
    if (debateClock.textContent !== clockText) debateClock.textContent = clockText;
    state.remainingMs = remaining;
    const low = !!state.endsAt && remaining > 0 && remaining < 5000;
    countdownFill.classList.toggle('is-low', low);
    debateClock.classList.toggle('is-low', low);
    renderFinaleTimers(fraction, secs, remaining);

    const mSessionTimer = document.getElementById('m-session-timer');
    if (mSessionTimer) {
      if (state.sessionTimerEnabled && state.sessionEndsAt) {
        mSessionTimer.hidden = false;
        const sRem = Math.max(0, state.sessionEndsAt - Date.now());
        const sSecs = Math.ceil(sRem / 1000);
        const sessionText = `⚡ ${String(Math.floor(sSecs / 60)).padStart(2, '0')}:${String(sSecs % 60).padStart(2, '0')}`;
        if (mSessionTimer.textContent !== sessionText) mSessionTimer.textContent = sessionText;
        mSessionTimer.classList.toggle('is-low', sRem > 0 && sRem < 30000);
      } else {
        mSessionTimer.hidden = true;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // intel:drop { text } -> this player's role-slanted research snippet.
  socket.on('intel:drop', (payload) => {
    const text = (payload && payload.text) || 'No intel received.';
    document.getElementById('intel-text').textContent = text;
    document.getElementById('intel-ref').textContent = `REF C${state.cycle || 0}-${(state.node || 'NODE-00').slice(-2)}`;
    document.getElementById('shield-intel').checked = false;
    // Keep it in the intel drawer for DEBATE and VOTE.
    document.getElementById('intel-drawer-text').textContent = text;
    document.getElementById('intel-drawer-ref').textContent = `CYCLE ${state.cycle || 0}`;
  });

  // The intel drawer is available from DEBATE through VOTE of the cycle it
  // belongs to; a new INCIDENT clears it.
  socket.on('phase', (payload) => {
    if (!payload) return;
    const drawer = document.getElementById('intel-drawer');
    if (payload.phase === 'INCIDENT') {
      document.getElementById('intel-drawer-text').textContent = '';
      drawer.open = false;
    }
    const hasIntel = !!document.getElementById('intel-drawer-text').textContent;
    drawer.hidden = !(hasIntel && ['DEBATE', 'VOTE'].includes(payload.phase));
    if (drawer.hidden) drawer.open = false;
  });

  // Policy names arrive with the DEBATE phase; label the vote buttons with them.
  socket.on('phase', (payload) => {
    if (payload && payload.options) {
      const { A, B } = payload.options;
      if (A) {
        document.getElementById('vote-a-name').textContent = A.name || 'Policy A';
        document.getElementById('vote-a-text').textContent = A.text || A.summary || '';
      }
      if (B) {
        document.getElementById('vote-b-name').textContent = B.name || 'Policy B';
        document.getElementById('vote-b-text').textContent = B.text || B.summary || '';
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Resolution: did my policy win, current GDW, and my private score update.
  // ---------------------------------------------------------------------------
  function resetResult(cycle) {
    document.getElementById('result-cycle').textContent = cycle || state.cycle || 1;
    document.getElementById('result-outcome').textContent = 'THE LOOM IS SIMULATING…';
    document.getElementById('result-policy').textContent = '—';
    document.getElementById('result-yours').textContent = '';
    document.getElementById('result-card').className = 'result-card';
    document.getElementById('result-score').hidden = true;
  }
  socket.on('phase', (payload) => { if (payload && payload.phase === 'RESOLUTION') resetResult(payload.cycle); });
  socket.on('resolution', (payload) => {
    if (!payload || !payload.result) return;
    const r = payload.result;
    const mine = state.lastVote && state.lastVote.cycle === r.cycle ? state.lastVote.choice : null;
    const card = document.getElementById('result-card');
    document.getElementById('result-cycle').textContent = r.cycle;
    document.getElementById('result-policy').textContent = `Policy ${r.winner}: ${r.policy || ''}`;
    if (!mine) {
      document.getElementById('result-outcome').textContent = 'YOU ABSTAINED';
      card.className = 'result-card is-neutral';
    } else {
      const won = mine === r.winner;
      document.getElementById('result-outcome').textContent = won ? 'YOUR POLICY WON' : 'YOUR POLICY LOST';
      document.getElementById('result-yours').textContent = `You voted ${mine}.${r.tie ? ' Tied vote: the Loom chose.' : ''}`;
      card.className = `result-card ${won ? 'is-won' : 'is-lost'}`;
    }
    const gdw = typeof payload.gdw === 'number' ? payload.gdw : null;
    document.getElementById('result-gdw').textContent = gdw === null ? '--%' : `${gdw.toFixed(1)}%`;
    const delta = typeof r.gdwDelta === 'number' ? r.gdwDelta : null;
    const deltaEl = document.getElementById('result-gdw-delta');
    deltaEl.textContent = delta === null ? '' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
    deltaEl.className = `result-gdw-delta mono ${delta < 0 ? 'is-down' : 'is-up'}`;
  });
  // score:update { cycle, gained, total } arrives privately with the resolution.
  socket.on('score:update', (payload) => {
    if (!payload) return;
    state.score = payload.total;
    const el = document.getElementById('result-score');
    el.hidden = !(payload.gained > 0);
    el.textContent = `+${payload.gained} AGENDA POINT${payload.gained === 1 ? '' : 'S'}`;
    document.getElementById('result-total').textContent = `Your agenda score: ${payload.total}`;
  });

  // ---------------------------------------------------------------------------
  // End Screen (game:end): this phone's final score, whether it won (or the
  // Loom shut down), its cycle-by-cycle points and the class grade. Only this
  // node's row is shown; the projector reveals everyone.
  // ---------------------------------------------------------------------------
  const GRADE_LABELS = { SHUTDOWN: 'SHUTDOWN', Fragile: 'FRAGILE', Stable: 'STABLE', Thriving: 'THRIVING' };

  function renderEnd(data) {
    if (!data) return;
    state.endData = data;
    const me = (data.roles || []).find((r) => r.node === state.node) || null;
    const winners = data.winner || [];
    const won = !data.shutdown && winners.includes(state.node);
    const card = document.getElementById('end-card');
    card.classList.toggle('is-won', won);
    card.classList.toggle('is-lost', !!data.shutdown);
    card.classList.toggle('is-shared', won && winners.length > 1);
    document.getElementById('end-node').textContent = state.node || 'NODE';
    const outcome = document.getElementById('end-outcome');
    const headline = document.getElementById('end-headline');
    if (data.shutdown) {
      outcome.textContent = 'THE LOOM HAS SHUT DOWN';
      headline.textContent = 'SYSTEM COLLAPSE — ALL AGENDAS FAILED';
    } else if (won) {
      outcome.textContent = winners.length > 1 ? 'SHARED VICTORY' : 'YOU WON';
      headline.textContent = winners.length > 1 ? `You share the win with ${winners.length - 1} other${winners.length > 2 ? 's' : ''}.` : 'Your agenda shaped the future.';
    } else {
      outcome.textContent = 'NOT THIS TIME';
      headline.textContent = 'Another agenda shaped the future.';
    }
    document.getElementById('end-role').textContent = me && me.role ? `You were ${me.role.name || me.role.key}.` : '';
    document.getElementById('end-score').textContent = me ? String(me.total) : '—';
    const list = document.getElementById('end-breakdown');
    list.textContent = '';
    for (const c of (me && me.perCycle) || []) {
      const li = document.createElement('li');
      const parts = [];
      if (c.role) parts.push(`+${c.role} role`);
      if (c.catalyst) parts.push(`+${c.catalyst} catalyst`);
      if (c.author) parts.push(`+${c.author} author`);
      const gained = (c.role || 0) + (c.catalyst || 0) + (c.author || 0);
      li.className = gained ? 'is-scored' : '';
      li.textContent = `CYCLE ${c.cycle}: ${parts.length ? parts.join(', ') : '0'}`;
      list.appendChild(li);
    }
    const grade = document.getElementById('end-grade');
    grade.textContent = GRADE_LABELS[data.grade] || data.grade || '—';
    grade.dataset.grade = data.grade || '';
    document.getElementById('end-gdw').textContent = typeof data.finalGdw === 'number' ? `GDW ${data.finalGdw.toFixed(1)}%` : '';
    document.getElementById('end-world').textContent = data.worldName ? `World reached: ${data.worldName}.` : '';
  }
  socket.on('game:end', renderEnd);

  // ---------------------------------------------------------------------------
  // World reveal card: the world the first two votes built and what changes.
  // ---------------------------------------------------------------------------
  const WORLD_IMPACT = {
    AA: ['Wealth and power are shared. The next crises are about meaning when nobody has to work.', 'The Assembly made society volatile: outcomes swing harder for the rest of the game.'],
    AB: ['Wealth is shared but the Loom governs. The next crises are about dependence on the machine.', 'Delegated control keeps things calm and predictable.'],
    BA: ['Owners kept the wealth; the masses kept the vote. The next crises are about class conflict.', 'The Assembly made society volatile: outcomes swing harder for the rest of the game.'],
    BB: ['Owners rule and everyone else lives on stipends. The next crises are about pacification.', 'Delegated control keeps things calm and predictable.']
  };
  function renderWorldCard(world) {
    if (!world || !world.worldKey) return;
    state.worldKey = world.worldKey;
    document.body.dataset.world = world.worldKey;
    document.getElementById('m-world-key').textContent = `WORLD ${world.worldKey}`;
    document.getElementById('m-world-name').textContent = world.name || world.worldKey;
    document.getElementById('m-world-tagline').textContent = world.tagline || '';
    const list = document.getElementById('m-world-impact');
    list.textContent = '';
    const lines = (WORLD_IMPACT[world.worldKey] || []).slice();
    if (world.problemLeft) lines.push(`Problem left unsolved: ${world.problemLeft}. Your agenda still scores the same way.`);
    lines.forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
  }
  socket.on('world:reveal', renderWorldCard);
  socket.on('phase', (payload) => { if (payload && payload.phase === 'WORLD_REVEAL') renderWorldCard(payload.world); });

  // ---------------------------------------------------------------------------
  // Finale write-in: one policy, up to 140 characters -> finale:submit { text }.
  // ---------------------------------------------------------------------------
  const finaleForm = document.getElementById('finale-form');
  const finaleText = document.getElementById('finale-text');
  const finaleSubmit = document.getElementById('finale-submit');
  const finaleError = document.getElementById('finale-error');
  // Live "n / 140" counter; the submit button stays disabled while empty.
  const finaleCount = document.getElementById('finale-count');
  function updateFinaleCount() {
    const n = finaleText.value.length;
    finaleCount.textContent = `${n} / 140`;
    finaleCount.classList.toggle('is-near', n >= 120);
    if (!finaleSubmit.dataset.busy) finaleSubmit.disabled = !finaleText.value.trim();
  }
  finaleText.addEventListener('input', updateFinaleCount);

  finaleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = finaleText.value.trim();
    if (!text) {
      finaleError.textContent = 'Write a policy first: the Loom cannot enact silence.';
      finaleError.hidden = false;
      return;
    }
    if (finaleSubmit.dataset.busy) return;
    finaleSubmit.dataset.busy = '1';
    finaleSubmit.disabled = true;
    finaleError.hidden = true;
    socket.emit('finale:submit', { text }, (res) => {
      delete finaleSubmit.dataset.busy;
      updateFinaleCount();
      if (res && res.ok) {
        state.finaleSubmitted = res.text || text;
        dismissKeyboard();
        showFinaleWait();
        return;
      }
      finaleError.textContent = 'The Loom did not accept that. Try again.';
      finaleError.hidden = false;
    });
  });
  // After a policy is sent, close the on-screen keyboard and put the
  // viewport back at the top. iOS Safari leaves the page scrolled (and the
  // visual viewport offset) after the keyboard closes; Android Chrome can
  // leave the layout shrunk for a frame, so scroll again once it settles.
  function dismissKeyboard() {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function' && /^(TEXTAREA|INPUT)$/.test(el.tagName)) el.blur();
    const toTop = () => {
      window.scrollTo(0, 0);
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    };
    toTop();
    requestAnimationFrame(toTop);
    setTimeout(toTop, 300);
  }
  // "THE LOOM IS EVALUATING YOUR POLICY..." with the player's own text.
  function showFinaleWait(status) {
    // (After a refresh the phone knows only that it submitted, not the text.)
    document.getElementById('finale-wait-mine').textContent = typeof state.finaleSubmitted === 'string' && state.finaleSubmitted ? `"${state.finaleSubmitted}"` : '';
    document.getElementById('finale-wait-status').textContent = status || (state.phase === 'FINALE_MOD'
      ? 'Cleaning language. Translating intent into numbers.'
      : 'Submitted. Waiting for the other council members.');
    showView('m-view-finale-wait');
  }
  // Revise modal: shows the Loom's private feedback and allows one resubmit
  // (finale:submit during FINALE_MOD's 25 s window).
  const reviseBox = document.getElementById('finale-revise');
  const reviseForm = document.getElementById('finale-revise-form');
  const reviseText = document.getElementById('finale-revise-text');
  const reviseSubmit = document.getElementById('finale-revise-submit');
  const reviseError = document.getElementById('finale-revise-error');
  function openRevise(feedback) {
    document.getElementById('finale-feedback').textContent = feedback || 'Please rephrase your policy.';
    reviseText.value = state.finaleSubmitted || '';
    reviseSubmit.disabled = false;
    reviseError.hidden = true;
    reviseBox.hidden = false;
    showView('m-view-finale-wait');
    reviseText.focus();
  }
  function closeRevise() { reviseBox.hidden = true; }
  reviseForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = reviseText.value.trim();
    if (!text || reviseSubmit.disabled) return;
    reviseSubmit.disabled = true; // one chance only
    socket.emit('finale:submit', { text }, (res) => {
      if (res && res.ok) {
        state.finaleSubmitted = res.text || text;
        dismissKeyboard();
        closeRevise();
        showFinaleWait('Revision received. The Loom is evaluating it again.');
        return;
      }
      reviseError.textContent = res && res.reason === 'ALREADY_RESUBMITTED' ? 'You have already used your one revision.' : 'The revision window has closed.';
      reviseError.hidden = false;
    });
  });
  socket.on('phase', (payload) => { if (payload && payload.phase !== 'FINALE_MOD') closeRevise(); });

  // finale:feedback { status, feedback } (private): ok -> accepted; revise ->
  // the resubmit modal; reject -> a standard protocol policy was substituted.
  socket.on('finale:feedback', (payload) => {
    if (!payload) return;
    if (payload.status === 'revise') return openRevise(payload.feedback);
    closeRevise();
    const title = document.getElementById('finale-wait-title');
    if (payload.status === 'ok') {
      title.textContent = 'POLICY ACCEPTED BY THE LOOM';
      showFinaleWait('It goes before the council next, anonymously.');
    } else if (payload.status === 'reject') {
      title.textContent = 'POLICY NOT ACCEPTED';
      showFinaleWait(payload.feedback || 'A standard protocol policy was substituted for yours.');
    }
    return undefined;
  });
  // A new finale write resets the waiting title.
  socket.on('phase', (payload) => {
    if (payload && payload.phase === 'FINALE_WRITE') document.getElementById('finale-wait-title').textContent = 'THE LOOM IS EVALUATING YOUR POLICY...';
  });

  socket.on('phase', (payload) => {
    if (!payload) return;
    // Already submitted when FINALE_WRITE is (re)broadcast: stay on the wait screen.
    if (payload.phase === 'FINALE_WRITE' && state.finaleSubmitted && state.finaleCycle === payload.cycle) showFinaleWait();
    if (payload.phase === 'FINALE_MOD') showFinaleWait();
  });
  socket.on('phase', (payload) => {
    if (payload && payload.phase === 'FINALE_WRITE' && state.finaleCycle !== payload.cycle) {
      state.finaleCycle = payload.cycle;
      state.finaleSubmitted = null;
      finaleText.value = '';
      finaleError.hidden = true;
      delete finaleSubmit.dataset.busy;
      updateFinaleCount();
    }
    // Secret agenda reminder above the textarea, so the policy serves it.
    if (payload && payload.phase === 'FINALE_WRITE') {
      const goal = state.role && (state.role.goal || state.role.winCondition);
      document.getElementById('finale-goal').hidden = !goal;
      document.getElementById('finale-goal-text').textContent = goal ? `${state.role.name}: ${state.role.goal}` : '';
    }
  });

  // ---------------------------------------------------------------------------
  // Finale ballot: finale:ballot { policies: [{ id, text }] x4 } (own hidden).
  // ---------------------------------------------------------------------------
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  const proposalName = (id) => `PROPOSAL ${ROMAN[Number(String(id).replace(/\D+/g, '')) - 1] || id}`;
  const ballot = { policies: [], order: [] };
  function renderBallot() {
    const list = document.getElementById('rank-cards');
    list.textContent = '';
    ballot.policies.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'rank-card';
      li.dataset.policy = p.id;
      const head = document.createElement('p');
      head.className = 'rank-name mono';
      head.textContent = proposalName(p.id);
      const text = document.createElement('p');
      text.className = 'rank-text';
      text.textContent = p.text;
      li.append(head, text);
      // Tap-to-rank: tapping an unranked card gives it the next free place
      // (1st, 2nd, ...); tapping a ranked card unranks just that card and the
      // places after it shift up (3rd -> 2nd, 4th -> 3rd).
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      li.addEventListener('click', () => toggleRank(p.id));
      li.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleRank(p.id);
      });
      list.appendChild(li);
    });
    renderRanks();
  }
  const PLACE_NAMES = ['1st', '2nd', '3rd', '4th'];
  const BORDA_POINTS = [4, 3, 2, 1];
  function toggleRank(id) {
    if (ballot.locked) return;
    const at = ballot.order.indexOf(id);
    if (at >= 0) ballot.order.splice(at, 1);
    else if (ballot.order.length < ballot.policies.length) ballot.order.push(id);
    renderRanks();
  }
  // A ballot can be locked only when every one of the (4) proposals has a
  // distinct place 1-4: exactly the ids on this ballot, each once.
  function ballotComplete() {
    const ids = ballot.policies.map((p) => p.id);
    return ids.length > 0 && ballot.order.length === ids.length
      && new Set(ballot.order).size === ids.length && ballot.order.every((id) => ids.includes(id));
  }
  function renderRanks() {
    document.querySelectorAll('.rank-card').forEach((card) => {
      const place = ballot.order.indexOf(card.dataset.policy);
      card.classList.toggle('is-ranked', place >= 0);
      card.dataset.place = place >= 0 ? String(place + 1) : '';
      // Borda weight of that place: burying a rival at 4th still gives it 1 point.
      card.dataset.points = place >= 0 ? `+${BORDA_POINTS[place]} PT${BORDA_POINTS[place] === 1 ? '' : 'S'}` : '';
      card.setAttribute('aria-label', `${proposalName(card.dataset.policy)}${place >= 0 ? `, ranked ${PLACE_NAMES[place]}` : ', not ranked yet'}`);
    });
    const left = ballot.policies.length - ballot.order.length;
    document.getElementById('rank-submit').disabled = !!ballot.locked || !ballotComplete();
    document.getElementById('rank-help').textContent = left
      ? `Tap the proposals in order of preference: ${PLACE_NAMES[ballot.order.length]} next. Tap a ranked one to undo.`
      : 'All four ranked. Tap one to change it, or lock in.';
  }
  // LOCK IN RANKINGS -> finale:rank { order: [id1, id2, id3, id4] }.
  const rankSubmit = document.getElementById('rank-submit');
  rankSubmit.addEventListener('click', () => {
    if (ballot.locked || !ballotComplete()) return;
    ballot.locked = true;
    rankSubmit.disabled = true;
    document.getElementById('rank-error').hidden = true;
    socket.emit('finale:rank', { order: ballot.order.slice() }, (res) => {
      if (res && res.ok) {
        document.getElementById('rank-cards').hidden = true;
        rankSubmit.hidden = true;
        // Confirmation: the ballot as cast (place, proposal, Borda points).
        const summary = document.getElementById('rank-locked-order');
        summary.textContent = '';
        ballot.order.forEach((id, i) => {
          const li = document.createElement('li');
          li.textContent = `${PLACE_NAMES[i]}  ${proposalName(id)}  +${BORDA_POINTS[i]}`;
          summary.appendChild(li);
        });
        document.getElementById('rank-locked').hidden = false;
        document.getElementById('m-view-finale-rank').classList.add('is-locked');
        buzz(50);
        return;
      }
      ballot.locked = false;
      renderRanks();
      document.getElementById('rank-error').textContent = 'The Loom refused that ballot. Check your ranking and try again.';
      document.getElementById('rank-error').hidden = false;
    });
  });

  socket.on('finale:ballot', (payload) => {
    ballot.policies = (payload && Array.isArray(payload.policies)) ? payload.policies.slice(0, 4) : [];
    ballot.order = [];
    ballot.locked = false;
    rankSubmit.hidden = false;
    document.getElementById('rank-locked').hidden = true;
    document.getElementById('m-view-finale-rank').classList.remove('is-locked');
    document.getElementById('rank-cards').hidden = false;
    renderBallot();
  });

  // Tap A or B -> vote:cast { choice, override }
  function castVote(choice) {
    // One vote per cycle from this phone: ignore taps once a vote is in
    // flight or recorded (rapid A/B mashing sends a single vote:cast).
    if (state.voteLockedCycle === state.cycle) return;
    state.voteLockedCycle = state.cycle;
    setVoteButtonsDisabled(true); // disabled the instant the vote is tapped
    const override = document.getElementById('vote-override').checked;
    state.lastVote = { cycle: state.cycle, choice };
    buzz(override ? [40, 40, 120] : 50);
    setVoteLocked(true, choice, override);
    socket.emit('vote:cast', { choice, override }, (res) => {
      if (res && res.ok) {
        if (override) state.overrideUsed = true;
        return;
      }
      // Already voted counts as locked; anything else lets the player retry.
      if (res && res.reason === 'ALREADY_VOTED') return;
      state.voteLockedCycle = null; // rejected: allow a retry
      setVoteButtonsDisabled(false);
      if (res && res.reason === 'OVERRIDE_SPENT') {
        state.overrideUsed = true;
        renderOverrideAvailability();
      }
      console.warn('[mobile] vote rejected', res && res.reason);
      setVoteLocked(false);
    });
  }

  function setVoteButtonsDisabled(disabled) {
    document.querySelectorAll('.vote-btn').forEach((b) => { b.disabled = disabled; });
    document.getElementById('vote-override').disabled = disabled || !!state.overrideUsed;
  }

  // Lock state: "VOTE RECORDED — WAITING FOR OTHER NODES".
  function setVoteLocked(locked, choice, override) {
    document.getElementById('vote-panel').hidden = locked;
    document.getElementById('vote-locked').hidden = !locked;
    if (locked && choice) {
      document.getElementById('vote-lock-choice').textContent = `You chose Policy ${choice}${override ? ' with your Override' : ''}.`;
    }
  }

  // Override availability: once spent (in any earlier cycle) the switch is
  // disabled and hidden for the rest of the game.
  function renderOverrideAvailability() {
    const spent = !!state.overrideUsed;
    const box = document.getElementById('vote-override');
    const row = document.getElementById('override-row');
    box.checked = false;
    box.disabled = spent;
    row.classList.remove('is-armed');
    row.classList.toggle('is-spent', spent);
    row.hidden = spent;
    document.getElementById('override-spent').hidden = !spent;
  }

  // Each new VOTE phase starts unlocked; a spent Override stays hidden.
  socket.on('phase', (payload) => {
    if (!payload || payload.phase !== 'VOTE') return;
    setVoteLocked(false);
    setVoteButtonsDisabled(false);
    renderOverrideAvailability();
  });

  // override:status { overrideAvailable } -> the server's word wins (e.g. after a reconnect).
  socket.on('override:status', (payload) => {
    if (!payload || typeof payload.overrideAvailable !== 'boolean') return;
    state.overrideUsed = !payload.overrideAvailable;
    renderOverrideAvailability();
  });
  // Override armed: clear visual state (crimson row, "x2" on both buttons) and
  // a 2-step confirm — the first tap arms that button, a second tap within
  // 4 s casts the doubled vote. Without the Override one tap votes.
  const CONFIRM_MS = 4000;
  let pendingChoice = null;
  let pendingTimer = null;
  function clearPendingConfirm() {
    pendingChoice = null;
    clearTimeout(pendingTimer);
    document.querySelectorAll('.vote-btn').forEach((b) => b.classList.remove('is-confirming'));
  }
  function renderOverrideArmed() {
    const armed = document.getElementById('vote-override').checked;
    document.getElementById('override-row').classList.toggle('is-armed', armed);
    document.getElementById('vote-panel').classList.toggle('is-override-armed', armed);
    clearPendingConfirm();
  }
  document.getElementById('vote-override').addEventListener('change', renderOverrideArmed);
  socket.on('phase', (payload) => { if (payload && payload.phase === 'VOTE') renderOverrideArmed(); });

  document.querySelectorAll('.vote-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const choice = btn.dataset.choice;
      const armed = document.getElementById('vote-override').checked;
      if (armed && pendingChoice !== choice) {
        clearPendingConfirm();
        pendingChoice = choice;
        btn.classList.add('is-confirming');
        pendingTimer = setTimeout(clearPendingConfirm, CONFIRM_MS);
        return;
      }
      clearPendingConfirm();
      castVote(choice);
    });
  });

  // ---------------------------------------------------------------------------
  // Debug mock tester for standalone screen checks, from the console:
  //   debugMobilePhase('VOTE')   debugMobilePhase('INTEL')   debugMobilePhase('ROLE_ASSIGN')
  // Seats a fake NODE-03 and feeds the same handlers real events would.
  // ---------------------------------------------------------------------------
  const MOCK_ROLE = {
    key: 'artisan', name: 'The Artisan', icon: '\u2692',
    goal: 'Human effort and creative struggle over machine efficiency.',
    winCondition: 'The winning policy is tagged artisan.',
    cardText: 'Poiesis / Creative Friction'
  };
  function debugEmit(event, payload) {
    socket.listeners(event).forEach((fn) => fn(payload));
  }
  function debugMobilePhase(phase, { seconds = 20, cycle = 1 } = {}) {
    if (!state.node) {
      state.node = 'NODE-03';
      setNodeLabel(state.node);
    }
    if (phase === 'ROLE_ASSIGN') debugEmit('role:assigned', { role: MOCK_ROLE });
    if (phase === 'INTEL') debugEmit('intel:drop', { text: 'Loom archive: districts that ran their own repair councils reported the highest sense of purpose in the region.' });
    const payload = { cycle, phase, endsAt: seconds ? Date.now() + seconds * 1000 : null };
    if (phase === 'VOTE' || phase === 'DEBATE') {
      payload.options = {
        A: { key: 'A', name: 'The Commons', text: 'The Loom and everything it produces become public property; every citizen gets an equal share.' },
        B: { key: 'B', name: 'The Charter', text: 'Owners keep legal title but pay a robot dividend to everyone from a levy on the Loom\'s output.' }
      };
    }
    debugEmit('phase', payload);
    return payload;
  }
  window.debugMobilePhase = debugMobilePhase;
  window.debugMobileEvent = debugEmit;
  window.debugMobileBallot = () => debugEmit('finale:ballot', { policies: [
    { id: 'POLICY-1', text: 'Every district elects a repair council that controls its own grid.' },
    { id: 'POLICY-3', text: 'Publish every staged challenge and let citizens vote on future ones.' },
    { id: 'POLICY-4', text: 'Keep the challenges but let anyone opt out of them.' },
    { id: 'POLICY-5', text: 'Maintain current regional administrative protocols without structural changes.' }
  ] });

  // ---------------------------------------------------------------------------
  // Refresh / reconnect re-hydration. On resume the server replays this
  // seat's state in order: state:sync { phase, cycle, voted, submitted,
  // ranked }, role:assigned, phase, intel:drop, override:status, ballot...
  // The normal handlers repaint role, intel, timer and ballot; this restores
  // what only the server remembers: a vote, write-in or ranking already in.
  // (Registered last so it runs after every other 'phase' handler.)
  // ---------------------------------------------------------------------------
  socket.on('state:sync', (sync) => { state.sync = sync || null; });
  const syncApplies = (phase) => state.sync && state.sync.phase === phase && state.sync.cycle === state.cycle;
  socket.on('phase', (payload) => {
    if (!payload || !state.sync) return;
    if (state.sync.phase !== payload.phase || state.sync.cycle !== (payload.cycle || 0)) { state.sync = null; return; }
    if (payload.phase === 'VOTE' && state.sync.voted) {
      state.voteLockedCycle = state.cycle;
      setVoteButtonsDisabled(true);
      setVoteLocked(true);
      document.getElementById('vote-lock-choice').textContent = 'Your vote was recorded before you reconnected.';
    }
    if (payload.phase === 'FINALE_WRITE' && state.sync.submitted) {
      state.finaleSubmitted = state.finaleSubmitted || true;
      state.finaleCycle = payload.cycle;
      showFinaleWait('Your policy was received before you reconnected.');
    }
  });
  socket.on('finale:ballot', () => {
    if (!syncApplies('FINALE_RANK') || !state.sync.ranked) return;
    ballot.locked = true;
    document.getElementById('rank-cards').hidden = true;
    rankSubmit.hidden = true;
    document.getElementById('rank-locked-order').textContent = '';
    document.getElementById('rank-locked').hidden = false;
    document.getElementById('m-view-finale-rank').classList.add('is-locked');
  });

  window.SocietelosMobile = { openRevise, socket, state, loadSession, saveSession, clearSession, showView, setNodeLabel, renderRole, onPhase };
})();
