const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');

const sim = require('./sim/engine');
const loom = require('./loom');

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

// Convenient mobile routes
app.get('/mobile', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'player.html'));
});
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'player.html'));
});

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

// Standardized Phase State Constants
const STATE_LOBBY = 'STATE_LOBBY';
const STATE_VOTING = 'STATE_VOTING';
const STATE_RESOLUTION = 'STATE_RESOLUTION';
const STATE_GAME_OVER = 'STATE_GAME_OVER';

// Load content from /data
const ROLES_PATH = path.join(__dirname, '..', 'data', 'roles.json');
const CRISES_PATH = path.join(__dirname, '..', 'data', 'crises.json');
const CITIZENS_PATH = path.join(__dirname, '..', 'data', 'citizens.json');

let NODE_DEFINITIONS = [];
try {
  NODE_DEFINITIONS = JSON.parse(fs.readFileSync(ROLES_PATH, 'utf-8'));
} catch (e) {
  console.error('[Error reading roles.json]', e);
}

let CRISES_DATA = { fixedCrises: [], worlds: {} };
try {
  CRISES_DATA = JSON.parse(fs.readFileSync(CRISES_PATH, 'utf-8'));
} catch (e) {
  console.error('[Error reading crises.json]', e);
}

let CITIZENS = [];
try {
  CITIZENS = JSON.parse(fs.readFileSync(CITIZENS_PATH, 'utf-8'));
} catch (e) {
  console.error('[Error reading citizens.json]', e);
}

const MAX_NODES = 5;

// Slots state (NODE-01 to NODE-05)
let nodeSlots = {
  'NODE-01': null,
  'NODE-02': null,
  'NODE-03': null,
  'NODE-04': null,
  'NODE-05': null
};

// Hidden Agenda points per node
let nodeScores = {
  'NODE-01': 0,
  'NODE-02': 0,
  'NODE-03': 0,
  'NODE-04': 0,
  'NODE-05': 0
};

// 1x Override per player per game
let nodeOverridesUsed = {
  'NODE-01': false,
  'NODE-02': false,
  'NODE-03': false,
  'NODE-04': false,
  'NODE-05': false
};

// Global Monte Carlo simulation cohorts
let cohorts = sim.createInitialState();

// Master Game State
let gameState = {
  phase: STATE_LOBBY,
  cycle: 0,
  totalCycles: 5,
  gdw: 25,
  timerSeconds: 90,
  timerPaused: false,
  volatility: 1.0,
  vote1: null, // 'A' or 'B'
  vote2: null, // 'A' or 'B'
  worldKey: null, // 'AA', 'AB', 'BA', 'BB'
  worldName: null,
  votes: {}, // nodeId -> { vote: 'A'|'B', override: boolean }
  lastResolution: null,
  currentFeed: [],
  history: [],
  districts: sim.DISTRICTS.map((d) => ({ id: d.id, name: d.name, gdw: 25 }))
};

let debateInterval = null;

function getCurrentCrisis() {
  if (gameState.cycle === 1) return CRISES_DATA.fixedCrises[0];
  if (gameState.cycle === 2) return CRISES_DATA.fixedCrises[1];

  if (gameState.worldKey && CRISES_DATA.worlds[gameState.worldKey]) {
    const world = CRISES_DATA.worlds[gameState.worldKey];
    if (gameState.cycle === 3) return world.crises[0];
    if (gameState.cycle === 4) return world.crises[1];
    if (gameState.cycle === 5) {
      // Finale
      const fin = world.finale;
      return {
        cycle: 5,
        title: fin.title,
        subtitle: fin.subtitle,
        description: fin.incident,
        teacherPrompt: fin.teacherPrompt,
        policyA: fin.fallbackPolicyA,
        policyB: fin.fallbackPolicyB,
        intelDrops: CRISES_DATA.fixedCrises[0].intelDrops
      };
    }
  }

  return CRISES_DATA.fixedCrises[0];
}

function getSlotSummary() {
  return NODE_DEFINITIONS.map((def) => {
    const occupant = nodeSlots[def.id];
    return {
      id: def.id,
      designation: def.designation,
      icon: def.icon,
      archetype: def.archetype,
      agenda: def.agenda,
      winCondition: def.winCondition,
      connected: !!occupant,
      playerName: occupant ? occupant.playerName : null,
      joinedAt: occupant ? occupant.joinedAt : null,
      simulated: occupant ? !!occupant.simulated : false,
      score: nodeScores[def.id] || 0,
      overrideUsed: !!nodeOverridesUsed[def.id],
      hasVoted: !!gameState.votes[def.id]
    };
  });
}

