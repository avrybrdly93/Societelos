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

  window.SocietelosHost = { socket, state, fetchQR };
})();
