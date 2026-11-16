#!/usr/bin/env node
'use strict';

// WCAG AA contrast check for the world colour themes on the projector.
// Each theme colour is used as text (top-bar brand, Loom lines, world title,
// region count) on the host's dark surfaces, so each pair must reach 4.5:1.
// Usage: node scripts/check-contrast.js   (npm run check:contrast)

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');

function token(name) {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1];
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const surfaces = { 'bg (slate-900)': token('slate-900'), 'raised (slate-800)': token('slate-800'), 'sunken (slate-950)': token('slate-950') };
const themes = { AA: token('theme-aa'), AB: token('theme-ab'), BA: token('theme-ba'), BB: token('theme-bb') };
const AA_NORMAL = 4.5;

let failed = 0;
for (const [world, color] of Object.entries(themes)) {
  for (const [surface, bg] of Object.entries(surfaces)) {
    const ratio = contrast(color, bg);
    const ok = ratio >= AA_NORMAL;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} world ${world} ${color} on ${surface} ${bg}: ${ratio.toFixed(2)}:1`);
  }
}
if (failed) {
  console.error(`${failed} theme/surface pair(s) below WCAG AA ${AA_NORMAL}:1`);
  process.exit(1);
}
console.log(`All 4 world themes meet WCAG AA (>= ${AA_NORMAL}:1) on projector surfaces`);
