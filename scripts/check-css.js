#!/usr/bin/env node
'use strict';

// TASK-691: audit public/css/styles.css for duplicate selectors and unused
// rules. A rule is "unused" when one of its class or id names never appears
// in index.html, mobile.html or public/js/*.js. Names built dynamically in
// JS (e.g. `world-${key}`) are matched through DYNAMIC_PREFIXES below.
// Dead declaration = a property set for a selector that a later rule with
// the exact same selector, in the same @media/@supports context, sets again
// (same specificity + later order, so the earlier value can never apply).
// Repeating a selector to layer extra properties is fine and not reported.
// Usage: node scripts/check-css.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CSS = 'public/css/styles.css';
const SOURCES = ['public/index.html', 'public/mobile.html', ...fs.readdirSync(path.join(root, 'public/js')).filter((f) => f.endsWith('.js')).map((f) => `public/js/${f}`)];

// Class-name prefixes JS composes at runtime, e.g. `is-${place}`, are found
// automatically from template literals in the sources.
function dynamicPrefixes(corpus) {
  return [...new Set([...corpus.matchAll(/([a-zA-Z][\w-]*-)\$\{/g)].map((m) => m[1]))];
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
}

/** Flat list of { selector, context, line } for every style rule. */
function parseRules(css) {
  const rules = [];
  const ctx = [];
  let buf = '';
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      const head = buf.trim();
      const line = css.slice(0, start).split('\n').length + (css.slice(start, i).match(/^\s*/)[0].split('\n').length - 1);
      if (head.startsWith('@')) {
        ctx.push({ at: head.replace(/\s+/g, ' '), keyframes: /^@(-\w+-)?keyframes/.test(head) });
      } else if (ctx.some((c) => c.keyframes)) {
        ctx.push({ at: null, keyframes: true });
      } else {
        const close = css.indexOf('}', i);
        const decls = parseDecls(css.slice(i + 1, close), css.slice(0, i + 1).split('\n').length);
        const selectors = head.split(',').map((sel) => sel.trim().replace(/\s+/g, ' '));
        const context = ctx.filter((c) => c.at).map((c) => c.at).join(' > ');
        ctx.push({ at: null });
        const block = { selectors, context, line, decls };
        for (const selector of selectors) rules.push({ selector, context, line, block });
      }
      buf = '';
      start = i + 1;
    } else if (ch === '}') {
      ctx.pop();
      buf = '';
      start = i + 1;
    } else if (ch === ';' && !ctx.length) {
      buf = '';
      start = i + 1;
    } else {
      buf += ch;
    }
  }
  return rules;
}

/** [{ prop, important, line }] for one declaration block body. */
function parseDecls(body, firstLine) {
  const out = [];
  let depth = 0;
  let cur = '';
  let curStart = 0;
  const flush = (end) => {
    const m = cur.match(/^\s*(-?[\w-]+)\s*:([\s\S]*)$/);
    if (m) out.push({ prop: m[1].toLowerCase(), important: /!important\s*$/.test(m[2].trim()), line: firstLine + body.slice(0, curStart).split('\n').length - 1 + (cur.match(/^\s*/)[0].split('\n').length - 1) });
    cur = '';
    curStart = end + 1;
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) flush(i); else cur += ch;
  }
  flush(body.length);
  return out;
}

function namesIn(selector) {
  // Drop attribute selectors and pseudo-class arguments that are strings.
  const s = selector.replace(/\[[^\]]*\]/g, '');
  const classes = [...s.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  const ids = [...s.matchAll(/#(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  return { classes, ids };
}

function audit() {
  const css = stripComments(fs.readFileSync(path.join(root, CSS), 'utf8'));
  const rules = parseRules(css);
  const corpus = SOURCES.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const prefixes = dynamicPrefixes(corpus);
  const used = (name) => new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, '\\-')}($|[^\\w-])`).test(corpus)
    || prefixes.some((p) => name.startsWith(p));

  // Dead declarations: overridden for every selector of their block by a
  // later block in the same context with the same selector.
  const blocks = [...new Set(rules.map((r) => r.block))];
  const duplicates = [];
  blocks.forEach((b, bi) => {
    for (const d of b.decls) {
      if (d.important) continue;
      const overriddenBy = b.selectors.map((sel) => {
        for (let j = blocks.length - 1; j > bi; j--) {
          const later = blocks[j];
          if (later.context === b.context && later.selectors.includes(sel) && later.decls.some((x) => x.prop === d.prop)) {
            return later.decls.find((x) => x.prop === d.prop).line;
          }
        }
        return null;
      });
      if (overriddenBy.every((l) => l !== null)) {
        duplicates.push({ selector: b.selectors.join(', '), context: b.context, line: d.line, prop: d.prop, first: Math.max(...overriddenBy) });
      }
    }
  });

  const unused = [];
  for (const r of rules) {
    const { classes, ids } = namesIn(r.selector);
    const missing = [...classes.map((c) => `.${c}`), ...ids.map((i) => `#${i}`)].filter((n) => !used(n.slice(1)));
    if (missing.length) unused.push({ ...r, missing });
  }
  return { rules, duplicates, unused };
}

if (require.main === module) {
  const { rules, duplicates, unused } = audit();
  for (const d of duplicates) console.error(`dead       line ${d.line}: ${d.prop} on "${d.selector}"${d.context ? ` in ${d.context}` : ''} (overridden on line ${d.first})`);
  for (const u of unused) console.error(`unused     line ${u.line}: "${u.selector}" (${u.missing.join(', ')} not referenced)`);
  if (duplicates.length || unused.length) {
    console.error(`${CSS}: ${duplicates.length} dead declaration(s), ${unused.length} unused rule(s) of ${rules.length}`);
    process.exit(1);
  }
  console.log(`${CSS}: ${rules.length} selectors, no dead declarations, none unused`);
}

module.exports = { audit, parseRules };
