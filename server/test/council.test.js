'use strict';

// The council redesign: five public characters with idea vectors, the 500
// simulated citizens, 0-100 per-round scoring, the public scoreboard, the
// Loom's live feed, the year 2121 and the removal of intel drops.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const engine = require('../gameEngine');
const citizens = require('../citizens');
const scoring = require('../scoring');
const { playGame } = require('./playGame');

const { roles: characters, sim } = engine.loadGameData();

test('the five council characters each carry six ideas in [-1, 1] and a group weight', () => {
  assert.deepEqual(characters.map((c) => c.id), ['optimist', 'traditionalist', 'pragmatist', 'radical', 'humanist']);
  for (const c of characters) {
    assert.deepEqual(Object.keys(c.ideas).sort(), citizens.TRAITS.slice().sort());
    for (const v of Object.values(c.ideas)) assert.ok(v >= -1 && v <= 1);
    assert.ok(c.groupWeight >= 0 && c.groupWeight <= 1);
    assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'public', c.portrait)), `${c.id} portrait exists`);
  }
  // Some care more about the group goal, some more about their own ideals.
  const byId = Object.fromEntries(characters.map((c) => [c.id, c]));
  assert.ok(byId.pragmatist.groupWeight > 0.5 && byId.radical.groupWeight < 0.5);
});

test('500 citizens are seeded deterministically across the districts and cohorts', () => {
  const a = citizens.generateCitizens(sim, characters, 1234);
  const b = citizens.generateCitizens(sim, characters, 1234);
  const c = citizens.generateCitizens(sim, characters, 99);
  assert.equal(a.length, 500);
  assert.deepEqual(a, b, 'same seed, same citizens');
  assert.notDeepEqual(a, c, 'another seed, another population');
  const districts = new Set(a.map((x) => x.district));
  assert.deepEqual([...districts].sort(), ['D1', 'D2', 'D3', 'D4', 'D5']);
  for (const x of a) {
    assert.equal(x.ideas.length, 6);
    for (const v of x.ideas) assert.ok(v >= -1 && v <= 1);
  }
  // Bigger districts get more citizens (Riverside 65k vs Old Harbour 30k).
  const count = (d) => a.filter((x) => x.district === d).length;
  assert.ok(count('D3') > count('D1'));
});

test('citizen approval counts the citizens whose ideas point the same way as the policy', () => {
  const pop = [
    { district: 'D1', lean: 'optimist', ideas: [1, 0, 0, 0, 0, 0] },
    { district: 'D1', lean: 'radical', ideas: [-1, 0, 0, 0, 0, 0] },
    { district: 'D2', lean: 'optimist', ideas: [0.5, 0.5, 0, 0, 0, 0] }
  ];
  const r = citizens.approval(pop, { purpose: 0.8 });
  assert.equal(r.approve, 2);
  assert.equal(r.total, 3);
  assert.deepEqual(r.byDistrict.D1, { approve: 1, total: 2 });
  assert.equal(citizens.approval(pop, {}).approve, 0, 'a policy that changes nothing wins nobody over');
});

test('scoreRound gives 0-100 points, weighted between personal fit and the council goal', () => {
  const ideal = { ideas: { purpose: 1, connection: 0, health: 0, trust: 0, fairness: 0, autonomy: 0 }, groupWeight: 0 };
  const groupie = { ...ideal, groupWeight: 1 };
  const aligned = { purpose: 0.9 };
  const opposed = { purpose: -0.9 };
  assert.equal(scoring.scoreRound(ideal, aligned).points, 100, 'perfectly aligned, all personal');
  assert.equal(scoring.scoreRound(ideal, opposed).points, 0, 'directly opposed, all personal');
  assert.equal(scoring.scoreRound(groupie, opposed, { satisfactionDelta: 10, approvalShare: 1 }).points, 100, 'the group goal is all that counts');
  assert.equal(scoring.scoreRound(groupie, aligned, { satisfactionDelta: -10, approvalShare: 0 }).points, 0);
  assert.equal(scoring.scoreRound(ideal, aligned, { shutdown: true }).points, 0, 'a shutdown round is worth nothing');
  for (let i = 0; i < 200; i++) {
    const fx = Object.fromEntries(citizens.TRAITS.map((t) => [t, Math.round((Math.random() * 2 - 1) * 10) / 10]));
    for (const c of characters) {
      const { points } = scoring.scoreRound(c, fx, { satisfactionDelta: Math.random() * 30 - 15, approvalShare: Math.random() });
      assert.ok(Number.isInteger(points) && points >= 0 && points <= 100);
    }
  }
});

