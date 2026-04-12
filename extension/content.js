// HumanProof Content Script — Platform Capture Engine
// Injected into ChatGPT, Claude, Discord pages

(function () {
  'use strict';

  const url = window.location.href;
  let platform = null;

  if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) {
    platform = 'chatgpt';
  } else if (url.includes('claude.ai')) {
    platform = 'claude';
  } else if (url.includes('discord.com')) {
    platform = 'midjourney';
  } else if (url.includes('gemini.google.com')) {
    platform = 'gemini';
  } else if (url.includes('grok.com') || url.includes('x.com/i/grok')) {
    platform = 'grok';
  } else if (url.includes('figma.com')) {
    platform = 'figma';
  }

  if (!platform) return;

  // Check if this platform is enabled
  chrome.storage.local.get(['hp_platforms', 'hp_capture_enabled'], (result) => {
    if (result.hp_capture_enabled === false) return; // global capture off
    const platforms = result.hp_platforms || {};
    if (platforms[platform] === false) {
      console.log(`[HumanProof] Platform ${platform} is disabled, skipping capture.`);
      return;
    }
    initPlatform();
  });

  console.log(`[HumanProof] Active on platform: ${platform}`);

  // ── Helpers ─────────────────────────────────────────────────────

  function sendLog(data) {
    try {
      chrome.runtime.sendMessage({
        type: 'CAPTURE_LOG',
        data: {
          platform,
          conversationUrl: window.location.href,
          conversationId: extractConversationId(),
          ...data,
        },
      });
      console.log(`[HumanProof] Log sent: ${data.type} — ${(data.content || '').substring(0, 60)}...`);
    } catch (err) {
      console.warn('[HumanProof] sendLog error:', err.message);
    }
  }

  function extractConversationId() {
    const u = window.location.href;
    const m1 = u.match(/\/c\/([a-zA-Z0-9-]+)/);
    if (m1) return m1[1];
    const m2 = u.match(/\/chat\/([a-zA-Z0-9-]+)/);
    if (m2) return m2[1];
    const m3 = u.match(/\/channels\/(\d+)\/(\d+)/);
    if (m3) return `${m3[1]}/${m3[2]}`;
    return null;
  }

  // ── ChatGPT Capture (robust approach) ─────────────────────────

  function initChatGPTCapture() {
    let lastPromptText = '';
    let lastResponseCount = 0;
    let capturedTexts = new Set(); // dedup by content hash

    function hashText(t) {
      return (t || '').substring(0, 100).trim();
    }

    // ── METHOD 1: Capture prompts via textarea/input interception ──
    // Listen for Enter key or send button to grab the prompt text
    function capturePromptOnSend() {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          // Find the active textarea or contenteditable
          const textarea = document.querySelector('textarea, [contenteditable="true"]#prompt-textarea, div[contenteditable="true"][data-placeholder]');
          if (textarea) {
            const text = (textarea.value || textarea.innerText || '').trim();
            if (text && text !== lastPromptText && text.length > 1) {
              lastPromptText = text;
              // Small delay to ensure it's actually being sent (not just editing)
              setTimeout(() => {
                sendLog({ type: 'prompt', content: text, model: detectChatGPTModel() });
              }, 100);
            }
          }
        }
      }, true);

      // Also capture via send button click
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label*="Send"], button[data-testid="fruitjuice-send-button"]');
        if (btn) {
          const textarea = document.querySelector('textarea, [contenteditable="true"]#prompt-textarea, div[contenteditable="true"][data-placeholder]');
          if (textarea) {
            const text = (textarea.value || textarea.innerText || '').trim();
            if (text && text !== lastPromptText && text.length > 1) {
              lastPromptText = text;
              setTimeout(() => {
                sendLog({ type: 'prompt', content: text, model: detectChatGPTModel() });
              }, 100);
            }
          }
        }
      }, true);
    }

    // ── METHOD 2: Capture responses via periodic DOM scanning ──
    // More reliable than MutationObserver for streaming content
    function startResponseScanner() {
      setInterval(() => {
        // Find all assistant message containers
        // Strategy: find elements that contain copy buttons but not user messages
        const allTurns = document.querySelectorAll(
          'article, [data-testid^="conversation-turn-"], [class*="agent-turn"], [class*="group\\/conversation-turn"]'
        );

        let responseCount = 0;
        allTurns.forEach((turn) => {
          // Skip user turns
          if (turn.querySelector('[data-message-author-role="user"]')) return;
          // Must have a copy button (signals it's a complete assistant turn)
          if (!turn.querySelector('[data-testid="copy-turn-action-button"], button[aria-label="Copy"]')) return;
          responseCount++;

          // Extract text
          const markdown = turn.querySelector('.markdown, [class*="markdown"], [class*="prose"]');
          let text = markdown ? markdown.innerText?.trim() : '';

          // Check for generated images
          if (!text) {
            const imgs = turn.querySelectorAll('img[alt]:not([alt=""])');
            const alts = [];
            imgs.forEach((img) => {
              const alt = img.alt?.trim();
              if (alt && alt.length > 5 && !alt.startsWith('User') && !alt.startsWith('Avatar')) {
                alts.push(alt);
              }
            });
            if (alts.length > 0) text = `[Image generated] ${alts.join('; ')}`;
          }

          // Also check for "Creating image" status (DALL-E)
          if (!text) {
            const creating = turn.querySelector('[class*="result-streaming"], [class*="creating"]');
            if (creating) return; // still generating, skip
            text = turn.innerText?.trim()?.substring(0, 500);
          }

          if (!text) return;

          const hash = hashText(text);
          if (capturedTexts.has(hash)) return;
          capturedTexts.add(hash);

          sendLog({ type: 'response', content: text, model: detectChatGPTModel() });
        });

        lastResponseCount = responseCount;
      }, 3000); // Check every 3 seconds
    }

    // ── METHOD 3: Capture image region edits (DALL-E inpainting) ──
    function captureRegionEdits() {
      // DALL-E editor uses a canvas overlay for region selection
      // When the user draws a region and submits, capture it
      let isInEditMode = false;

      const editObserver = new MutationObserver(() => {
        // Detect when the DALL-E edit UI appears
        const editCanvas = document.querySelector('canvas[class*="edit"], [class*="image-edit"], [data-testid*="edit"]');
        const editOverlay = document.querySelector('[class*="inpaint"], [class*="mask-editor"], [aria-label*="Edit"]');
        const editButton = document.querySelector('button:has([class*="edit"]), [data-testid*="edit-image"]');

        // Also detect the "Edit" button overlay on generated images
        const editBtns = document.querySelectorAll('button');
        let foundEditMode = false;
        editBtns.forEach((btn) => {
          const t = btn.innerText?.trim().toLowerCase();
          if (t === 'edit' && btn.closest('[class*="image"], [class*="dalle"]')) {
            foundEditMode = true;
          }
        });

        if ((editCanvas || editOverlay || foundEditMode) && !isInEditMode) {
          isInEditMode = true;
          console.log('[HumanProof] DALL-E edit mode detected');
        }

        if (isInEditMode) {
          // Check if user submitted an edit instruction
          // The textarea/input will contain the edit instruction
          // We capture this as a special "region_edit" type when sent
        }
      });

      editObserver.observe(document.body, { childList: true, subtree: true });

      // Intercept edit submissions: when in edit mode, the prompt is a region edit
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && isInEditMode) {
          const textarea = document.querySelector('textarea, [contenteditable="true"]#prompt-textarea, div[contenteditable="true"]');
          if (textarea) {
            const text = (textarea.value || textarea.innerText || '').trim();
            if (text && text.length > 1) {
              sendLog({
                type: 'prompt',
                content: `[Region Edit] ${text}`,
                model: detectChatGPTModel(),
                metadata: { editType: 'region_inpaint', instruction: text },
              });
              // Reset after capture
              setTimeout(() => { isInEditMode = false; }, 2000);
            }
          }
        }
      }, true);

      // Also detect the "Selection" indicator in ChatGPT (when image variant selected)
      document.addEventListener('click', (e) => {
        const target = e.target.closest?.('[class*="image"], [class*="dalle"], button');
        if (!target) return;

        // Check for image variant selection (e.g., clicking on one of 4 generated images)
        const img = target.querySelector('img') || (target.tagName === 'IMG' ? target : null);
        if (img && img.closest('[class*="grid"], [class*="image-set"], [class*="gallery"]')) {
          sendLog({
            type: 'selection',
            content: `Selected image variant: ${img.alt || 'image'}`,
            model: detectChatGPTModel(),
            metadata: { selectionType: 'image_variant', alt: img.alt || '' },
          });
        }
      }, true);
    }

    // ── METHOD 4: Selection/choice capture ──
    function captureSelections() {
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const text = btn.innerText?.trim();
        if (!text) return;

        // Image preference: "Image 1 is better", etc.
        if (text.match(/image \d.*(better|prefer|select)/i) || text.match(/(better|prefer|select).*image \d/i)) {
          sendLog({
            type: 'selection',
            content: `Selected: "${text}"`,
            model: detectChatGPTModel(),
            metadata: { selectionType: 'image_preference', choice: text },
          });
          return;
        }

        // Option choices
        if (text.match(/^(option|choice|version)\s*[a-d1-4]/i) ||
            text.match(/^(prefer|select|choose)\s/i) ||
            text.match(/this (one|version|option)/i)) {
          sendLog({
            type: 'selection',
            content: `Selected: "${text}"`,
            model: detectChatGPTModel(),
            metadata: { selectionType: 'option_choice', choice: text },
          });
          return;
        }

        // Thumbs up/down
        const testId = btn.getAttribute('data-testid') || '';
        if (testId.includes('thumbs-up') || testId.includes('good')) {
          sendLog({ type: 'selection', content: 'Approved response (thumbs up)', model: detectChatGPTModel(), metadata: { selectionType: 'approval' } });
        }
        if (testId.includes('thumbs-down') || testId.includes('bad')) {
          sendLog({ type: 'selection', content: 'Rejected response (thumbs down)', model: detectChatGPTModel(), metadata: { selectionType: 'rejection' } });
        }
      }, true);
    }

    // ── Also keep MutationObserver as backup for prompt capture ──
    function initBackupObserver() {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;

            // User messages
            const userMsg = node.querySelector?.('[data-message-author-role="user"]') ||
              node.closest?.('[data-message-author-role="user"]');
            if (userMsg) {
              const text = userMsg.innerText?.trim();
              if (text && text !== lastPromptText && !capturedTexts.has(hashText(text))) {
                capturedTexts.add(hashText(text));
                lastPromptText = text;
                sendLog({ type: 'prompt', content: text, model: detectChatGPTModel() });
              }
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    // Start all capture methods
    capturePromptOnSend();
    startResponseScanner();
    captureRegionEdits();
    captureSelections();
    initBackupObserver();

    console.log('[HumanProof] ChatGPT capture initialized (5 methods active)');
  }

  function detectChatGPTModel() {
    const sel = document.querySelector('[data-testid="model-selector"]');
    if (sel) return sel.innerText?.trim();
    const oai = document.querySelector('button.font-oai, button [class*="font-oai"]');
    if (oai) return oai.innerText?.trim();
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      const t = btn.innerText?.toLowerCase() || '';
      if (t.includes('gpt-4') || t.includes('4o') || t.includes('o1') || t.includes('o3') || t.includes('o4')) {
        return btn.innerText.trim();
      }
    }
    return 'ChatGPT';
  }

  // ── Claude Capture ──────────────────────────────────────────────

  function initClaudeCapture() {
    let lastPrompt = '';
    const capturedTexts = new Set();

    // Prompt via textarea interception
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const textarea = document.querySelector('[contenteditable="true"], textarea');
        if (textarea) {
          const text = (textarea.value || textarea.innerText || '').trim();
          if (text && text !== lastPrompt && text.length > 1) {
            lastPrompt = text;
            setTimeout(() => {
              sendLog({ type: 'prompt', content: text, model: detectClaudeModel() });
            }, 100);
          }
        }
      }
    }, true);

    // Response scanner
    setInterval(() => {
      const turns = document.querySelectorAll('[data-is-streaming="false"], [class*="response"], [class*="assistant"]');
      turns.forEach((turn) => {
        const text = turn.innerText?.trim();
        if (!text || text.length < 10) return;
        const hash = text.substring(0, 100);
        if (capturedTexts.has(hash)) return;
        capturedTexts.add(hash);
        sendLog({ type: 'response', content: text, model: detectClaudeModel() });
      });
    }, 3000);

    // Backup MutationObserver
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const humanTurn = node.querySelector?.('[data-is-human-turn="true"]');
          if (humanTurn) {
            const text = humanTurn.innerText?.trim();
            if (text && text !== lastPrompt && !capturedTexts.has(text.substring(0, 100))) {
              capturedTexts.add(text.substring(0, 100));
              lastPrompt = text;
              sendLog({ type: 'prompt', content: text, model: detectClaudeModel() });
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function detectClaudeModel() {
    const el = document.querySelector('[data-testid="model-selector"], [class*="model-name"]');
    if (el) return el.innerText?.trim();
    // Look for model name in page
    const btns = document.querySelectorAll('button, span');
    for (const b of btns) {
      const t = b.innerText?.trim();
      if (t && (t.includes('Sonnet') || t.includes('Opus') || t.includes('Haiku') || t.includes('Claude'))) {
        if (t.length < 30) return t;
      }
    }
    return 'Claude';
  }

  // ── Discord/Midjourney Capture ─────────────────────────────────

  function initMidjourneyCapture() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const msg = node.querySelector?.('[class*="messageContent"]');
          if (msg) {
            const text = msg.innerText?.trim();
            if (text?.startsWith('/imagine')) {
              sendLog({ type: 'prompt', content: text, model: 'Midjourney' });
            }
          }
          const images = node.querySelectorAll?.('img[src*="cdn.discordapp.com"]');
          if (images?.length > 0) {
            for (const img of images) {
              if (img.closest?.('[class*="message"]')?.textContent?.includes('Midjourney')) {
                sendLog({ type: 'response', content: `[Image generated] ${img.src}`, model: 'Midjourney' });
              }
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Gemini Capture ───────────────────────────────────────────────

  function initGeminiCapture() {
    let lastPrompt = '';
    const capturedTexts = new Set();

    // Prompt via textarea
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const textarea = document.querySelector('textarea, [contenteditable="true"], .ql-editor, [aria-label*="prompt"]');
        if (textarea) {
          const text = (textarea.value || textarea.innerText || '').trim();
          if (text && text !== lastPrompt && text.length > 1) {
            lastPrompt = text;
            setTimeout(() => sendLog({ type: 'prompt', content: text, model: 'Gemini' }), 100);
          }
        }
      }
    }, true);

    // Response scanner
    setInterval(() => {
      const responses = document.querySelectorAll('[class*="response-container"], [class*="model-response"], .markdown-main-panel, [data-content-type="response"]');
      responses.forEach((el) => {
        const text = el.innerText?.trim();
        if (!text || text.length < 10) return;
        const hash = text.substring(0, 100);
        if (capturedTexts.has(hash)) return;
        capturedTexts.add(hash);
        sendLog({ type: 'response', content: text, model: 'Gemini' });
      });
    }, 3000);

    console.log('[HumanProof] Gemini capture initialized');
  }

  // ── Grok Capture ────────────────────────────────────────────────

  function initGrokCapture() {
    let lastPrompt = '';
    const capturedTexts = new Set();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const textarea = document.querySelector('textarea, [contenteditable="true"]');
        if (textarea) {
          const text = (textarea.value || textarea.innerText || '').trim();
          if (text && text !== lastPrompt && text.length > 1) {
            lastPrompt = text;
            setTimeout(() => sendLog({ type: 'prompt', content: text, model: 'Grok' }), 100);
          }
        }
      }
    }, true);

    setInterval(() => {
      const responses = document.querySelectorAll('[class*="message-bubble"]:not([class*="user"]), [class*="assistant"], [class*="bot-message"]');
      responses.forEach((el) => {
        const text = el.innerText?.trim();
        if (!text || text.length < 10) return;
        const hash = text.substring(0, 100);
        if (capturedTexts.has(hash)) return;
        capturedTexts.add(hash);
        sendLog({ type: 'response', content: text, model: 'Grok' });
      });
    }, 3000);

    console.log('[HumanProof] Grok capture initialized');
  }

  // ── Figma Capture (comments/AI features) ────────────────────────

  function initFigmaCapture() {
    // Figma AI features: capture text generation, suggestions
    const capturedTexts = new Set();

    setInterval(() => {
      // Look for AI-related panels/dialogs in Figma
      const aiPanels = document.querySelectorAll('[class*="ai_panel"], [class*="ai-"], [aria-label*="AI"]');
      aiPanels.forEach((el) => {
        const text = el.innerText?.trim();
        if (!text || text.length < 5) return;
        const hash = text.substring(0, 100);
        if (capturedTexts.has(hash)) return;
        capturedTexts.add(hash);
        sendLog({ type: 'prompt', content: text, model: 'Figma AI' });
      });
    }, 3000);

    console.log('[HumanProof] Figma capture initialized');
  }

  // ── Initialize ─────────────────────────────────────────────────

  function initPlatform() {
    switch (platform) {
      case 'chatgpt': initChatGPTCapture(); break;
      case 'claude': initClaudeCapture(); break;
      case 'midjourney': initMidjourneyCapture(); break;
      case 'gemini': initGeminiCapture(); break;
      case 'grok': initGrokCapture(); break;
      case 'figma': initFigmaCapture(); break;
    }
    chrome.runtime.sendMessage({ type: 'DETECT_PLATFORM' });
  }
})();
