// HumanProof Background Service Worker

// ── Config ───────────────────────────────────────────────────────
const API_URL_KEY = 'hp_api_url';
const DEFAULT_API = 'https://humanproof-3zwqrvoxt-ritchieros-projects.vercel.app';
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// Auto-analysis thresholds
const STAGE_CLASSIFY_EVERY = 5;    // Classify stages every N new logs
const PROJECT_DETECT_EVERY = 10;   // Detect projects every N new logs
let unclassifiedCount = 0;

// ── Serialization lock for chain writes ─────────────────────────
// Prevents race conditions when multiple captures arrive simultaneously
let chainLock = Promise.resolve();
function withChainLock(fn) {
  chainLock = chainLock.then(fn, fn); // run fn after previous completes (even on error)
  return chainLock;
}

async function getApiUrl() {
  const result = await chrome.storage.local.get([API_URL_KEY]);
  return result[API_URL_KEY] || DEFAULT_API;
}

// ── Hash Chain (Custody Chain) ──────────────────────────────────
// Each log entry gets a SHA-256 hash that includes the previous hash,
// creating a tamper-evident chain like a mini-blockchain.

async function sha256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Build the canonical payload string for hashing
// This is the "evidence record" — what gets sealed in the chain
function buildHashPayload(entry, previousHash) {
  const record = {
    // Chain link
    previousHash: previousHash,
    // Temporal proof
    timestamp: entry.timestamp,
    sequence: entry.chainIndex,
    // Content fingerprint
    contentHash: entry.contentHash,    // hash of actual content (stored separately)
    type: entry.type,                  // prompt | response | selection | manual_entry
    // Tool & context
    platform: entry.platform,
    model: entry.model || null,
    conversationUrl: entry.conversationUrl || null,
    conversationId: entry.conversationId || null,
    // Evidence metadata
    hasScreenshot: entry.hasScreenshot || false,
    userAgent: entry.userAgent || null,
  };
  // Deterministic JSON serialization (sorted keys)
  return JSON.stringify(record, Object.keys(record).sort());
}

async function computeChainHash(entry, previousHash) {
  // First, hash the actual content separately (privacy: content can be revealed selectively)
  const contentHash = await sha256(entry.content || '');
  entry.contentHash = contentHash;

  // Build the payload and hash it
  const payload = buildHashPayload(entry, previousHash);
  const hash = await sha256(payload);
  return hash;
}

async function getLastChainHash() {
  const result = await chrome.storage.local.get(['hp_chain']);
  const chain = result.hp_chain || [];
  if (chain.length === 0) return GENESIS_HASH;
  return chain[chain.length - 1].hash;
}

async function appendToChain(chainEntry) {
  const result = await chrome.storage.local.get(['hp_chain']);
  const chain = result.hp_chain || [];
  chain.push(chainEntry);
  await chrome.storage.local.set({ hp_chain: chain });
  return chain.length;
}

// Verify the entire chain — returns { valid, brokenAt, length }
async function verifyChain() {
  const result = await chrome.storage.local.get(['hp_chain', 'logs']);
  const chain = result.hp_chain || [];
  const logs = result.logs || [];

  if (chain.length === 0) return { valid: true, length: 0 };

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const expectedPrev = i === 0 ? GENESIS_HASH : chain[i - 1].hash;

    // Check previousHash link
    if (entry.previousHash !== expectedPrev) {
      return { valid: false, brokenAt: i, reason: 'previousHash mismatch', length: chain.length };
    }

    // Find the corresponding log to recompute hash
    const log = logs.find(l => l.id === entry.logId);
    if (!log) {
      return { valid: false, brokenAt: i, reason: 'missing log entry', length: chain.length };
    }

    // Recompute content hash
    const contentHash = await sha256(log.content || '');
    if (contentHash !== entry.contentHash) {
      return { valid: false, brokenAt: i, reason: 'content tampered', length: chain.length };
    }

    // Recompute chain hash
    const recomputeEntry = { ...log, contentHash, chainIndex: entry.chainIndex };
    const payload = buildHashPayload(recomputeEntry, expectedPrev);
    const recomputedHash = await sha256(payload);

    if (recomputedHash !== entry.hash) {
      return { valid: false, brokenAt: i, reason: 'hash mismatch', length: chain.length };
    }
  }

  return { valid: true, length: chain.length };
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

// ── Local Creative Stage Classifier ─────────────────────────────
// Classifies each interaction into a creative stage instantly (no API call)
// Based on USCO copyright framework: demonstrates human creative control

