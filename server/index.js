const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const PORT = process.env.PORT || 3000;

// Serve static assets from public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helper to get local network IP address
function getLocalNetworkIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Fixed Council Archetypes
const MAX_NODES = 5;
const NODE_DEFINITIONS = [
  {
    id: 'NODE-01',
    designation: 'The Artisan',
    archetype: 'Poiesis / Creative Friction',
    agenda: 'Pushes for creative struggle and manual friction. Believes fulfillment requires human effort over automation.'
  },
  {
    id: 'NODE-02',
    designation: 'The Lotus-Eater',
    archetype: 'Hedonic Optimization / Frictionless Leisure',
    agenda: 'Pushes for absolute, frictionless comfort and pleasure. Believes telos is found in peace and leisure.'
  },
  {
    id: 'NODE-03',
    designation: 'The Assimilator',
    archetype: 'Synthetic Convergence / Machine Telos',
    agenda: 'Believes humanity’s telos is to merge entirely with The Loom. Grants the AI cognitive and emotional control.'
  },
  {
    id: 'NODE-04',
    designation: 'The Catalyst',
    archetype: 'Anti-Fragility / Controlled Crisis',
    agenda: 'Injects chaotic crises to force human resilience. Thrives on controlled systemic volatility.'
  },
  {
    id: 'NODE-05',
    designation: 'The Ghost',
    archetype: 'Biological Grounding / Subversive Decoupling',
    agenda: 'Seeks to dismantle The Loom entirely and return humanity to biological and earthen roots.'
  }
];

// Council Slots State: key is nodeId ('NODE-01' ... 'NODE-05')
// Value is null when vacant, or { sessionId, socketId, playerName, joinedAt, simulated }
let nodeSlots = {
  'NODE-01': null,
  'NODE-02': null,
  'NODE-03': null,
  'NODE-04': null,
  'NODE-05': null
};

let gameState = {
  status: 'LOBBY', // LOBBY, CRISIS, DEBATE, VOTING, RESOLUTION, COLLAPSE
  cycle: 0,
  gdw: 25, // Gross Domestic Well-Being starts at 25% (Critical Threshold)
  startTime: Date.now()
};

function getLobbyPayload() {
  const slots = NODE_DEFINITIONS.map((def) => {
    const occupant = nodeSlots[def.id];
    return {
      id: def.id,
      designation: def.designation,
      archetype: def.archetype,
      agenda: def.agenda,
      connected: !!occupant,
      playerName: occupant ? occupant.playerName : null,
      joinedAt: occupant ? occupant.joinedAt : null,
      simulated: occupant ? !!occupant.simulated : false
    };
  });

  const connectedCount = Object.values(nodeSlots).filter(Boolean).length;

  return {
    status: gameState.status,
    gdw: gameState.gdw,
    cycle: gameState.cycle,
    connectedCount,
    maxNodes: MAX_NODES,
    isReady: connectedCount >= MAX_NODES,
    slots,
    networkIP: getLocalNetworkIP(),
    port: PORT
  };
}

// Find node currently assigned to a session
function findSlotBySession(sessionId) {
  if (!sessionId) return null;
  for (const [nodeId, occupant] of Object.entries(nodeSlots)) {
    if (occupant && occupant.sessionId === sessionId) {
      return nodeId;
    }
  }
  return null;
}

// Find node currently assigned to a socket
function findSlotBySocket(socketId) {
  if (!socketId) return null;
  for (const [nodeId, occupant] of Object.entries(nodeSlots)) {
    if (occupant && occupant.socketId === socketId) {
      return nodeId;
    }
  }
  return null;
}

