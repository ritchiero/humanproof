// HumanProof Background Service Worker

// ── Config ───────────────────────────────────────────────────────
const API_URL_KEY = 'hp_api_url';
const DEFAULT_API = 'http://localhost:3000';

// Auto-analysis thresholds
const STAGE_CLASSIFY_EVERY = 5;    // Classify stages every N new logs
const PROJECT_DETECT_EVERY = 10;   // Detect projects every N new logs
let unclassifiedCount = 0;

async function getApiUrl() {
  const result = await chrome.storage.local.get([API_URL_KEY]);
  return result[API_URL_KEY] || DEFAULT_API;
}

// ── Side Panel ───────────────────────────────────────────────────

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (chrome.sidePanel.toggleOpen) {
      await chrome.sidePanel.toggleOpen({ windowId: tab.windowId });
    } else if (chrome.sidePanel.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } else {
      await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
    }
  } catch (err) {
    console.warn('[HumanProof] Side panel open failed:', err.message);
  }
});

// ── Screenshot ───────────────────────────────────────────────────

async function captureScreenshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.windowId) return null;
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 40 });
  } catch (err) {
    console.warn('[HumanProof] Screenshot failed:', err.message);
    return null;
  }
}

// ── Auto AI Analysis ─────────────────────────────────────────────

// Runs Haiku to classify creative stages for unclassified logs
async function autoClassifyStages() {
  try {
    const result = await chrome.storage.local.get(['logs', 'hp_stages']);
    const logs = result.logs || [];
    const existingStages = result.hp_stages || {};

    // Find logs without a stage classification
    const unclassified = logs.filter((l) => !existingStages[l.id]);
    if (unclassified.length < 3) return; // Wait for enough logs

    console.log(`[HumanProof] Auto-classifying ${unclassified.length} logs with Haiku...`);

    const apiUrl = await getApiUrl();
    const resp = await fetch(`${apiUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: unclassified, action: 'classify_stages' }),
    });

    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();

    if (data.stages) {
      const updated = { ...existingStages };
      for (const s of data.stages) {
        updated[s.id] = s.stage;
      }
      await chrome.storage.local.set({ hp_stages: updated });

      // Notify side panel
      chrome.runtime.sendMessage({ type: 'STAGES_UPDATED', stages: updated }).catch(() => {});
      // Sync to dashboard
      fetch(`${apiUrl}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'stages', stages: updated }),
      }).catch(() => {});
      console.log(`[HumanProof] Classified ${data.stages.length} stages.`);
    }
  } catch (err) {
    console.warn('[HumanProof] Auto-classify failed:', err.message);
  }
}

// Runs Sonnet to detect/update projects
async function autoDetectProjects() {
  try {
    const result = await chrome.storage.local.get(['logs']);
    const logs = result.logs || [];
    if (logs.length < 4) return; // Need enough data

    console.log(`[HumanProof] Auto-detecting projects with Sonnet...`);

    const apiUrl = await getApiUrl();
    const resp = await fetch(`${apiUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs, action: 'detect_projects' }),
    });

    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();

    if (data.projects && data.projects.length > 0) {
      await chrome.storage.local.set({ hp_projects: data.projects });
      // Notify side panel
      chrome.runtime.sendMessage({ type: 'PROJECTS_UPDATED', projects: data.projects }).catch(() => {});
      // Sync to dashboard
      fetch(`${apiUrl}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'projects', projects: data.projects }),
      }).catch(() => {});
      console.log(`[HumanProof] Detected ${data.projects.length} projects.`);
    }
  } catch (err) {
    console.warn('[HumanProof] Auto-detect projects failed:', err.message);
  }
}

