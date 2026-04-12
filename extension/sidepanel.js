// HumanProof Side Panel Logic

let logs = [];
let screenshotCache = {}; // logId -> dataUrl
let stages = {}; // logId -> creative stage (AI-classified)
let currentTab = 'logs';
let projects = []; // AI-detected projects: { name, logIds, startedAt, platforms }
let selectedProjectIdx = null; // For report tab

const STAGE_DISPLAY = {
  'ideation':      { color: '#7c3aed', bg: '#f5f3ff', label: 'Ideation' },
  'direction':     { color: '#2563eb', bg: '#eff6ff', label: 'Direction' },
  'generation':    { color: '#059669', bg: '#ecfdf5', label: 'Generation' },
  'iteration':     { color: '#0891b2', bg: '#ecfeff', label: 'Iteration' },
  'selection':     { color: '#d97706', bg: '#fffbeb', label: 'Selection' },
  'refinement':    { color: '#dc2626', bg: '#fef2f2', label: 'Refinement' },
  'revision':      { color: '#be185d', bg: '#fdf2f8', label: 'Revision' },
  'combination':   { color: '#7c3aed', bg: '#faf5ff', label: 'Combination' },
  'final_review':  { color: '#16a34a', bg: '#f0fdf4', label: 'Final Review' },
  // Legacy Spanish keys (from old AI classifier)
  'ideación':      { color: '#7c3aed', bg: '#f5f3ff', label: 'Ideation' },
  'dirección':     { color: '#2563eb', bg: '#eff6ff', label: 'Direction' },
  'exploración':   { color: '#0891b2', bg: '#ecfeff', label: 'Exploration' },
  'selección':     { color: '#d97706', bg: '#fffbeb', label: 'Selection' },
  'edición':       { color: '#dc2626', bg: '#fef2f2', label: 'Edition' },
  'corrección':    { color: '#be185d', bg: '#fdf2f8', label: 'Correction' },
  'combinación':   { color: '#7c3aed', bg: '#faf5ff', label: 'Combination' },
  'refinamiento':  { color: '#0891b2', bg: '#ecfeff', label: 'Refinement' },
  'validación':    { color: '#16a34a', bg: '#f0fdf4', label: 'Validation' },
  'respuesta':     { color: '#059669', bg: '#ecfdf5', label: 'Response' },
};

const TYPE_DISPLAY = {
  'prompt':       { icon: '▶', label: 'Prompt' },
  'response':     { icon: '◀', label: 'Response' },
  'selection':    { icon: '☆', label: 'Selection' },
  'manual_entry': { icon: '✎', label: 'Manual' },
};

// ── Helpers ──────────────────────────────────────────────────────

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncate(text, max = 120) {
  if (!text) return '';
  return text.length > max ? text.substring(0, max) + '...' : text;
}

// Group logs by conversationUrl (each unique URL = one session)
function groupBySession(logsList) {
  const groups = {};
  for (const log of logsList) {
    const key = log.conversationUrl || `no-url-${log.platform || 'unknown'}`;
    if (!groups[key]) {
      groups[key] = {
        url: log.conversationUrl || null,
        platform: log.platform,
        logs: [],
        firstTimestamp: log.timestamp,
        lastTimestamp: log.timestamp,
      };
    }
    groups[key].logs.push(log);
    if (log.timestamp < groups[key].firstTimestamp) groups[key].firstTimestamp = log.timestamp;
    if (log.timestamp > groups[key].lastTimestamp) groups[key].lastTimestamp = log.timestamp;
  }
  // Sort sessions by last activity (most recent first)
  return Object.values(groups).sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp));
}

// Derive a short label for a session from its first prompt
function sessionLabel(session) {
  const firstPrompt = session.logs.find((l) => l.type === 'prompt');
  if (firstPrompt) return truncate(firstPrompt.content, 50);
  return session.url ? `Conversation` : 'Session';
}

// ── Tab switching ────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    render();
  });
});

// ── Messages from background ─────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'NEW_LOG') {
    logs.unshift(message.data);
    updateStatus(message.data.platform);
    render();
    if (message.data.hasScreenshot) {
      loadScreenshot(message.data.id);
    }
  }
  if (message.type === 'STAGES_UPDATED') {
    stages = message.stages || {};
    render();
  }
  if (message.type === 'PROJECTS_UPDATED') {
    projects = message.projects || [];
    render();
  }
});

