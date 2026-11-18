'use strict';

// Thursday content audit (TASK-709 onward) over the 14 core crises a game
// can reach: 2 fixed + per world its Cycle 3-4 binaries and its finale.

const test = require('node:test');
const assert = require('node:assert/strict');

const data = require('../../data/crises.json');

const ROLES = ['artisan', 'lotus', 'assimilator', 'catalyst', 'ghost'];
const finaleIds = new Set(Object.values(data.worlds).map((w) => w.finale));
const CORE = data.crises.filter((c) => c.world === 'fixed'
  || (c.mode === 'binary' && (c.cycle === 3 || c.cycle === 4))
  || finaleIds.has(c.id));

test('the core set is 14 crises', () => {
  assert.equal(CORE.length, 14);
});

// TASK-709: 70 drops, each readable in 20 s on a phone (<= 180 chars) and
// framed as an in-world document ("Loom archive:", "Leaked memo:", ...).
test('all 70 Intel Drops are <= 180 characters with in-world document framing', () => {
  let n = 0;
  for (const c of CORE) {
    for (const role of ROLES) {
      const drop = c.intel && c.intel[role];
      assert.equal(typeof drop, 'string', `${c.id}/${role} missing`);
      assert.ok(drop.length <= 180, `${c.id}/${role} is ${drop.length} chars`);
      assert.match(drop, /^[A-Z][a-z]*( [a-z]+){0,3}: \S/, `${c.id}/${role} lacks a "Source label:" opener: ${drop}`);
      n++;
    }
  }
  assert.equal(n, 70);
});

// TASK-710: every Catalyst drop is a forecast that tells the Catalyst where
// the GDW swing (or the calm) is. Directions and sizes were checked against
// npm run calibrate:crises (median delta and p5-95 spread per option).
test('every Catalyst Intel Drop is a forecast that names the swing', () => {
  for (const c of CORE) {
    const drop = c.intel.catalyst;
    assert.match(drop.split(':')[0], /forecast/i, `${c.id}: Catalyst drop is not a forecast`);
    assert.match(drop, /swing|spread|whipsaw|crash|points|barely|flat/i, `${c.id}: Catalyst drop does not say what moves the line`);
  }
});

// TASK-711: World Reveal copy. Names, taglines and problems are the MVP spec
// strings; each world also has a short Loom revealLine for the projector.
test('each world reveal has spec name/tagline/problem and a projector-length Loom line', () => {
  const spec = {
    AA: ['The Commonwealth', 'Shared wealth, shared power', 'meaning'],
    AB: ['The Benevolent Machine', 'Shared wealth, the Loom rules', 'dependence'],
    BA: ['The Uneasy Republic', 'Rich owners, voting masses', 'class conflict'],
    BB: ['The Gilded Cage', 'Owners rule, masses on stipends', 'pacification']
  };
  for (const [key, [name, tagline, problemLeft]] of Object.entries(spec)) {
    const w = data.worlds[key];
    assert.deepEqual([w.name, w.tagline, w.problemLeft], [name, tagline, problemLeft], key);
    assert.equal(typeof w.revealLine, 'string', `${key} revealLine`);
    assert.ok(w.revealLine.length >= 40 && w.revealLine.length <= 120, `${key} revealLine is ${w.revealLine.length} chars`);
  }
});

// TASK-713: the Loom's five-year epilogue for each class grade band.
test('each grade band has a Loom epilogue for the End Screen (<= 140 chars)', () => {
  assert.deepEqual(Object.keys(data.grades).sort(), ['Fragile', 'SHUTDOWN', 'Stable', 'Thriving']);
  for (const [grade, text] of Object.entries(data.grades)) {
    assert.ok(typeof text === 'string' && text.length >= 40 && text.length <= 140, `${grade}: ${text && text.length} chars`);
  }
  assert.match(data.grades.SHUTDOWN, /zero/);
});

// TASK-714: 10 citizens x 3 bands of fallback lines, each citizen with a
// stated voice and no line shared or near-duplicated between citizens.
const citizens = require('../../data/citizens.json');

test('30 citizen fallback lines: 10 voiced citizens x good/mixed/bad, all distinct', () => {
  assert.equal(citizens.length, 10);
  const seen = new Map();
  for (const c of citizens) {
    assert.ok(typeof c.voice === 'string' && c.voice.length > 10, `${c.id} has no voice note`);
    for (const band of ['good', 'mixed', 'bad']) {
      assert.ok(Array.isArray(c.lines[band]) && c.lines[band].length >= 1, `${c.id}.${band}`);
      for (const line of c.lines[band]) {
        const key = line.toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 6).join(' ');
        assert.ok(!seen.has(key), `${c.id}.${band} opens like ${seen.get(key)}`);
        seen.set(key, `${c.id}.${band}`);
      }
    }
  }
  assert.ok(seen.size >= 30);
});

