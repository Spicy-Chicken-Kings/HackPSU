// ============================================================
//  BrainPause v3 — content.js
//  Injected into instagram.com
// ============================================================
(function () {
  'use strict';
  if (window.__bp3) return;
  window.__bp3 = true;

  const BACKEND = 'http://localhost:5000';

  // ─────────────────────────────────────────────────────────────
  //  GLOBAL STATE
  // ─────────────────────────────────────────────────────────────
  const S = {
    running: false,
    paused:  false,
    cfg:     null,           // { mode, intervalMin, sessionMin }

    // interval halving
    intervalMs:    120_000,
    minIntervalMs:  15_000,
    promptTimer:   null,
    cdVal:         0,
    cdInterval:    null,

    // grayscale
    sat:  1.0,
    bri:  1.0,
    gsStep: 0,
    gsTimer: null,

    // scroll
    prevY:     0,
    prevT:     Date.now(),
    velBuf:    [],           // rolling 15-sample velocity buffer
    fastBurst: 0,
    slowStreak: 0,

    // engagement
    likeCount: 0,
    engTimer:  null,
    engWarn:   false,
    engReset:  Date.now(),

    // xp / level
    xp:    0,
    level: 1,
    promptsDone: 0,
    sessionStart: null,

    // pet
    petBubbleTimer: null,
    petRandTimer:   null,

    // prompts
    usedIds: new Set(),
  };

  // ─────────────────────────────────────────────────────────────
  //  NEGATIVE WORD LIST  (local sentiment guard)
  // ─────────────────────────────────────────────────────────────
  const NEG_WORDS = new Set([
    'nothing','none','nobody','hate','hated','hating',
    'terrible','awful','horrible','awful','dreadful',
    'sad','depressed','depressing','depression',
    'miserable','misery','worthless','hopeless',
    'lonely','alone','angry','anger','upset',
    'bad','worst','disgusting','pathetic','useless',
    'boring','bored','empty','pointless','meaningless',
    'stupid','dumb','idiot','fail','failure','failed',
    'ugly','gross','sick','suck','sucks','sucked',
    'tired','exhausted','numb','hurt','hurting','pain',
  ]);

  function isNegative(text) {
    const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
    const hits = words.filter(w => NEG_WORDS.has(w)).length;
    return hits >= 1;
  }

  // ─────────────────────────────────────────────────────────────
  //  PROMPTS
  // ─────────────────────────────────────────────────────────────
  const PROMPTS = [
    {
      id: 'breathe', title: 'Breathe With Me', emoji: '🫁',
      type: 'breathing',
      desc: 'Let\'s slow down together. Follow the circle.',
      petLine: 'Deep breaths reset everything. You deserve this moment 🌸',
    },
    {
      id: 'gratitude', title: 'Gratitude Check', emoji: '✨',
      type: 'write',
      q: 'Write something you\'re grateful for right now:',
      ph: 'I\'m grateful for…',
      petLine: 'Even tiny things count — a warm drink, a good song, sunlight ☀️',
    },
    {
      id: 'physical', title: 'Move Your Body', emoji: '🏃',
      type: 'physical',
      mainText: 'Do 5 jumping jacks!', mainIcon: '🤸',
      altText: 'Stretch both arms above your head and hold for 10 seconds.',
      altIcon: '🙆',
      petLine: 'Movement is medicine! Your body will thank you 💪',
    },
    {
      id: 'eye_rest', title: '20-20 Eye Break', emoji: '👁️',
      type: 'countdown', duration: 20,
      q: 'Look at something about 20 feet away.',
      petLine: 'Your eyes work so hard scrolling all day. Give them a rest! 🌿',
    },
    {
      id: 'senses', title: '5 Senses Check-In', emoji: '🌿',
      type: 'senses',
      q: 'Ground yourself. Name one thing for each sense:',
      senses: [
        { icon: '👀', lbl: 'See'   },
        { icon: '👂', lbl: 'Hear'  },
        { icon: '✋', lbl: 'Touch' },
        { icon: '👃', lbl: 'Smell' },
        { icon: '👅', lbl: 'Taste' },
      ],
      petLine: 'This is grounding magic. You\'re here, right now 🌱',
    },
    {
      id: 'hydration', title: 'Hydration Break', emoji: '💧',
      type: 'ack',
      q: 'Your brain is 75% water.',
      sub: 'Go grab a sip — I\'ll be right here when you\'re back.',
      cta: 'I drank some water! 💧',
      petLine: 'Hydration = better mood, sharper focus, more energy! 💜',
    },
    {
      id: 'offline_win', title: 'Offline Highlight', emoji: '🌟',
      type: 'write',
      q: 'What\'s the best thing that happened to you today — offline?',
      ph: 'Something nice today…',
      petLine: 'Real life has the best moments. Tell me one! 🌞',
    },
    {
      id: 'six_words', title: 'Six Word Story', emoji: '📖',
      type: 'sixwords',
      q: 'Describe your day in exactly 6 words:',
      ph: 'e.g. Woke up, smiled, kept going…',
      petLine: 'Six words, one whole mood. Let\'s hear it 📝',
    },
    {
      id: 'annoyance', title: 'Comic Relief', emoji: '😅',
      type: 'write',
      q: 'What\'s a minor thing that bothers you way more than it should?',
      ph: 'The thing that gets me is…',
      petLine: 'Laughing at small stuff is underrated therapy 😄',
    },
    {
      id: 'proud', title: 'Proud Moment', emoji: '🏆',
      type: 'write',
      q: 'What\'s something you\'ve done recently that you\'re proud of?',
      ph: 'Recently I…',
      petLine: 'You\'ve done something worth celebrating. Find it! 🎉',
    },
    {
      id: 'travel', title: 'Dream Destination', emoji: '✈️',
      type: 'write',
      q: 'Where in the world do you most want to visit? Why?',
      ph: 'I want to go to…',
      petLine: 'Dream big! Every journey starts with a single thought 🗺️',
    },
  ];

  // ─────────────────────────────────────────────────────────────
  //  PET MESSAGES
  // ─────────────────────────────────────────────────────────────
  const MSGS = {
    fast:     ['Speedy much? 🏎️', 'Whoa, slow down!', 'Is something chasing you? 🚀', 'Easy there, racer!', 'Fingers flying! 👀'],
    shy:      ['Don\'t be shy! 💗', 'Nothing catching your eye?', 'Give a post some love! ❤️', 'Interact a little! 😊', 'Like something! Go on 😄'],
    slowEnj:  ['Enjoying what you see? 🌸', 'Taking it all in~ ✨', 'Love the energy! 💕', 'Good vibes only 🌟'],
    rand:     ['What\'s the buzz? 🐝', 'Hey there! 👋', 'How\'s the feed?', 'Still with me? 😊', 'You\'re doing great 💜', 'Heyyyy 🌸', 'Peek-a-boo! 👀'],
    lvlUp:    ['Level up! ⬆️✨', 'You\'re growing! 🌱', 'Love that reflection! 💜', 'Look at you go! 🎉'],
    empty:    ['Don\'t forget to respond! I\'m listening 🌸', 'Take a moment — what comes to mind? 💭', 'Your thoughts matter! Give it a try ✏️', 'Even one word counts 💜'],
    negative: [
      'It\'s okay — even hard days have a tiny bright spot 🌤️ Try again?',
      'Rough day? That\'s totally valid. You still showed up — that counts 💜',
      'Sending you love 💗 Can you find one small positive thing?',
      'Be gentle with yourself. What\'s one thing going okay right now?',
      'You deserve kindness — especially from yourself 🌸 Want to try again?',
      'Hard times pass. What\'s one tiny thing you can appreciate? ✨',
    ],
    praise:   ['Love that reflection! 💜', 'That\'s beautiful 🌟', 'So thoughtful 🧠', 'Really lovely! ✨', 'You\'re doing amazing! 🎉', 'Worth remembering 💡', 'Wonderful! 💗', 'You\'ve got this ⭐'],
  };

  function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  const qs  = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => [...r.querySelectorAll(s)];

  // ─────────────────────────────────────────────────────────────
  //  BRAIN SVG  — pink, detailed
  // ─────────────────────────────────────────────────────────────
  // size: 'pet' (big sidebar) | 'prompt' (in overlay) | 'mini' (validation row)
  function brainSVG(size) {
    const W = size === 'pet' ? 120 : size === 'prompt' ? 76 : 42;
    const uid = size + Math.random().toString(36).slice(2, 6);
    return `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"
  class="bp-brain bp-brain-${size}" width="${W}" height="${W}">
  <defs>
    <radialGradient id="g1-${uid}" cx="50%" cy="45%" r="55%">
      <stop offset="0%"   stop-color="#ffe4ec"/>
      <stop offset="100%" stop-color="#ff8fab"/>
    </radialGradient>
    <radialGradient id="g2-${uid}" cx="30%" cy="30%" r="60%">
      <stop offset="0%"   stop-color="#ffc2d1" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#ff4d6d" stop-opacity="0.3"/>
    </radialGradient>
    <filter id="gs-${uid}">
      <feGaussianBlur stdDeviation="2.8" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Soft halo -->
  <ellipse cx="60" cy="65" rx="50" ry="46" fill="#ff8fab" opacity="0.08"/>

  <!-- Brain body -->
  <path d="M60 98
    C28 98 11 79 11 57
    C11 36 29 18 49 17
    C52 17 55 18 57 19.5
    C55 13 50 7 50 7
    C68 4 77 22 71 35
    C79 29 91 33 92 46
    C101 43 111 53 108 67
    C105 80 93 88 79 91
    C76 95 69 98 60 98Z"
    fill="url(#g1-${uid})" filter="url(#gs-${uid})"/>

  <!-- Right lobe shade -->
  <path d="M60 98
    C37 94 24 80 21 66
    C18 52 27 41 40 36
    C37 50 44 64 55 70
    C51 78 54 90 60 98Z"
    fill="url(#g2-${uid})" opacity="0.65"/>

  <!-- Highlight top -->
  <path d="M51 21 Q67 17 80 29"
    stroke="#fff0f3" stroke-width="5.5" fill="none"
    stroke-linecap="round" opacity="0.55"/>

  <!-- Brain folds -->
  <path d="M44 31 Q57 39 53 54" stroke="#c9184a" stroke-width="2.2"   fill="none" opacity="0.42" stroke-linecap="round"/>
  <path d="M69 29 Q77 44 67 57" stroke="#c9184a" stroke-width="2.2"   fill="none" opacity="0.42" stroke-linecap="round"/>
  <path d="M27 60 Q40 68 33 79" stroke="#c9184a" stroke-width="2"     fill="none" opacity="0.35" stroke-linecap="round"/>
  <path d="M84 50 Q93 63 84 72" stroke="#c9184a" stroke-width="2"     fill="none" opacity="0.38" stroke-linecap="round"/>
  <path d="M30 48 Q60 54 88 47" stroke="#c9184a" stroke-width="1.6"   fill="none" opacity="0.28" stroke-linecap="round"/>

  <!-- White eyes -->
  <circle cx="45" cy="63" r="10"  fill="white"   filter="url(#gs-${uid})"/>
  <circle cx="75" cy="63" r="10"  fill="white"   filter="url(#gs-${uid})"/>
  <!-- Pupils -->
  <circle cx="46" cy="64" r="6.2" fill="#1a0010" class="bp-pl"/>
  <circle cx="76" cy="64" r="6.2" fill="#1a0010" class="bp-pr"/>
  <!-- Shine -->
  <circle cx="48.5" cy="61.5" r="2.2" fill="white"/>
  <circle cx="78.5" cy="61.5" r="2.2" fill="white"/>

  <!-- Top lashes -->
  <path d="M37 56 Q45 51 53 56" stroke="#c9184a" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.9"/>
  <path d="M67 56 Q75 51 83 56" stroke="#c9184a" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.9"/>

  <!-- Smile -->
  <path d="M48 80 Q60 92 72 80"
    stroke="#c9184a" stroke-width="3" fill="none"
    stroke-linecap="round" class="bp-mouth"/>

  <!-- Rosy cheeks -->
  <ellipse cx="32"  cy="73" rx="8"  ry="5"  fill="#ff4d6d" opacity="0.22"/>
  <ellipse cx="88"  cy="73" rx="8"  ry="5"  fill="#ff4d6d" opacity="0.22"/>

  <!-- Floating heart -->
  <text x="60" y="13" font-size="12" text-anchor="middle" class="bp-hrt">💗</text>
</svg>`;
  }

  // ─────────────────────────────────────────────────────────────
  //  GRAYSCALE  — targets only feed media
  // ─────────────────────────────────────────────────────────────
  function initGrayscale() {
    let el = document.getElementById('bp-gs');
    if (!el) {
      el = document.createElement('style');
      el.id = 'bp-gs';
      document.head.appendChild(el);
    }
    applyGrayscale();
  }

  function applyGrayscale() {
    const el = document.getElementById('bp-gs');
    if (!el) return;
    // Target IG feed images & videos but exclude our own UI
    el.textContent = `
      article img:not(.bp-brain *),
      article video,
      ._aagv img, ._aagv video,
      ._ac7v img, ._ac7v video,
      [role="main"] img:not(#bp-pet img):not(#bp-overlay img):not(#bp-setup img),
      [role="main"] video {
        filter: saturate(${S.sat.toFixed(3)}) brightness(${S.bri.toFixed(3)}) !important;
        transition: filter 6s ease !important;
      }
    `;
  }

  function restoreGrayscale() {
    const el = document.getElementById('bp-gs');
    if (el) el.textContent = '';
  }

  function tickGrayscale() {
    if (!S.running) return;
    S.gsStep++;
    // 1.0 → 0.40 sat over ~30 steps (every 20 s ≈ 10 min); 1.0 → 0.87 bri
    S.sat = clamp(1.0 - S.gsStep * 0.02,  0.40, 1.0);
    S.bri = clamp(1.0 - S.gsStep * 0.0045, 0.87, 1.0);
    applyGrayscale();
  }

  // ─────────────────────────────────────────────────────────────
  //  SCROLL TRACKING
  // ─────────────────────────────────────────────────────────────
  function initScroll() {
    const onScroll = () => {
      if (!S.running || S.paused) return;
      const now = Date.now();
      const dt  = Math.max(1, now - S.prevT);
      const vel = (Math.abs(window.scrollY - S.prevY) / dt) * 1000; // px/s
      S.prevY = window.scrollY;
      S.prevT = now;

      S.velBuf.push(vel);
      if (S.velBuf.length > 15) S.velBuf.shift();
      const avg = S.velBuf.reduce((a, b) => a + b, 0) / S.velBuf.length;

      if (avg > 850) {
        S.fastBurst++;
        S.slowStreak = 0;
        if (S.fastBurst >= 5) {
          S.fastBurst = 0;
          petSay(rnd(MSGS.fast));
          if (S.cfg?.mode === 'doomscroll')
            S.intervalMs = Math.max(S.minIntervalMs, Math.floor(S.intervalMs * 0.65));
        }
      } else if (avg < 180 && vel > 10) {
        S.fastBurst = 0;
        S.slowStreak++;
        if (S.slowStreak >= 12 && S.likeCount > 0) {
          S.slowStreak = 0;
          petSay(rnd(MSGS.slowEnj));
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  }

  // ─────────────────────────────────────────────────────────────
  //  ENGAGEMENT TRACKING
  // ─────────────────────────────────────────────────────────────
  function initEngagement() {
    document.addEventListener('click', (e) => {
      if (e.target?.closest('[aria-label*="Like"],[aria-label*="Unlike"],[aria-label*="Comment"],[aria-label*="Save"]')) {
        S.likeCount++;
        S.engWarn = false;
      }
    }, { capture: true });

    S.engTimer = setInterval(() => {
      if (!S.running || S.paused) return;
      if (Date.now() - S.engReset < 90_000) return;
      // 90 s passed
      if (S.likeCount === 0 && !S.engWarn) {
        S.engWarn = true;
        petSay(rnd(MSGS.shy));
        if (S.cfg?.mode === 'doomscroll') firePetTriggerPrompt();
      }
      S.likeCount = 0;
      S.engReset  = Date.now();
      S.engWarn   = false;
    }, 8000);
  }

  // ─────────────────────────────────────────────────────────────
  //  BRAIN PET  (sidebar — large, middle-right)
  // ─────────────────────────────────────────────────────────────
  function buildPet() {
    if (document.getElementById('bp-pet')) return;

    const wrap = document.createElement('div');
    wrap.id = 'bp-pet';
    wrap.innerHTML = `
      <div id="bp-bubble" class="bp-bubble"></div>
      <div class="bp-pet-body">
        ${brainSVG('pet')}
        <div class="bp-lvl-badge" id="bp-lvl-badge">Lv.${S.level}</div>
        <div class="bp-sparks">
          <span class="bp-sp s1">✨</span>
          <span class="bp-sp s2">💗</span>
          <span class="bp-sp s3">⭐</span>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    wrap.querySelector('.bp-pet-body').addEventListener('click', () => petSay(rnd(MSGS.rand)));
    scheduleRandMessage();
  }

  function petSay(msg, dur = 4200) {
    const pet    = document.getElementById('bp-pet');
    const bubble = document.getElementById('bp-bubble');
    if (!pet || !bubble) return;

    bubble.textContent = msg;
    bubble.classList.add('bp-bubble-show');
    pet.classList.add('bp-pet-show', 'bp-pet-talk');

    clearTimeout(S.petBubbleTimer);
    S.petBubbleTimer = setTimeout(() => {
      bubble.classList.remove('bp-bubble-show');
      pet.classList.remove('bp-pet-talk');
      setTimeout(() => {
        if (!document.getElementById('bp-overlay'))
          pet.classList.remove('bp-pet-show');
      }, 500);
    }, dur);
  }

  function scheduleRandMessage() {
    clearTimeout(S.petRandTimer);
    S.petRandTimer = setTimeout(() => {
      if (S.running && !S.paused) petSay(rnd(MSGS.rand));
      scheduleRandMessage();
    }, 45_000 + Math.random() * 75_000);
  }

  function petLevelUp() {
    S.level++;
    const b = document.getElementById('bp-lvl-badge');
    if (b) b.textContent = `Lv.${S.level}`;
    const p = document.getElementById('bp-pet');
    if (p) { p.classList.add('bp-pet-glow'); setTimeout(() => p.classList.remove('bp-pet-glow'), 2800); }
    petSay(rnd(MSGS.lvlUp), 4500);
  }

  // ─────────────────────────────────────────────────────────────
  //  SETUP CARD
  // ─────────────────────────────────────────────────────────────
  function showSetup() {
    if (document.getElementById('bp-setup')) return;

    const el = document.createElement('div');
    el.id = 'bp-setup';
    el.innerHTML = `
      <div class="bp-setup-card">
        <div class="bp-setup-top">
          <div class="bp-setup-brain">${brainSVG('prompt')}</div>
          <div class="bp-setup-intro">
            <p class="bp-setup-hi">Hey! I'm your Brain Pet 🧠💗</p>
            <p class="bp-setup-hint">I'll help you scroll more mindfully on Instagram.</p>
          </div>
        </div>

        <h2 class="bp-h2">Welcome to BrainPause</h2>
        <p class="bp-sub">How should I check in with you?</p>

        <div class="bp-modes">
          <label class="bp-mode bp-mode-on" data-mode="timer">
            <span class="bp-mode-ico">⏱️</span>
            <span class="bp-mode-body">
              <strong>Set a Timer</strong>
              <small>Prompts on a regular schedule</small>
            </span>
            <span class="bp-mode-dot"></span>
          </label>
          <label class="bp-mode" data-mode="doomscroll">
            <span class="bp-mode-ico">🔍</span>
            <span class="bp-mode-body">
              <strong>Detect Doomscrolling</strong>
              <small>I step in when I notice you zoning out</small>
            </span>
            <span class="bp-mode-dot"></span>
          </label>
        </div>

        <div class="bp-field">
          <label class="bp-lbl">First prompt after</label>
          <div class="bp-slider-row">
            <input type="range" id="bp-iv" min="1" max="30" value="5" class="bp-range">
            <span class="bp-rv" id="bp-ivv">5 min</span>
          </div>
        </div>

        <div class="bp-field">
          <label class="bp-lbl">Session limit</label>
          <div class="bp-slider-row">
            <input type="range" id="bp-sess" min="5" max="120" value="30" class="bp-range">
            <span class="bp-rv" id="bp-sessv">30 min</span>
          </div>
        </div>

        <button class="bp-go" id="bp-go">Let's go <span>→</span></button>
      </div>`;
    document.body.appendChild(el);

    let mode = 'timer';
    qsa('.bp-mode', el).forEach(m => m.addEventListener('click', () => {
      qsa('.bp-mode', el).forEach(x => x.classList.remove('bp-mode-on'));
      m.classList.add('bp-mode-on');
      mode = m.dataset.mode;
    }));

    qs('#bp-iv',   el).addEventListener('input', e => qs('#bp-ivv',   el).textContent = e.target.value + ' min');
    qs('#bp-sess', el).addEventListener('input', e => qs('#bp-sessv', el).textContent = e.target.value + ' min');

    qs('#bp-go', el).addEventListener('click', () => {
      const cfg = { mode, intervalMin: +qs('#bp-iv', el).value, sessionMin: +qs('#bp-sess', el).value };
      startSession(cfg);
      el.classList.add('bp-fade-out');
      setTimeout(() => el.remove(), 500);
    });

    requestAnimationFrame(() => el.classList.add('bp-in'));
  }

  // ─────────────────────────────────────────────────────────────
  //  SESSION
  // ─────────────────────────────────────────────────────────────
  function startSession(cfg) {
    S.running = true;
    S.paused  = false;
    S.cfg     = cfg;
    S.intervalMs  = cfg.intervalMin * 60_000;
    S.sessionStart = Date.now();
    S.sat = 1.0; S.bri = 1.0; S.gsStep = 0;

    chrome.storage.local.set({
      brainpause_active: true,
      brainpause_settings: cfg,
      brainpause_stats: { prompts: 0, level: 1, lp: 0, start: Date.now() },
    });

    initGrayscale();
    initScroll();
    initEngagement();
    buildPet();

    S.gsTimer = setInterval(tickGrayscale, 20_000);
    scheduleNext();
    chrome.runtime.sendMessage({ type: 'SET_SESSION_END', delayMinutes: cfg.sessionMin });
    setTimeout(() => petSay('Session started! I\'ll keep watch 👀', 3500), 700);
  }

  function scheduleNext() {
    clearTimeout(S.promptTimer);
    clearInterval(S.cdInterval);
    S.cdVal = Math.floor(S.intervalMs / 1000);
    S.cdInterval = setInterval(() => { if (!S.paused) S.cdVal = Math.max(0, S.cdVal - 1); }, 1000);
    S.promptTimer = setTimeout(() => { if (S.running && !S.paused) firePrompt(); }, S.intervalMs);
  }

  function firePrompt() {
    showOverlay(pickPrompt());
    S.intervalMs = Math.max(S.minIntervalMs, Math.floor(S.intervalMs / 2));
  }

  // engagement-triggered (doomscroll mode)
  function firePetTriggerPrompt() {
    clearTimeout(S.promptTimer);
    clearInterval(S.cdInterval);
    firePrompt();
  }

  function pickPrompt(skip = null) {
    const pool = PROMPTS.filter(p => p.id !== skip && !S.usedIds.has(p.id));
    const src  = pool.length ? pool : PROMPTS.filter(p => p.id !== skip);
    if (!src.length) { S.usedIds.clear(); return PROMPTS[0]; }
    return src[Math.floor(Math.random() * src.length)];
  }

  // ─────────────────────────────────────────────────────────────
  //  PROMPT OVERLAY
  // ─────────────────────────────────────────────────────────────
  function showOverlay(prompt) {
    document.getElementById('bp-overlay')?.remove();

    const ov = document.createElement('div');
    ov.id = 'bp-overlay';
    ov.innerHTML = `
      <div class="bp-backdrop"></div>
      <div class="bp-card">

        <!-- Pet row -->
        <div class="bp-pet-row">
          <div class="bp-pet-avatar">${brainSVG('prompt')}</div>
          <div class="bp-pet-say">
            <div class="bp-say-main">Hey… it's been a while 👋</div>
            <div class="bp-say-hint">${prompt.petLine || 'Take a moment for yourself 💗'}</div>
          </div>
        </div>

        <!-- Title bar -->
        <div class="bp-title-row">
          <div class="bp-emoji-box">${prompt.emoji}</div>
          <h3 class="bp-title">${prompt.title}</h3>
        </div>

        <!-- Body -->
        <div class="bp-body">${makeBody(prompt)}</div>

        <!-- Feedback zone -->
        <div class="bp-feedback" id="bp-feedback" style="display:none">
          <div class="bp-fb-pet">${brainSVG('mini')}</div>
          <div class="bp-fb-msg" id="bp-fb-msg"></div>
        </div>

        <!-- Buttons -->
        <div class="bp-actions">
          <button class="bp-skip" id="bp-skip">↻ Try another</button>
          <button class="bp-done" id="bp-done">Done ✓</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    // show pet on sidebar
    document.getElementById('bp-pet')?.classList.add('bp-pet-show');

    // wire
    qs('#bp-done', ov).addEventListener('click', () => onDone(prompt, ov));
    qs('#bp-skip', ov).addEventListener('click', () => onSkip(prompt));

    if (prompt.type === 'breathing') startBreathing(ov);
    if (prompt.type === 'countdown') startCountdown(prompt, ov);
    if (prompt.type === 'physical')  wirePhysical(ov);
    if (prompt.type === 'ack')       wireAck(ov);

    requestAnimationFrame(() => ov.classList.add('bp-ov-in'));
  }

  function makeBody(p) {
    switch (p.type) {
      case 'breathing': return `
        <p class="bp-desc">${p.desc}</p>
        <div class="bp-breath-wrap">
          <div class="bp-ring" id="bp-ring">
            <span class="bp-ring-lbl" id="bp-ring-lbl">Breathe in…</span>
          </div>
        </div>`;

      case 'write': case 'sixwords': return `
        <p class="bp-desc">${p.q}</p>
        <textarea class="bp-ta" id="bp-ta" placeholder="${p.ph || 'Type here…'}" rows="3"
          ${p.type === 'sixwords' ? 'maxlength="90"' : ''}></textarea>
        ${p.type === 'sixwords' ? '<div class="bp-wc" id="bp-wc">0 / 6 words</div>' : ''}`;

      case 'physical': return `
        <div class="bp-phys">
          <div class="bp-phys-ico" id="bp-phys-ico">${p.mainIcon}</div>
          <p class="bp-desc">${p.mainText}</p>
          <div class="bp-phys-cnt" id="bp-cnt">0<span>/5</span></div>
          <button class="bp-cnt-btn" id="bp-inc">+ One done!</button>
          <button class="bp-alt-tog" id="bp-alt-tog">Can't do that right now?</button>
          <div class="bp-alt-box" id="bp-alt-box" style="display:none">${p.altIcon} ${p.altText}</div>
        </div>`;

      case 'countdown': return `
        <p class="bp-desc">${p.q}</p>
        <div class="bp-cd-wrap">
          <div class="bp-cd-ring">
            <svg viewBox="0 0 80 80" class="bp-cd-svg">
              <circle cx="40" cy="40" r="34" fill="none" stroke="#252538" stroke-width="6"/>
              <circle cx="40" cy="40" r="34" fill="none" stroke="#ff8fab" stroke-width="6"
                stroke-dasharray="213.6" stroke-dashoffset="0" id="bp-cd-arc"
                stroke-linecap="round" transform="rotate(-90 40 40)"/>
            </svg>
            <div class="bp-cd-num" id="bp-cd-num">${p.duration}</div>
          </div>
        </div>`;

      case 'senses': return `
        <p class="bp-desc">${p.q}</p>
        <div class="bp-senses">
          ${p.senses.map(s => `
            <div class="bp-sense-row">
              <span class="bp-si">${s.icon}</span>
              <span class="bp-sl">${s.lbl}</span>
              <input class="bp-si-in" placeholder="I ${s.lbl.toLowerCase()}…" type="text">
            </div>`).join('')}
        </div>`;

      case 'ack': return `
        <p class="bp-desc">${p.q}</p>
        <p class="bp-sub">${p.sub || ''}</p>
        <div class="bp-ack-ico">💧</div>
        <button class="bp-ack-btn" id="bp-ack-btn">${p.cta}</button>`;
    }
    return `<p class="bp-desc">${p.q || p.desc || ''}</p>`;
  }

  // ── prompt-specific wiring ───────────────────────────────────
  function startBreathing(root) {
    const ring = qs('#bp-ring', root), lbl = qs('#bp-ring-lbl', root);
    if (!ring || !lbl) return;
    let phase = 'in';
    const go = () => {
      if (!document.getElementById('bp-overlay')) return;
      if (phase === 'in')   { ring.classList.remove('bp-out'); ring.classList.add('bp-in');  lbl.textContent = 'Breathe in…';  phase = 'hold'; setTimeout(go, 4000); }
      else if (phase === 'hold') { lbl.textContent = 'Hold…';          phase = 'out';  setTimeout(go, 2000); }
      else                  { ring.classList.remove('bp-in');  ring.classList.add('bp-out'); lbl.textContent = 'Breathe out…'; phase = 'in';   setTimeout(go, 4500); }
    };
    go();
  }

  function startCountdown(p, root) {
    let rem = p.duration;
    const arc = qs('#bp-cd-arc', root), num = qs('#bp-cd-num', root);
    const t = setInterval(() => {
      if (!document.getElementById('bp-overlay')) { clearInterval(t); return; }
      rem--;
      if (num) num.textContent = rem <= 0 ? '✓' : rem;
      if (arc)  arc.style.strokeDashoffset = 213.6 * (1 - rem / p.duration);
      if (rem <= 0) { clearInterval(t); qs('#bp-done', root)?.classList.add('bp-done-ready'); }
    }, 1000);
  }

  function wirePhysical(root) {
    let n = 0;
    const btn  = qs('#bp-inc',     root);
    const disp = qs('#bp-cnt',     root);
    const ico  = qs('#bp-phys-ico',root);
    btn?.addEventListener('click', () => {
      n++;
      if (disp) disp.innerHTML = `${n}<span>/5</span>`;
      if (ico && n >= 3) ico.style.transform = 'scale(1.3) rotate(8deg)';
      if (n >= 5) { btn.textContent = '🎉 All done!'; btn.disabled = true; qs('#bp-done', root)?.classList.add('bp-done-ready'); }
    });
    const tog = qs('#bp-alt-tog', root), box = qs('#bp-alt-box', root);
    tog?.addEventListener('click', () => {
      const v = box.style.display !== 'none';
      box.style.display = v ? 'none' : 'block';
      tog.textContent = v ? 'Can\'t do that right now?' : 'Show original ↑';
    });
  }

  function wireAck(root) {
    qs('#bp-ack-btn', root)?.addEventListener('click', (e) => {
      e.target.textContent = '✓ Nice!'; e.target.disabled = true;
      qs('#bp-done', root)?.classList.add('bp-done-ready');
    });
  }

  // live six-word counter
  document.addEventListener('input', e => {
    if (e.target.id === 'bp-ta') {
      const wc = document.getElementById('bp-wc');
      if (wc) {
        const n = e.target.value.trim().split(/\s+/).filter(Boolean).length;
        wc.textContent = `${n} / 6 words`;
        wc.style.color = n === 6 ? '#34d399' : n > 6 ? '#f87171' : '#8887a0';
      }
    }
  });

  // ─────────────────────────────────────────────────────────────
  //  COMPLETE PROMPT  — the core validation logic
  // ─────────────────────────────────────────────────────────────
  async function onDone(prompt, root) {
    const ta   = qs('#bp-ta', root || document);
    const resp = ta ? ta.value.trim() : '';
    const fb   = qs('#bp-feedback', root || document);
    const fbMsg= qs('#bp-fb-msg',   root || document);
    const isText = ['write', 'sixwords'].includes(prompt.type);

    // ── 1. EMPTY CHECK ─────────────────────────────────────────
    if (isText && resp.length === 0) {
      showFeedback(fb, fbMsg, rnd(MSGS.empty), 'warn');
      ta.classList.add('bp-shake');
      setTimeout(() => ta.classList.remove('bp-shake'), 600);
      return; // block completion — don't dismiss
    }

    // ── 2. NEGATIVE SENTIMENT CHECK ────────────────────────────
    if (isText && isNegative(resp)) {
      showFeedback(fb, fbMsg, rnd(MSGS.negative), 'support');
      addXP(2);
      // Let them read the message, then dismiss after a pause
      setTimeout(() => dismissOverlay(), 4500);
      return;
    }

     // ── 3. POSITIVE / NORMAL PATH ──────────────────────────────
     S.promptsDone++;
     S.usedIds.add(prompt.id);
 
     if (isText && resp.length > 0) {
       showFeedback(fb, fbMsg, 'Thinking… 🧠', 'loading');
       try {
         const r = await callBackend(resp, prompt.id);
         showFeedback(fb, fbMsg, r?.message || rnd(MSGS.praise), r?.level_up ? 'good' : 'warn');
         if (r?.level_up) {
           S.xp += (r.score || 7);
           checkLevel();
           saveStats();
           setTimeout(() => dismissOverlay(), 3000);
         } else {
           addXP(4);
           saveStats();
           // prompt stays open for another try
         }
       } catch {
         showFeedback(fb, fbMsg, rnd(MSGS.praise), 'good');
         addXP(3);
         saveStats();
         setTimeout(() => dismissOverlay(), 3000);
       }
     } else {
       showFeedback(fb, fbMsg, rnd(MSGS.praise), 'good');
       addXP(2);
       saveStats();
       setTimeout(() => dismissOverlay(), 3000);
     }
  }

  function showFeedback(area, msgEl, text, type) {
    if (!area || !msgEl) return;
    area.style.display = 'flex';
    msgEl.textContent  = text;
    msgEl.className    = `bp-fb-msg bp-fb-${type}`;
  }

  function onSkip(current) {
    document.getElementById('bp-overlay')?.remove();
    showOverlay(pickPrompt(current.id));   // always swap, never dismiss
  }

  function dismissOverlay() {
    const ov = document.getElementById('bp-overlay');
    if (ov) { ov.classList.add('bp-ov-out'); setTimeout(() => ov.remove(), 450); }
    scheduleNext();
  }

  // ─────────────────────────────────────────────────────────────
  //  XP / LEVELS
  // ─────────────────────────────────────────────────────────────
  function addXP(n) { S.xp += n; checkLevel(); }

  function checkLevel() {
    if (S.xp >= S.level * 20) petLevelUp();
    saveStats();
  }

  function saveStats() {
    chrome.storage.local.set({
      brainpause_stats: {
        prompts: S.promptsDone, level: S.level,
        lp: Math.min(100, (S.xp / (S.level * 20)) * 100),
        start: S.sessionStart,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  BACKEND (AI validation)
  // ─────────────────────────────────────────────────────────────
  async function callBackend(response, promptId) {
    const r = await fetch(`${BACKEND}/validate-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response, prompt_type: promptId }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error();
    return r.json();
  }

  // ─────────────────────────────────────────────────────────────
  //  EXTENSION MESSAGING
  // ─────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((m, _, reply) => {
    if (m.type === 'ALARM_TRIGGER')       { if (S.running && !S.paused) firePrompt(); reply({ ok: true }); }
    if (m.type === 'SESSION_END')         { endSession(); reply({ ok: true }); }
    if (m.type === 'TOGGLE_PAUSE')        { S.paused = !S.paused; if (!S.paused) scheduleNext(); reply({ paused: S.paused }); }
    if (m.type === 'END_SESSION')         { endSession(); reply({ ok: true }); }
    if (m.type === 'GET_NEXT_PROMPT_TIME'){ reply({ seconds: S.cdVal }); }
    return true;
  });

  function endSession() {
    S.running = false;
    clearTimeout(S.promptTimer); clearInterval(S.cdInterval);
    clearTimeout(S.petRandTimer); clearInterval(S.gsTimer); clearInterval(S.engTimer);
    restoreGrayscale();
    document.getElementById('bp-overlay')?.remove();
    chrome.storage.local.set({ brainpause_active: false });
    petSay(`Session done! Great work 🌟 Lv.${S.level}`, 6000);
  }

  // ─────────────────────────────────────────────────────────────
  //  BOOT
  // ─────────────────────────────────────────────────────────────
  async function boot() {
    const d = await chrome.storage.local.get(['brainpause_active', 'brainpause_settings']);
    if (d.brainpause_active && d.brainpause_settings) startSession(d.brainpause_settings);
    else setTimeout(showSetup, 1600);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', boot)
    : boot();
})();