// Load existing data on open
chrome.runtime.sendMessage({ type: 'GET_LOGS' }, (response) => {
  if (response?.logs) {
    logs = response.logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    // Load stages + projects, then render, THEN load screenshots
    chrome.storage.local.get(['hp_projects', 'hp_stages'], (result) => {
      if (result.hp_projects) projects = result.hp_projects;
      if (result.hp_stages) stages = result.hp_stages;
      render();
      // Load screenshots AFTER DOM is built
      setTimeout(() => {
        logs.forEach((log) => {
          if (log.hasScreenshot) loadScreenshot(log.id);
        });
      }, 100);
    });
    // Set status based on existing logs
    if (logs.length > 0) {
      const lastPlatform = logs[0]?.platform;
      updateStatus(lastPlatform || 'active');
    }
  }
});

// Also check active tab to detect if we're on a supported platform
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]?.url) {
    const u = tabs[0].url;
    if (u.includes('chatgpt.com') || u.includes('chat.openai.com')) {
      updateStatus('chatgpt');
    } else if (u.includes('claude.ai')) {
      updateStatus('claude');
    } else if (u.includes('discord.com')) {
      updateStatus('midjourney');
    }
  }
});

// ── Screenshot loading ───────────────────────────────────────────

function loadScreenshot(logId) {
  chrome.runtime.sendMessage({ type: 'GET_SCREENSHOT', logId }, (response) => {
    const loadingEl = document.getElementById(`sload_${logId}`);
    if (response?.screenshot) {
      screenshotCache[logId] = response.screenshot;
      const img = document.getElementById(`thumb_${logId}`);
      if (img) {
        img.src = response.screenshot;
        img.style.display = 'block';
      }
      if (loadingEl) loadingEl.style.display = 'none';
    } else {
      // Screenshot not found — show fallback
      if (loadingEl) loadingEl.textContent = '📷 No capture available';
    }
  });
}

function updateStatus(platform) {
  const el = document.getElementById('status');
  if (platform) {
    el.dataset.platform = platform;
    // Only show active if capture is enabled
    chrome.storage.local.get(['hp_capture_enabled'], (result) => {
      if (result.hp_capture_enabled === false) {
        el.textContent = 'paused';
        el.className = 'status inactive';
      } else {
        el.textContent = platform;
        el.className = 'status active';
      }
    });
  } else {
    el.textContent = 'inactive';
    el.className = 'status inactive';
  }
}

// ── Render ────────────────────────────────────────────────────────

function render() {
  const content = document.getElementById('content');

  if (currentTab === 'logs') renderLogs(content);
  if (currentTab === 'projects') renderProjects(content);
  if (currentTab === 'report') renderReport(content);
}

// ── Logs Tab (grouped by session) ─────────────────────────────────

