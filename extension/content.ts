/**
 * HumanProof — Content Script
 * Injected into AI platform pages. Detects platform, captures interactions via DOM observation.
 */

type Platform = 'chatgpt' | 'claude' | 'midjourney';

function detectPlatform(): Platform | null {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  if (host.includes('claude.ai')) return 'claude';
  if (host.includes('discord.com')) return 'midjourney';
  return null;
}

const platform = detectPlatform();

if (platform) {
  console.log(`[HumanProof] Detected: ${platform}`);
  initCapture(platform);
}

function initCapture(p: Platform) {
  switch (p) {
    case 'chatgpt':
      observeChatGPT();
      break;
    case 'claude':
      observeClaude();
      break;
    case 'midjourney':
      // P1 stretch
      break;
  }
}

function observeChatGPT() {
  // TODO: Implement DOM mutation observer for ChatGPT
  // Strategy: observe the conversation container for new message elements
  // Selectors TBD after platform research
  console.log('[HumanProof] ChatGPT observer initialized (stub)');
}

function observeClaude() {
  // TODO: Implement DOM mutation observer for Claude.ai
  console.log('[HumanProof] Claude observer initialized (stub)');
}

function sendCapture(data: {
  platform: Platform;
  model: string;
  prompt: string;
  response: string;
  parameters?: Record<string, unknown>;
}) {
  chrome.runtime.sendMessage({
    type: 'INTERACTION_CAPTURED',
    payload: {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...data,
    },
  });
}

// Export for use by platform-specific observers
(window as any).__humanproof_send = sendCapture;
