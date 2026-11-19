#!/usr/bin/env node
'use strict';

// Validates data/roles.json, data/citizens.json and data/crises.json against
// the frozen schema in data/SCHEMA.md. No dependencies. Exit code 1 on errors.

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const ROLE_KEYS = ['optimist', 'traditionalist', 'pragmatist', 'radical', 'humanist']; // the five council characters
const AGENDA_KEYS = ['artisan', 'lotus', 'assimilator', 'catalyst', 'ghost']; // legacy keys still used by crisis data
const TAGS = ['artisan', 'lotus', 'assimilator', 'ghost'];
const TRAITS = ['purpose', 'connection', 'health', 'trust', 'fairness', 'autonomy'];
const DISTRICTS = ['D1', 'D2', 'D3', 'D4', 'D5'];
const COHORTS = ['youth', 'workers', 'elders', 'elite'];
const WORLDS = ['AA', 'AB', 'BA', 'BB'];
const BANDS = ['good', 'mixed', 'bad'];

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

function load(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
  } catch (e) {
    err(name, `invalid JSON (${e.message})`);
    return null;
  }
}

function checkEffects(where, effects) {
  if (!effects || typeof effects !== 'object') return err(where, 'effects missing');
  for (const k of Object.keys(effects)) if (!TRAITS.includes(k)) err(where, `unknown trait "${k}"`);
  for (const t of TRAITS) {
    const v = effects[t];
    if (typeof v !== 'number' || v < -1 || v > 1) err(where, `trait "${t}" must be a number in [-1, 1]`);
  }
  return undefined;
}

function checkRoles(roles) {
  if (!Array.isArray(roles) || roles.length !== 5) return err('roles.json', 'must be an array of 5 roles');
  const ids = roles.map((r) => r.id);
  for (const key of ROLE_KEYS) if (!ids.includes(key)) err('roles.json', `missing role "${key}"`);
  roles.forEach((r, i) => {
    for (const f of ['id', 'name', 'icon', 'goal', 'winCondition', 'cardText', 'motto', 'portrait']) if (!isStr(r[f])) err(`roles.json[${i}]`, `"${f}" required`);
    if (!r.ideas || TRAITS.some((t) => typeof r.ideas[t] !== 'number' || r.ideas[t] < -1 || r.ideas[t] > 1)) err(`roles.json[${i}]`, '"ideas" needs all six traits in [-1, 1]');
    if (!(typeof r.groupWeight === 'number' && r.groupWeight >= 0 && r.groupWeight <= 1)) err(`roles.json[${i}]`, '"groupWeight" must be in [0, 1]');
  });
  return undefined;
}

function checkCitizens(citizens) {
  if (!Array.isArray(citizens) || citizens.length !== 10) return err('citizens.json', 'must be an array of 10 citizens');
  citizens.forEach((c, i) => {
    const where = `citizens.json[${c.id || i}]`;
    for (const f of ['id', 'name', 'voice']) if (!isStr(c[f])) err(where, `"${f}" required`);
    if (!Number.isInteger(c.age)) err(where, '"age" must be an integer');
    if (!DISTRICTS.includes(c.district)) err(where, `district must be one of ${DISTRICTS}`);
    if (!COHORTS.includes(c.cohort)) err(where, `cohort must be one of ${COHORTS}`);
    for (const b of BANDS) {
      const lines = c.lines && c.lines[b];
      if (!Array.isArray(lines) || !lines.length || !lines.every(isStr)) err(where, `lines.${b} needs at least one line`);
      else lines.forEach((l) => { if (l.length > 140) err(where, `lines.${b} line over 140 chars`); });
    }
  });
  return undefined;
}

// Writing rule: every option must hurt at least one trait, so neither choice
// is a free win. Applies to each world variant of an effectsByWorld option.
function checkHasCost(where, effects) {
  if (!effects || typeof effects !== 'object') return;
  if (!TRAITS.some((t) => typeof effects[t] === 'number' && effects[t] < 0)) {
    err(where, 'writing rule: the option must hurt at least one trait (no free wins)');
  }
}

