'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const loom = require('../loom');

const OFFLINE = { enabled: false, apiKey: '', model: 'gemini-2.5-flash', timeoutMs: 8000 };
const citizens = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'citizens.json'), 'utf8'));

test('loom.narrate returns valid fallback JSON when the API key is missing', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    for (const delta of [-8, 0, 8]) {
      const out = await loom.narrate({ winningOption: { name: 'The Charter' }, simSummary: { realizedDelta: delta }, citizens });
      // Round-trips through JSON and matches the narration schema.
      const parsed = JSON.parse(JSON.stringify(out));
      assert.equal(typeof parsed.loomLine, 'string');
      assert.ok(parsed.loomLine.length > 0 && parsed.loomLine.length <= 200);
      assert.ok(Array.isArray(parsed.messages) && parsed.messages.length > 0);
      for (const m of parsed.messages) {
        assert.ok(citizens.some((c) => c.id === m.citizenId), `unknown citizen ${m.citizenId}`);
        assert.ok(typeof m.text === 'string' && m.text.length <= 140);
      }
      assert.equal(parsed.fallback, true);
    }
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
  // Explicit offline config behaves the same.
  const out = await loom.narrate({ winningOption: { name: 'X' } }, { config: OFFLINE });
  assert.equal(out.fallback, true);
});

test('loom.moderate returns valid fallback JSON when the API key is missing', async () => {
  const submissions = [
    { node: 'NODE-01', text: '  Every district elects a repair council.  ' },
    { node: 'NODE-02', text: 'x'.repeat(400) },
    { node: 'NODE-05', text: 'Open the datacenter doors on weekends.' }
  ];
  const out = await loom.moderate(submissions, { title: 'March on the Datacenter' }, { config: OFFLINE });
  const parsed = JSON.parse(JSON.stringify(out));
  assert.equal(parsed.length, submissions.length);
  const TRAITS = ['purpose', 'connection', 'health', 'trust', 'fairness', 'autonomy'];
  parsed.forEach((r, i) => {
    assert.equal(r.node, submissions[i].node);
    assert.ok(['ok', 'revise', 'reject'].includes(r.status));
    assert.ok(typeof r.cleaned === 'string' && r.cleaned.length > 0 && r.cleaned.length <= 140);
    assert.equal(typeof r.feedback, 'string');
    assert.ok(Array.isArray(r.roles));
    assert.deepEqual(Object.keys(r.effects).sort(), [...TRAITS].sort());
    for (const t of TRAITS) assert.ok(r.effects[t] >= -1 && r.effects[t] <= 1);
    assert.equal(r.fallback, true);
  });
  assert.equal(parsed[0].cleaned, 'Every district elects a repair council.');
});

test('loom never mutates the game state or scores it is given', async () => {
  const deepFreeze = (o) => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.values(o).forEach(deepFreeze);
    }
    return o;
  };
  const game = deepFreeze({
    scores: { 'NODE-01': 2, 'NODE-02': 0 },
    gdw: 31,
    crisis: { title: 'Purpose Drift', incident: 'Posts about feeling useless are spiking.' },
    winningOption: { name: 'The Guilds', text: 'Fund voluntary guilds.', roles: ['artisan'], effects: { purpose: 0.6 } },
    simSummary: { realizedDelta: 4, topMoves: [] },
    citizens
  });
  const submissions = deepFreeze([{ node: 'NODE-01', text: 'Plant a forest.' }]);
  const before = JSON.stringify({ game, submissions });

  // Online path with a mocked Gemini reply, and the offline path.
  const reply = (obj) => async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
  const online = { enabled: true, apiKey: 'test', model: 'gemini-2.5-flash', timeoutMs: 1000 };
  await loom.narrate(game, { config: online, fetchImpl: reply({ loomLine: 'Noted.', messages: [{ citizenId: 'mara', text: 'Hi.' }] }) });
  await loom.narrate(game, { config: OFFLINE });
  await loom.moderate(submissions, game.crisis, {
    config: online,
    fetchImpl: reply([{ node: 'NODE-01', status: 'ok', cleaned: 'Plant a forest.', feedback: '', roles: ['ghost'], effects: { purpose: 0.4 } }])
  });
  await loom.moderate(submissions, game.crisis, { config: OFFLINE });

  assert.equal(JSON.stringify({ game, submissions }), before);
  // The module exposes no way to set scores or GDW (moderateAndScorePolicies is
  // the prototype's alias for moderate(); it returns effect vectors, not scores).
  const LEGACY = ['moderateAndScorePolicies'];
  for (const name of Object.keys(loom)) {
    if (!LEGACY.includes(name)) assert.ok(!/score|gdw|setState/i.test(name), `unexpected export ${name}`);
  }
});