function getFullStatePayload() {
  const crisis = getCurrentCrisis();
  const slots = getSlotSummary();
  const connectedCount = Object.values(nodeSlots).filter(Boolean).length;
  const votedCount = Object.keys(gameState.votes).length;

  return {
    phase: gameState.phase,
    status: gameState.phase,
    gdw: gameState.gdw,
    cycle: gameState.cycle,
    totalCycles: gameState.totalCycles,
    connectedCount,
    maxNodes: MAX_NODES,
    isReady: connectedCount >= MAX_NODES,
    timerSeconds: gameState.timerSeconds,
    timerPaused: gameState.timerPaused,
    votedCount,
    worldKey: gameState.worldKey,
    worldName: gameState.worldName,
    crisis: crisis
      ? {
          cycle: crisis.cycle,
          title: crisis.title,
          subtitle: crisis.subtitle,
          description: crisis.description || crisis.incident,
          teacherPrompt: crisis.teacherPrompt,
          policyA: crisis.policyA,
          policyB: crisis.policyB
        }
      : null,
    feed: gameState.currentFeed,
    lastResolution: gameState.lastResolution,
    slots,
    history: gameState.history,
    districts: gameState.districts,
    networkIP: getLocalNetworkIP(),
    port: PORT
  };
}

function getPlayerStatePayload(nodeId) {
  const base = getFullStatePayload();
  const crisis = getCurrentCrisis();
  let secretIntel = null;

  if (crisis && nodeId && crisis.intelDrops && crisis.intelDrops[nodeId]) {
    secretIntel = crisis.intelDrops[nodeId];
  }

  const voteRecord = gameState.votes[nodeId] || null;

  return {
    ...base,
    myNodeId: nodeId,
    myVote: voteRecord ? voteRecord.vote : null,
    myOverrideUsed: !!nodeOverridesUsed[nodeId],
    secretIntel
  };
}

