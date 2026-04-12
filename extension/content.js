// HumanProof Content Script — Platform Capture Engine
// Injected into ChatGPT, Claude, Discord pages

(function () {
  'use strict';

  // Detect which platform we're on
  const url = window.location.href;
  let platform = null;

  if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) {
    platform = 'chatgpt';
  } else if (url.includes('claude.ai')) {
    platform = 'claude';
  } else if (url.includes('discord.com')) {
    platform = 'midjourney';
  }

  if (!platform) return;

  console.log(`[HumanProof] Active on platform: ${platform}`);

  // Send a log to the background script
  function sendLog(data) {
    chrome.runtime.sendMessage({
      type: 'CAPTURE_LOG',
      data: {
        platform,
        ...data,
      },
    });
  }

  // ============================================
  // CAPTURE METHOD: DOM Observation (default)
  // TODO: DOM selectors are best-effort guesses.
  // They WILL need testing against live sites.
  // Open DevTools on each platform to verify.
  // ============================================

  // --- ChatGPT Capture ---
  function initChatGPTCapture() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          // TODO: Verify selector — data-message-author-role may have changed
          const userMsg = node.querySelector('[data-message-author-role="user"]');
          if (userMsg) {
            const text = userMsg.innerText?.trim();
            if (text) {
              sendLog({ type: 'prompt', content: text, model: detectChatGPTModel() });
            }
          }

          // TODO: Verify selector — data-message-author-role may have changed
          const assistantMsg = node.querySelector('[data-message-author-role="assistant"]');
          if (assistantMsg) {
            // Wait for streaming to complete
            setTimeout(() => {
              const text = assistantMsg.innerText?.trim();
              if (text) {
                sendLog({ type: 'response', content: text, model: detectChatGPTModel() });
              }
            }, 3000);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function detectChatGPTModel() {
    // TODO: Verify selector — model selector DOM may have changed
    const modelEl = document.querySelector('[data-testid="model-selector"]');
    if (modelEl) return modelEl.innerText?.trim();
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.innerText?.toLowerCase();
      if (text?.includes('gpt-4') || text?.includes('gpt-3') || text?.includes('o1') || text?.includes('o3')) {
        return btn.innerText.trim();
      }
    }
    return 'unknown';
  }

  // --- Claude Capture ---
  function initClaudeCapture() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          // TODO: Verify selector — data-is-human-turn may not exist
          const humanTurn = node.closest?.('[data-is-human-turn="true"]') || node.querySelector?.('[data-is-human-turn="true"]');
          if (humanTurn) {
            const text = humanTurn.innerText?.trim();
            if (text) {
              sendLog({ type: 'prompt', content: text, model: detectClaudeModel() });
            }
          }

          // TODO: Verify selector
          const aiTurn = node.closest?.('[data-is-human-turn="false"]') || node.querySelector?.('[data-is-human-turn="false"]');
          if (aiTurn) {
            setTimeout(() => {
              const text = aiTurn.innerText?.trim();
              if (text) {
                sendLog({ type: 'response', content: text, model: detectClaudeModel() });
              }
            }, 5000);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function detectClaudeModel() {
    // TODO: Verify selector
    const modelEl = document.querySelector('[data-testid="model-selector"]');
    if (modelEl) return modelEl.innerText?.trim();
    return 'Claude (model unknown)';
  }

  // --- Discord/Midjourney Capture ---
  function initMidjourneyCapture() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          // TODO: Verify selector — Discord DOM changes frequently
          const messageContent = node.querySelector?.('[class*="messageContent"]');
          if (messageContent) {
            const text = messageContent.innerText?.trim();
            if (text?.startsWith('/imagine')) {
              sendLog({ type: 'prompt', content: text, model: 'Midjourney' });
            }
          }

          const images = node.querySelectorAll?.('img[src*="cdn.discordapp.com"]');
          if (images?.length > 0) {
            for (const img of images) {
              if (img.src?.includes('midjourney') || img.closest?.('[class*="message"]')?.textContent?.includes('Midjourney')) {
                sendLog({
                  type: 'response',
                  content: `[Image generated] ${img.src}`,
                  model: 'Midjourney',
                });
              }
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Initialize the right capture engine
  switch (platform) {
    case 'chatgpt':
      initChatGPTCapture();
      break;
    case 'claude':
      initClaudeCapture();
      break;
    case 'midjourney':
      initMidjourneyCapture();
      break;
  }

  // Notify background that content script is active
  chrome.runtime.sendMessage({ type: 'DETECT_PLATFORM' });
})();