test('narrateFallback prefers the option\'s authored loomLines for the outcome band', () => {
  const option = { name: 'X', loomLine: 'single line', loomLines: { good: 'good line', mixed: 'mixed line', bad: 'bad line' } };
  assert.equal(loom.narrateFallback({ winningOption: option, simSummary: { realizedDelta: 8 } }).loomLine, 'good line');
  assert.equal(loom.narrateFallback({ winningOption: option, simSummary: { realizedDelta: 0 } }).loomLine, 'mixed line');
  assert.equal(loom.narrateFallback({ winningOption: option, simSummary: { realizedDelta: -8 } }).loomLine, 'bad line');
  assert.equal(loom.narrateFallback({ winningOption: { name: 'Y', loomLine: 'single line' }, simSummary: { realizedDelta: 8 } }).loomLine, 'single line');
});

test('narrate accepts { crisis, winningPolicy, summary, citizens } as well as the engine shape', async () => {
  const policy = { name: 'P', loomLines: { good: 'good line', mixed: 'mixed line', bad: 'bad line' } };
  const a = await loom.narrate({ crisis: { title: 'T' }, winningPolicy: policy, summary: { realizedDelta: -9 }, citizens }, { config: OFFLINE });
  const b = await loom.narrate({ crisis: { title: 'T' }, winningOption: policy, simSummary: { realizedDelta: -9 }, citizens }, { config: OFFLINE });
  assert.equal(a.loomLine, 'bad line');
  assert.deepEqual(a, b);
});

test('rankCitizensByShift puts citizens of the most-moved district and cohort first', () => {
  const summary = { topMoves: [
    { district: 'D4', cohort: 'elders', trait: 'trust', change: -0.2 },
    { district: 'D2', cohort: 'youth', trait: 'connection', change: 0.1 }
  ] };
  const ranked = loom.rankCitizensByShift(citizens, summary);
  assert.equal(ranked.length, citizens.length);
  assert.equal(ranked[0].id, 'ruth', 'D4 elder');
  assert.equal(ranked[1].id, 'kai', 'D2 youth');
});

test('narrate prompt names the most affected citizens and asks for 6-10 in character', async () => {
  let prompt = '';
  const fetchImpl = async (url, init) => {
    prompt = JSON.parse(init.body).contents[0].parts[0].text;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ loomLine: 'ok', messages: [{ citizenId: 'ruth', text: 'hi' }] }) }] } }] }) };
  };
  const out = await loom.narrate(
    { crisis: { title: 'T' }, winningOption: { name: 'P' }, simSummary: { topMoves: [{ district: 'D4', cohort: 'elders', trait: 'trust', change: -0.2 }] }, citizens },
    { config: { ...OFFLINE, enabled: true, apiKey: 'test' }, fetchImpl }
  );
  assert.equal(out.loomLine, 'ok');
  assert.match(prompt, /Most affected first: ruth \(D4 elders\)/);
  assert.match(prompt, /Pick 6-10 different citizens/);
});

test('offline narration names the most affected district and the realized shock', async () => {
  const summary = {
    realizedDelta: -4,
    topMoves: [{ district: 'D4', cohort: 'elders', trait: 'trust', change: -0.2 }],
    shocks: [{ month: 5, district: 'D2', trait: 'health', amount: 0.05 }]
  };
  const out = await loom.narrate({ winningOption: { name: 'P', loomLine: 'Done.' }, simSummary: summary, citizens }, { config: OFFLINE });
  assert.equal(out.loomLine, 'Done. D4 Eastworks moved most. A shock hit D2 in month 5.');
  // Facts are dropped (shock first) rather than overflowing 200 characters.
  const long = 'x'.repeat(170);
  assert.equal(loom.withSimFacts(long, summary), `${long} D4 Eastworks moved most.`);
  assert.equal(loom.withSimFacts('y'.repeat(199), summary), 'y'.repeat(199));
});

test('narrate sends each citizen\'s simulated mood and top trait change to Gemini', async () => {
  let prompt = '';
  const fetchImpl = async (url, init) => {
    prompt = JSON.parse(init.body).contents[0].parts[0].text;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ loomLine: 'ok', messages: [] }) }] } }] }) };
  };
  const withMood = citizens.map((c, i) => ({ ...c, mood: 20 + i, moodChange: -1.5, topChange: { trait: 'trust', change: -0.04 } }));
  await loom.narrate({ crisis: { title: 'T' }, winningOption: { name: 'P' }, simSummary: {}, citizens: withMood }, { config: { ...OFFLINE, enabled: true, apiKey: 'k' }, fetchImpl });
  assert.match(prompt, /"id":"mara"[^}]*"mood":20,"moodChange":-1\.5,"topChange":\{"trait":"trust","change":-0\.04\}/);
});