function broadcastState() {
  for (const [nodeId, occupant] of Object.entries(nodeSlots)) {
    if (occupant && occupant.socketId) {
      io.to(occupant.socketId).emit('state_update', getPlayerStatePayload(nodeId));
    }
  }

  io.to('host_room').emit('state_update', getFullStatePayload());
  io.emit('lobby_telemetry', getFullStatePayload());
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

// Timer
function startDebateTimer() {
  stopDebateTimer();
  gameState.timerPaused = false;
  debateInterval = setInterval(() => {
    if (!gameState.timerPaused) {
      if (gameState.timerSeconds > 0) {
        gameState.timerSeconds--;
        io.emit('timer_tick', {
          timerSeconds: gameState.timerSeconds,
          timerPaused: gameState.timerPaused
        });
      } else {
        stopDebateTimer();
        checkAllVotesIn(true);
      }
    }
  }, 1000);
}

function stopDebateTimer() {
  if (debateInterval) {
    clearInterval(debateInterval);
    debateInterval = null;
  }
}

function initializeCycle(cycleNumber) {
  stopDebateTimer();
  gameState.phase = STATE_VOTING;
  gameState.cycle = cycleNumber;
  gameState.timerSeconds = 90;
  gameState.timerPaused = false;
  gameState.votes = {};
  gameState.lastResolution = null;

  const crisis = getCurrentCrisis();
  if (crisis) {
    gameState.currentFeed = crisis.feed || crisis.initialBotFeed || [];
  }

  startDebateTimer();
  console.log(`[Cycle ${cycleNumber}] Initialized: ${crisis ? crisis.title : ''}`);
  broadcastState();
}

async function resolveVotes() {
  stopDebateTimer();
  const crisis = getCurrentCrisis();
  if (!crisis) return;

  // Calculate weighted votes (accounting for 2x Override)
  let weightA = 0;
  let weightB = 0;
  let rawCountA = 0;
  let rawCountB = 0;

  for (const [nodeId, record] of Object.entries(gameState.votes)) {
    const multiplier = record.override ? 2 : 1;
    if (record.vote === 'A') {
      weightA += multiplier;
      rawCountA++;
    } else {
      weightB += multiplier;
      rawCountB++;
    }
  }

  let winningKey = 'A';
  if (weightB > weightA) {
    winningKey = 'B';
  } else if (weightA === weightB) {
    winningKey = Math.random() > 0.5 ? 'A' : 'B';
  }

  // Branching world calculation after Cycle 1 & 2
  if (gameState.cycle === 1) gameState.vote1 = winningKey;
  if (gameState.cycle === 2) {
    gameState.vote2 = winningKey;
    gameState.worldKey = `${gameState.vote1}${gameState.vote2}`;
    const worldObj = CRISES_DATA.worlds[gameState.worldKey];
    gameState.worldName = worldObj ? worldObj.name : 'The Unknown World';
    if (gameState.vote2 === 'A') gameState.volatility = 1.5; // Assembly adds volatility
    console.log(`[World Established] Key: ${gameState.worldKey} -> ${gameState.worldName}`);
  }

  const winningPolicy = winningKey === 'A' ? crisis.policyA : crisis.policyB;
  const totalVotes = rawCountA + rawCountB;
  const isUnanimous = totalVotes >= 3 && (rawCountA === 0 || rawCountB === 0);

  // Run Monte Carlo Cohort Simulation
  const seed = 2026 + gameState.cycle * 137;
  const simResult = sim.runSimulationCycle(cohorts, winningPolicy.effects, seed, gameState.volatility);

  cohorts = simResult.realizedCohorts;
  const oldGdw = gameState.gdw;
  gameState.gdw = simResult.realizedGdw;
  gameState.districts = simResult.districtSummaries;

  // Update Hidden Agenda scores
  const scoreIncreases = [];
  const rolesTagged = winningPolicy.roles || [];

  rolesTagged.forEach((roleTag) => {
    NODE_DEFINITIONS.forEach((def) => {
      const match = def.designation.toLowerCase().includes(roleTag.toLowerCase());
      if (match && nodeScores[def.id] !== undefined) {
        nodeScores[def.id] += 1;
        scoreIncreases.push(`${def.id} (${def.designation})`);
      }
    });
  });

  // Catalyst check: scores +1 if GDW swings by >= 10 points and stays > 0
  const gdwSwing = Math.abs(gameState.gdw - oldGdw);
  if (gdwSwing >= 10 && gameState.gdw > 0) {
    nodeScores['NODE-04'] += 1;
    scoreIncreases.push(`NODE-04 (The Catalyst: +${gdwSwing}% Volatility Bonus)`);
  }

  // Generate Loom AI Narrative & Citizen Reactions
  const loomNarrative = await loom.narrateResolution(crisis, winningPolicy, {
    realizedGdw: gameState.gdw,
    oldGdw
  });

  const formattedMessages = (loomNarrative.messages || []).map((m) => {
    const citizen = CITIZENS.find((c) => c.id === m.citizenId) || { name: m.citizenId, handle: `@${m.citizenId}` };
    return {
      user: citizen.handle || citizen.name,
      text: m.text,
      sentiment: 'reaction'
    };
  });

  gameState.currentFeed = [
    { user: '@THE_LOOM', text: loomNarrative.loomLine, sentiment: 'telemetry' },
    ...formattedMessages,
    ...gameState.currentFeed
  ];

  gameState.phase = STATE_RESOLUTION;
  gameState.lastResolution = {
    cycle: gameState.cycle,
    winningPolicyKey: winningKey,
    winningPolicyName: winningPolicy.name,
    teacherPrompt: crisis.teacherPrompt,
    votesA: weightA,
    votesB: weightB,
    totalVotes,
    isUnanimous,
    gdwDelta: gameState.gdw - oldGdw,
    oldGdw,
    newGdw: gameState.gdw,
    forecast: simResult.forecast,
    scoreIncreases,
    isGameOver: gameState.gdw <= 0 || gameState.cycle >= gameState.totalCycles,
    isCollapse: gameState.gdw <= 0
  };

  gameState.history.push({
    cycle: gameState.cycle,
    crisisTitle: crisis.title,
    winningPolicy: winningPolicy.name,
    gdw: gameState.gdw
  });

  console.log(`[Vote Resolved] Cycle ${gameState.cycle}: ${winningPolicy.name} won (${weightA}-${weightB}). GDW: ${oldGdw} -> ${gameState.gdw}`);
  broadcastState();
}

function checkAllVotesIn(force = false) {
  const activeSlots = Object.keys(nodeSlots).filter((k) => nodeSlots[k] !== null);
  const targetCount = activeSlots.length > 0 ? activeSlots.length : MAX_NODES;
  const votedCount = Object.keys(gameState.votes).length;

  if (force || (votedCount >= targetCount && targetCount > 0)) {
    activeSlots.forEach((slotId) => {
      if (!gameState.votes[slotId]) {
        gameState.votes[slotId] = {
          vote: Math.random() > 0.5 ? 'A' : 'B',
          override: false
        };
      }
    });
    resolveVotes();
  }
}

// Socket handlers
io.on('connection', (socket) => {
  socket.emit('state_update', getFullStatePayload());

  socket.on('register_host', () => {
    socket.join('host_room');
    socket.emit('state_update', getFullStatePayload());
  });

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
        winCondition: def.winCondition,
        sessionId,
        playerName: nodeSlots[existingNodeId].playerName
      });

      broadcastState();
    } else {
      socket.emit('session_not_found');
    }
  });

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
        winCondition: def.winCondition,
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
      for (const def of NODE_DEFINITIONS) {
        if (nodeSlots[def.id] === null) {
          targetNodeId = def.id;
          break;
        }
      }
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
      winCondition: def.winCondition,
      sessionId,
      playerName
    });

    console.log(`[Node Joined] ${targetNodeId} (${def.designation}) claimed by ${playerName}`);
    broadcastState();
  });

  socket.on('node_leave', (data = {}) => {
    const slot = findSlotBySession(data.sessionId) || findSlotBySocket(socket.id);
    if (slot) {
      nodeSlots[slot] = null;
      delete gameState.votes[slot];
      socket.leave('node_room');
      socket.emit('node_left_confirmed');
      broadcastState();
    }
  });

  // Host starts simulation
  socket.on('start_simulation', () => {
    console.log('[Simulation Started]');
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

  // Player votes (supports 1x Override)
  socket.on('submit_vote', (data = {}) => {
    const { sessionId, vote, useOverride } = data;
    const nodeId = findSlotBySession(sessionId) || findSlotBySocket(socket.id);

    if (!nodeId) {
      socket.emit('vote_error', { message: 'Node not authenticated.' });
      return;
    }

    if (gameState.phase !== STATE_VOTING) {
      socket.emit('vote_error', { message: 'Voting is not active.' });
      return;
    }

    if (vote === 'A' || vote === 'B') {
      const canOverride = useOverride && !nodeOverridesUsed[nodeId];
      if (canOverride) {
        nodeOverridesUsed[nodeId] = true;
      }

      gameState.votes[nodeId] = {
        vote,
        override: !!canOverride
      };

      console.log(`[Vote] ${nodeId} voted ${vote} (Override: ${!!canOverride})`);
      socket.emit('vote_confirmed', { vote, override: !!canOverride });
      broadcastState();

      const activeSlots = Object.keys(nodeSlots).filter((k) => nodeSlots[k] !== null);
      if (Object.keys(gameState.votes).length >= activeSlots.length) {
        resolveVotes();
      }
    }
  });

  // Teacher / Host Controls
  socket.on('toggle_pause_timer', () => {
    gameState.timerPaused = !gameState.timerPaused;
    broadcastState();
  });

  socket.on('add_timer_seconds', (sec = 30) => {
    gameState.timerSeconds += sec;
    broadcastState();
  });

  socket.on('force_resolve_vote', () => {
    checkAllVotesIn(true);
  });

  socket.on('advance_cycle', () => {
    if (gameState.cycle < gameState.totalCycles && gameState.gdw > 0) {
      initializeCycle(gameState.cycle + 1);
    } else {
      gameState.phase = STATE_GAME_OVER;
      broadcastState();
    }
  });

  socket.on('reset_simulation', () => {
    stopDebateTimer();
    cohorts = sim.createInitialState();
    gameState.phase = STATE_LOBBY;
    gameState.cycle = 0;
    gameState.gdw = 25;
    gameState.timerSeconds = 90;
    gameState.timerPaused = false;
    gameState.volatility = 1.0;
    gameState.vote1 = null;
    gameState.vote2 = null;
    gameState.worldKey = null;
    gameState.worldName = null;
    gameState.votes = {};
    gameState.lastResolution = null;
    gameState.currentFeed = [];
    gameState.history = [];
    nodeScores = {
      'NODE-01': 0,
      'NODE-02': 0,
      'NODE-03': 0,
      'NODE-04': 0,
      'NODE-05': 0
    };
    nodeOverridesUsed = {
      'NODE-01': false,
      'NODE-02': false,
      'NODE-03': false,
      'NODE-04': false,
      'NODE-05': false
    };
    broadcastState();
  });

  socket.on('reset_lobby', () => {
    stopDebateTimer();
    cohorts = sim.createInitialState();
    for (const k of Object.keys(nodeSlots)) {
      nodeSlots[k] = null;
    }
    gameState.phase = STATE_LOBBY;
    gameState.cycle = 0;
    gameState.gdw = 25;
    gameState.votes = {};
    gameState.lastResolution = null;
    gameState.currentFeed = [];
    gameState.history = [];
    io.emit('lobby_reset_broadcast');
    broadcastState();
  });

  socket.on('disconnect', () => {
    const slot = findSlotBySocket(socket.id);
    if (slot && gameState.phase === STATE_LOBBY) {
      nodeSlots[slot] = null;
      broadcastState();
    }
  });
});

server.listen(PORT, () => {
  const ip = getLocalNetworkIP();
  console.log(`=======================================================`);
  console.log(`  SOCIETELOS // THE LOOM SIMULATION ENGINE ONLINE     `);
  console.log(`  Host Projector:  http://localhost:${PORT}           `);
  console.log(`  Mobile Join:     http://${ip}:${PORT}/mobile        `);
  console.log(`  Monte Carlo:     5 Districts // 20 Cohorts Ready    `);
  console.log(`=======================================================`);
});
