// HumanProof Side Panel Logic

let logs = [];
let currentTab = 'logs';

// Tab switching
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    render();
  });
});

// Listen for new logs from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'NEW_LOG') {
    logs.unshift({
      ...message.data,
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    });
    updateStatus(message.data.platform);
    render();
  }
});

// Load existing logs on open
chrome.runtime.sendMessage({ type: 'GET_LOGS' }, (response) => {
  if (response?.logs) {
    logs = response.logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    render();
  }
});

function updateStatus(platform) {
  const el = document.getElementById('status');
  if (platform) {
    el.textContent = platform;
    el.className = 'status active';
  } else {
    el.textContent = 'inactive';
    el.className = 'status inactive';
  }
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncate(text, max = 120) {
  if (!text) return '';
  return text.length > max ? text.substring(0, max) + '...' : text;
}

function render() {
  const content = document.getElementById('content');

  if (currentTab === 'logs') {
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
      </div>
      ${logs.map((log) => `
        <div class="log-entry log-type-${log.type}">
          <div class="meta">
            <span class="platform-badge platform-${log.platform}">${log.platform}</span>
            <span>${log.type}</span>
            <span>&middot;</span>
            <span>${formatTime(log.timestamp)}</span>
            ${log.model ? `<span>&middot; ${log.model}</span>` : ''}
          </div>
          <div class="text">${truncate(log.content)}</div>
        </div>
      `).join('')}
      <button class="btn btn-danger" id="clearLogs">Clear All Logs</button>
    `;

    document.getElementById('clearLogs')?.addEventListener('click', () => {
      if (confirm('Clear all captured logs?')) {
        logs = [];
        chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
        render();
      }
    });
  }

  if (currentTab === 'projects') {
    content.innerHTML = `
      <div class="empty-state">
        <h3>AI Project Detection</h3>
        <p>Once you have enough logs, click below to let AI analyze and group them into projects.</p>
        <button class="btn btn-primary" id="analyzeBtn">Analyze Logs with AI</button>
      </div>
    `;

    document.getElementById('analyzeBtn')?.addEventListener('click', () => {
      // TODO: Send logs to Claude API for project detection
      alert('AI analysis will be connected to Claude API. Coming next.');
    });
  }

  if (currentTab === 'report') {
    content.innerHTML = `
      <div class="empty-state">
        <h3>Generate Evidence Report</h3>
        <p>Select a project and generate a verifiable PDF report with chain of custody, contribution analysis, and authorship justification.</p>
        <button class="btn btn-primary" id="generateBtn">Generate Report</button>
      </div>
    `;

    document.getElementById('generateBtn')?.addEventListener('click', () => {
      // TODO: Generate PDF report
      alert('PDF report generation coming next.');
    });
  }
}

// Initial render
render();
