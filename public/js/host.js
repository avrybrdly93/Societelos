// Societelos — host projector client.
// Renders server state only; the server owns every timer and decision.
(function () {
  'use strict';

  // Reconnect to the same room after a refresh.
  const savedRoom = (() => {
    try { return sessionStorage.getItem('societelos.hostRoom'); } catch (e) { return null; }
  })();

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

  window.SocietelosHost = { socket, state };
})();