const STAGE_RULES = [
  {
    stage: 'selection',
    // Explicit selection patterns — check first (highest priority)
    patterns: [
      /\bselect(ed|ing)?\b/i, /\bchoo?se\b/i, /\bprefer\b/i, /\bpick(ed)?\b/i,
      /\bthis (one|version|option)\b/i, /\boption [a-d1-4]\b/i,
      /\bimage \d.*(better|prefer)/i, /\bI('ll| will)? go with\b/i,
      /\blet'?s? use\b/i, /\bthumbs (up|down)\b/i,
      /\belijamos\b/i, /\bprefiero\b/i, /\bescojo\b/i, /\bme quedo con\b/i,
    ],
    typeMatch: ['prompt', 'selection'],
  },
  {
    stage: 'final_review',
    patterns: [
      /\blooks? (good|great|perfect|amazing)\b/i, /\bapproved?\b/i,
      /\bthat'?s? (perfect|it|great|exactly)\b/i, /\bship it\b/i,
      /\blet'?s? go with (this|that)\b/i, /\bfinal(ize|ized)?\b/i,
      /\bdone\b/i, /\blisto\b/i, /\bperfecto\b/i, /\baprobado\b/i,
      /\basí está bien\b/i, /\bme gusta\b/i,
    ],
    typeMatch: ['prompt'],
  },
  {
    stage: 'combination',
    patterns: [
      /\bcombine?\b/i, /\bmerge\b/i, /\bmix\b/i, /\bblend\b/i,
      /\btake .* from .* and/i, /\bput together\b/i,
      /\bjunta\b/i, /\bcombina\b/i, /\bmezcla\b/i, /\bune\b/i,
    ],
    typeMatch: ['prompt'],
  },
  {
    stage: 'revision',
    patterns: [
      /\brewrite\b/i, /\bredo\b/i, /\bstart over\b/i, /\btry again\b/i,
      /\bfrom scratch\b/i, /\bcompletely different\b/i, /\bnew approach\b/i,
      /\brehacer\b/i, /\bde nuevo\b/i, /\bdesde cero\b/i, /\botra vez\b/i,
    ],
    typeMatch: ['prompt'],
  },
  {
    stage: 'refinement',
    patterns: [
      /\bfix\b/i, /\badjust\b/i, /\btweak\b/i, /\bmodif(y|ied|ication)\b/i,
      /\bchange (the|this|that)\b/i, /\bupdate\b/i, /\bimprove\b/i,
      /\bslightly\b/i, /\ba (bit|little) more\b/i, /\bless\b/i,
      /\bcorrige\b/i, /\bajusta\b/i, /\bcambia\b/i, /\bmejora\b/i,
      /\bmodifica\b/i, /\bun poco más\b/i,
    ],
    typeMatch: ['prompt'],
  },
  {
    stage: 'direction',
    patterns: [
      /\bmake (it|this|that) (more|less)\b/i, /\bstyle\b/i, /\btone\b/i,
      /\buse .* instead\b/i, /\blike .* but\b/i, /\bin the style of\b/i,
      /\bmore (like|similar)\b/i, /\bformat\b/i, /\bstructure\b/i,
      /\bque sea más\b/i, /\bestilo\b/i, /\bcomo .* pero\b/i,
      /\ben formato\b/i, /\bcon tono\b/i,
    ],
    typeMatch: ['prompt'],
  },
  {
    stage: 'ideation',
    // First prompt or clearly new idea
    patterns: [
      /\bI want to (create|make|build|design|write|generate)\b/i,
      /\bcan you (create|make|build|design|write|generate)\b/i,
      /\blet'?s? (create|make|build|design|write)\b/i,
      /\bidea\b/i, /\bwhat if\b/i, /\bhow about\b/i, /\bconcept\b/i,
      /\bquiero (crear|hacer|diseñar|escribir|generar)\b/i,
      /\bhazme\b/i, /\bcrea(me)?\b/i, /\bdiseña\b/i, /\bgenera\b/i,
      /\bqué tal si\b/i, /\by si\b/i,
    ],
    typeMatch: ['prompt'],
  },
];

function classifyStage(logEntry, previousLogs) {
  const { type, content } = logEntry;
  const text = (content || '').toLowerCase();

  // Selection type is always "selection" stage
  if (type === 'selection') return 'selection';

  // Responses from AI
  if (type === 'response') {
    // Check if this is early in the conversation (generation) or later (iteration)
    const sameConvLogs = previousLogs.filter(
      l => l.conversationId === logEntry.conversationId && l.conversationUrl === logEntry.conversationUrl
    );
    const responseCount = sameConvLogs.filter(l => l.type === 'response').length;
    return responseCount === 0 ? 'generation' : 'iteration';
  }

  // For prompts, check patterns in priority order
  for (const rule of STAGE_RULES) {
    if (rule.typeMatch && !rule.typeMatch.includes(type)) continue;
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) return rule.stage;
    }
  }

  // Fallback: if it's the first prompt in a conversation, it's ideation
  if (type === 'prompt') {
    const sameConvPrompts = previousLogs.filter(
      l => l.type === 'prompt' && l.conversationId === logEntry.conversationId && l.conversationUrl === logEntry.conversationUrl
    );
    return sameConvPrompts.length === 0 ? 'ideation' : 'direction';
  }

  return 'ideation';
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

    // Serialize through lock to prevent race conditions on chain writes
    withChainLock(async () => {
      const result = await chrome.storage.local.get(['hp_capture_enabled', 'hp_platforms']);
      if (result.hp_capture_enabled === false) return; // global capture off
      const platforms = result.hp_platforms || {};
      if (platforms[message.data?.platform] === false) return; // platform disabled
      let screenshot = null;
      if (tabId) {
        screenshot = await captureScreenshot(tabId);
      }

      const logId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = new Date().toISOString();

      // Get user agent for evidence metadata
      const userAgent = (typeof navigator !== 'undefined') ? navigator.userAgent : null;

      const logEntry = {
        ...message.data,
        id: logId,
        timestamp,
        hasScreenshot: !!screenshot,
        userAgent,
      };

      if (screenshot) {
        await chrome.storage.local.set({ [`screenshot_${logId}`]: screenshot });
      }

      // ── Hash Chain: compute chain hash ──
      const previousHash = await getLastChainHash();
      const chainResult = await chrome.storage.local.get(['hp_chain']);
      const chainIndex = (chainResult.hp_chain || []).length;
      logEntry.chainIndex = chainIndex;

      const chainHash = await computeChainHash(logEntry, previousHash);

      // Store chain entry (evidence record)
      const chainEntry = {
        logId,
        hash: chainHash,
        previousHash,
        contentHash: logEntry.contentHash,
        chainIndex,
        timestamp,
        platform: logEntry.platform,
        type: logEntry.type,
        model: logEntry.model || null,
      };
      await appendToChain(chainEntry);

      // Add hash references to the log entry
      logEntry.hash = chainHash;
      logEntry.previousHash = previousHash;

      // ── Classify creative stage locally ──
      const logsResult = await chrome.storage.local.get(['logs']);
      const logs = logsResult.logs || [];
      logEntry.stage = classifyStage(logEntry, logs);

      // Save log
      logs.push(logEntry);
      await chrome.storage.local.set({ logs });

      console.log(`[HumanProof] Chain #${chainIndex}: ${chainHash.substring(0, 12)}... ← ${previousHash.substring(0, 12)}...`);

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
            screenshotUrl: screenshot || undefined,
          },
        }),
      }).catch(() => {});

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

  if (message.type === 'SYNC_ALL_LOGS') {
    (async () => {
      try {
        const result = await chrome.storage.local.get(['logs']);
        const logs = result.logs || [];
        if (logs.length === 0) {
          sendResponse({ success: true, count: 0 });
          return;
        }
        const apiUrl = await getApiUrl();
        const resp = await fetch(`${apiUrl}/api/logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'sync', logs }),
        });
        const data = await resp.json();
        sendResponse({ success: true, count: logs.length, serverCount: data.count });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'CLEAR_LOGS') {
    chrome.storage.local.get(null, (allData) => {
      const keysToRemove = Object.keys(allData).filter(
        (k) => k === 'logs' || k.startsWith('screenshot_') || k === 'hp_stages' || k === 'hp_projects' || k === 'hp_chain'
      );
      chrome.storage.local.remove(keysToRemove);
    });
    unclassifiedCount = 0;
    sendResponse({ success: true });
  }

  // ── Chain / Custody handlers ──
  if (message.type === 'GET_CHAIN') {
    chrome.storage.local.get(['hp_chain'], (result) => {
      sendResponse({ chain: result.hp_chain || [] });
    });
    return true;
  }

  if (message.type === 'VERIFY_CHAIN') {
    (async () => {
      const verification = await verifyChain();
      sendResponse(verification);
    })();
    return true;
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
