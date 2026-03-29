// BrainPause — Popup Script

async function getActiveIgTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  return tabs.find(t => t.active) || tabs[0] || null;
}

async function sendToContent(message) {
  const tab = await getActiveIgTab();
  if (!tab) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch { return null; }
}

async function init() {
  const data = await chrome.storage.local.get(['brainpause_active', 'brainpause_settings', 'brainpause_stats']);
  const active = data.brainpause_active;
  const stats = data.brainpause_stats || { prompts: 0, level: 1, levelProgress: 20, startTime: null };

  const pill = document.getElementById('status-pill');
  const pillText = document.getElementById('status-text');
  const sessionView = document.getElementById('session-view');
  const noSessionView = document.getElementById('no-session-view');

  if (active) {
    pill.className = 'status-pill active';
    pillText.textContent = 'Live';
    sessionView.style.display = 'block';
    noSessionView.style.display = 'none';

    // Fill stats
    document.getElementById('stat-prompts').textContent = stats.prompts;
    document.getElementById('stat-level').textContent = stats.level;
    document.getElementById('level-progress').style.width = stats.levelProgress + '%';

    if (stats.startTime) {
      const elapsed = Math.floor((Date.now() - stats.startTime) / 60000);
      document.getElementById('stat-time').textContent = elapsed + 'm';
    }

    // Get next prompt time from content
    const res = await sendToContent({ type: 'GET_NEXT_PROMPT_TIME' });
    if (res && res.seconds > 0) {
      const s = res.seconds;
      document.getElementById('next-prompt-time').textContent =
        s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's';
    }
  } else {
    pill.className = 'status-pill inactive';
    pillText.textContent = 'Off';
    sessionView.style.display = 'none';
    noSessionView.style.display = 'block';
  }

  // Controls
  document.getElementById('btn-open-ig')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.instagram.com' });
    window.close();
  });

  document.getElementById('btn-pause')?.addEventListener('click', async () => {
    const res = await sendToContent({ type: 'TOGGLE_PAUSE' });
    const btn = document.getElementById('btn-pause');
    if (res?.paused) {
      btn.textContent = 'Resume Session';
      btn.style.color = 'var(--accent2)';
    } else {
      btn.textContent = 'Pause Session';
      btn.style.color = '';
    }
  });

  document.getElementById('btn-stop')?.addEventListener('click', async () => {
    await sendToContent({ type: 'END_SESSION' });
    await chrome.storage.local.set({ brainpause_active: false });
    chrome.runtime.sendMessage({ type: 'CLEAR_ALARMS' });
    showMsg('Session ended. Great work! 🧠');
    setTimeout(() => init(), 800);
  });
}

function showMsg(text) {
  const el = document.getElementById('msg');
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; }, 3000);
}

init();
