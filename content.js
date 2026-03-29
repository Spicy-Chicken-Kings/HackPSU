// ============================================================
//  BrainPause — Content Script (instagram.com)
//  Mindful scrolling companion
// ============================================================

(function () {
  'use strict';

  // ── Prevent double-injection ────────────────────────────────
  if (window.__brainpause_loaded) return;
  window.__brainpause_loaded = true;

  // ── Backend URL ─────────────────────────────────────────────
  const API = 'http://localhost:5000';

  // ── State ───────────────────────────────────────────────────
  const BP = {
    active: false,
    paused: false,
    settings: null,

    // Timing
    intervalMs: 120000,        // current interval (halves after each prompt)
    minIntervalMs: 15000,      // floor: 15 seconds
    promptTimerId: null,
    sessionEndTimerId: null,
    countdownVal: 0,
    countdownTimer: null,

    // Grayscale / desaturation
    saturation: 1.0,           // starts full color
    brightness: 1.0,
    grayscaleTimer: null,

    // Scroll tracking
    lastScrollY: 0,
    lastScrollTime: Date.now(),
    scrollVelocity: 0,
    scrollSamples: [],
    fastScrollCount: 0,

    // Engagement tracking
    likeCount: 0,
    commentCount: 0,
    lastEngagementCheck: Date.now(),
    engagementWarned: false,

    // Session stats
    promptCount: 0,
    level: 1,
    xp: 0,
    sessionStart: null,

    // UI refs
    setupEl: null,
    overlayEl: null,
    petEl: null,
    feedFilter: null,

    // Pet state
    petShown: false,
    petTimerId: null,
    petHideTimerId: null,
    petLevel: 1,

    // Prompts
    usedPromptIds: new Set(),
    activePromptId: null,
  };

  // ── Prompt Definitions ──────────────────────────────────────
  const PROMPTS = [
    {
      id: 'breathe',
      title: 'Breathe With Me',
      emoji: '🫁',
      type: 'breathing',
      desc: 'Take a mindful breath. Follow the circle.',
    },
    {
      id: 'gratitude',
      title: 'Gratitude Check',
      emoji: '✨',
      type: 'write',
      prompt: 'Write something you\'re grateful for right now:',
      placeholder: 'I\'m grateful for…',
    },
    {
      id: 'physical',
      title: 'Move Your Body',
      emoji: '🏃',
      type: 'physical',
      primary: 'Do 5 jumping jacks!',
      primaryIcon: '🤸',
      alt: 'Can\'t jump right now? Stretch both arms above your head and hold for 10 seconds.',
      altIcon: '🙆',
    },
    {
      id: 'eye_rest',
      title: '20-20 Eye Break',
      emoji: '👁️',
      type: 'countdown',
      prompt: 'Look at something 20 feet away.',
      duration: 20,
    },
    {
      id: '5_senses',
      title: '5 Senses Check-In',
      emoji: '🌿',
      type: 'senses',
      prompt: 'Ground yourself. Name one thing for each sense:',
      senses: [
        { icon: '👀', label: 'See' },
        { icon: '👂', label: 'Hear' },
        { icon: '✋', label: 'Touch' },
        { icon: '👃', label: 'Smell' },
        { icon: '👅', label: 'Taste' },
      ],
    },
    {
      id: 'hydration',
      title: 'Hydration Break',
      emoji: '💧',
      type: 'acknowledge',
      prompt: 'Your brain is 75% water.',
      sub: 'Go grab a sip — we\'ll be here when you\'re back.',
      cta: 'I took a sip! 💧',
    },
    {
      id: 'offline_win',
      title: 'Offline Highlight',
      emoji: '🌟',
      type: 'write',
      prompt: 'What\'s the best thing that happened to you today — offline?',
      placeholder: 'Something nice today…',
    },
    {
      id: 'six_words',
      title: 'Six Word Story',
      emoji: '📖',
      type: 'six_words',
      prompt: 'Describe your day in exactly 6 words:',
      placeholder: 'Word 1, Word 2…',
    },
    {
      id: 'minor_annoyance',
      title: 'Comic Relief',
      emoji: '😅',
      type: 'write',
      prompt: 'What\'s a minor thing that annoys you way more than it should?',
      placeholder: 'The thing that gets me is…',
    },
    {
      id: 'proud',
      title: 'Proud Moment',
      emoji: '🏆',
      type: 'write',
      prompt: 'What\'s something you\'ve done recently that you\'re proud of?',
      placeholder: 'Recently I…',
    },
    {
      id: 'travel_dream',
      title: 'Dream Destination',
      emoji: '✈️',
      type: 'write',
      prompt: 'Where in the world do you most want to visit? Why?',
      placeholder: 'I want to go to…',
    },
  ];

  // ── Pet Messages ────────────────────────────────────────────
  const PET_MSGS = {
    fast: ['Speedy much? 🏎️', 'Whoa, slow down!', 'Going somewhere? 🚀', 'Easy there, racer!'],
    low_engage: ['Feeling shy? 👀', 'Not liking much today?', 'Just passing through?', 'Invisible mode on?'],
    general: ['What\'s the buzz? 🐝', 'Still here? 👋', 'How\'s the feed treating you?', 'You good? 😊', 'Taking it all in~', 'Heyyyy 👀'],
    level_up: ['Level up! ⬆️✨', 'You\'re growing! 🌱', 'Love the reflection! 💜'],
  };

  // ── Utilities ───────────────────────────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function formatSeconds(s) {
    if (s >= 60) return Math.floor(s / 60) + 'm ' + (s % 60).toString().padStart(2, '0') + 's';
    return s + 's';
  }

  // ── Feed Filter (Desaturation) ──────────────────────────────
  function initFeedFilter() {
    const style = document.createElement('style');
    style.id = 'bp-filter-style';
    style.textContent = `
      body { 
        filter: saturate(1) brightness(1) !important;
        transition: filter 2s ease !important;
      }
    `;
    document.head.appendChild(style);
  }

  function updateFeedFilter() {
    const style = $('#bp-filter-style');
    if (!style) return;
    style.textContent = `
      body { 
        filter: saturate(${BP.saturation}) brightness(${BP.brightness}) !important;
        transition: filter 3s ease !important;
      }
    `;
  }

  function stepDesaturation() {
    // Gradual: step by ~0.03 per tick (every 30s), floor at 0.55 saturation / 0.92 brightness
    BP.saturation = clamp(BP.saturation - 0.03, 0.55, 1.0);
    BP.brightness = clamp(BP.brightness - 0.008, 0.92, 1.0);
    updateFeedFilter();
  }

  // ── Scroll Tracking ─────────────────────────────────────────
  function initScrollTracking() {
    window.addEventListener('scroll', onScroll, { passive: true });
    // Also track Instagram's main scroll container
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  }

  function onScroll(e) {
    if (!BP.active || BP.paused) return;
    const now = Date.now();
    const dt = (now - BP.lastScrollTime) / 1000;
    const dy = Math.abs(window.scrollY - BP.lastScrollY);
    if (dt > 0) BP.scrollVelocity = dy / dt;

    BP.scrollSamples.push(BP.scrollVelocity);
    if (BP.scrollSamples.length > 10) BP.scrollSamples.shift();

    BP.lastScrollY = window.scrollY;
    BP.lastScrollTime = now;

    // Fast scroll detection
    const avgVel = BP.scrollSamples.reduce((a, b) => a + b, 0) / BP.scrollSamples.length;
    if (avgVel > 1200) {
      BP.fastScrollCount++;
      if (BP.fastScrollCount >= 3) {
        BP.fastScrollCount = 0;
        showPetMessage(rand(PET_MSGS.fast));
      }
    }

    // Doomscroll mode: check engagement
    if (BP.settings?.mode === 'doomscroll') {
      checkEngagement();
    }
  }

  // ── Engagement Tracking ─────────────────────────────────────
  function initEngagementTracking() {
    // Watch for like / comment interactions via mutation or click delegation
    document.addEventListener('click', (e) => {
      const target = e.target?.closest('[aria-label*="Like"], [aria-label*="Comment"], [aria-label*="Save"]');
      if (target) {
        BP.likeCount++;
        BP.engagementWarned = false;
      }
    }, { capture: true });
  }

  function checkEngagement() {
    const now = Date.now();
    const elapsed = (now - BP.lastEngagementCheck) / 1000;
    if (elapsed < 90) return; // check every 90 seconds

    BP.lastEngagementCheck = now;
    if (BP.likeCount < 1 && !BP.engagementWarned) {
      BP.engagementWarned = true;
      showPetMessage(rand(PET_MSGS.low_engage));
      // Trigger a prompt earlier if in doomscroll mode
      triggerPrompt();
    }
    BP.likeCount = 0;
  }

  // ── Brain Pet ───────────────────────────────────────────────
  function createPet() {
    if ($('#bp-pet')) return;

    const pet = document.createElement('div');
    pet.id = 'bp-pet';
    pet.innerHTML = `
      <div class="bp-pet-bubble" id="bp-pet-bubble"></div>
      <div class="bp-pet-body">
        <svg viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg" class="bp-brain-svg">
          <!-- Brain shape -->
          <g class="bp-brain-group">
            <!-- Left hemisphere -->
            <path d="M 45 72 C 20 72 8 58 8 42 C 8 26 20 14 35 14 C 38 14 41 15 43 16 C 41 12 38 8 38 8 C 52 6 58 18 55 26 C 60 22 68 24 70 32 C 76 30 84 36 82 46 C 80 56 72 62 62 64 C 60 68 54 72 45 72 Z" 
              fill="#c4b5fd" class="bp-brain-path"/>
            <!-- Right highlight -->
            <path d="M 45 72 C 30 70 20 62 18 52 C 16 42 22 34 30 30 C 28 38 32 46 40 50 C 38 56 40 64 45 72 Z"
              fill="#a78bfa" opacity="0.5"/>
            <!-- Folds -->
            <path d="M 35 28 Q 45 32 42 42" stroke="#7c3aed" stroke-width="1.5" fill="none" opacity="0.4" stroke-linecap="round"/>
            <path d="M 55 30 Q 58 40 52 48" stroke="#7c3aed" stroke-width="1.5" fill="none" opacity="0.4" stroke-linecap="round"/>
            <path d="M 25 45 Q 33 50 28 58" stroke="#7c3aed" stroke-width="1.5" fill="none" opacity="0.4" stroke-linecap="round"/>
          </g>
          <!-- Eyes -->
          <g class="bp-eyes">
            <circle cx="34" cy="46" r="5" fill="white"/>
            <circle cx="56" cy="46" r="5" fill="white"/>
            <circle cx="35" cy="47" r="3" fill="#1e1b4b" class="bp-pupil-l"/>
            <circle cx="57" cy="47" r="3" fill="#1e1b4b" class="bp-pupil-r"/>
            <circle cx="36" cy="46" r="1" fill="white"/>
            <circle cx="58" cy="46" r="1" fill="white"/>
          </g>
          <!-- Mouth -->
          <path d="M 37 58 Q 45 65 53 58" stroke="#7c3aed" stroke-width="2" fill="none" 
            stroke-linecap="round" class="bp-mouth"/>
          <!-- Cheeks -->
          <circle cx="28" cy="54" r="4" fill="#f472b6" opacity="0.3" class="bp-cheeks"/>
          <circle cx="62" cy="54" r="4" fill="#f472b6" opacity="0.3" class="bp-cheeks"/>
        </svg>
        <div class="bp-level-badge" id="bp-level-badge">Lv.${BP.petLevel}</div>
      </div>
    `;
    document.body.appendChild(pet);
    BP.petEl = pet;

    pet.addEventListener('click', () => {
      showPetMessage(rand(PET_MSGS.general));
    });

    // Random pet pop-in schedule
    schedulePetAppearance();
  }

  function showPetMessage(msg, duration = 3500) {
    const pet = $('#bp-pet');
    const bubble = $('#bp-pet-bubble');
    if (!pet || !bubble) return;

    bubble.textContent = msg;
    pet.classList.add('bp-pet-visible', 'bp-pet-talking');
    bubble.classList.add('bp-bubble-visible');

    clearTimeout(BP.petHideTimerId);
    BP.petHideTimerId = setTimeout(() => {
      bubble.classList.remove('bp-bubble-visible');
      // Keep pet visible a bit longer
      setTimeout(() => {
        if (!$('#bp-overlay')) pet.classList.remove('bp-pet-visible');
        pet.classList.remove('bp-pet-talking');
      }, 600);
    }, duration);
  }

  function schedulePetAppearance() {
    clearTimeout(BP.petTimerId);
    // Appear randomly every 45–120 seconds
    const delay = 45000 + Math.random() * 75000;
    BP.petTimerId = setTimeout(() => {
      if (!BP.active || BP.paused) { schedulePetAppearance(); return; }
      showPetMessage(rand(PET_MSGS.general));
      schedulePetAppearance();
    }, delay);
  }

  function updatePetLevel() {
    const badge = $('#bp-level-badge');
    if (badge) badge.textContent = `Lv.${BP.petLevel}`;
    const pet = $('#bp-pet');
    if (pet) {
      pet.classList.add('bp-level-glow');
      setTimeout(() => pet.classList.remove('bp-level-glow'), 2000);
    }
  }

  // ── Setup Overlay ───────────────────────────────────────────
  function showSetup() {
    if ($('#bp-setup')) return;

    const el = document.createElement('div');
    el.id = 'bp-setup';
    el.innerHTML = `
      <div class="bp-setup-card">
        <div class="bp-setup-pet">
          <svg viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg" style="width:64px;height:64px">
            <path d="M 45 72 C 20 72 8 58 8 42 C 8 26 20 14 35 14 C 38 14 41 15 43 16 C 41 12 38 8 38 8 C 52 6 58 18 55 26 C 60 22 68 24 70 32 C 76 30 84 36 82 46 C 80 56 72 62 62 64 C 60 68 54 72 45 72 Z" fill="#c4b5fd"/>
            <path d="M 45 72 C 30 70 20 62 18 52 C 16 42 22 34 30 30 C 28 38 32 46 40 50 C 38 56 40 64 45 72 Z" fill="#a78bfa" opacity="0.5"/>
            <circle cx="34" cy="46" r="5" fill="white"/>
            <circle cx="56" cy="46" r="5" fill="white"/>
            <circle cx="35" cy="47" r="3" fill="#1e1b4b"/>
            <circle cx="57" cy="47" r="3" fill="#1e1b4b"/>
            <path d="M 37 58 Q 45 65 53 58" stroke="#7c3aed" stroke-width="2" fill="none" stroke-linecap="round"/>
          </svg>
        </div>
        <h2 class="bp-setup-title">Hey! I'm your Brain Pet 🧠</h2>
        <p class="bp-setup-sub">I'll help you scroll more mindfully on Instagram. How would you like me to check in?</p>

        <div class="bp-mode-cards">
          <div class="bp-mode-card bp-mode-selected" data-mode="timer">
            <span class="bp-mode-icon">⏱️</span>
            <div>
              <div class="bp-mode-name">Set a Timer</div>
              <div class="bp-mode-desc">I'll prompt you every few minutes</div>
            </div>
          </div>
          <div class="bp-mode-card" data-mode="doomscroll">
            <span class="bp-mode-icon">🔍</span>
            <div>
              <div class="bp-mode-name">Detect Doomscrolling</div>
              <div class="bp-mode-desc">I'll step in when I notice you zoning out</div>
            </div>
          </div>
        </div>

        <div class="bp-interval-row" id="bp-interval-row">
          <label class="bp-label">First prompt after</label>
          <div class="bp-slider-row">
            <input type="range" id="bp-interval-slider" min="1" max="60" value="5" class="bp-slider">
            <span class="bp-slider-val" id="bp-slider-val">5 min</span>
          </div>
        </div>

        <div class="bp-session-limit-row">
          <label class="bp-label">Session limit</label>
          <div class="bp-slider-row">
            <input type="range" id="bp-session-slider" min="5" max="120" value="30" class="bp-slider">
            <span class="bp-slider-val" id="bp-session-val">30 min</span>
          </div>
        </div>

        <button class="bp-cta" id="bp-start-btn">
          <span>Let's go</span>
          <span class="bp-cta-arrow">→</span>
        </button>
      </div>
    `;
    document.body.appendChild(el);
    BP.setupEl = el;

    // Mode selection
    let selectedMode = 'timer';
    $$('.bp-mode-card').forEach(card => {
      card.addEventListener('click', () => {
        $$('.bp-mode-card').forEach(c => c.classList.remove('bp-mode-selected'));
        card.classList.add('bp-mode-selected');
        selectedMode = card.dataset.mode;
        $('#bp-interval-row').style.display = selectedMode === 'timer' ? 'block' : 'block';
      });
    });

    // Sliders
    $('#bp-interval-slider').addEventListener('input', (e) => {
      $('#bp-slider-val').textContent = e.target.value + ' min';
    });
    $('#bp-session-slider').addEventListener('input', (e) => {
      $('#bp-session-val').textContent = e.target.value + ' min';
    });

    // Start
    $('#bp-start-btn').addEventListener('click', () => {
      const intervalMin = parseInt($('#bp-interval-slider').value);
      const sessionMin = parseInt($('#bp-session-slider').value);
      const settings = { mode: selectedMode, intervalMin, sessionMin };
      startSession(settings);

      el.classList.add('bp-fade-out');
      setTimeout(() => el.remove(), 500);
    });

    // Animate in
    requestAnimationFrame(() => el.classList.add('bp-setup-visible'));
  }

  // ── Session Management ──────────────────────────────────────
  function startSession(settings) {
    BP.active = true;
    BP.paused = false;
    BP.settings = settings;
    BP.intervalMs = settings.intervalMin * 60000;
    BP.sessionStart = Date.now();
    BP.promptCount = 0;
    BP.xp = 0;
    BP.level = 1;
    BP.saturation = 1.0;
    BP.brightness = 1.0;

    // Persist
    chrome.storage.local.set({
      brainpause_active: true,
      brainpause_settings: settings,
      brainpause_stats: { prompts: 0, level: 1, levelProgress: 0, startTime: Date.now() }
    });

    // Initialize features
    initFeedFilter();
    initScrollTracking();
    initEngagementTracking();
    createPet();

    // Gradual desaturation every 30 seconds
    BP.grayscaleTimer = setInterval(stepDesaturation, 30000);

    // Schedule first prompt
    scheduleNextPrompt();

    // Session limit
    chrome.runtime.sendMessage({
      type: 'SET_SESSION_END',
      delayMinutes: settings.sessionMin
    });

    showPetMessage('Session started! I\'ll keep an eye on you 👀', 3000);
  }

  function scheduleNextPrompt() {
    clearTimeout(BP.promptTimerId);
    clearInterval(BP.countdownTimer);

    BP.countdownVal = Math.floor(BP.intervalMs / 1000);

    BP.countdownTimer = setInterval(() => {
      if (!BP.paused) BP.countdownVal = Math.max(0, BP.countdownVal - 1);
    }, 1000);

    BP.promptTimerId = setTimeout(() => {
      if (BP.active && !BP.paused) triggerPrompt();
    }, BP.intervalMs);
  }

  function triggerPrompt() {
    if (!BP.active || BP.paused) return;
    const prompt = pickPrompt();
    showPromptOverlay(prompt);

    // Halve the interval
    BP.intervalMs = Math.max(BP.minIntervalMs, Math.floor(BP.intervalMs / 2));
  }

  function pickPrompt(excludeId = null) {
    const available = PROMPTS.filter(p => p.id !== excludeId && !BP.usedPromptIds.has(p.id));
    if (available.length === 0) {
      BP.usedPromptIds.clear();
      return PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  // ── Prompt Overlay ──────────────────────────────────────────
  function showPromptOverlay(prompt) {
    // Remove existing overlay
    $('#bp-overlay')?.remove();
    BP.activePromptId = prompt.id;

    const overlay = document.createElement('div');
    overlay.id = 'bp-overlay';

    overlay.innerHTML = `
      <div class="bp-overlay-backdrop"></div>
      <div class="bp-overlay-card">
        <!-- Pet in overlay -->
        <div class="bp-overlay-pet">
          <svg viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg" class="bp-overlay-brain">
            <path d="M 45 72 C 20 72 8 58 8 42 C 8 26 20 14 35 14 C 38 14 41 15 43 16 C 41 12 38 8 38 8 C 52 6 58 18 55 26 C 60 22 68 24 70 32 C 76 30 84 36 82 46 C 80 56 72 62 62 64 C 60 68 54 72 45 72 Z" fill="#c4b5fd"/>
            <path d="M 45 72 C 30 70 20 62 18 52 C 16 42 22 34 30 30 C 28 38 32 46 40 50 C 38 56 40 64 45 72 Z" fill="#a78bfa" opacity="0.5"/>
            <path d="M 35 28 Q 45 32 42 42" stroke="#7c3aed" stroke-width="1.5" fill="none" opacity="0.4" stroke-linecap="round"/>
            <path d="M 55 30 Q 58 40 52 48" stroke="#7c3aed" stroke-width="1.5" fill="none" opacity="0.4" stroke-linecap="round"/>
            <circle cx="34" cy="46" r="5" fill="white"/>
            <circle cx="56" cy="46" r="5" fill="white"/>
            <circle cx="35" cy="47" r="3" fill="#1e1b4b"/>
            <circle cx="57" cy="47" r="3" fill="#1e1b4b"/>
            <circle cx="36" cy="46" r="1" fill="white"/>
            <circle cx="58" cy="46" r="1" fill="white"/>
            <path d="M 37 58 Q 45 65 53 58" stroke="#7c3aed" stroke-width="2" fill="none" stroke-linecap="round"/>
            <circle cx="28" cy="54" r="4" fill="#f472b6" opacity="0.3"/>
            <circle cx="62" cy="54" r="4" fill="#f472b6" opacity="0.3"/>
          </svg>
          <div class="bp-overlay-speech">Hey… it's been a while 👋</div>
        </div>

        <div class="bp-prompt-header">
          <span class="bp-prompt-emoji">${prompt.emoji}</span>
          <h3 class="bp-prompt-title">${prompt.title}</h3>
        </div>

        <div class="bp-prompt-body" id="bp-prompt-body">
          ${renderPromptBody(prompt)}
        </div>

        <div class="bp-prompt-actions">
          <button class="bp-btn-skip" id="bp-btn-skip">Try a different one ↻</button>
          <button class="bp-btn-done" id="bp-btn-done">Done ✓</button>
        </div>

        <div class="bp-validation-msg" id="bp-validation-msg"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    BP.overlayEl = overlay;

    // Show pet in corner too
    $('#bp-pet')?.classList.add('bp-pet-visible');

    // Wire up buttons
    $('#bp-btn-done').addEventListener('click', () => completePrompt(prompt));
    $('#bp-btn-skip').addEventListener('click', () => skipPrompt(prompt));

    // Start any timers in the prompt
    if (prompt.type === 'countdown') startCountdownPrompt(prompt);
    if (prompt.type === 'breathing') startBreathingAnimation();

    // Animate in
    requestAnimationFrame(() => overlay.classList.add('bp-overlay-visible'));
  }

  function renderPromptBody(prompt) {
    switch (prompt.type) {
      case 'breathing':
        return `
          <p class="bp-prompt-desc">${prompt.desc}</p>
          <div class="bp-breathing-container">
            <div class="bp-breath-ring" id="bp-breath-ring">
              <div class="bp-breath-inner">
                <span class="bp-breath-label" id="bp-breath-label">Breathe in</span>
              </div>
            </div>
          </div>
        `;

      case 'write':
      case 'six_words':
        return `
          <p class="bp-prompt-desc">${prompt.prompt}</p>
          <textarea class="bp-textarea" id="bp-text-input" 
            placeholder="${prompt.placeholder || 'Type here…'}" 
            rows="3" ${prompt.type === 'six_words' ? 'maxlength="60"' : ''}></textarea>
          ${prompt.type === 'six_words' ? '<div class="bp-word-count" id="bp-word-count">0 / 6 words</div>' : ''}
        `;

      case 'physical':
        return `
          <div class="bp-physical-main">
            <div class="bp-physical-icon">${prompt.primaryIcon}</div>
            <p class="bp-prompt-desc">${prompt.primary}</p>
            <div class="bp-physical-count" id="bp-phys-count">0 / 5</div>
            <div class="bp-count-btns">
              <button class="bp-count-btn" id="bp-count-inc">+1 Done!</button>
            </div>
          </div>
          <div class="bp-physical-alt">
            <button class="bp-alt-toggle" id="bp-alt-toggle">Can't do that right now?</button>
            <p class="bp-alt-text" id="bp-alt-text" style="display:none">${prompt.altIcon} ${prompt.alt}</p>
          </div>
        `;

      case 'countdown':
        return `
          <p class="bp-prompt-desc">${prompt.prompt}</p>
          <div class="bp-countdown-container">
            <div class="bp-countdown-ring">
              <svg class="bp-countdown-svg" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="#2a2a36" stroke-width="5"/>
                <circle cx="40" cy="40" r="34" fill="none" stroke="#a78bfa" stroke-width="5"
                  stroke-dasharray="213.6" stroke-dashoffset="0" id="bp-countdown-circle"
                  stroke-linecap="round" transform="rotate(-90 40 40)"/>
              </svg>
              <div class="bp-countdown-val" id="bp-countdown-val">${prompt.duration}</div>
            </div>
          </div>
        `;

      case 'senses':
        return `
          <p class="bp-prompt-desc">${prompt.prompt}</p>
          <div class="bp-senses-grid">
            ${prompt.senses.map(s => `
              <div class="bp-sense-row">
                <span class="bp-sense-icon">${s.icon}</span>
                <span class="bp-sense-label">${s.label}</span>
                <input class="bp-sense-input" placeholder="I can ${s.label.toLowerCase()}…" type="text">
              </div>
            `).join('')}
          </div>
        `;

      case 'acknowledge':
        return `
          <p class="bp-prompt-desc">${prompt.prompt}</p>
          <p class="bp-prompt-sub">${prompt.sub || ''}</p>
          <div style="font-size:48px;text-align:center;margin:16px 0">💧</div>
        `;
    }
    return `<p class="bp-prompt-desc">${prompt.prompt || prompt.desc}</p>`;
  }

  function startBreathingAnimation() {
    const ring = $('#bp-breath-ring');
    const label = $('#bp-breath-label');
    if (!ring || !label) return;

    let phase = 'in';
    let cycleCount = 0;
    const cycle = () => {
      if (!$('#bp-overlay')) return; // overlay closed
      if (phase === 'in') {
        ring.classList.remove('bp-breathe-out');
        ring.classList.add('bp-breathe-in');
        label.textContent = 'Breathe in…';
        phase = 'hold';
        setTimeout(cycle, 4000);
      } else if (phase === 'hold') {
        label.textContent = 'Hold…';
        phase = 'out';
        setTimeout(cycle, 2000);
      } else {
        ring.classList.remove('bp-breathe-in');
        ring.classList.add('bp-breathe-out');
        label.textContent = 'Breathe out…';
        cycleCount++;
        phase = 'in';
        setTimeout(cycle, 4000);
      }
    };
    cycle();
  }

  function startCountdownPrompt(prompt) {
    let remaining = prompt.duration;
    const circle = $('#bp-countdown-circle');
    const val = $('#bp-countdown-val');
    const total = 213.6;

    const tick = setInterval(() => {
      if (!$('#bp-overlay')) { clearInterval(tick); return; }
      remaining--;
      if (val) val.textContent = remaining;
      if (circle) {
        const offset = total * (1 - remaining / prompt.duration);
        circle.style.strokeDashoffset = offset;
      }
      if (remaining <= 0) {
        clearInterval(tick);
        if (val) val.textContent = '✓';
        $('#bp-btn-done')?.classList.add('bp-btn-ready');
      }
    }, 1000);

    // Wire up physical counter if needed
    const countBtn = $('#bp-count-inc');
    if (countBtn) {
      let count = 0;
      countBtn.addEventListener('click', () => {
        count++;
        const el = $('#bp-phys-count');
        if (el) el.textContent = `${count} / 5`;
        if (count >= 5) {
          countBtn.textContent = 'Done! 🎉';
          countBtn.disabled = true;
          $('#bp-btn-done')?.classList.add('bp-btn-ready');
        }
      });
    }
  }

  // Wire up physical counter outside of countdown
  document.addEventListener('click', (e) => {
    if (e.target.id === 'bp-count-inc') {
      let count = parseInt($('#bp-phys-count')?.textContent) || 0;
      count++;
      const el = $('#bp-phys-count');
      if (el) el.textContent = `${count} / 5`;
      if (count >= 5) {
        e.target.textContent = 'Done! 🎉';
        e.target.disabled = true;
        $('#bp-btn-done')?.classList.add('bp-btn-ready');
      }
    }
    if (e.target.id === 'bp-alt-toggle') {
      const altText = $('#bp-alt-text');
      if (altText) {
        const visible = altText.style.display !== 'none';
        altText.style.display = visible ? 'none' : 'block';
        e.target.textContent = visible ? 'Can\'t do that right now?' : 'Show original ↑';
      }
    }
  });

  // Six-word counter
  document.addEventListener('input', (e) => {
    if (e.target.id === 'bp-text-input') {
      const wordCountEl = $('#bp-word-count');
      if (wordCountEl) {
        const words = e.target.value.trim().split(/\s+/).filter(Boolean).length;
        wordCountEl.textContent = `${words} / 6 words`;
        wordCountEl.style.color = words === 6 ? '#34d399' : (words > 6 ? '#f87171' : '#8b8a99');
      }
    }
  });

  async function completePrompt(prompt) {
    BP.promptCount++;
    BP.usedPromptIds.add(prompt.id);

    // Get user response for AI validation
    const textInput = $('#bp-text-input');
    const userResponse = textInput ? textInput.value : '';

    const validationMsg = $('#bp-validation-msg');

    if (userResponse.trim().length > 0) {
      validationMsg && (validationMsg.textContent = 'Thinking… 🧠');
      try {
        const result = await validatePromptResponse(userResponse, prompt.id);
        if (result && validationMsg) {
          validationMsg.textContent = result.message;
          if (result.level_up) {
            BP.xp += result.score || 5;
            checkLevelUp();
          }
        }
      } catch (e) {
        // Offline — give generic encouragement
        if (validationMsg) validationMsg.textContent = getLocalEncouragement();
        addXP(3);
      }
    } else {
      addXP(2);
      if (validationMsg) validationMsg.textContent = getLocalEncouragement();
    }

    // Save stats
    updateStats();

    // Wait a moment then close
    setTimeout(() => dismissOverlay(), 2000);
  }

  function skipPrompt(currentPrompt) {
    // Skip to a different prompt, NOT dismiss
    const next = pickPrompt(currentPrompt.id);
    $('#bp-overlay')?.remove();
    showPromptOverlay(next);
  }

  function dismissOverlay() {
    const overlay = $('#bp-overlay');
    if (overlay) {
      overlay.classList.add('bp-overlay-hiding');
      setTimeout(() => overlay.remove(), 400);
    }
    $('#bp-pet')?.classList.remove('bp-pet-visible');
    scheduleNextPrompt();
  }

  // ── XP & Leveling ───────────────────────────────────────────
  function addXP(amount) {
    BP.xp += amount;
    checkLevelUp();
  }

  function checkLevelUp() {
    const threshold = BP.level * 20;
    if (BP.xp >= threshold) {
      BP.level++;
      BP.petLevel = BP.level;
      updatePetLevel();
      showPetMessage(rand(PET_MSGS.level_up), 4000);
    }
    updateStats();
  }

  function updateStats() {
    const threshold = BP.level * 20;
    const progress = Math.min(100, (BP.xp / threshold) * 100);
    chrome.storage.local.set({
      brainpause_stats: {
        prompts: BP.promptCount,
        level: BP.level,
        levelProgress: progress,
        startTime: BP.sessionStart
      }
    });
  }

  // ── AI Validation (Backend) ─────────────────────────────────
  async function validatePromptResponse(response, promptId) {
    try {
      const res = await fetch(`${API}/validate-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response, prompt_type: promptId }),
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) throw new Error('Backend unavailable');
      return await res.json();
    } catch {
      return { score: 5, message: getLocalEncouragement(), level_up: false };
    }
  }

  // ── Local Encouragement Fallback ─────────────────────────────
  const LOCAL_ENCOURAGEMENT = [
    'Love that reflection! 💜', 'Keep that energy! ✨', 'So thoughtful 🧠',
    'That\'s really lovely 🌟', 'You\'re doing great! 🎉', 'Nice one! 💪',
    'That\'s worth remembering 💡', 'Real good answer! ⭐'
  ];
  function getLocalEncouragement() { return rand(LOCAL_ENCOURAGEMENT); }

  // ── Messaging from Background/Popup ─────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ALARM_TRIGGER') {
      if (BP.active && !BP.paused) triggerPrompt();
      sendResponse({ ok: true });
    }
    if (message.type === 'SESSION_END') {
      endSession();
      sendResponse({ ok: true });
    }
    if (message.type === 'TOGGLE_PAUSE') {
      BP.paused = !BP.paused;
      if (!BP.paused) scheduleNextPrompt();
      sendResponse({ paused: BP.paused });
    }
    if (message.type === 'END_SESSION') {
      endSession();
      sendResponse({ ok: true });
    }
    if (message.type === 'GET_NEXT_PROMPT_TIME') {
      sendResponse({ seconds: BP.countdownVal });
    }
    return true;
  });

  function endSession() {
    BP.active = false;
    clearTimeout(BP.promptTimerId);
    clearInterval(BP.countdownTimer);
    clearTimeout(BP.petTimerId);
    clearInterval(BP.grayscaleTimer);

    // Restore colors
    const style = $('#bp-filter-style');
    if (style) style.textContent = 'body { filter: saturate(1) brightness(1) !important; transition: filter 2s ease !important; }';

    // Final message
    $('#bp-overlay')?.remove();
    showSessionEndCard();
    chrome.storage.local.set({ brainpause_active: false });
  }

  function showSessionEndCard() {
    const pet = $('#bp-pet');
    if (!pet) return;
    showPetMessage(`Session over! Great work 🌟 Lv.${BP.level}`, 6000);
  }

  // ── Boot ─────────────────────────────────────────────────────
  async function boot() {
    const data = await chrome.storage.local.get(['brainpause_active', 'brainpause_settings']);

    if (data.brainpause_active && data.brainpause_settings) {
      startSession(data.brainpause_settings);
    } else {
      // Show setup after a short delay to let Instagram load
      setTimeout(showSetup, 1800);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
