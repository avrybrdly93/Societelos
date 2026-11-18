'use strict';

// Loom classroom safety (TASK-746 onward): API-layer safety filters, what
// happens when Gemini blocks a request, and the local pre-filter.

const test = require('node:test');
const assert = require('node:assert/strict');

const loom = require('../loom');

const cfg = { apiKey: 'k', enabled: true, model: 'gemini-test', timeoutMs: 8000 };
const quiet = { logger: () => {} };
const reply = (payload) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => payload });
const answer = (obj) => reply({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const CRISIS = { title: 'The Fake Struggle Scandal', incident: 'Leaked logs show the Loom staged challenges.' };

function silenceWarn(t) {
  const warn = console.warn;
  console.warn = () => {};
  t.after(() => { console.warn = warn; });
}

// TASK-746
test('every Gemini request blocks harassment, hate speech, sexual and dangerous content at the API layer', async () => {
  let body = null;
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return answer({ loomLine: 'Noted.', messages: [] }); };
  await loom.callGemini('hello', { ...quiet, config: cfg, fetchImpl });
  const cats = Object.fromEntries(body.safetySettings.map((s) => [s.category, s.threshold]));
  for (const c of ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']) {
    assert.ok(['BLOCK_MEDIUM_AND_ABOVE', 'BLOCK_LOW_AND_ABOVE'].includes(cats[c]), `${c}: ${cats[c]}`);
  }
});

test('a safety-blocked prompt or answer is reported as LOOM_SAFETY_BLOCK, never as content', async () => {
  const blockedPrompt = async () => reply({ promptFeedback: { blockReason: 'SAFETY' } });
  await assert.rejects(loom.callGemini('x', { ...quiet, config: cfg, fetchImpl: blockedPrompt }), { code: 'LOOM_SAFETY_BLOCK' });
  const blockedAnswer = async () => reply({ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: '{"loomLine":"x"}' }] } }] });
  await assert.rejects(loom.callGemini('x', { ...quiet, config: cfg, fetchImpl: blockedAnswer }), { code: 'LOOM_SAFETY_BLOCK' });
});

test('a blocked moderation batch is re-moderated one by one: only the unsafe write-in is rejected', async (t) => {
  silenceWarn(t);
  const UNSAFE = 'UNSAFE-WRITE-IN-PLACEHOLDER';
  const fetchImpl = async (url, init) => {
    const prompt = JSON.parse(init.body).contents[0].parts[0].text;
    const list = JSON.parse(prompt.split('\n\n').pop());
    if (list.some((s) => s.text.includes(UNSAFE))) return reply({ promptFeedback: { blockReason: 'SAFETY' } });
    return answer(list.map((s) => ({ node: s.node, status: 'ok', cleaned: `Clean: ${s.text}`, feedback: '', roles: ['artisan'], effects: { purpose: 0.2, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: -0.1 } })));
  };
  const subs = [
    { node: 'NODE-01', text: 'Every district funds a repair guild.' },
    { node: 'NODE-02', text: UNSAFE },
    { node: 'NODE-03', text: 'Publish every staged challenge.' }
  ];
  const out = await loom.moderate(subs, CRISIS, { ...quiet, config: cfg, fetchImpl });
  assert.deepEqual(out.map((r) => r.status), ['ok', 'reject', 'ok']);
  assert.equal(out[1].cleaned, '', 'the blocked text is never returned');
  assert.equal(out[1].safetyBlocked, true);
  assert.equal(out[0].cleaned, 'Clean: Every district funds a repair guild.');
  assert.ok(!out.some((r) => r.fallback), 'the class keeps its write-ins (no A/B fallback)');
});

test('a blocked narration falls back to the authored Loom line', async (t) => {
  silenceWarn(t);
  const fetchImpl = async () => reply({ candidates: [{ finishReason: 'SAFETY' }] });
  const n = await loom.narrate({ crisis: { title: 'T' }, winningOption: { name: 'A', loomLines: { good: 'Authored good.', mixed: 'Authored mixed.', bad: 'Authored bad.' } }, summary: { realizedDelta: 5 } }, { ...quiet, config: cfg, fetchImpl });
  assert.equal(n.fallback, true);
  assert.match(n.loomLine, /^Authored good\./);
});

