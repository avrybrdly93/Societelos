// The Loom: titles in Unicode Mathematical Bold (𝐓𝐡𝐞 𝐋𝐨𝐨𝐦).
(function () {
  'use strict';

  // Converts A-Z, a-z and 0-9 in the game's main titles to their Unicode
  // Mathematical Bold code points (U+1D400 block), rendered with the vendored
  // STIX Two Math subset (css/fonts.css, "Loom Math") so it works offline.
  // Screen readers get the plain text through aria-label. Titles the game
  // rewrites at runtime are converted again by a MutationObserver.

  const UPPER = 0x1d400;
  const LOWER = 0x1d41a;
  const DIGIT = 0x1d7ce;

  function toMathBold(text) {
    let out = '';
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      if (c >= 65 && c <= 90) out += String.fromCodePoint(UPPER + c - 65);
      else if (c >= 97 && c <= 122) out += String.fromCodePoint(LOWER + c - 97);
      else if (c >= 48 && c <= 57) out += String.fromCodePoint(DIGIT + c - 48);
      else out += ch;
    }
    return out;
  }

  function fromMathBold(text) {
    let out = '';
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      if (c >= UPPER && c < UPPER + 26) out += String.fromCharCode(65 + c - UPPER);
      else if (c >= LOWER && c < LOWER + 26) out += String.fromCharCode(97 + c - LOWER);
      else if (c >= DIGIT && c < DIGIT + 10) out += String.fromCharCode(48 + c - DIGIT);
      else out += ch;
    }
    return out;
  }

  // The "main areas": headings and the names of things.
  const SELECTOR = [
    '[data-mathbold]', 'h1', 'h2', '.incident-title', '.policy-name', '.world-name', '.seat-name',
    '.char-name', '.champion-character', '.enact-title', '.finale-title', '.end-winner-title',
    '.topbar-brand', '.vote-name', '.m-char-name', '.score-name', '.voice-title', '.chronicle-tag'
  ].join(', ');

  const ASCII = /[A-Za-z0-9]/;
  let busy = false;

  function convert(el) {
    if (!el || el.closest('[data-no-mathbold]')) return;
    const upper = getComputedStyle(el).textTransform === 'uppercase';
    const original = fromMathBold(el.textContent).replace(/\s+/g, ' ').trim();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let changed = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!ASCII.test(node.nodeValue)) continue;
      const parent = node.parentElement;
      const up = parent && parent !== el ? getComputedStyle(parent).textTransform === 'uppercase' : upper;
      node.nodeValue = toMathBold(up ? node.nodeValue.toUpperCase() : node.nodeValue);
      changed = true;
    }
    if (changed || el.dataset.mathboldDone === undefined) {
      // aria-label keeps the text as written (screen readers, tests).
      if (original) el.setAttribute('aria-label', original);
      el.dataset.mathboldDone = '';
    }
  }

  function applyWithin(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches(SELECTOR)) convert(root);
    root.querySelectorAll(SELECTOR).forEach(convert);
  }

  function onMutations(mutations) {
    if (busy) return;
    busy = true;
    try {
      const targets = new Set();
      for (const m of mutations) {
        const el = m.target.nodeType === 3 ? m.target.parentElement : m.target;
        if (!el) continue;
        const host = el.closest(SELECTOR);
        if (host) targets.add(host);
        m.addedNodes.forEach((n) => { if (n.nodeType === 1) targets.add(n); });
      }
      targets.forEach(applyWithin);
    } finally {
      busy = false;
    }
  }

  function start() {
    applyWithin(document.body);
    new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  window.LoomMathBold = { toMathBold, fromMathBold, applyWithin, SELECTOR };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
