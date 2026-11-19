// The Loom — cinematic layer for the host projector (title sequence + crisis cards).
(function () {
  'use strict';

  //   LoomCinematic.playIntro({ onEnter })   opening title sequence (on page load)
  //   LoomCinematic.playCrisis({ crisis, cycle, kicker, worldKey }) -> Promise
  //                                          title card at the start of a crisis
  //   LoomCinematic.dismiss()                hide immediately (e.g. reconnect mid-game)
  //
  // Per-crisis art: put the image in public/img/crises/ and list it in
  // CRISIS_ART below (crisis id -> file name). Until a crisis has its own art, the title card uses the utopian city,
  // colour-graded for the world the class is in and darkened as cycles pass,
  // with a camera move unique to that crisis.

  const root = document.getElementById('cinematic');
  if (!root) return;

  const $ = (id) => document.getElementById(id);
  const rig = $('cine-rig');
  const bg = $('cine-bg');
  const gate = $('cine-gate');
  const logo = $('cine-logo');
  const ctaWrap = $('cine-cta-wrap');
  const cta = $('cine-cta');
  const muteBtn = $('cine-mute');
  const skipBtn = $('cine-skip');
  const crisisBox = $('cine-crisis');
  const kickerEl = $('cine-crisis-kicker');
  const titleEl = $('cine-crisis-title');
  const subtitleEl = $('cine-crisis-subtitle');
  const ruleEl = crisisBox.querySelector('.cine-rule');

  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const INTRO_ART = 'img/new-style/Loom-Loading-Screen.png';
  const CRISIS_ART_DIR = 'img/crises/';
  // Crisis id -> image in public/img/crises/ (1920x1080 or larger, no text).
  // Prompts for every crisis: docs/crisis-art-prompts.md.
  const CRISIS_ART = {
    // 'fixed-1-ownership': 'fixed-1-ownership.webp',
  };

  // Title cards show the district each crisis centres on (see Districts.md):
  // Aurelia = wealth/status, Capitol = governance & knowledge, Obsidian Chasm =
  // automated industry, Sector V Commons = ordinary daily life, Twilight
  // Promenade = leisure, distraction and escape.
  const DISTRICT_ART = {
    aurelia: 'img/new-style/Districts/Aurelia.png',
    capitol: 'img/new-style/Districts/Capitol.png',
    chasm: 'img/new-style/Districts/Obsidian-Chasm.png',
    commons: 'img/new-style/Districts/SectorVCommons.png',
    promenade: 'img/new-style/Districts/Twilight-Promenade.png'
  };
  const CRISIS_DISTRICT = {
    'fixed-1-ownership': 'aurelia', 'fixed-2-board': 'aurelia', 'fixed-1-factory': 'chasm',
    'fixed-1-driving': 'commons', 'fixed-2-offswitch': 'capitol', 'fixed-2-planning': 'capitol', 'fixed-2-shares': 'capitol',
    'aa-purpose-drift': 'promenade', 'aa-robot-art': 'promenade', 'aa-lost-knowledge': 'capitol',
    'aa-fake-struggle': 'capitol', 'aa-curriculum-revolt': 'capitol',
    'ab-the-pods': 'commons', 'ab-curated-bonds': 'promenade', 'ab-mood-dial': 'commons',
    'ab-merge-offer': 'capitol', 'ab-memory-edit': 'capitol',
    'ba-shadow-elite': 'aurelia', 'ba-media-monopoly': 'aurelia', 'ba-private-security': 'aurelia',
    'ba-status-wars': 'promenade', 'ba-vote-to-seize': 'capitol',
    'bb-scroll-extinction': 'promenade', 'bb-the-unplugged': 'promenade', 'bb-biometric-tollways': 'commons',
    'bb-march-datacenter': 'capitol', 'bb-luxury-lottery': 'aurelia'
  };
  const DISTRICT_KEYS = Object.keys(DISTRICT_ART);
  function districtArtFor(id) {
    const key = CRISIS_DISTRICT[id] || DISTRICT_KEYS[hash(String(id || 'loom')) % DISTRICT_KEYS.length];
    return DISTRICT_ART[key].split('/').map(encodeURIComponent).join('/');
  }

  // ---------------------------------------------------------------------------
  // Procedural sound (Web Audio, no assets).
  // ---------------------------------------------------------------------------
  const sound = (() => {
    let ctx = null;
    let muted = false;
    function init() {
      if (!ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) ctx = new AudioCtx();
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function ready() { return !muted && init(); }
    function tone(freq, start, dur, { type = 'sine', peak = 0.05, attack = 0.03, dest } = {}) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(peak, start + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain);
      gain.connect(dest || ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.05);
    }

    // Warm Lydian pad and a rising harp arpeggio as the title appears.
    function entrance() {
      if (!ready()) return;
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.42, now);
      master.connect(ctx.destination);
      [174.61, 261.63, 329.63, 392.0, 440.0, 587.33].forEach((freq, idx) => {
        const filter = ctx.createBiquadFilter();
        const voice = ctx.createGain();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(280, now);
        filter.frequency.exponentialRampToValueAtTime(1950, now + 2.4);
        filter.frequency.exponentialRampToValueAtTime(650, now + 5.6);
        voice.gain.setValueAtTime(0.0001, now);
        voice.gain.linearRampToValueAtTime(0.065 / (idx * 0.35 + 1), now + 1.2 + idx * 0.08);
        voice.gain.exponentialRampToValueAtTime(0.0001, now + 5.8);
        filter.connect(voice);
        voice.connect(master);
        [['sine', 1], ['triangle', 1.0025]].forEach(([type, detune]) => {
          const osc = ctx.createOscillator();
          osc.type = type;
          osc.frequency.setValueAtTime(freq * detune, now);
          osc.connect(filter);
          osc.start(now + 0.15);
          osc.stop(now + 6.0);
        });
      });
      [523.25, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98].forEach((freq, i) => {
        const t = now + 0.65 + i * 0.18;
        tone(freq, t, 1.75, { peak: 0.055, attack: 0.025, dest: master });
        tone(freq * 0.5, t, 1.75, { type: 'triangle', peak: 0.03, attack: 0.025, dest: master });
      });
    }

    function chime() {
      if (!ready()) return;
      const now = ctx.currentTime;
      [587.33, 880.0, 1174.66].forEach((f, i) => tone(f, now + i * 0.065, 1.1, { peak: 0.06, attack: 0.02 }));
    }

    function confirm() {
      if (!ready()) return;
      const now = ctx.currentTime;
      [261.63, 329.63, 392.0, 493.88, 659.25].forEach((f, i) => tone(f, now + i * 0.04, 1.4, { type: 'triangle', peak: 0.05 }));
    }

    // Crisis sting: a low swell under a struck interval. darkness 0 = warm
    // open fifth; 1 = minor second over a detuned drone.
    function sting(darkness) {
      if (!ready()) return;
      const now = ctx.currentTime;
      const d = Math.max(0, Math.min(1, darkness));
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.5, now);
      master.connect(ctx.destination);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, now);
      filter.frequency.exponentialRampToValueAtTime(900 - d * 450, now + 1.8);
      filter.frequency.exponentialRampToValueAtTime(160, now + 5.2);
      filter.connect(master);
      const root = 55;
      [[root, 0.14], [root * 1.5, 0.08], [root * (2 + d * 0.012), 0.06]].forEach(([f, peak]) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, now);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(peak, now + 1.4);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 5.4);
        osc.connect(g);
        g.connect(filter);
        osc.start(now);
        osc.stop(now + 5.5);
      });
      // Struck bell pair as the title lands.
      const hit = now + 1.15;
      const upper = d > 0.5 ? 659.25 * Math.pow(2, 1 / 12) : 659.25 * 1.5; // minor 2nd vs. fifth
      tone(659.25, hit, 3.2, { peak: 0.05, attack: 0.008, dest: master });
      tone(upper, hit + 0.02, 3.0, { peak: 0.035, attack: 0.008, dest: master });
      tone(329.63, hit, 3.6, { type: 'triangle', peak: 0.04, attack: 0.01, dest: master });
    }

    return {
      init,
      entrance, chime, confirm, sting,
      get muted() { return muted; },
      setMuted(v) { muted = !!v; }
    };
  })();

  // ---------------------------------------------------------------------------
  // Intro song: plays from the "click to begin" gesture and carries the title
  // screen. It fades out when the host enters the lobby (or the intro is
  // dismissed). If the file cannot play, the synthesized entrance is the fallback.
  // ---------------------------------------------------------------------------
  const song = (() => {
    const SRC = 'audio/intro-song.m4a';
    const VOLUME = 0.7;
    const FADE_MS = 1400;
    let audio = null;
    let fadeTimer = null;
    function stopNow() {
      clearInterval(fadeTimer);
      fadeTimer = null;
      if (audio) { try { audio.pause(); } catch (e) { /* ignore */ } audio = null; }
    }
    // Resolves true when the song is playing, false when the caller should
    // fall back to the synthesized entrance.
    function play(muted) {
      stopNow();
      if (muted || typeof Audio === 'undefined') return Promise.resolve(false);
      const el = new Audio(SRC);
      el.loop = true;
      el.volume = VOLUME;
      audio = el;
      return el.play().then(() => true).catch(() => { if (audio === el) audio = null; return false; });
    }
    function fadeOut() {
      const el = audio;
      if (!el) return;
      clearInterval(fadeTimer);
      const steps = 14;
      let n = 0;
      fadeTimer = setInterval(() => {
        n += 1;
        try { el.volume = Math.max(0, VOLUME * (1 - n / steps)); } catch (e) { /* ignore */ }
        if (n >= steps) { stopNow(); }
      }, FADE_MS / steps);
    }
    function setMuted(m) {
      if (!audio) return;
      if (m) { try { audio.pause(); } catch (e) { /* ignore */ } }
      else { audio.play().catch(() => {}); }
    }
    return { play, fadeOut, stopNow, setMuted, isFading: () => fadeTimer !== null };
  })();

  // ---------------------------------------------------------------------------
  // Floating motes (only animated while the layer is visible).
  // ---------------------------------------------------------------------------
  const motes = (() => {
    const canvas = $('cine-motes');
    const c2d = canvas.getContext && canvas.getContext('2d');
    let particles = [];
    let raf = null;
    let rgb = '176, 212, 249';
    // Fine motes drifting on the air, plus tiny shimmering sparks rising
    // slowly through the scene (soft glints, not glassy bubbles).
    const MOTES = 90;
    const BUBBLES = 55;
    function seed() {
      const w = canvas.width;
      const h = canvas.height;
      particles = Array.from({ length: MOTES }, () => ({
        kind: 'mote',
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 2.4 + 0.7,
        vx: (Math.random() - 0.35) * 0.32,
        vy: (Math.random() - 0.65) * 0.26,
        a: Math.random() * 0.55 + 0.15,
        p: Math.random() * Math.PI * 2
      })).concat(Array.from({ length: BUBBLES }, () => {
        const r = 0.6 + Math.random() * 1.2;
        return {
          kind: 'bubble',
          x: Math.random() * w,
          y: Math.random() * h,
          r,
          vx: (Math.random() - 0.5) * 0.12,
          vy: -(0.1 + Math.random() * 0.3) - 0.05, // slow upward drift
          a: 0.3 + Math.random() * 0.5,
          p: Math.random() * Math.PI * 2,
          wobble: 0.3 + Math.random() * 0.7
        };
      }));
    }
    function drawBubble(m) {
      // Shimmer: a soft glow that twinkles; no rim, no glassy highlight.
      const alpha = m.a * (0.35 + 0.65 * Math.abs(Math.sin(m.p * 1.7)));
      const gr = m.r * 2.6;
      const g = c2d.createRadialGradient(m.x, m.y, 0, m.x, m.y, gr);
      g.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      g.addColorStop(0.35, `rgba(${rgb}, ${alpha * 0.45})`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      c2d.beginPath();
      c2d.arc(m.x, m.y, gr, 0, Math.PI * 2);
      c2d.fillStyle = g;
      c2d.fill();
    }
    function frame() {
      const w = canvas.width;
      const h = canvas.height;
      c2d.clearRect(0, 0, w, h);
      for (const m of particles) {
        m.p += 0.02;
        if (m.kind === 'bubble') {
          m.x += m.vx + Math.sin(m.p) * 0.25 * m.wobble;
          m.y += m.vy;
          if (m.y < -m.r * 2) { m.y = h + m.r * 2; m.x = Math.random() * w; }
          if (m.x < -m.r * 2) m.x = w + m.r; else if (m.x > w + m.r * 2) m.x = -m.r;
          drawBubble(m);
          continue;
        }
        m.x = (m.x + m.vx + w) % w;
        m.y = (m.y + m.vy + h) % h;
        c2d.beginPath();
        c2d.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        c2d.fillStyle = `rgba(${rgb}, ${m.a * (0.65 + 0.35 * Math.sin(m.p))})`;
        c2d.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    return {
      start(colour) {
        if (!c2d || reducedMotion) return;
        rgb = colour || '176, 212, 249';
        if (!particles.length) seed();
        if (raf === null) raf = requestAnimationFrame(frame);
      },
      stop() {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
      }
    };
  })();

  // ---------------------------------------------------------------------------
  // Shared timeline helpers.
  // ---------------------------------------------------------------------------
  let timers = [];
  let finishCurrent = null; // resolves the running sequence (crisis cards)
  function later(ms, fn) { timers.push(setTimeout(fn, reducedMotion ? Math.min(ms, 200) : ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function resetStage(mode) {
    clearTimers();
    root.classList.remove('mode-intro', 'mode-crisis', 'is-playing', 'is-leaving');
    root.classList.add(`mode-${mode}`);
    rig.classList.remove('is-zooming');
    logo.classList.remove('phase-appear', 'phase-settled');
    ctaWrap.classList.remove('is-visible');
    crisisBox.querySelectorAll('.is-in').forEach((el) => el.classList.remove('is-in'));
    bg.classList.remove('is-loaded');
    skipBtn.hidden = true;
    void rig.offsetWidth; // restart transitions from zero
  }

  function setArt(src, look) {
    // The art is graded cool (blue-white) on top of any per-world grade.
    root.style.setProperty('--cine-grade', look.grade || 'brightness(1)');
    root.style.setProperty('--cine-wash', look.wash || 'transparent');
    rig.style.setProperty('--cine-origin', look.origin || '36% 38%');
    rig.style.setProperty('--cine-zoom', String(look.zoom || 1.115));
    rig.style.setProperty('--cine-drift-x', look.driftX || '0');
    rig.style.setProperty('--cine-drift-y', look.driftY || '0');
    rig.style.setProperty('--cine-zoom-ms', `${look.zoomMs || 7200}ms`);
    bg.style.backgroundImage = `url("${src}")`;
    requestAnimationFrame(() => bg.classList.add('is-loaded'));
  }

  function hide() {
    if (!song.isFading() && !root.classList.contains('mode-crisis')) song.stopNow();
    clearTimers();
    motes.stop();
    root.hidden = true;
    root.classList.remove('is-leaving', 'is-playing');
    if (finishCurrent) { const done = finishCurrent; finishCurrent = null; done(); }
  }

  function leave() {
    if (root.hidden) return;
    clearTimers();
    root.classList.add('is-leaving');
    timers.push(setTimeout(hide, reducedMotion ? 50 : 900));
  }

  // ---------------------------------------------------------------------------
  // 1. Opening title sequence.
  // ---------------------------------------------------------------------------
  let onEnter = null;
  let songOn = false; // the intro song is playing, so skip the synthesized entrance
  function runIntro() {
    resetStage('intro');
    setArt(INTRO_ART, { origin: '36% 38%', zoom: 1.115 });
    motes.start();
    later(50, () => rig.classList.add('is-zooming'));
    later(650, () => { logo.classList.add('phase-appear'); if (!songOn) sound.entrance(); });
    later(2100, () => { logo.classList.remove('phase-appear'); logo.classList.add('phase-settled'); });
    later(6300, () => { ctaWrap.classList.add('is-visible'); sound.chime(); cta.focus({ preventScroll: true }); });
  }

  function playIntro(options) {
    onEnter = (options && options.onEnter) || null;
    resetStage('intro');
    root.hidden = false;
    gate.classList.remove('is-dismissed');
    setArt(INTRO_ART, { origin: '36% 38%' });
    motes.start();
    gate.focus({ preventScroll: true });
  }

  function unlockAndStart() {
    if (gate.classList.contains('is-dismissed')) return;
    gate.classList.add('is-dismissed');
    sound.init();
    // The same gesture lets the Loom's voice (speechSynthesis) speak later.
    try { if (window.speechSynthesis) window.speechSynthesis.resume(); } catch (e) { /* unsupported */ }
    // Start the song inside the click gesture (browser autoplay rules), then
    // run the title sequence; it falls back to the synth entrance if the song fails.
    songOn = true;
    song.play(sound.muted).then((ok) => { songOn = ok; });
    runIntro();
  }
  gate.addEventListener('click', unlockAndStart);
  gate.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); unlockAndStart(); }
  });

  cta.addEventListener('click', () => {
    song.fadeOut();
    sound.confirm();
    leave();
    if (onEnter) { const cb = onEnter; onEnter = null; cb(); }
  });

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sound.setMuted(!sound.muted);
    song.setMuted(sound.muted);
    muteBtn.textContent = sound.muted ? 'Sound: Off' : 'Sound: On';
    muteBtn.setAttribute('aria-pressed', String(sound.muted));
    if (!sound.muted) sound.chime();
  });

  // ---------------------------------------------------------------------------
  // 2. Crisis title cards.
  // ---------------------------------------------------------------------------
  const WORLD_NAMES = { AA: 'The Commonwealth', AB: 'The Benevolent Machine', BA: 'The Uneasy Republic', BB: 'The Gilded Cage' };
  // Colour grade for the fallback art, by world. The utopia is the same city
  // in every world; what the class has done to it is the grade.
  const WORLD_LOOKS = {
    FIXED: { grade: 'brightness(0.8) saturate(0.95)', wash: 'linear-gradient(180deg, rgba(17, 22, 32, 0.15), rgba(7, 8, 10, 0.55))', motes: '176, 212, 249', darkness: 0.15 },
    AA: { grade: 'sepia(0.35) saturate(0.85) brightness(0.7)', wash: 'linear-gradient(180deg, rgba(55, 100, 145, 0.25), rgba(13, 17, 25, 0.55))', motes: '167, 207, 248', darkness: 0.3 },
    AB: { grade: 'saturate(0.35) hue-rotate(130deg) brightness(0.62) contrast(1.05)', wash: 'linear-gradient(180deg, rgba(30, 110, 120, 0.3), rgba(6, 18, 22, 0.6))', motes: '190, 240, 245', darkness: 0.55 },
    BA: { grade: 'sepia(0.55) hue-rotate(-28deg) saturate(1.5) brightness(0.5) contrast(1.15)', wash: 'linear-gradient(180deg, rgba(140, 30, 30, 0.3), rgba(20, 6, 6, 0.6))', motes: '185, 151, 244', darkness: 0.75 },
    BB: { grade: 'grayscale(0.85) brightness(0.45) contrast(1.25)', wash: 'linear-gradient(180deg, rgba(20, 24, 40, 0.35), rgba(4, 5, 8, 0.7))', motes: '200, 205, 215', darkness: 0.9 }
  };

  function worldOf(crisisId, worldKey) {
    const prefix = String(crisisId || '').slice(0, 2).toUpperCase();
    if (WORLD_LOOKS[prefix] && prefix !== 'FI') return prefix;
    return WORLD_LOOKS[worldKey] ? worldKey : 'FIXED';
  }

  // Deterministic per-crisis camera move, so every problem frames the city
  // differently even before it has its own art.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function cameraFor(id) {
    const h = hash(String(id || 'loom'));
    const pick = (shift, lo, hi) => lo + (((h >>> shift) & 0xff) / 255) * (hi - lo);
    return {
      origin: `${pick(0, 22, 78).toFixed(1)}% ${pick(8, 28, 62).toFixed(1)}%`,
      zoom: Number(pick(16, 1.1, 1.2).toFixed(3)),
      driftX: `${pick(24, -1.6, 1.6).toFixed(2)}%`,
      driftY: `${pick(4, -1.0, 1.0).toFixed(2)}%`
    };
  }

  // Resolve the crisis's own art (preloaded so it fades in whole), else null.
  const artCache = new Map();
  function findCrisisArt(id) {
    const file = id && Object.prototype.hasOwnProperty.call(CRISIS_ART, id) ? CRISIS_ART[id] : null;
    if (!file) return Promise.resolve(null);
    if (artCache.has(id)) return artCache.get(id);
    const src = CRISIS_ART_DIR + encodeURIComponent(file);
    const found = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    artCache.set(id, found);
    return found;
  }

  const CARD_MS = 6200; // INCIDENT lasts 15 s: leave time to read the incident

  function playCrisis({ crisis, cycle, kicker, worldKey } = {}) {
    if (!crisis) return Promise.resolve();
    if (finishCurrent) hide();
    return new Promise((resolve) => {
      finishCurrent = resolve;
      resetStage('crisis');
      root.hidden = false;
      const world = worldOf(crisis.id, worldKey);
      const look = WORLD_LOOKS[world];
      const later3 = Math.max(0, (cycle || 3) - 3);
      kickerEl.textContent = kicker || [`Cycle ${cycle || ''}`.trim(), WORLD_NAMES[world]].filter(Boolean).join('  ·  ');
      titleEl.textContent = crisis.title || '';
      subtitleEl.textContent = crisis.subtitle || '';
      skipBtn.hidden = false;

      // Fade the layer in from black, then frame the art.
      root.classList.add('is-leaving');
      void root.offsetWidth;
      root.classList.remove('is-leaving');

      findCrisisArt(crisis.id).then((src) => {
        if (finishCurrent !== resolve) return; // superseded
        const camera = cameraFor(crisis.id);
        if (src) {
          setArt(src, { ...camera, zoomMs: 9000, wash: 'linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.55))' });
        } else {
          const grade = `${look.grade} brightness(${(1 - 0.08 * later3).toFixed(2)})`;
          // District art is bright and detailed: keep the world's wash but a mild grade.
          setArt(districtArtFor(crisis.id), { ...camera, zoomMs: 9000, grade: `saturate(0.9) brightness(${(0.88 - 0.06 * later3).toFixed(2)})`, wash: look.wash });
        }
        rig.classList.add('is-zooming');
      });

      motes.start(look.motes);
      later(250, () => root.classList.add('is-playing'));
      later(500, () => sound.sting(look.darkness + 0.05 * later3));
      later(700, () => kickerEl.classList.add('is-in'));
      later(1150, () => titleEl.classList.add('is-in'));
      later(1900, () => ruleEl.classList.add('is-in'));
      later(2300, () => subtitleEl.classList.add('is-in'));
      later(CARD_MS, leave);
    });
  }

  skipBtn.addEventListener('click', (e) => { e.stopPropagation(); leave(); });
  root.addEventListener('click', () => { if (root.classList.contains('mode-crisis')) leave(); });

  window.LoomCinematic = {
    playIntro,
    playCrisis,
    dismiss: hide,
    isActive: () => !root.hidden,
    sound,
    _test: { cameraFor, worldOf, districtArtFor }
  };
})();
