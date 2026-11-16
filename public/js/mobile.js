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
  const socket = window.io({ auth: { clientType: 'phone', token: saved && saved.token } });

  const state = { node: saved ? saved.node : null, roomCode: null, phase: 'LOBBY', cycle: 0, endsAt: null, role: null };

  socket.on('connect', () => console.log('[mobile] connected'));
  socket.on('disconnect', (reason) => console.warn('[mobile] disconnected:', reason));

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
    saveSession({ node: info.node, token: saved && saved.token, roomCode: info.roomCode });
  });

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
  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.getElementById('join-name').value.trim();
    if (!name) return;
    joinSubmit.disabled = true;
    joinError.hidden = true;
    socket.emit('lobby:join', { name }, (res) => {
      joinSubmit.disabled = false;
      if (!res || !res.ok) {
        joinError.textContent = JOIN_ERRORS[res && res.reason] || 'Connection refused. Try again.';
        joinError.hidden = false;
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
    document.getElementById('role-icon').textContent = role.icon || '';
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
    VOTE: 'm-view-vote'
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

  function onPhase(payload) {
    if (!payload || !payload.phase) return;
    state.phase = payload.phase;
    state.cycle = payload.cycle || 0;
    state.endsAt = payload.endsAt || null;
    document.body.dataset.phase = payload.phase;
    if (!state.node) return showView('m-view-join');
    const screen = PHASE_SCREENS[payload.phase];
    if (screen) return showView(screen);
    document.getElementById('wait-status').textContent = WAIT_MESSAGES[payload.phase] || 'Stand by.';
    return showView('m-view-wait');
  }

  socket.on('phase', onPhase);

  // Countdown bar (and the debate clock), recomputed each frame from the
  // server's endsAt so every phone stays in step with the projector.
  const countdownFill = document.getElementById('m-countdown-fill');
  const debateClock = document.getElementById('debate-clock');
  let phaseDurationMs = 0;
  let durationFor = null;
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
    debateClock.textContent = state.endsAt ? `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}` : '--:--';
    state.remainingMs = remaining;
    const low = !!state.endsAt && remaining > 0 && remaining < 5000;
    countdownFill.classList.toggle('is-low', low);
    debateClock.classList.toggle('is-low', low);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // intel:drop { text } -> this player's role-slanted research snippet.
  socket.on('intel:drop', (payload) => {
    const text = (payload && payload.text) || 'No intel received.';
    document.getElementById('intel-text').textContent = text;
    document.getElementById('intel-ref').textContent = `REF C${state.cycle || 0}-${(state.node || 'NODE-00').slice(-2)}`;
    document.getElementById('shield-intel').checked = false;
  });

  // Policy names arrive with the DEBATE phase; label the vote buttons with them.
  socket.on('phase', (payload) => {
    if (payload && payload.options) {
      const { A, B } = payload.options;
      if (A) document.getElementById('vote-a-name').textContent = A.name || 'Policy A';
      if (B) document.getElementById('vote-b-name').textContent = B.name || 'Policy B';
    }
  });

  // Tap A or B -> vote:cast { choice, override }
  function castVote(choice) {
    const override = document.getElementById('vote-override').checked;
    setVoteLocked(true, choice, override);
    socket.emit('vote:cast', { choice, override }, (res) => {
      if (res && res.ok) {
        if (override) state.overrideUsed = true;
        return;
      }
      // Already voted counts as locked; anything else lets the player retry.
      if (res && res.reason === 'ALREADY_VOTED') return;
      console.warn('[mobile] vote rejected', res && res.reason);
      setVoteLocked(false);
    });
  }

  // Lock state: "VOTE RECORDED — WAITING FOR OTHER NODES".
  function setVoteLocked(locked, choice, override) {
    document.getElementById('vote-panel').hidden = locked;
    document.getElementById('vote-locked').hidden = !locked;
    if (locked && choice) {
      document.getElementById('vote-lock-choice').textContent = `You chose Policy ${choice}${override ? ' with your Override' : ''}.`;
    }
  }

  // Each new VOTE phase starts unlocked; a spent Override stays disabled.
  socket.on('phase', (payload) => {
    if (!payload || payload.phase !== 'VOTE') return;
    setVoteLocked(false);
    const box = document.getElementById('vote-override');
    box.checked = false;
    box.disabled = !!state.overrideUsed;
    document.getElementById('override-row').classList.toggle('is-spent', !!state.overrideUsed);
  });
  document.querySelectorAll('.vote-btn').forEach((btn) => {
    btn.addEventListener('click', () => castVote(btn.dataset.choice));
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
      payload.options = { A: { key: 'A', name: 'The Commons' }, B: { key: 'B', name: 'The Charter' } };
    }
    debugEmit('phase', payload);
    return payload;
  }
  window.debugMobilePhase = debugMobilePhase;

  window.SocietelosMobile = { socket, state, loadSession, saveSession, clearSession, showView, setNodeLabel, renderRole, onPhase };
})();
