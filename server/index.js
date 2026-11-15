const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const { CRISES } = require('./crises');

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

// Slots state
let nodeSlots = {
  'NODE-01': null,
  'NODE-02': null,
  'NODE-03': null,
  'NODE-04': null,
  'NODE-05': null
};

// Agenda scores per node
let nodeScores = {
  'NODE-01': 0,
  'NODE-02': 0,
  'NODE-03': 0,
  'NODE-04': 0,
  'NODE-05': 0
};

// Game lifecycle state
let gameState = {
  status: 'LOBBY', // LOBBY, DEBATE, RESOLUTION, GAME_OVER
  cycle: 0,
  totalCycles: 5,
  gdw: 25, // Gross Domestic Well-Being starts at 25%
  timerSeconds: 90,
  timerRunning: false,
  votes: {}, // nodeId -> 'A' | 'B'
  lastResolution: null,
  currentFeed: []
};

let debateInterval = null;

function getSlotSummary() {
  return NODE_DEFINITIONS.map((def) => {
    const occupant = nodeSlots[def.id];
    return {
      id: def.id,
      designation: def.designation,
      archetype: def.archetype,
      agenda: def.agenda,
      connected: !!occupant,
      playerName: occupant ? occupant.playerName : null,
      joinedAt: occupant ? occupant.joinedAt : null,
      simulated: occupant ? !!occupant.simulated : false,
      score: nodeScores[def.id] || 0,
      hasVoted: !!gameState.votes[def.id]
    };
  });
}

function getCurrentCrisis() {
  if (gameState.cycle >= 1 && gameState.cycle <= CRISES.length) {
    return CRISES[gameState.cycle - 1];
  }
  return null;
}

function getFullGameStatePayload() {
  const crisis = getCurrentCrisis();
  const slots = getSlotSummary();
  const connectedCount = Object.values(nodeSlots).filter(Boolean).length;
  const votedCount = Object.keys(gameState.votes).length;

  return {
    status: gameState.status,
    gdw: gameState.gdw,
    cycle: gameState.cycle,
    totalCycles: gameState.totalCycles,
    connectedCount,
    maxNodes: MAX_NODES,
    isReady: connectedCount >= MAX_NODES,
    timerSeconds: gameState.timerSeconds,
    timerRunning: gameState.timerRunning,
    votedCount,
    crisis: crisis
      ? {
          cycle: crisis.cycle,
          title: crisis.title,
          subtitle: crisis.subtitle,
          description: crisis.description,
          policyA: {
            name: crisis.policyA.name,
            summary: crisis.policyA.summary,
            gdwChange: crisis.policyA.gdwChange
          },
          policyB: {
            name: crisis.policyB.name,
            summary: crisis.policyB.summary,
            gdwChange: crisis.policyB.gdwChange
          }
        }
      : null,
    feed: gameState.currentFeed,
    lastResolution: gameState.lastResolution,
    slots,
    networkIP: getLocalNetworkIP(),
    port: PORT
  };
}

function getPlayerStatePayload(nodeId) {
  const base = getFullGameStatePayload();
  const crisis = getCurrentCrisis();
  let secretIntel = null;

  if (crisis && nodeId && crisis.intelDrops[nodeId]) {
    secretIntel = crisis.intelDrops[nodeId];
  }

  return {
    ...base,
    myNodeId: nodeId,
    myVote: gameState.votes[nodeId] || null,
    secretIntel
  };
}

function broadcastState() {
  // Send customized payloads to nodes (so their secret intel is securely targeted)
  for (const [nodeId, occupant] of Object.entries(nodeSlots)) {
    if (occupant && occupant.socketId) {
      io.to(occupant.socketId).emit('state_update', getPlayerStatePayload(nodeId));
    }
  }

  // Send general payload to host room and unassigned sockets
  io.to('host_room').emit('state_update', getFullGameStatePayload());
  io.emit('lobby_telemetry', getFullGameStatePayload());
}

function findSlotBySession(sessionId) {
  if (!sessionId) return null;
  for (const [nodeId, occupant] of Object.entries(nodeSlots)) {
    if (occupant && occupant.sessionId === sessionId) return nodeId;
  }
  return null;
}

function findSlotBySocket(socketId) {
  if (!socketId) return null;
  for (const [nodeId, occupant] of Object.entries(nodeSlots)) {
    if (occupant && occupant.socketId === socketId) return nodeId;
  }
  return null;
}

// Timer management
function startDebateTimer() {
  stopDebateTimer();
  gameState.timerRunning = true;
  debateInterval = setInterval(() => {
    if (gameState.timerSeconds > 0) {
      gameState.timerSeconds--;
      io.emit('timer_tick', { timerSeconds: gameState.timerSeconds });
    } else {
      stopDebateTimer();
      // Auto-resolve or nudge to resolution if time runs out
      checkAllVotesIn(true);
    }
  }, 1000);
}

function stopDebateTimer() {
  if (debateInterval) {
    clearInterval(debateInterval);
    debateInterval = null;
  }
  gameState.timerRunning = false;
}

