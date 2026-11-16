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

  window.SocietelosMobile = { socket, state, loadSession, saveSession, clearSession };
})();
