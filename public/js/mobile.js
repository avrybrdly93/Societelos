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

  window.SocietelosMobile = { socket, state, loadSession, saveSession, clearSession, showView, setNodeLabel };
})();