function initializeCycle(cycleNumber) {
  stopDebateTimer();
  gameState.status = 'DEBATE';
  gameState.cycle = cycleNumber;
  gameState.timerSeconds = 90;
  gameState.votes = {};
  gameState.lastResolution = null;

  const crisis = CRISES[cycleNumber - 1];
  if (crisis) {
    gameState.currentFeed = [...crisis.initialBotFeed];
  }

  startDebateTimer();
  console.log(`[Crisis Started] Cycle ${cycleNumber}: ${crisis ? crisis.title : ''}`);
  broadcastState();
}

function resolveVotes() {
  stopDebateTimer();
  const crisis = getCurrentCrisis();
  if (!crisis) return;

  const votesA = Object.values(gameState.votes).filter((v) => v === 'A').length;
  const votesB = Object.values(gameState.votes).filter((v) => v === 'B').length;

  let winningPolicyKey = 'A';
  if (votesB > votesA) {
    winningPolicyKey = 'B';
  } else if (votesA === votesB) {
    // Tie-breaker: Loom AI bias (defaults to machine stability / Policy B)
    winningPolicyKey = Math.random() > 0.5 ? 'A' : 'B';
  }

  const winningPolicy = winningPolicyKey === 'A' ? crisis.policyA : crisis.policyB;
  const totalVotes = votesA + votesB;
  const isUnanimous = totalVotes >= 3 && (votesA === 0 || votesB === 0);

  // Update GDW
  const oldGdw = gameState.gdw;
  gameState.gdw = Math.max(0, Math.min(100, gameState.gdw + winningPolicy.gdwChange));

  // Update hidden agenda scores
  const scoreIncreases = [];
  winningPolicy.favoredRoles.forEach((favoredNodeId) => {
    if (nodeScores[favoredNodeId] !== undefined) {
      nodeScores[favoredNodeId] += 1;
      const def = NODE_DEFINITIONS.find((d) => d.id === favoredNodeId);
      scoreIncreases.push(`${favoredNodeId} (${def ? def.designation : ''})`);
    }
  });

  // Append new bot reaction feed
  gameState.currentFeed = [...winningPolicy.botReactions, ...gameState.currentFeed];

  gameState.status = 'RESOLUTION';
  gameState.lastResolution = {
    cycle: gameState.cycle,
    winningPolicyKey,
    winningPolicyName: winningPolicy.name,
    votesA,
    votesB,
    totalVotes,
    isUnanimous,
    gdwDelta: winningPolicy.gdwChange,
    oldGdw,
    newGdw: gameState.gdw,
    scoreIncreases,
    breakdown: { ...gameState.votes },
    isGameOver: gameState.gdw <= 0 || gameState.cycle >= gameState.totalCycles,
    isCollapse: gameState.gdw <= 0
  };

  console.log(`[Vote Resolved] Cycle ${gameState.cycle}: Policy ${winningPolicyKey} won (${votesA}-${votesB}). GDW: ${oldGdw} -> ${gameState.gdw}`);
  broadcastState();
}

function checkAllVotesIn(force = false) {
  const activeSlots = Object.keys(nodeSlots).filter((k) => nodeSlots[k] !== null);
  const targetCount = activeSlots.length > 0 ? activeSlots.length : MAX_NODES;
  const votedCount = Object.keys(gameState.votes).length;

  if (force || (votedCount >= targetCount && targetCount > 0)) {
    // Default uncast votes
    activeSlots.forEach((slotId) => {
      if (!gameState.votes[slotId]) {
        gameState.votes[slotId] = Math.random() > 0.5 ? 'A' : 'B';
      }
    });
    resolveVotes();
  }
}

