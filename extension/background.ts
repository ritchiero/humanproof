/**
 * HumanProof — Background Service Worker
 * Opens side panel on click, routes messages between content scripts and sidebar.
 */

const API_BASE = 'http://localhost:3000'; // Change to Vercel URL in production

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'INTERACTION_CAPTURED') {
    // Forward to API
    fetch(`${API_BASE}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.payload),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log('[HumanProof] Stored:', data.id);
      })
      .catch((err) => {
        console.error('[HumanProof] Store failed:', err);
      });

    // Also store locally for offline access
    chrome.storage.local.get('interactions', ({ interactions = [] }) => {
      interactions.push(message.payload);
      chrome.storage.local.set({ interactions });
    });
  }

  if (message.type === 'REQUEST_LOGS') {
    chrome.storage.local.get('interactions', ({ interactions = [] }) => {
      sendResponse(interactions);
    });
    return true; // Async response
  }
});

console.log('[HumanProof] Background service worker loaded');
