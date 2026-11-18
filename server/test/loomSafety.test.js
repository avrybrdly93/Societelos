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
