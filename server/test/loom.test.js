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