// TASK-715: 10 five-year epilogues for the End Screen closing citizen:
// 5 for a Stable/Thriving ending, 5 for a Fragile/Shutdown ending.
test('10 closing citizen epilogues: 5 good/stable and 5 fragile/shutdown, <= 112 chars', () => {
  const pools = { good: [], bad: [] };
  for (const c of citizens) {
    for (const [band, text] of Object.entries(c.epilogue || {})) {
      assert.ok(band in pools, `${c.id}: unknown epilogue band ${band}`);
      // <= 112, like the longest cycle line: two lines in the End Screen quote.
      assert.ok(text.length <= 112, `${c.id}.epilogue.${band} is ${text.length} chars`);
      pools[band].push(c.id);
    }
  }
  assert.equal(pools.good.length, 5, `good: ${pools.good}`);
  assert.equal(pools.bad.length, 5, `bad: ${pools.bad}`);
  // A shutdown can end the game in Cycle 2, so bad epilogues never claim five years.
  for (const id of pools.bad) assert.doesNotMatch(citizens.find((c) => c.id === id).epilogue.bad, /five years/i, id);
});

test('the End Screen closing citizen speaks an epilogue that matches the ending', () => {
  const engine = require('../gameEngine');
  const log = console.log;
  console.log = () => {};
  try {
    for (const [gdw, ending, band] of [[48, null, 'good'], [20, null, 'bad'], [0, 'shutdown', 'bad']]) {
      const game = new engine.GameState({ roomCode: 'EPIL' });
      game.cycle = 5;
      game.gdw = gdw;
      game.ending = ending;
      game.startEndPhase();
      const closing = game.endData.closingMessage;
      const c = citizens.find((x) => x.id === closing.citizenId);
      assert.ok(c && c.epilogue && c.epilogue[band], `GDW ${gdw}: ${closing.citizenId} has no ${band} epilogue`);
      assert.equal(closing.text, c.epilogue[band]);
      game.clearPhaseTimer();
    }
  } finally {
    console.log = log;
  }
});

// TASK-716: role cards read cleanly on a 375x667 phone, in player language
// (tags are hidden from players, so no "tagged ..." jargon).
test('role cards: player-facing win conditions and phone-length card text', () => {
  const roles = require('../../data/roles.json');
  for (const r of roles) {
    assert.doesNotMatch(r.winCondition, /tagged|\btag\b/i, `${r.id} winCondition uses internal tag jargon`);
    assert.doesNotMatch(r.winCondition, /^\+1/, `${r.id} winCondition repeats the "+1 score when" heading`);
    assert.ok(r.cardText.length <= 220, `${r.id} cardText is ${r.cardText.length} chars`);
    assert.ok(r.winCondition.length <= 110, `${r.id} winCondition is ${r.winCondition.length} chars`);
  }
});

// TASK-717 / TASK-718: mechanical proofreading - spacing, punctuation,
// repeated words, quote style and a classroom word list - over every
// player- or projector-facing string in a data file.
const BANNED = /\b(damn|hell|crap|sucks?|stupid|idiot|kill yourself|sexy|drunk|shit|fuck|bitch|bastard)\b/i;

function proofread(label, text) {
  const problems = [];
  if (/ {2}/.test(text)) problems.push('double space');
  if (/\s[,.!?;:]/.test(text)) problems.push('space before punctuation');
  if (/[,!?;][A-Za-z]/.test(text) || /[a-z]\.[A-Z]/.test(text)) problems.push('missing space after punctuation');
  if (/[‘’“”]/.test(text)) problems.push('curly quotes (data uses straight quotes)');
  if (/\b(\w{2,}) \1\b/i.test(text)) problems.push('repeated word');
  if (/^\s|\s$/.test(text)) problems.push('leading/trailing whitespace');
  if (BANNED.test(text)) problems.push(`not classroom-appropriate: "${text.match(BANNED)[0]}"`);
  return problems.map((p) => `${label}: ${p}: ${text}`);
}

function strings(value, label, out = []) {
  if (typeof value === 'string') out.push([label, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${label}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${label}.${k}`, out);
  return out;
}

test('citizens.json proofreads clean', () => {
  const problems = strings(citizens, 'citizens').flatMap(([l, t]) => proofread(l, t));
  assert.deepEqual(problems, []);
});

// TASK-718: crises.json (every incident, option, intel drop, feed line and
// Loom line) proofreads clean and uses the project's American spelling.
test('crises.json proofreads clean with consistent American spelling', () => {
  const all = strings(data, 'crises');
  assert.deepEqual(all.flatMap(([l, t]) => proofread(l, t)), []);
  const british = /\b(neighbour\w*|colour\w*|behaviour\w*|labour\w*|optimis\w+|nationalis\w+|organis\w+|realis(e|ed|ing|ation)s?)\b/i;
  for (const [label, text] of [...all, ...strings(citizens, 'citizens'), ...strings(require('../../data/roles.json'), 'roles')]) {
    assert.doesNotMatch(text, british, `${label}: British spelling`);
  }
});

// TASK-719: no emoji in any content file. Role icons are plain Unicode
// symbols (geometric/astronomical), which render in the system fonts
// offline; emoji fonts and colour glyphs vary by phone.
test('zero emoji in crises.json, roles.json and citizens.json', () => {
  const fs = require('fs');
  const path = require('path');
  for (const f of ['crises.json', 'roles.json', 'citizens.json']) {
    const text = fs.readFileSync(path.join(__dirname, '../../data', f), 'utf8');
    const emoji = text.match(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|️|‍/gu);
    assert.equal(emoji, null, `${f} contains emoji: ${emoji && emoji.join(' ')}`);
  }
});