function checkOption(where, o, crisis) {
  if (!o) return err(where, 'missing');
  if (!isStr(o.name)) err(where, '"name" required');
  if (!isStr(o.text)) err(where, '"text" required');
  const roleSets = o.rolesByWorld ? Object.values(o.rolesByWorld) : [o.roles];
  roleSets.forEach((roles) => {
    if (!Array.isArray(roles)) return err(where, '"roles" must be an array');
    if (roles.length > 2) err(where, 'at most 2 role tags');
    return roles.forEach((r) => { if (!TAGS.includes(r)) err(where, `unknown role tag "${r}"`); });
  });
  if (o.draft === true && !o.effects && !o.effectsByWorld) {
    warnings.push(`${where}: draft option, effect vector not authored yet`);
  } else if (o.effectsByWorld) {
    for (const [k, e] of Object.entries(o.effectsByWorld)) {
      checkEffects(`${where}.effectsByWorld.${k}`, e);
      checkHasCost(`${where}.effectsByWorld.${k}`, e);
    }
  } else {
    checkEffects(where, o.effects);
    checkHasCost(where, o.effects);
  }
  if (o.loomLines !== undefined) {
    for (const b of BANDS) {
      const line = o.loomLines && o.loomLines[b];
      if (!isStr(line)) err(where, `loomLines.${b} required when loomLines is set`);
      else if (line.length > 200) err(where, `loomLines.${b} over 200 chars`);
    }
  }
  if (o.volatility !== undefined && (typeof o.volatility !== 'number' || o.volatility <= 0)) err(where, 'volatility must be a positive number');
  if (crisis.mode === 'writein' && !o.effects && !o.effectsByWorld && o.draft !== true) err(where, 'finale fallback needs effects');
  return undefined;
}

function checkCrises(data, citizenIds) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.crises)) return err('crises.json', 'must be { worlds, crises: [] }');
  const worlds = data.worlds || {};
  for (const w of WORLDS) {
    if (!worlds[w]) err('crises.json', `worlds.${w} missing`);
    else if (!isStr(worlds[w].name)) err(`crises.json worlds.${w}`, '"name" required');
  }
  const seen = new Set();
  data.crises.forEach((c, i) => {
    const where = `crises.json[${c.id || i}]`;
    if (!isStr(c.id)) err(where, '"id" required');
    if (seen.has(c.id)) err(where, 'duplicate id');
    seen.add(c.id);
    if (!['fixed', ...WORLDS].includes(c.world)) err(where, 'bad world');
    if (!Number.isInteger(c.cycle) || c.cycle < 1 || c.cycle > 12) err(where, 'cycle must be 1-12');
    if (c.world === 'fixed' && c.cycle > 2) err(where, 'fixed crises are cycles 1-2');
    if (c.world !== 'fixed' && c.cycle < 3) err(where, 'world crises are cycles 3+');
    if (c.mode !== 'binary' && c.mode !== 'writein') err(where, 'mode must be "binary" or "writein"');
    if (c.world === 'fixed' && c.mode !== 'binary') err(where, 'fixed crises must be binary');
    for (const f of ['title', 'incident']) if (!isStr(c[f])) err(where, `"${f}" required`);
    if (!c.options) err(where, 'options required');
    else for (const k of ['A', 'B']) checkOption(`${where}.options.${k}`, c.options[k], c);
    (c.feed || []).forEach((m, j) => {
      if (!citizenIds.has(m.citizenId)) err(`${where}.feed[${j}]`, `unknown citizen "${m.citizenId}"`);
    });
    if (c.intel) for (const k of Object.keys(c.intel)) if (!AGENDA_KEYS.includes(k)) err(where, `intel key "${k}" is not a role`);
  });
  for (const w of ['fixed', ...WORLDS]) {
    const cycles = w === 'fixed' ? [1, 2] : [3, 4];
    for (const cy of cycles) if (!data.crises.some((c) => c.world === w && c.cycle === cy)) err('crises.json', `no crisis for ${w} cycle ${cy}`);
    if (w !== 'fixed') {
      const finaleId = worlds[w] && worlds[w].finale;
      if (!finaleId || !data.crises.some((c) => c.id === finaleId && c.mode === 'writein')) {
        err('crises.json', `missing writein finale for world ${w}`);
      }
    }
  }
  return undefined;
}