function renderLogs(content) {
  if (logs.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <h3>Waiting for AI interactions...</h3>
        <p>Navigate to ChatGPT, Claude, or Discord and start a conversation.</p>
      </div>
    `;
    return;
  }

  const stats = {
    total: logs.length,
    prompts: logs.filter((l) => l.type === 'prompt').length,
    responses: logs.filter((l) => l.type === 'response').length,
  };

  const sessions = groupBySession(logs);

  content.innerHTML = `
    <div class="stats">
      <div class="stat">
        <div class="number">${stats.total}</div>
        <div class="label">Total</div>
      </div>
      <div class="stat">
        <div class="number">${stats.prompts}</div>
        <div class="label">Prompts</div>
      </div>
      <div class="stat">
        <div class="number">${stats.responses}</div>
        <div class="label">Responses</div>
      </div>
      <div class="stat">
        <div class="number">${sessions.length}</div>
        <div class="label">Sessions</div>
      </div>
    </div>

    ${sessions.map((session, sIdx) => `
      <div class="session-group">
        <div class="session-header" data-session-idx="${sIdx}">
          <div class="session-title">
            <span class="platform-badge platform-${session.platform}">${session.platform}</span>
            <span class="session-label">${sessionLabel(session)}</span>
          </div>
          <div class="session-meta">
            <span>${session.logs.length} logs</span>
            <span>&middot;</span>
            <span>${formatTime(session.lastTimestamp)}</span>
            <span class="session-chevron" id="chevron_${sIdx}">${sIdx === 0 ? '▾' : '▸'}</span>
          </div>
        </div>
        <div class="session-logs" id="session_${sIdx}" style="display:${sIdx === 0 ? 'block' : 'none'}">
          ${session.logs.map((log, logIdx) => {
            const stg = log.stage || stages[log.id]; // prefer inline stage, fallback to AI-classified
            const stgInfo = stg ? STAGE_DISPLAY[stg] : null;
            const typeInfo = TYPE_DISPLAY[log.type] || { icon: '•', label: log.type };
            return `
            <div class="log-entry" data-log-id="${log.id}" data-type="${log.type}">
              <span class="log-badge">${logIdx + 1}</span>
              <div class="log-content-col">
                <div class="log-header">
                  <div class="log-header-left">
                    <span class="type-pill type-pill-${log.type}">${typeInfo.label}</span>
                    ${stgInfo ? `<span class="stage-badge" style="background:${stgInfo.bg};color:${stgInfo.color};">${stgInfo.label}</span>` : ''}
                  </div>
                  <span class="meta-time">${formatTime(log.timestamp)}</span>
                </div>
                <div class="text">${truncate(log.content)}</div>
                <div class="log-footer">
                  ${log.model ? `<span class="meta-model">${log.model}</span>` : ''}
                  ${log.hash ? `<span class="hash-badge" title="Chain hash: ${log.hash}\nPrevious: ${log.previousHash || 'genesis'}">#${log.chainIndex ?? '?'} ${log.hash.substring(0, 8)}…</span>` : ''}
                  ${log.conversationUrl ? `<a href="${log.conversationUrl}" target="_blank" class="conv-link">${log.conversationId ? `ID: ${log.conversationId.substring(0, 12)}...` : 'Open'}</a>` : ''}
                </div>
                ${log.hasScreenshot ? `
                  <div class="screenshot-frame" data-log-id="${log.id}">
                    <img id="thumb_${log.id}" class="screenshot-thumb" data-log-id="${log.id}" src="${screenshotCache[log.id] || ''}" style="display:${screenshotCache[log.id] ? 'block' : 'none'}" title="Click to enlarge" />
                    <div class="screenshot-loading" id="sload_${log.id}" style="display:${screenshotCache[log.id] ? 'none' : 'flex'}">📷 Loading capture...</div>
                  </div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `).join('')}

    <div id="lightbox" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:999; cursor:pointer; justify-content:center; align-items:center;">
      <img id="lightbox-img" style="max-width:95%; max-height:95%; border-radius:8px; box-shadow:0 4px 24px rgba(0,0,0,0.5);" />
    </div>
    <button class="btn btn-danger" id="clearLogs">Clear All Logs</button>
  `;

  // Attach event listeners (MV3 CSP blocks inline onclick)
  document.querySelectorAll('.session-header[data-session-idx]').forEach((header) => {
    header.addEventListener('click', () => {
      const idx = parseInt(header.getAttribute('data-session-idx'));
      toggleSession(idx);
    });
  });

  document.querySelectorAll('.screenshot-thumb[data-log-id]').forEach((img) => {
    img.addEventListener('click', () => {
      showScreenshot(img.getAttribute('data-log-id'));
    });
  });

  document.getElementById('lightbox')?.addEventListener('click', function () {
    this.style.display = 'none';
  });

  document.getElementById('clearLogs')?.addEventListener('click', () => {
    if (confirm('Clear all captured logs?')) {
      logs = [];
      screenshotCache = {};
      stages = {};
      projects = [];
      chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
      render();
    }
  });

  // Reload screenshots into DOM after render (DOM was rebuilt)
  setTimeout(() => {
    logs.forEach((log) => {
      if (log.hasScreenshot) {
        const img = document.getElementById(`thumb_${log.id}`);
        if (img && screenshotCache[log.id]) {
          img.src = screenshotCache[log.id];
          img.style.display = 'block';
        } else if (img && !screenshotCache[log.id]) {
          loadScreenshot(log.id);
        }
      }
    });
  }, 50);
}

// Toggle session expand/collapse
function toggleSession(idx) {
  const el = document.getElementById(`session_${idx}`);
  const chevron = document.getElementById(`chevron_${idx}`);
  if (el.style.display === 'none') {
    el.style.display = 'block';
    chevron.textContent = '▾';
  } else {
    el.style.display = 'none';
    chevron.textContent = '▸';
  }
}
window.toggleSession = toggleSession;

// ── Projects Tab ──────────────────────────────────────────────────

function renderProjects(content) {
  if (logs.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <h3>No logs yet</h3>
        <p>Start capturing interactions, then detect projects.</p>
      </div>
    `;
    return;
  }

  const sessions = groupBySession(logs);

  let projectsHtml = '';
  if (projects.length > 0) {
    projectsHtml = projects.map((p, i) => {
      const pLogs = logs.filter((l) => p.logIds.includes(l.id));
      const platforms = [...new Set(pLogs.map((l) => l.platform))];
      return `
        <div class="project-card">
          <div class="project-name-row">
            <span class="project-name" id="pname_${i}" data-project-idx="${i}" title="Click to rename">${p.name}</span>
            <span class="project-edit-hint">✎</span>
          </div>
          ${p.description ? `<div class="project-desc">${p.description}</div>` : ''}
          <div class="project-meta">
            ${platforms.map((pl) => `<span class="platform-badge platform-${pl}">${pl}</span>`).join('')}
            <span>${pLogs.length} interactions</span>
            <span>&middot;</span>
            <span>${pLogs.filter((l) => l.type === 'prompt').length} prompts</span>
          </div>
          <div class="project-sessions">
            ${getProjectSessions(pLogs).map((s) => `
              <div class="project-session-row">
                <span class="platform-badge platform-${s.platform}">${s.platform}</span>
                <span class="session-label">${sessionLabel(s)}</span>
                <span class="session-count">${s.logs.length}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  content.innerHTML = `
    <div class="detect-section">
      <p style="font-size:12px; color:#6b7280; margin-bottom:8px;">
        ${sessions.length} session${sessions.length !== 1 ? 's' : ''} detected across ${[...new Set(logs.map((l) => l.platform))].length} platform${[...new Set(logs.map((l) => l.platform))].length !== 1 ? 's' : ''}.
        ${projects.length > 0 ? `${projects.length} project${projects.length !== 1 ? 's' : ''} identified.` : 'Click below to let AI cluster them into projects.'}
      </p>
      <button class="btn btn-primary" id="detectBtn">
        ${projects.length > 0 ? 'Re-detect Projects' : 'Detect Projects with AI'}
      </button>
      <div id="detectStatus" style="margin-top:8px; font-size:11px; color:#6b7280;"></div>
    </div>
    ${projectsHtml}
  `;

  document.getElementById('detectBtn')?.addEventListener('click', detectProjects);

  // Attach project name edit listeners (MV3 CSP blocks inline onclick)
  document.querySelectorAll('.project-name[data-project-idx]').forEach((el) => {
    el.addEventListener('click', () => {
      editProjectName(parseInt(el.getAttribute('data-project-idx')));
    });
  });
}

function getProjectSessions(pLogs) {
  return groupBySession(pLogs);
}

// Call the Next.js API to cluster logs into projects
async function detectProjects() {
  const statusEl = document.getElementById('detectStatus');
  const btn = document.getElementById('detectBtn');

  statusEl.textContent = 'Analyzing interactions...';
  btn.disabled = true;
  btn.style.opacity = '0.5';

  try {
    // Get the dashboard URL from storage or use default
    const config = await chrome.storage.local.get(['hp_api_url']);
    const apiUrl = config.hp_api_url || 'http://localhost:3000';

    const response = await fetch(`${apiUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        logs: logs,
        action: 'detect_projects',
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.projects && data.projects.length > 0) {
      projects = data.projects;
      // Persist to storage
      await chrome.storage.local.set({ hp_projects: projects });
      statusEl.textContent = `Found ${projects.length} project${projects.length !== 1 ? 's' : ''}!`;
      render();
    } else {
      statusEl.textContent = 'No distinct projects found. Keep capturing more interactions.';
    }
  } catch (err) {
    console.error('[HumanProof] Detect projects error:', err);
    statusEl.textContent = `Error: ${err.message}. Make sure the dashboard is running.`;
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

// ── Report Tab ────────────────────────────────────────────────────

function renderReport(content) {
  // Report tab now shows chain verification first, then project report
  content.innerHTML = `
    <div id="chainVerification" style="margin-bottom:16px;">
      <div class="chain-status valid" style="opacity:0.6;">
        <span class="chain-icon">⏳</span>
        <div class="chain-info">
          <div class="chain-title">Verifying chain integrity...</div>
        </div>
      </div>
    </div>

    <div id="chainDetails" style="margin-bottom:16px;"></div>

    ${projects.length > 0 ? `
      <div style="margin-bottom:12px;">
        <label style="font-size:13px; font-weight:600; color:#1a1a2e;">Select a project:</label>
        <select id="projectSelect" style="width:100%; margin-top:4px; padding:9px 10px; border:1px solid #eef0f4; border-radius:10px; font-size:13px; background:#fff;">
          ${projects.map((p, i) => `<option value="${i}" ${selectedProjectIdx === i ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary" id="generateBtn">Generate Evidence Report</button>
      <div id="reportStatus" style="margin-top:8px; font-size:11px; color:#6b7280;"></div>
      <div id="reportPreview" style="margin-top:12px;"></div>
    ` : `
      <div class="empty-state" style="padding:24px 16px;">
        <h3>Evidence report</h3>
        <p>Capture more interactions and detect projects to generate a full copyright evidence report.</p>
      </div>
    `}
  `;

  // Run chain verification
  chrome.runtime.sendMessage({ type: 'VERIFY_CHAIN' }, (result) => {
    const el = document.getElementById('chainVerification');
    if (!result) {
      el.innerHTML = `
        <div class="chain-status invalid">
          <span class="chain-icon">⚠️</span>
          <div class="chain-info">
            <div class="chain-title">No chain data</div>
            <div class="chain-detail">Start capturing interactions to build your evidence chain.</div>
          </div>
        </div>`;
      return;
    }

    if (result.valid) {
      el.innerHTML = `
        <div class="chain-status valid">
          <span class="chain-icon">✅</span>
          <div class="chain-info">
            <div class="chain-title">Chain integrity verified</div>
            <div class="chain-detail">${result.length} blocks · All hashes valid · No tampering detected</div>
          </div>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="chain-status invalid">
          <span class="chain-icon">❌</span>
          <div class="chain-info">
            <div class="chain-title">Chain integrity broken</div>
            <div class="chain-detail">Break at block #${result.brokenAt}: ${result.reason}</div>
          </div>
        </div>`;
    }
  });

  // Load chain details
  chrome.runtime.sendMessage({ type: 'GET_CHAIN' }, (result) => {
    const el = document.getElementById('chainDetails');
    const chain = result?.chain || [];
    if (chain.length === 0) {
      el.innerHTML = '';
      return;
    }

    const latest = chain[chain.length - 1];
    const first = chain[0];
    const platforms = [...new Set(chain.map(c => c.platform))];
    const types = {};
    chain.forEach(c => { types[c.type] = (types[c.type] || 0) + 1; });

    el.innerHTML = `
      <div style="background:#fff; border:1px solid #eef0f4; border-radius:14px; padding:16px;">
        <div style="font-size:13px; font-weight:600; color:#1a1a2e; margin-bottom:10px;">Custody Chain Summary</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
          <div style="background:#f7f8fa; padding:10px; border-radius:8px;">
            <div style="font-size:18px; font-weight:700; color:#1a1a2e;">${chain.length}</div>
            <div style="font-size:10px; color:#9ca3b4; text-transform:uppercase; font-weight:600;">Blocks</div>
          </div>
          <div style="background:#f7f8fa; padding:10px; border-radius:8px;">
            <div style="font-size:18px; font-weight:700; color:#1a1a2e;">${platforms.length}</div>
            <div style="font-size:10px; color:#9ca3b4; text-transform:uppercase; font-weight:600;">Platforms</div>
          </div>
        </div>
        <div style="margin-bottom:8px;">
          <div style="font-size:10px; color:#9ca3b4; text-transform:uppercase; font-weight:600; margin-bottom:4px;">Interaction Breakdown</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${Object.entries(types).map(([t, count]) => `<span class="type-pill type-pill-${t}">${t}: ${count}</span>`).join('')}
          </div>
        </div>
        <div style="margin-bottom:8px;">
          <div style="font-size:10px; color:#9ca3b4; text-transform:uppercase; font-weight:600; margin-bottom:4px;">Genesis Hash</div>
          <div class="chain-hash-mono">${first.previousHash}</div>
        </div>
        <div style="margin-bottom:8px;">
          <div style="font-size:10px; color:#9ca3b4; text-transform:uppercase; font-weight:600; margin-bottom:4px;">Latest Hash</div>
          <div class="chain-hash-mono">${latest.hash}</div>
        </div>
        <div>
          <div style="font-size:10px; color:#9ca3b4; text-transform:uppercase; font-weight:600; margin-bottom:4px;">Time Range</div>
          <div style="font-size:12px; color:#4b5563;">${new Date(first.timestamp).toLocaleString()} → ${new Date(latest.timestamp).toLocaleString()}</div>
        </div>
      </div>
    `;
  });

  if (projects.length > 0) {
    document.getElementById('projectSelect')?.addEventListener('change', (e) => {
      selectedProjectIdx = parseInt(e.target.value);
    });
    if (selectedProjectIdx === null) selectedProjectIdx = 0;
    document.getElementById('generateBtn')?.addEventListener('click', generateReport);
  }
}

async function generateReport() {
  const statusEl = document.getElementById('reportStatus');
  const previewEl = document.getElementById('reportPreview');
  const btn = document.getElementById('generateBtn');

  const project = projects[selectedProjectIdx || 0];
  if (!project) return;

  const projectLogs = logs.filter((l) => project.logIds.includes(l.id));
  if (projectLogs.length === 0) {
    statusEl.textContent = 'No logs found for this project.';
    return;
  }

  statusEl.textContent = 'Generating authorship justification...';
  btn.disabled = true;
  btn.style.opacity = '0.5';

  try {
    const config = await chrome.storage.local.get(['hp_api_url']);
    const apiUrl = config.hp_api_url || 'http://localhost:3000';

    // Step 1: Categorize contributions
    statusEl.textContent = 'Step 1/2: Categorizing contributions...';
    const catResp = await fetch(`${apiUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: projectLogs, action: 'categorize' }),
    });
    const catData = await catResp.json();

    // Step 2: Generate justification
    statusEl.textContent = 'Step 2/2: Writing authorship justification...';
    const justResp = await fetch(`${apiUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: projectLogs, action: 'justify' }),
    });
    const justData = await justResp.json();

    statusEl.textContent = 'Report ready!';

    // Show preview
    const strength = justData.strengthAssessment || 'unknown';
    const strengthColor = strength === 'strong' ? '#16a34a' : strength === 'moderate' ? '#ca8a04' : '#dc2626';

    previewEl.innerHTML = `
      <div class="report-preview">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span style="font-size:14px; font-weight:700;">${project.name}</span>
          <span style="background:${strengthColor}22; color:${strengthColor}; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600;">${strength}</span>
        </div>
        <div style="font-size:12px; color:#374151; margin-bottom:8px;">${justData.summary || ''}</div>
        <div style="font-size:11px; color:#6b7280; max-height:200px; overflow-y:auto; white-space:pre-wrap; padding:8px; background:#f9fafb; border-radius:6px; border:1px solid #e5e7eb;">
          ${justData.justification || 'No justification generated.'}
        </div>
        ${justData.recommendations ? `
          <div style="margin-top:8px;">
            <div style="font-size:11px; font-weight:600; color:#374151;">Recommendations:</div>
            ${justData.recommendations.map((r) => `<div style="font-size:11px; color:#6b7280; padding-left:8px;">• ${r}</div>`).join('')}
          </div>
        ` : ''}
        <button class="btn btn-secondary" id="downloadReport" style="margin-top:12px;">Download as PDF (coming soon)</button>
      </div>
    `;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

// ── Project name editing ─────────────────────────────────────────

function editProjectName(idx) {
  const el = document.getElementById(`pname_${idx}`);
  if (!el) return;

  const current = projects[idx].name;
  el.outerHTML = `<input id="pname_input_${idx}" class="project-name-input" value="${current.replace(/"/g, '&quot;')}" />`;

  const input = document.getElementById(`pname_input_${idx}`);
  input.focus();
  input.select();

  function save() {
    const newName = input.value.trim() || current;
    projects[idx].name = newName;
    saveProjects();
    render();
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { input.value = current; save(); }
  });
}
window.editProjectName = editProjectName;

function saveProjects() {
  chrome.storage.local.set({ hp_projects: projects });
}

// ── Screenshot lightbox ──────────────────────────────────────────

function showScreenshot(logId) {
  const src = screenshotCache[logId];
  if (!src) {
    chrome.runtime.sendMessage({ type: 'GET_SCREENSHOT', logId }, (response) => {
      if (response?.screenshot) {
        screenshotCache[logId] = response.screenshot;
        const lightbox = document.getElementById('lightbox');
        const img = document.getElementById('lightbox-img');
        img.src = response.screenshot;
        lightbox.style.display = 'flex';
      }
    });
    return;
  }
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  img.src = src;
  lightbox.style.display = 'flex';
}
window.showScreenshot = showScreenshot;

// ── Settings dropdown ────────────────────────────────────────────

(function initSettings() {
  const toggle = document.getElementById('settingsToggle');
  const dropdown = document.getElementById('settingsDropdown');
  const apiInput = document.getElementById('apiUrlInput');
  const logCountEl = document.getElementById('logCount');

  // Toggle dropdown
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    if (dropdown.classList.contains('open')) {
      // Update log count
      logCountEl.textContent = logs.length;
      // Update capture status
      const statusBadge = document.getElementById('captureStatus');
      const statusEl = document.getElementById('status');
      if (statusEl.classList.contains('active')) {
        statusBadge.textContent = '● Active';
        statusBadge.className = 'settings-badge badge-active';
      } else {
        statusBadge.textContent = '○ Inactive';
        statusBadge.className = 'settings-badge badge-inactive';
      }
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== toggle) {
      dropdown.classList.remove('open');
    }
  });

  // Load saved API URL
  chrome.storage.local.get(['hp_api_url'], (result) => {
    apiInput.value = result.hp_api_url || 'http://localhost:3000';
  });

  // Save API URL on change
  apiInput.addEventListener('change', () => {
    const url = apiInput.value.trim();
    if (url) {
      chrome.storage.local.set({ hp_api_url: url });
    }
  });

  // Language select (store preference)
  const langSelect = document.getElementById('langSelect');
  chrome.storage.local.get(['hp_lang'], (result) => {
    if (result.hp_lang) langSelect.value = result.hp_lang;
  });
  langSelect.addEventListener('change', () => {
    chrome.storage.local.set({ hp_lang: langSelect.value });
  });

  // Platform toggles
  const platformCheckboxes = document.querySelectorAll('#platformToggles input[data-platform]');
  chrome.storage.local.get(['hp_platforms'], (result) => {
    const platforms = result.hp_platforms || {};
    platformCheckboxes.forEach((cb) => {
      const p = cb.getAttribute('data-platform');
      // Default: all enabled
      if (platforms[p] === false) cb.checked = false;
    });
  });
  platformCheckboxes.forEach((cb) => {
    cb.addEventListener('change', () => {
      chrome.storage.local.get(['hp_platforms'], (result) => {
        const platforms = result.hp_platforms || {};
        platforms[cb.getAttribute('data-platform')] = cb.checked;
        chrome.storage.local.set({ hp_platforms: platforms });
        // Notify background
        chrome.runtime.sendMessage({ type: 'SET_PLATFORMS', platforms });
      });
    });
  });

  // Capture toggle
  const captureToggle = document.getElementById('captureToggle');
  const pausedBanner = document.getElementById('pausedBanner');
  const statusEl = document.getElementById('status');

  function updateCaptureUI(enabled) {
    if (enabled) {
      pausedBanner.classList.remove('visible');
      statusEl.textContent = statusEl.dataset.platform || 'ready';
      statusEl.className = 'status active';
    } else {
      pausedBanner.classList.add('visible');
      statusEl.textContent = 'paused';
      statusEl.className = 'status inactive';
    }
  }

  // Load saved state
  chrome.storage.local.get(['hp_capture_enabled'], (result) => {
    const enabled = result.hp_capture_enabled !== false; // default true
    captureToggle.checked = enabled;
    updateCaptureUI(enabled);
  });

  captureToggle.addEventListener('change', () => {
    const enabled = captureToggle.checked;
    chrome.storage.local.set({ hp_capture_enabled: enabled });
    // Notify background + all content scripts
    chrome.runtime.sendMessage({ type: 'SET_CAPTURE_ENABLED', enabled });
    updateCaptureUI(enabled);
  });
})();

// Initial render
render();