// SOCKET.IO EVENTS
io.on('connection', (socket) => {
  console.log(`[Socket Connected] Client: ${socket.id}`);

  // Push immediate state snapshot
  socket.emit('state_update', getFullGameStatePayload());

  // Host registers itself
  socket.on('register_host', () => {
    socket.join('host_room');
    socket.emit('state_update', getFullGameStatePayload());
    console.log(`[Host Registered] Socket ID: ${socket.id}`);
  });

  // Check existing session for player reconnect
  socket.on('check_session', (data = {}) => {
    const { sessionId } = data;
    const existingNodeId = findSlotBySession(sessionId);

    if (existingNodeId) {
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

      broadcastState();
    } else {
      socket.emit('session_not_found');
    }
  });

  // Node (Player) joins council
  socket.on('node_join', (data = {}) => {
    const sessionId = data.sessionId || `session_${Math.random().toString(36).substring(2, 10)}`;
    const playerName = (data.playerName || '').trim() || 'Trustee';
    let requestedNodeId = data.requestedNodeId;

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
      broadcastState();
      return;
    }

    let targetNodeId = null;
    if (requestedNodeId && (nodeSlots[requestedNodeId] === null || nodeSlots[requestedNodeId].simulated)) {
      targetNodeId = requestedNodeId;
    } else {
      // First look for strictly vacant slots
      for (const def of NODE_DEFINITIONS) {
        if (nodeSlots[def.id] === null) {
          targetNodeId = def.id;
          break;
        }
      }
      // If none completely vacant, take over a simulated AI slot
      if (!targetNodeId) {
        for (const def of NODE_DEFINITIONS) {
          if (nodeSlots[def.id] && nodeSlots[def.id].simulated) {
            targetNodeId = def.id;
            break;
          }
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

    console.log(`[Node Joined] ${targetNodeId} (${def.designation}) claimed by ${playerName}`);
    broadcastState();
  });

  // Node voluntarily leaves
  socket.on('node_leave', (data = {}) => {
    const slot = findSlotBySession(data.sessionId) || findSlotBySocket(socket.id);
    if (slot) {
      console.log(`[Node Left] Relinquishing ${slot}`);
      nodeSlots[slot] = null;
      delete gameState.votes[slot];
      socket.leave('node_room');
      socket.emit('node_left_confirmed');
      broadcastState();
    }
  });

  // GAME ACTION: Host starts simulation
  socket.on('start_simulation', () => {
    console.log('[Host Action] Starting Simulation -> Crisis Cycle 01');
    // If not all nodes are filled by humans, auto-populate remaining slots as simulated nodes
    NODE_DEFINITIONS.forEach((def) => {
      if (nodeSlots[def.id] === null) {
        const simSession = `sim_${Math.random().toString(36).substring(2, 8)}`;
        nodeSlots[def.id] = {
          sessionId: simSession,
          socketId: null,
          playerName: `${def.designation} (AI)`,
          joinedAt: Date.now(),
          simulated: true
        };
      }
    });

    initializeCycle(1);
  });

  // GAME ACTION: Player submits vote
  socket.on('submit_vote', (data = {}) => {
    const { sessionId, vote } = data; // 'A' or 'B'
    const nodeId = findSlotBySession(sessionId) || findSlotBySocket(socket.id);

    if (!nodeId) {
      socket.emit('vote_error', { message: 'Node not authenticated.' });
      return;
    }

    if (gameState.status !== 'DEBATE') {
      socket.emit('vote_error', { message: 'Voting is not active.' });
      return;
    }

    if (vote === 'A' || vote === 'B') {
      gameState.votes[nodeId] = vote;
      console.log(`[Vote Cast] ${nodeId} voted for Policy ${vote}`);

      socket.emit('vote_confirmed', { vote });
      broadcastState();

      // Check if all active nodes have voted
      const activeSlots = Object.keys(nodeSlots).filter((k) => nodeSlots[k] !== null);
      if (Object.keys(gameState.votes).length >= activeSlots.length) {
        resolveVotes();
      }
    }
  });

  // GAME ACTION: Host calls vote / skips debate timer
  socket.on('force_resolve_vote', () => {
    console.log('[Host Action] Forcing vote resolution');
    checkAllVotesIn(true);
  });

  // GAME ACTION: Host advances to next crisis
  socket.on('advance_cycle', () => {
    if (gameState.cycle < gameState.totalCycles && gameState.gdw > 0) {
      initializeCycle(gameState.cycle + 1);
    } else {
      gameState.status = 'GAME_OVER';
      broadcastState();
    }
  });

  // GAME ACTION: Reset to lobby
  socket.on('reset_simulation', () => {
    stopDebateTimer();
    gameState.status = 'LOBBY';
    gameState.cycle = 0;
    gameState.gdw = 25;
    gameState.timerSeconds = 90;
    gameState.votes = {};
    gameState.lastResolution = null;
    gameState.currentFeed = [];
    nodeScores = {
      'NODE-01': 0,
      'NODE-02': 0,
      'NODE-03': 0,
      'NODE-04': 0,
      'NODE-05': 0
    };
    broadcastState();
  });

  // Dev controls
  socket.on('simulate_add_node', () => {
    for (const def of NODE_DEFINITIONS) {
      if (nodeSlots[def.id] === null) {
        const simSession = `sim_${Math.random().toString(36).substring(2, 8)}`;
        nodeSlots[def.id] = {
          sessionId: simSession,
          socketId: null,
          playerName: `Simulated Node`,
          joinedAt: Date.now(),
          simulated: true
        };
        broadcastState();
        break;
      }
    }
  });

  socket.on('simulate_remove_node', () => {
    const occupiedKeys = Object.keys(nodeSlots).filter((k) => nodeSlots[k] !== null);
    if (occupiedKeys.length > 0) {
      const lastKey = occupiedKeys[occupiedKeys.length - 1];
      nodeSlots[lastKey] = null;
      delete gameState.votes[lastKey];
      broadcastState();
    }
  });

  socket.on('reset_lobby', () => {
    stopDebateTimer();
    for (const key of Object.keys(nodeSlots)) {
      nodeSlots[key] = null;
    }
    gameState.status = 'LOBBY';
    gameState.cycle = 0;
    gameState.gdw = 25;
    gameState.votes = {};
    gameState.lastResolution = null;
    gameState.currentFeed = [];
    io.emit('lobby_reset_broadcast');
    broadcastState();
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    const slot = findSlotBySocket(socket.id);
    if (slot && gameState.status === 'LOBBY') {
      console.log(`[Lobby Disconnect] Releasing ${slot}`);
      nodeSlots[slot] = null;
      broadcastState();
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
