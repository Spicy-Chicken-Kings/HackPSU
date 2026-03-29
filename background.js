// BrainPause — Background Service Worker
// Handles alarms, persistent state, and messaging

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ brainpause_active: false, brainpause_settings: null });
});

// Forward alarm events to the active Instagram tab
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'brainpause_prompt') {
    const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*', active: true });
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'ALARM_TRIGGER' }).catch(() => {});
    });
  }
  if (alarm.name === 'brainpause_session_end') {
    const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'SESSION_END' }).catch(() => {});
    });
    chrome.storage.local.set({ brainpause_active: false });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SET_ALARM') {
    chrome.alarms.clear('brainpause_prompt', () => {
      chrome.alarms.create('brainpause_prompt', { delayInMinutes: message.delayMinutes });
    });
    sendResponse({ ok: true });
  }
  if (message.type === 'SET_SESSION_END') {
    chrome.alarms.create('brainpause_session_end', { delayInMinutes: message.delayMinutes });
    sendResponse({ ok: true });
  }
  if (message.type === 'CLEAR_ALARMS') {
    chrome.alarms.clearAll();
    sendResponse({ ok: true });
  }
  return true;
});
