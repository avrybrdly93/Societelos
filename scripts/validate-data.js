#!/usr/bin/env node
'use strict';

// Validates data/roles.json, data/citizens.json and data/crises.json against
// the frozen schema in data/SCHEMA.md. No dependencies. Exit code 1 on errors.

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const ROLE_KEYS = ['artisan', 'lotus', 'assimilator', 'catalyst', 'ghost'];
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
    for (const f of ['id', 'name', 'icon', 'goal', 'winCondition', 'cardText']) if (!isStr(r[f])) err(`roles.json[${i}]`, `"${f}" required`);
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
    if (!Number.isInteger(c.cycle) || c.cycle < 1 || c.cycle > 5) err(where, 'cycle must be 1-5');
    if (c.world === 'fixed' && c.cycle > 2) err(where, 'fixed crises are cycles 1-2');
    if (c.world !== 'fixed' && c.cycle < 3) err(where, 'world crises are cycles 3-5');
    const expectedMode = c.cycle === 5 ? 'writein' : 'binary';
    if (c.mode !== expectedMode) err(where, `mode must be "${expectedMode}"`);
    for (const f of ['title', 'incident']) if (!isStr(c[f])) err(where, `"${f}" required`);
    if (!c.options) err(where, 'options required');
    else for (const k of ['A', 'B']) checkOption(`${where}.options.${k}`, c.options[k], c);
    (c.feed || []).forEach((m, j) => {
      if (!citizenIds.has(m.citizenId)) err(`${where}.feed[${j}]`, `unknown citizen "${m.citizenId}"`);
    });
    if (c.intel) for (const k of Object.keys(c.intel)) if (!ROLE_KEYS.includes(k)) err(where, `intel key "${k}" is not a role`);
  });
  for (const w of ['fixed', ...WORLDS]) {
    const cycles = w === 'fixed' ? [1, 2] : [3, 4, 5];
    for (const cy of cycles) if (!data.crises.some((c) => c.world === w && c.cycle === cy)) err('crises.json', `no crisis for ${w} cycle ${cy}`);
  }
  return undefined;
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
console.log('data/*.json valid');