// The crisis tree (see selectCrisis in server/gameEngine.js). Every root has
// a cycle 1 crisis (path '') and a cycle 2 crisis after each decision (path
// 'A' and 'B'); every world has a cycle 3 crisis (path '') and a cycle 4
// crisis after each cycle 3 decision, plus its write-in finale. Each tree
// crisis needs an incident, a Loom intro, options A and B with effects and
// role tags, citizen feed lines and debate hooks. Blitz-only extras are not
// held to this. Copy stays short: the projector reads it aloud.
const MAX_INCIDENT_WORDS = 30;
const MAX_OPTION_WORDS = 20;
function checkCoreCrises(data) {
  const worlds = data.worlds || {};
  const list = data.crises;
  const need = (where, found) => { if (!found) err('crises.json', `crisis tree: no crisis for ${where}`); return found; };
  const core = [];
  const roots = Array.from(new Set(list.filter((c) => c.root).map((c) => c.root)));
  if (!roots.length) err('crises.json', 'crisis tree: no roots');
  for (const root of roots) {
    core.push(need(`root ${root} cycle 1`, list.find((c) => c.root === root && c.cycle === 1 && c.path === '')));
    // Cycle 2 is always fixed-2-offswitch, so a root only needs its own cycle 1 crisis.
    core.push(need('fixed-2-offswitch', list.find((c) => c.id === 'fixed-2-offswitch' && c.cycle === 2)));
  }
  for (const w of WORLDS) {
    core.push(need(`world ${w} cycle 3`, list.find((c) => c.world === w && c.cycle === 3 && c.path === '')));
    for (const p of ['A', 'B']) core.push(need(`world ${w} cycle 4 after ${p}`, list.find((c) => c.world === w && c.cycle === 4 && c.path === p)));
    core.push(list.find((c) => worlds[w] && worlds[w].finale === c.id));
  }
  for (const c of core.filter(Boolean)) {
    const where = `crises.json[${c.id}] (tree)`;
    if (!isStr(c.loomIntro)) err(where, 'empty loomIntro');
    if (isStr(c.incident) && c.incident.split(/\s+/).length > MAX_INCIDENT_WORDS) err(where, `incident over ${MAX_INCIDENT_WORDS} words`);
    for (const k of ['A', 'B']) {
      const o = (c.options || {})[k] || {};
      if (!isStr(o.name) || !isStr(o.text)) err(where, `option ${k} needs name and text`);
      if (isStr(o.text) && o.text.split(/\s+/).length > (o.delayed ? 45 : MAX_OPTION_WORDS)) err(where, `option ${k} text over ${MAX_OPTION_WORDS} words`);
      if (!o.effects && !o.effectsByWorld) err(where, `option ${k} has no effects`);
      if (!(o.roles || o.rolesByWorld)) err(where, `option ${k} has no role tags`);
    }
    if (!Array.isArray(c.feed) || c.feed.length < 2) err(where, 'needs at least 2 citizen feed lines');
    if (!Array.isArray(c.debateHooks) || c.debateHooks.length < 2) err(where, 'needs at least 2 debate hooks');
  }
  return core.filter(Boolean).length;
}

// No emoji and school-appropriate language in any string of any data file.
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{1F1E6}-\u{1F1FF}]/u;
const BANNED = /\b(damn|hell|crap|sh[i1]t|f+u+c+k|bitch|bastard|ass(hole)?|piss|sex(y)?|kill yourself|stupid|idiot|retard(ed)?)\b/i;
function checkStrings(file, value, trail = file) {
  if (typeof value === 'string') {
    if (EMOJI.test(value)) err(trail, `contains emoji: "${value.slice(0, 40)}"`);
    const bad = value.match(BANNED);
    if (bad) err(trail, `language check: "${bad[0]}"`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => checkStrings(file, v, `${trail}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) checkStrings(file, v, `${trail}.${k}`);
  }
}

const roles = load('roles.json');
const citizens = load('citizens.json');
const crises = load('crises.json');
if (roles) checkRoles(roles);
if (citizens) checkCitizens(citizens);
if (crises) checkCrises(crises, new Set((citizens || []).map((c) => c.id)));
const coreCount = crises && Array.isArray(crises.crises) ? checkCoreCrises(crises) : 0;

// data/sim.json is checked with the simulation's own loader.
const simConfig = load('sim.json');
if (simConfig) {
  const { validateSimConfig } = require('../server/sim/state');
  validateSimConfig(simConfig).forEach((e) => err('sim.json', e));
}

for (const [name, data] of [['roles.json', roles], ['citizens.json', citizens], ['crises.json', crises]]) {
  if (data) checkStrings(name, data);
}

if (warnings.length) {
  console.warn(`Warnings (${warnings.length}):`);
  warnings.forEach((w) => console.warn(`  - ${w}`));
}

if (errors.length) {
  console.error(`Data validation failed (${errors.length}):`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log(`data/*.json valid (${coreCount} crises on the tree complete)`);