test('a full game: public council, 0-100 per round, scores after every round, the Loom speaks, 2121-2125, no intel', async () => {
  const out = await playGame({ gameId: 'council-flow', world: 'AA' });
  // Characters are public: one council broadcast with all five seats.
  assert.equal(out.council.length, 1);
  assert.deepEqual(out.council[0].members.map((m) => m.node), engine.NODE_IDS);
  assert.deepEqual(out.council[0].members.map((m) => m.character.id).sort(), characters.map((c) => c.id).sort());
  for (const m of out.council[0].members) assert.ok(!('ideas' in m.character), 'only public card fields');

  // Every round scores every member 0-100; the public scoreboard follows.
  assert.equal(out.scores.length, 5, 'a scoreboard after each of the five rounds');
  for (const u of out.scoreUpdates) assert.ok(u.gained >= 0 && u.gained <= 100 && typeof u.personal === 'number' && typeof u.group === 'number');
  const last = out.scores[out.scores.length - 1];
  assert.equal(last.maxTotal, 500);
  assert.ok(last.rows.every((r, i, a) => i === 0 || a[i - 1].total >= r.total), 'ranked best first');
  for (const r of last.rows) assert.equal(r.total, out.game.scores[r.node]);

  // The phases carry the year; there is no intel step.
  assert.ok(!out.phases.some((p) => p.endsWith(':INTEL')));
  assert.equal(out.intel.length, 0);
  const years = new Set(out.payloads.filter((p) => p.phase === 'INCIDENT').map((p) => p.year));
  assert.deepEqual([...years], [2121, 2122, 2123, 2124, 2125]);

  // The Loom's live feed: the intro, every crisis and every verdict.
  const kinds = out.loomLines.map((l) => l.kind);
  assert.ok(kinds.filter((k) => k === 'crisis').length === 5);
  assert.ok(kinds.filter((k) => k === 'verdict').length >= 4);
  assert.ok(out.loomLines[0].text.includes('2121'), 'the intro states the year');
  assert.ok(out.loomLines.some((l) => l.text === engine.GAME_GOAL), 'the goal is stated up front');
  assert.ok(kinds.includes('world') && kinds.includes('end'));

  // DEBATE carries the citizen poll; resolutions carry citizen approval.
  const debate = out.payloads.find((p) => p.phase === 'DEBATE');
  assert.ok(debate.poll && debate.poll.A >= 0 && debate.poll.A <= 100);
  assert.equal(out.resolutions[0].result.approval.total, 500);

  // The End Screen champion: the top score with the character's profile.
  const champ = out.gameEnd.champion;
  if (out.gameEnd.shutdown) assert.equal(champ, null);
  else {
    assert.equal(champ.total, Math.max(...Object.values(out.gameEnd.scores)));
    assert.ok(champ.character && champ.character.portrait && champ.character.ideas);
  }
  assert.equal(out.gameEnd.maxScore, 500);
});

test('the game says "Societal Satisfaction", never GDW, and no "//" anywhere on screen', () => {
  const root = path.join(__dirname, '..', '..', 'public');
  for (const f of ['index.html', 'mobile.html']) {
    const html = fs.readFileSync(path.join(root, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    const text = html.replace(/<[^>]+>/g, ' ').replace(/https?:\/\//g, '');
    assert.ok(!/\/\//.test(text), `${f} shows no "//"`);
    assert.ok(!/Gross Domestic|\bGDW\b|intel drop/i.test(text), `${f} uses the new wording`);
  }
  for (const f of ['js/host.js', 'js/mobile.js', 'js/council.js', 'js/charts.js']) {
    const js = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of js.matchAll(/(['`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
      if (/https?:|\$\{location\.protocol\}/.test(m[2])) continue;
      assert.ok(!m[2].includes('//'), `${f}: string "${m[2].slice(0, 60)}" shows "//"`);
    }
  }
});

test('mathbold converts titles to Unicode Mathematical Bold and back', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'mathbold.js'), 'utf8');
  const sandbox = { window: {}, document: { readyState: 'loading', addEventListener() {} } };
  vm.runInNewContext(src, sandbox);
  const { toMathBold, fromMathBold } = sandbox.window.LoomMathBold;
  assert.equal(toMathBold('The Loom 2121'), '\u{1D413}\u{1D421}\u{1D41E} \u{1D40B}\u{1D428}\u{1D428}\u{1D426} \u{1D7D0}\u{1D7CF}\u{1D7D0}\u{1D7CF}');
  assert.equal(fromMathBold(toMathBold('Who Owns the Loom? 99%')), 'Who Owns the Loom? 99%');
});
