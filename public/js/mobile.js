// Societelos — phone controller client.
// Phones only render server state and send inputs.
(function () {
  'use strict';

  const socket = window.io({ auth: { clientType: 'phone' } });

  const state = { node: null, roomCode: null, phase: 'LOBBY', cycle: 0, endsAt: null, role: null };

  socket.on('connect', () => console.log('[mobile] connected'));
  socket.on('disconnect', (reason) => console.warn('[mobile] disconnected:', reason));

  window.SocietelosMobile = { socket, state };
})();
