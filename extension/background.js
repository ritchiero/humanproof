// HumanProof Background Service Worker

// Toggle side panel on extension icon click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.toggleOpen({ tabId: tab.id });
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_LOG') {
    // Forward to side panel
    chrome.runtime.sendMessage({
      type: 'NEW_LOG',
      data: message.data,
      tabId: sender.tab?.id,
    });

    // Also save to chrome.storage as backup
    chrome.storage.local.get(['logs'], (result) => {
      const logs = result.logs || [];
      logs.push({
        ...message.data,
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
      });
      chrome.storage.local.set({ logs });
    });

    sendResponse({ success: true });
  }

  if (message.type === 'GET_LOGS') {
    chrome.storage.local.get(['logs'], (result) => {
      sendResponse({ logs: result.logs || [] });
    });
    return true; // async response
  }

  if (message.type === 'CLEAR_LOGS') {
    chrome.storage.local.set({ logs: [] });
    sendResponse({ success: true });
  }

  if (message.type === 'DETECT_PLATFORM') {
    const url = sender.tab?.url || '';
    let platform = null;

    if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) {
      platform = 'chatgpt';
    } else if (url.includes('claude.ai')) {
      platform = 'claude';
    } else if (url.includes('discord.com')) {
      platform = 'midjourney';
    } else if (url.includes('figma.com')) {
      platform = 'figma';
    }

    sendResponse({ platform });
  }
});