// TASK-747: the local pre-filter.
test('the pre-filter catches blatant profanity, slurs and disguises (leetspeak, f.u.c.k, F U C K)', () => {
  for (const text of ['this policy is sh1t', 'f.u.c.k the owners', 'F U C K the board', 'you are a b!tch', 'go kill yourself', 'Ban p0rn in the pods', 'you fuckers']) {
    assert.ok(loom.localPrefilter(text), `missed: ${text}`);
  }
});

test('the pre-filter never flags game vocabulary or any authored text in the data files', () => {
  for (const text of ['Give 5 elected leaders kill-switch keys.', 'The grid is dead; train keepers.', 'Shut down the Loom for good.', 'Sex education for every teen.', 'Expropriate the shitake farms.', 'Fukushima-style reactor checks.', 'Scunthorpe gets a library.']) {
    assert.equal(loom.localPrefilter(text), null, text);
  }
  const strings = [];
  const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  ['crises', 'citizens', 'roles'].forEach((f) => walk(require(`../../data/${f}.json`)));
  for (const text of strings) assert.equal(loom.localPrefilter(text), null, `false positive on authored text: ${text}`);
});

test('pre-filtered write-ins come back "revise" instantly, even offline, and never reach Gemini', async (t) => {
  silenceWarn(t);
  const subs = [{ node: 'NODE-01', text: 'Fund repair guilds in every district.' }, { node: 'NODE-02', text: 'this policy is sh1t' }];
  // Offline (no key): the flagged one is a real "revise", the clean one a fallback.
  const offline = await loom.moderate(subs, CRISIS, { config: { ...cfg, enabled: false } });
  assert.equal(offline[1].status, 'revise');
  assert.equal(offline[1].cleaned, '');
  assert.ok(offline[1].feedback.length > 20 && offline[1].prefiltered && !offline[1].fallback);
  assert.equal(offline[0].fallback, true);
  // Online: only the clean write-in is sent to Gemini.
  let sent = null;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text.split('\n\n').pop());
    return answer(sent.map((s) => ({ node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: [], effects: { purpose: 0, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: 0 } })));
  };
  const online = await loom.moderate(subs, CRISIS, { ...quiet, config: cfg, fetchImpl });
  assert.deepEqual(sent.map((s) => s.node), ['NODE-01']);
  assert.deepEqual(online.map((r) => r.status), ['ok', 'revise']);
  // A revision with blatant language is final.
  const [rev] = await loom.moderate([subs[1]], CRISIS, { ...quiet, config: cfg, fetchImpl, revision: true });
  assert.equal(rev.status, 'reject');
});

test('any unmoderated (fallback) write-in sends Cycle 5 to the authored A/B finale', async () => {
  const { playGame, withLoom } = require('./playGame');
  // One write-in judged by the Loom, the rest unavailable: never show the unmoderated ones.
  const mixed = (subs) => subs.map((s, i) => (i === 0
    ? { node: s.node, status: 'revise', cleaned: '', feedback: 'Rephrase.', roles: [], effects: {}, prefiltered: true }
    : { node: s.node, status: 'ok', cleaned: s.text, feedback: '', roles: [], effects: {}, fallback: true }));
  const out = await withLoom({ moderate: async (subs) => mixed(subs) }, () => playGame({ gameId: 'mixed-fallback', world: 'AA' }));
  assert.equal(out.gameEnd.finaleMode, 'fallback');
  assert.ok(!out.phases.includes('5:FINALE_DEBATE'), 'no write-ins were shown on the projector');
});