io.on('connection', (socket) => {
  console.log(`[Socket Connected] Client: ${socket.id}`);

  // Send initial snapshot to connecting client
  socket.emit('state_update', getLobbyPayload());

  // Host screen registration
  socket.on('register_host', () => {
    socket.join('host_room');
    socket.emit('state_update', getLobbyPayload());
    console.log(`[Host Registered] Socket ID: ${socket.id}`);
  });

  // Client checks if their tab already had an assigned session
  socket.on('check_session', (data = {}) => {
    const { sessionId } = data;
    const existingNodeId = findSlotBySession(sessionId);

    if (existingNodeId) {
      // Re-bind new socket to existing session
      nodeSlots[existingNodeId].socketId = socket.id;
      const def = NODE_DEFINITIONS.find((d) => d.id === existingNodeId);

      socket.join('node_room');
      socket.emit('node_assigned', {
        nodeId: existingNodeId,
        designation: def.designation,
        archetype: def.archetype,
        agenda: def.agenda,
        sessionId: sessionId,
        playerName: nodeSlots[existingNodeId].playerName
      });

      console.log(`[Session Reconnected] ${sessionId} re-bound to ${existingNodeId}`);
      io.emit('state_update', getLobbyPayload());
    } else {
      socket.emit('session_not_found');
    }
  });

  // Node (Player) joins council
  socket.on('node_join', (data = {}) => {
    const sessionId = data.sessionId || `session_${Math.random().toString(36).substring(2, 10)}`;
    const playerName = (data.playerName || '').trim() || 'Trustee';
    let requestedNodeId = data.requestedNodeId;

    // Check if this session already holds a slot
    const existingSlot = findSlotBySession(sessionId);
    if (existingSlot) {
      nodeSlots[existingSlot].socketId = socket.id;
      nodeSlots[existingSlot].playerName = playerName;
      const def = NODE_DEFINITIONS.find((d) => d.id === existingSlot);

      socket.join('node_room');
      socket.emit('node_assigned', {
        nodeId: existingSlot,
        designation: def.designation,
        archetype: def.archetype,
        agenda: def.agenda,
        sessionId,
        playerName
      });
      io.emit('state_update', getLobbyPayload());
      return;
    }

    // If requested specific slot, check if it's available
    let targetNodeId = null;
    if (requestedNodeId && nodeSlots[requestedNodeId] === null) {
      targetNodeId = requestedNodeId;
    } else {
      // Auto-assign the next free slot (NODE-01 through NODE-05)
      for (const def of NODE_DEFINITIONS) {
        if (nodeSlots[def.id] === null) {
          targetNodeId = def.id;
          break;
        }
      }
    }

    if (!targetNodeId) {
      socket.emit('node_join_rejected', {
        reason: 'Council is full. All 5 nodes are currently synchronized.'
      });
      return;
    }

    const def = NODE_DEFINITIONS.find((d) => d.id === targetNodeId);
    nodeSlots[targetNodeId] = {
      sessionId,
      socketId: socket.id,
      playerName,
      joinedAt: Date.now(),
      simulated: false
    };

    socket.join('node_room');
    socket.emit('node_assigned', {
      nodeId: targetNodeId,
      designation: def.designation,
      archetype: def.archetype,
      agenda: def.agenda,
      sessionId,
      playerName
    });

    console.log(`[Node Joined] ${targetNodeId} (${def.designation}) claimed by ${playerName} (${socket.id})`);
    io.emit('state_update', getLobbyPayload());
  });

  // Node voluntarily leaves / relinquishes slot
  socket.on('node_leave', (data = {}) => {
    const slot = findSlotBySession(data.sessionId) || findSlotBySocket(socket.id);
    if (slot) {
      console.log(`[Node Left] Relinquishing ${slot}`);
      nodeSlots[slot] = null;
      socket.leave('node_room');
      socket.emit('node_left_confirmed');
      io.emit('state_update', getLobbyPayload());
    }
  });

  // Dev: Simulate adding a node
  socket.on('simulate_add_node', () => {
    for (const def of NODE_DEFINITIONS) {
      if (nodeSlots[def.id] === null) {
        const simSession = `sim_${Math.random().toString(36).substring(2, 8)}`;
        nodeSlots[def.id] = {
          sessionId: simSession,
          socketId: simSession,
          playerName: `Simulated Node`,
          joinedAt: Date.now(),
          simulated: true
        };
        console.log(`[Simulated Node Added] ${def.id} (${def.designation})`);
        io.emit('state_update', getLobbyPayload());
        break;
      }
    }
  });

  // Dev: Simulate removing a node
  socket.on('simulate_remove_node', () => {
    // Remove the latest occupied slot
    const occupiedKeys = Object.keys(nodeSlots).filter((k) => nodeSlots[k] !== null);
    if (occupiedKeys.length > 0) {
      const lastKey = occupiedKeys[occupiedKeys.length - 1];
      console.log(`[Simulated Node Removed] ${lastKey}`);
      nodeSlots[lastKey] = null;
      io.emit('state_update', getLobbyPayload());
    }
  });

  // Dev: Reset lobby
  socket.on('reset_lobby', () => {
    for (const key of Object.keys(nodeSlots)) {
      nodeSlots[key] = null;
    }
    console.log('[Lobby Reset] All nodes disconnected');
    io.emit('lobby_reset_broadcast');
    io.emit('state_update', getLobbyPayload());
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    const slot = findSlotBySocket(socket.id);
    if (slot) {
      // If simulated, release immediately
      if (nodeSlots[slot] && nodeSlots[slot].simulated) {
        nodeSlots[slot] = null;
        console.log(`[Simulated Disconnected] ${slot}`);
        io.emit('state_update', getLobbyPayload());
      } else {
        // For real users, release the slot when socket disconnects
        console.log(`[Node Disconnected] ${slot} released`);
        nodeSlots[slot] = null;
        io.emit('state_update', getLobbyPayload());
      }
    } else {
      console.log(`[Socket Disconnected] ${socket.id}`);
    }
  });
});

server.listen(PORT, () => {
  const ip = getLocalNetworkIP();
  console.log(`=======================================================`);
  console.log(`  SOCIETELOS // THE LOOM PROTOCOL ENGINE ONLINE       `);
  console.log(`  Host Screen:   http://localhost:${PORT}             `);
  console.log(`  Mobile Join:   http://${ip}:${PORT}/player.html     `);
  console.log(`  Target Nodes:  5 Human Trustees                      `);
  console.log(`=======================================================`);
});
