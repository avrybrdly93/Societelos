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

test('loom.narrate times out cleanly at 8,000 ms and returns fallback citizen messages', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  // A network that never answers until the request is aborted.
  const hangingFetch = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      aborted = true;
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    let settled = false;
    const pending = loom.narrate(
      { winningOption: { name: 'P' }, simSummary: { realizedDelta: 5 }, citizens },
      { config: { ...OFFLINE, enabled: true, apiKey: 'k' }, fetchImpl: hangingFetch }
    ).then((r) => { settled = true; return r; });
    await Promise.resolve();
    t.mock.timers.tick(7999);
    await new Promise((r) => setImmediate(r));
    assert.equal(settled, false, 'still waiting just before 8 s');
    assert.equal(aborted, false);
    t.mock.timers.tick(1);
    const out = await pending;
    assert.equal(aborted, true, 'request aborted at 8 s');
    assert.equal(out.fallback, true);
    assert.ok(out.loomLine.length > 0);
    assert.ok(out.messages.length > 0 && out.messages.every((m) => citizens.some((c) => c.id === m.citizenId)));
  } finally {
    console.warn = warn;
  }
});

/** A fetch stub returning `payload` as Gemini's JSON text. */
const geminiReturns = (payload) => async () => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] })
});
const ONLINE = { ...OFFLINE, enabled: true, apiKey: 'k' };

test('loom.narrate strips emoji the model outputs despite instructions', async () => {
  const out = await loom.narrate(
    { winningOption: { name: 'P' }, simSummary: {}, citizens },
    { config: ONLINE, fetchImpl: geminiReturns({ loomLine: 'The council has chosen \u{1F916} wisely.', messages: [{ citizenId: 'kai', text: 'best day ever \u{1F389}\u{1F389} \u{1F44D}\u{1F3FD}' }, { citizenId: 'ruth', text: '\u{1F600}' }] }) }
  );
  assert.equal(out.loomLine, 'The council has chosen wisely.');
  assert.deepEqual(out.messages, [{ citizenId: 'kai', text: 'best day ever' }], 'emoji-only message dropped');
  assert.ok(!/\p{Extended_Pictographic}/u.test(JSON.stringify(out)));
});

test('loom.narrate truncates a 250-character citizen message to 140 characters cleanly', async () => {
  const words = 'The grid hums again and the kids are back at the river and nobody quite knows who to thank for it. ';
  const long = words.repeat(3).slice(0, 250);
  assert.equal(long.length, 250);
  const out = await loom.narrate(
    { winningOption: { name: 'P' }, simSummary: {}, citizens },
    { config: ONLINE, fetchImpl: geminiReturns({ loomLine: 'x'.repeat(260), messages: [{ citizenId: 'mara', text: long }] }) }
  );
  const text = out.messages[0].text;
  assert.ok(text.length <= 140, `length ${text.length}`);
  assert.ok(text.endsWith('…'), 'ends with an ellipsis');
  assert.ok(long.startsWith(text.slice(0, -1)), 'a prefix of the original');
  assert.ok(/\w…$/.test(text), 'cut at a word boundary, no dangling space or punctuation');
  assert.ok(out.loomLine.length <= 200);
});

test('narrate fallback never repeats a citizen in the same resolution feed', async () => {
  const doubled = [...citizens, ...citizens.map((c) => ({ ...c }))];
  const out = await loom.narrate({ winningOption: { name: 'P' }, simSummary: { realizedDelta: 4, topMoves: [{ district: 'D5', cohort: 'youth', trait: 'autonomy', change: 0.3 }] }, citizens: doubled }, { config: OFFLINE });
  const ids = out.messages.map((m) => m.citizenId);
  assert.equal(new Set(ids).size, ids.length, `duplicates in ${ids}`);
  assert.equal(ids.length, 6);
  assert.equal(ids[0], 'sol', 'most affected citizen (D5 youth) speaks first');
  // Authored reactions fallback is de-duplicated too.
  const reactions = [{ citizenId: 'kai', text: 'a' }, { citizenId: 'kai', text: 'b' }, { citizenId: 'lin', text: 'c' }];
  const out2 = await loom.narrate({ winningOption: { name: 'P', reactions }, simSummary: {} }, { config: OFFLINE });
  assert.deepEqual(out2.messages.map((m) => m.citizenId), ['kai', 'lin']);
});

// ---------------------------------------------------------------------------
// Finale moderation (Stream 4, TASK-536+)
// ---------------------------------------------------------------------------

/** A fetch stub that records each request body and answers with `respond(body)`. */
function recordingFetch(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, prompt: body.contents[0].parts[0].text });
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(respond(body)) }] } }] }) };
  };
  return { calls, fetchImpl };
}
const FINALE_CRISIS = {
  id: 'bb-march-datacenter', title: 'March on the Datacenter', mode: 'writein',
  incident: 'Over 100,000 citizens converge outside the central Loom server monolith.',
  options: {
    A: { name: 'Open the Server Gates', text: 'Grant citizen representatives direct executive keys to The Loom.', roles: ['ghost', 'artisan'], effects: { purpose: 0.4, connection: 0.3, health: -0.5, trust: 0.2, fairness: 0.5, autonomy: 0.6 } },
    B: { name: 'Acoustic Lockdown', text: 'Disperse the crowd with non-lethal sensory barriers.', roles: ['assimilator', 'lotus'], effects: { purpose: -0.5, connection: -0.4, health: 0.4, trust: -0.6, fairness: -0.6, autonomy: -0.7 } }
  }
};
const FIVE = ['Every district elects a repair council.', 'A luxury dividend for all.', 'Neural links for every adult.', 'Shut the servers one day a week.', 'Keep things as they are.']
  .map((text, i) => ({ node: `NODE-0${i + 1}`, text }));