// TASK-748: raw, unmoderated student text never comes back in `cleaned`,
// whatever fails: no key, network down, timeout, HTTP error, bad JSON, a
// node Gemini skipped, an "ok" with no cleaned text, or a safety block.
test('raw student text is never returned in cleaned under any error or timeout', async (t) => {
  silenceWarn(t);
  const MARK = 'RAWMARKER';
  const subs = [{ node: 'NODE-01', text: `${MARK} one plan for the district guilds` }, { node: 'NODE-02', text: `${MARK} two plan for shared pods` }];
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const scenarios = {
    'no key': { config: { ...cfg, enabled: false } },
    'network down': { fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } },
    timeout: { config: { ...cfg, timeoutMs: 30 }, fetchImpl: hang },
    'HTTP 500': { fetchImpl: async () => ({ ok: false, status: 500, headers: { get: () => null } }) },
    'bad JSON': { fetchImpl: async () => reply({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }) },
    'safety block': { fetchImpl: async () => reply({ promptFeedback: { blockReason: 'SAFETY' } }) }
  };
  for (const [label, o] of Object.entries(scenarios)) {
    for (const revision of [false, true]) {
      const out = await loom.moderate(subs, CRISIS, { ...quiet, config: cfg, ...o, revision });
      for (const r of out) {
        const unmoderated = r.fallback || r.safetyBlocked || r.status !== 'ok';
        if (unmoderated) assert.equal(r.cleaned, '', `${label}${revision ? ' (revision)' : ''}: ${r.node} leaked "${r.cleaned}"`);
      }
    }
    const [one] = [await loom.moderateOne(subs[0], CRISIS, { ...quiet, config: cfg, ...o })];
    if (one.fallback || one.status !== 'ok') assert.equal(one.cleaned, '', `${label}: moderateOne leaked`);
  }
  // Gemini answers but skips NODE-02 and returns "ok" with no cleaned text for NODE-01:
  // both are judged locally (heuristic), never echoed back unjudged.
  const partial = async () => answer([{ node: 'NODE-01', status: 'ok', cleaned: '', feedback: '', roles: [], effects: {} }]);
  const out = await loom.moderate(subs, CRISIS, { ...quiet, config: cfg, fetchImpl: partial });
  for (const r of out) assert.equal(r.heuristic, true, `${r.node} judged locally`);
});

test('the engine never puts a raw submission on the projector when cleaned text is missing', async () => {
  const { playGame, withLoom } = require('./playGame');
  // An "ok" with no cleaned text (a broken moderation result) becomes the placeholder.
  const noText = (subs) => subs.map((s, i) => ({ node: s.node, status: 'ok', cleaned: i === 0 ? '' : `Policy ${i}.`, feedback: '', roles: ['artisan'], effects: { purpose: 0.1, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: 0 } }));
  const out = await withLoom({ moderate: async (subs) => noText(subs) }, () => playGame({ gameId: 'no-cleaned-text', world: 'AB', writeIn: (i) => `RAWMARKER submission ${i}` }));
  const shown = out.ballots.flatMap((b) => b.policies.map((p) => p.text));
  assert.ok(shown.length > 0);
  for (const text of shown) assert.doesNotMatch(text, /RAWMARKER/, 'raw submission reached a ballot');
});

// TASK-749: the few-shot calibration examples are read from data/crises.json
// at runtime, so they always carry the final tuned vectors: for each world's
// finale, exactly as the engine hands it to loom.moderate.
test('moderation few-shot examples match the tuned effect vectors and tags in data/crises.json', () => {
  const engine = require('../gameEngine');
  const data = require('../../data/crises.json');
  const fixed1 = data.crises.find((c) => c.world === 'fixed' && c.cycle === 1);
  for (const world of ['AA', 'AB', 'BA', 'BB']) {
    const crisis = engine.selectCrisis(data, 5, world);
    const raw = data.crises.find((c) => c.id === data.worlds[world].finale);
    const examples = loom.calibrationExamples(crisis);
    assert.equal(examples.length, 4, world);
    const expected = [raw.options.A, raw.options.B, fixed1.options.A, fixed1.options.B];
    examples.forEach((e, i) => {
      assert.deepEqual(e.effects, loom.cleanEffects(expected[i].effects), `${world} example ${i + 1} effects`);
      assert.deepEqual(e.roles, loom.cleanRoles(expected[i].roles), `${world} example ${i + 1} roles`);
      assert.equal(e.policy, expected[i].text, `${world} example ${i + 1} text`);
    });
  }
});
