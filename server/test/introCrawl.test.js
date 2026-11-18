'use strict';

// TASK-712: the Intro Crawl (public/index.html + its spoken script in
// public/js/host.js) hits every MVP beat and finishes inside the 30 s INTRO.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
const hostJs = fs.readFileSync(path.join(__dirname, '../../public/js/host.js'), 'utf8');
const { DEFAULT_PHASE_SECONDS } = require('../gameEngine');

const crawl = html.match(/<div id="intro-crawl"[^>]*>([\s\S]*?)<\/div>/)[1];
const paragraphs = [...crawl.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
const spoken = new Function(`return ${hostJs.match(/const spokenScripts = (\[[\s\S]*?\]);/)[1]}`)();

test('the crawl hits the MVP beats: the Loom, 25% GDW, 94% revolt, the secret council', () => {
  const text = paragraphs.join(' ');
  for (const beat of [/Loom/, /25%/, /94%/, /revolt/, /in secret/, /Five crises/, /zero/]) assert.match(text, beat);
});

test('one spoken line per crawl paragraph', () => {
  assert.equal(spoken.length, paragraphs.length);
});

test('spoken narration fits the 30 s INTRO (rate 0.9 speech and the silent fallback)', () => {
  const introMs = DEFAULT_PHASE_SECONDS.INTRO * 1000;
  const pauses = (spoken.length - 1) * 380;
  // Silent fallback: 2.8 s per paragraph.
  assert.ok(spoken.length * 2800 + pauses <= introMs, 'fallback overruns INTRO');
  // Speech: ~2.5 words/s at rate 0.9 is a conservative TTS pace.
  const words = spoken.join(' ').split(/\s+/).length;
  assert.ok(words / 2.5 * 1000 + pauses <= introMs, `${words} spoken words overrun INTRO`);
});