// ── Message Listener ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle capture toggle
  if (message.type === 'SET_CAPTURE_ENABLED') {
    chrome.storage.local.set({ hp_capture_enabled: message.enabled });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'CAPTURE_LOG') {
    const tabId = sender.tab?.id;

    // Check if capture is enabled
    (async () => {
      const result = await chrome.storage.local.get(['hp_capture_enabled', 'hp_platforms']);
      if (result.hp_capture_enabled === false) return; // global capture off
      const platforms = result.hp_platforms || {};
      if (platforms[message.data?.platform] === false) return; // platform disabled
      let screenshot = null;
      if (tabId) {
        screenshot = await captureScreenshot(tabId);
      }

      const logId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const logEntry = {
        ...message.data,
        id: logId,
        timestamp: new Date().toISOString(),
        hasScreenshot: !!screenshot,
      };

      if (screenshot) {
        await chrome.storage.local.set({ [`screenshot_${logId}`]: screenshot });
      }

      const result = await chrome.storage.local.get(['logs']);
      const logs = result.logs || [];
      logs.push(logEntry);
      await chrome.storage.local.set({ logs });

      // Forward to side panel
      chrome.runtime.sendMessage({
        type: 'NEW_LOG',
        data: logEntry,
        tabId,
      }).catch(() => {});

      // ── Sync to dashboard API ──
      const apiUrl = await getApiUrl();
      fetch(`${apiUrl}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'log',
          data: {
            ...logEntry,
            screenshotUrl: screenshot || undefined, // Include screenshot for dashboard
          },
        }),
      }).catch(() => {}); // Fire and forget

      // ── Trigger auto-analysis ──
      unclassifiedCount++;

      if (unclassifiedCount >= STAGE_CLASSIFY_EVERY) {
        unclassifiedCount = 0;
        // Fire and forget — don't block log capture
        autoClassifyStages();
      }

      if (logs.length % PROJECT_DETECT_EVERY === 0) {
        // Re-detect projects every N total logs
        autoDetectProjects();
      }
    })();

    return true;
  }

  if (message.type === 'GET_LOGS') {
    chrome.storage.local.get(['logs'], (result) => {
      sendResponse({ logs: result.logs || [] });
    });
    return true;
  }

  if (message.type === 'GET_SCREENSHOT') {
    const key = `screenshot_${message.logId}`;
    chrome.storage.local.get([key], (result) => {
      sendResponse({ screenshot: result[key] || null });
    });
    return true;
  }

  if (message.type === 'GET_STAGES') {
    chrome.storage.local.get(['hp_stages'], (result) => {
      sendResponse({ stages: result.hp_stages || {} });
    });
    return true;
  }

  if (message.type === 'GET_PROJECTS') {
    chrome.storage.local.get(['hp_projects'], (result) => {
      sendResponse({ projects: result.hp_projects || [] });
    });
    return true;
  }

  if (message.type === 'CLEAR_LOGS') {
    chrome.storage.local.get(null, (allData) => {
      const keysToRemove = Object.keys(allData).filter(
        (k) => k === 'logs' || k.startsWith('screenshot_') || k === 'hp_stages' || k === 'hp_projects'
      );
      chrome.storage.local.remove(keysToRemove);
    });
    unclassifiedCount = 0;
    sendResponse({ success: true });
  }

  if (message.type === 'DETECT_PLATFORM') {
    const url = sender.tab?.url || '';
    let platform = null;

    if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) platform = 'chatgpt';
    else if (url.includes('claude.ai')) platform = 'claude';
    else if (url.includes('discord.com')) platform = 'midjourney';
    else if (url.includes('gemini.google.com')) platform = 'gemini';
    else if (url.includes('grok.com') || url.includes('x.com/i/grok')) platform = 'grok';
    else if (url.includes('figma.com')) platform = 'figma';

    sendResponse({ platform });
  }

  if (message.type === 'SET_PLATFORMS') {
    chrome.storage.local.set({ hp_platforms: message.platforms });
    sendResponse({ ok: true });
  }

  // Manual triggers from side panel (if user wants to force)
  if (message.type === 'FORCE_CLASSIFY') {
    autoClassifyStages();
    sendResponse({ ok: true });
  }
  if (message.type === 'FORCE_DETECT_PROJECTS') {
    autoDetectProjects();
    sendResponse({ ok: true });
  }
});
