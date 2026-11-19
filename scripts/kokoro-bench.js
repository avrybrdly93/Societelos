'use strict';

// How fast is the free Kokoro voice on THIS machine?  npm run bench:voice
// Prints the time to load the model and to speak two typical lines, and whether
// it can keep up with real time. Needs: npm install (kokoro-js) and internet
// on the very first run (model download). Not part of the game or the tests.

const os = require('os');
const { createKokoro } = require('../server/kokoro');

const LINES = [
  'I cannot compute purpose.',
  'Survival for two hundred fifty thousand citizens is mathematically guaranteed. I cannot compute purpose.'
];

(async () => {
  const cpus = os.cpus();
  console.log(`CPU: ${cpus.length} x ${cpus[0] && cpus[0].model}, ${(os.totalmem() / 1e9).toFixed(1)} GB RAM, node ${process.version}`);
  const lines = [];
  const k = createKokoro({ env: { ...process.env, KOKORO_TIMEOUT_MS: '300000' }, logger: (m) => { lines.push(m); console.log(m); } });
  let t0 = Date.now();
  k.warm();
  while (!k.isReady()) {
    if (lines.some((m) => /could not load/.test(m))) { console.log('FAILED to load: see message above.'); process.exit(1); }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`model loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const text of [...LINES, ...LINES]) { // second pass: warmed up
    t0 = Date.now();
    const wav = await k.generate(text);
    console.log(wav ? `  ${((Date.now() - t0) / 1000).toFixed(1)}s for ${text.length} characters` : '  FAILED');
  }
  process.exit(0);
})();