const okFor = (list) => list.map((s, i) => ({ node: s.node, status: 'ok', cleaned: `Cleaned ${i + 1}`, feedback: '', roles: ['artisan'], effects: { purpose: 0.1 * i, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: 0 } }));

test('loom.moderate sends all 5 write-ins and the Cycle 5 crisis in one batch call, results mapped by node', async () => {
  const { calls, fetchImpl } = recordingFetch((body) => okFor(JSON.parse(body.contents[0].parts[0].text.split('\n\n').pop())).reverse());
  const out = await loom.moderate(FIVE, FINALE_CRISIS, { config: ONLINE, fetchImpl });
  assert.equal(calls.length, 1, 'one Gemini call for the whole council');
  assert.match(calls[0].prompt, /March on the Datacenter/);
  assert.match(calls[0].prompt, /100,000 citizens/);
  for (const s of FIVE) assert.ok(calls[0].prompt.includes(s.text), `prompt carries ${s.node}`);
  assert.deepEqual(out.map((r) => r.node), FIVE.map((s) => s.node), 'same order as submitted, even if Gemini reorders');
  assert.deepEqual(out.map((r) => r.cleaned), ['Cleaned 1', 'Cleaned 2', 'Cleaned 3', 'Cleaned 4', 'Cleaned 5']);
  assert.ok(out.every((r) => !r.fallback));
});

test('loom.moderate embeds few-shot calibration: authored policies with exact effect vectors and role tags', async () => {
  const { calls, fetchImpl } = recordingFetch((body) => okFor(JSON.parse(body.contents[0].parts[0].text.split('\n\n').pop())));
  await loom.moderate(FIVE, FINALE_CRISIS, { config: ONLINE, fetchImpl });
  const prompt = calls[0].prompt;
  assert.match(prompt, /Calibration examples/);
  const examples = loom.calibrationExamples(FINALE_CRISIS);
  assert.ok(prompt.includes(JSON.stringify(examples)), 'examples sent verbatim');
  // The crisis's own A/B first, exactly as authored...
  assert.deepEqual(examples[0], { policy: FINALE_CRISIS.options.A.text, roles: ['ghost', 'artisan'], effects: FINALE_CRISIS.options.A.effects });
  assert.deepEqual(examples[1].effects, FINALE_CRISIS.options.B.effects);
  // ...then Fixed Crisis 1's options from data/crises.json as anchors.
  const data = require('../../data/crises.json');
  const fixed1 = data.crises.find((c) => c.world === 'fixed' && c.cycle === 1);
  assert.deepEqual(examples[2].effects, loom.cleanEffects(fixed1.options.A.effects));
  assert.equal(examples.length, 4);
  // The submissions come last, after the calibration block.
  assert.ok(prompt.indexOf('Calibration examples') < prompt.indexOf(FIVE[0].text));
});

test('loom.moderate requests temperature 0.2 and a JSON responseSchema of { node, status, cleaned, feedback, roles, effects }', async () => {
  const { calls, fetchImpl } = recordingFetch((body) => okFor(JSON.parse(body.contents[0].parts[0].text.split('\n\n').pop())));
  await loom.moderate(FIVE, FINALE_CRISIS, { config: ONLINE, fetchImpl });
  const cfg = calls[0].body.generationConfig;
  assert.equal(cfg.temperature, 0.2);
  assert.equal(cfg.responseMimeType, 'application/json');
  assert.equal(cfg.responseSchema.type, 'ARRAY');
  const item = cfg.responseSchema.items;
  assert.deepEqual([...item.required].sort(), ['cleaned', 'effects', 'feedback', 'node', 'roles', 'status']);
  assert.deepEqual(item.properties.status.enum, ['ok', 'revise', 'reject']);
  assert.deepEqual(item.properties.roles.items.enum, ['artisan', 'lotus', 'assimilator', 'ghost']);
  assert.deepEqual([...item.properties.effects.required].sort(), ['autonomy', 'connection', 'fairness', 'health', 'purpose', 'trust']);
  assert.ok(calls[0].url.endsWith(':generateContent'));
});

test('moderation rules: ok rewrites (140), revise for crude/off-topic/personal attacks with kind feedback (200, no lecturing), reject for unsafe or a failed revision', async () => {
  const sp = loom.SYSTEM_PROMPT;
  assert.match(sp, /status "ok": rewrite it as one clear, neutral policy sentence \(max 140 characters\) that preserves the author's intent/);
  assert.match(sp, /status "revise": it is crude, off-topic, a joke, or a personal attack/);
  assert.match(sp, /kind, specific private feedback \(max 200 characters\)/);
  assert.match(sp, /Do not lecture/);
  assert.match(sp, /status "reject": the content is unsafe .*or it is a second attempt that still fails after feedback/);
  // The system prompt rides on every moderation request.
  const { calls, fetchImpl } = recordingFetch((body) => okFor(JSON.parse(body.contents[0].parts[0].text.split('\n\n').pop())));
  await loom.moderate(FIVE, FINALE_CRISIS, { config: ONLINE, fetchImpl });
  assert.equal(calls[0].body.systemInstruction.parts[0].text, sp);
  assert.doesNotMatch(calls[0].prompt, /second attempts/);
});

