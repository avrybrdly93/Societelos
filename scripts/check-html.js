#!/usr/bin/env node
'use strict';

// TASK-690: structural HTML check for the two MVP pages (no network, no deps).
// Verifies: <!DOCTYPE html> first, <html lang>, exactly one <head>/<body>,
// <meta charset> + <title> in <head>, every non-void element closed in the
// right order, no stray closing tags, no void element "closed", no duplicate
// ids, and unique attributes per tag.
// Usage: node scripts/check-html.js [file ...]

const fs = require('fs');
const path = require('path');

const DEFAULT_FILES = ['public/index.html', 'public/mobile.html'];
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// Raw-text elements: their content is not markup.
const RAW = new Set(['script', 'style', 'textarea', 'title']);
// Elements whose end tag the HTML spec lets authors omit. None are left
// unclosed in this codebase, so every element must be closed explicitly.
const OPTIONAL_END = new Set([]);

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

function checkHtml(src) {
  const errors = [];
  const err = (idx, msg) => errors.push(`line ${lineOf(src, idx)}: ${msg}`);

  if (!/^\s*<!DOCTYPE html>/i.test(src)) err(0, 'missing <!DOCTYPE html> at top of file');

  const stack = [];
  const ids = new Map();
  const counts = { html: 0, head: 0, body: 0, title: 0, metaCharset: 0 };
  let inHead = false;
  const tagRe = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = tagRe.exec(src))) {
    const raw = m[0];
    if (raw.startsWith('<!')) continue;
    const name = m[1].toLowerCase();
    const attrs = m[2] || '';
    const closing = raw.startsWith('</');

    if (closing) {
      if (VOID.has(name)) { err(m.index, `void element </${name}> must not be closed`); continue; }
      const top = stack[stack.length - 1];
      if (!top) { err(m.index, `stray </${name}> with nothing open`); continue; }
      if (top.name === name) {
        stack.pop();
      } else if (stack.some((s) => s.name === name)) {
        while (stack.length && stack[stack.length - 1].name !== name) {
          const open = stack.pop();
          if (!OPTIONAL_END.has(open.name)) err(open.idx, `<${open.name}> not closed before </${name}>`);
        }
        stack.pop();
      } else {
        err(m.index, `stray </${name}> (innermost open element is <${top.name}>)`);
      }
      if (name === 'head') inHead = false;
      continue;
    }

    // Opening tag: attributes.
    const attrRe = /([^\s=/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
    const seen = new Set();
    let a;
    while ((a = attrRe.exec(attrs))) {
      const an = a[1].toLowerCase();
      if (an === '/') continue;
      if (seen.has(an)) err(m.index, `<${name}> has duplicate attribute "${an}"`);
      seen.add(an);
      if (an === 'id') {
        const id = (a[2] || '').replace(/^["']|["']$/g, '');
        if (!id) err(m.index, `<${name}> has an empty id`);
        else if (ids.has(id)) err(m.index, `duplicate id "${id}" (first on line ${ids.get(id)})`);
        else ids.set(id, lineOf(src, m.index));
      }
    }

    if (name === 'html') { counts.html++; if (!seen.has('lang')) err(m.index, '<html> is missing lang'); }
    if (name === 'head') { counts.head++; inHead = true; }
    if (name === 'body') counts.body++;
    if (name === 'title' && inHead) counts.title++;
    if (name === 'meta' && seen.has('charset') && inHead) counts.metaCharset++;

    if (VOID.has(name)) continue;
    if (/\/\s*>$/.test(raw)) {
      // Self-closing syntax is only meaningful in foreign (SVG/MathML) content.
      const inForeign = name === 'svg' || name === 'math' || stack.some((s) => s.name === 'svg' || s.name === 'math');
      if (!inForeign) err(m.index, `<${name} /> is not a void element: self-closing syntax is ignored in HTML`);
      continue;
    }
    if (RAW.has(name)) {
      const end = new RegExp(`</${name}\\s*>`, 'ig');
      end.lastIndex = tagRe.lastIndex;
      const close = end.exec(src);
      if (!close) { err(m.index, `<${name}> is never closed`); break; }
      tagRe.lastIndex = close.index + close[0].length;
      continue;
    }
    stack.push({ name, idx: m.index });
  }
  for (const open of stack) err(open.idx, `<${open.name}> is never closed`);

  for (const [k, label] of [['html', '<html>'], ['head', '<head>'], ['body', '<body>'], ['title', '<title> in <head>'], ['metaCharset', '<meta charset> in <head>']]) {
    if (counts[k] !== 1) errors.push(`expected exactly one ${label}, found ${counts[k]}`);
  }
  return errors;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;
  let bad = 0;
  for (const f of files) {
    const errors = checkHtml(fs.readFileSync(path.resolve(root, f), 'utf8'));
    if (errors.length) {
      bad++;
      console.error(`FAIL ${f}`);
      for (const e of errors) console.error(`  ${e}`);
    } else {
      console.log(`ok   ${f}`);
    }
  }
  process.exit(bad ? 1 : 0);
}

module.exports = { checkHtml };
