// Mission Control - Full Dashboard App
let authToken = localStorage.getItem('mc_auth');
let tasks = [], news = { cfd: [], crypto: [], ordinals: [] };
let market = [], tradfi = [], goals = [], sessions = [];
let files = [], usageData = null, systemHealth = null;
let ws = null, charts = {};
let allSessionMessages = [], currentSessionId = null;

// ===== Sidebar & Mobile =====
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
  document.querySelector('.sidebar-overlay').classList.toggle('open');
}
document.addEventListener('click', e => {
  if (e.target.closest('.nav-item') && window.innerWidth <= 768) toggleSidebar();
});

// ===== Auth =====
function checkAuth() {
  if (authToken) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    init();
  }
}

document.getElementById('login-btn')?.addEventListener('click', login);
document.getElementById('password-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') login(); });

async function login() {
  const pw = document.getElementById('password-input').value;
  try {
    const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const data = await res.json();
    if (data.success) {
      authToken = data.token;
      localStorage.setItem('mc_auth', authToken);
      document.cookie = `mc_auth=${authToken}; path=/`;
      checkAuth();
    } else {
      const err = document.getElementById('login-error');
      err.textContent = 'Invalid password';
      err.style.display = 'block';
    }
  } catch (e) { console.error('Login error:', e); }
}

// ===== API =====
async function api(endpoint, options = {}) {
  const res = await fetch(`/api${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`, ...options.headers }
  });
  return res.json();
}

// ===== WebSocket =====
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onmessage = e => {
    const data = JSON.parse(e.data);
    if (data.type === 'agent_status') updateAgentStatus(data.status);
    else if (data.type === 'system_health') { systemHealth = data.data; renderSystemHealth(); }
    else if (data.type === 'task_created' || data.type === 'task_updated') loadTasks();
    else if (data.type === 'task_deleted') { tasks = tasks.filter(t => t.id != data.taskId); renderKanban(); }
    else if (data.type === 'activity') loadActivity();
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
}

// ===== Navigation =====
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.style.display = 'block';
  const nav = document.querySelector(`[data-page="${page}"]`);
  if (nav) nav.classList.add('active');

  const loaders = {
    kanban: () => renderKanban(),
    files: () => loadFiles(),
    news: () => renderAllNews(),
    portfolio: () => { loadPortfolio(); loadMarket(); },
    cfdaware: () => { renderCFDNews(); renderProjectTasks('cfdaware', 'cfd-tasks'); renderProjectGoals('cfdaware', 'cfdaware-goals'); loadCFDNotes(); },
    ordx: () => { renderOrdinalsNews(); renderProjectTasks('ordx', 'ordx-tasks'); renderProjectGoals('ordx', 'ordx-goals'); },
    sessions: () => loadSessions(),
    usage: () => loadUsage(),
    cron: () => loadCron(),
    notes: () => loadNotes(),
  };
  if (loaders[page]) loaders[page]();
}

// Handle hash navigation
window.addEventListener('hashchange', () => {
  const page = location.hash.replace('#', '') || 'overview';
  navigateTo(page);
});

// ===== Init =====
async function init() {
  connectWS();
  await Promise.all([loadTasks(), loadNews(), loadMarket(), loadAgentStatus(), loadGoals(), loadSystemHealth(), loadActivity(), loadGitActivity()]);
  renderOverview();
  setInterval(loadAgentStatus, 30000);
  setInterval(loadMarket, 120000);
  setInterval(loadNews, 300000);
  setInterval(loadActivity, 30000);
  setInterval(loadSystemHealth, 60000);

  // Check hash
  const page = location.hash.replace('#', '');
  if (page && page !== 'overview') navigateTo(page);
}

// ===== Agent Status =====
async function loadAgentStatus() {
  const status = await api('/agent/status');
  updateAgentStatus(status);
}

function updateAgentStatus(s) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('agent-status-text');
  const detail = document.getElementById('agent-status-detail');
  dot.className = 'status-dot';

  if (!s.online) {
    dot.classList.add('offline');
    text.textContent = 'Dorf Offline';
    detail.textContent = 'Gateway unreachable';
  } else if (s.working) {
    dot.classList.add('working');
    text.textContent = 'Dorf Working';
    detail.textContent = s.activeModel ? `Using ${s.activeModel}` : 'Processing...';
  } else {
    const la = s.lastActivity ? new Date(s.lastActivity) : null;
    const mins = la ? Math.floor((Date.now() - la.getTime()) / 60000) : 999;
    if (mins >= 5) {
      dot.classList.add('idle');
      text.textContent = 'Dorf Idle';
      detail.textContent = mins < 60 ? `${mins}m ago` : `${Math.floor(mins/60)}h ago`;
    } else {
      text.textContent = 'Dorf Online';
      detail.textContent = mins < 1 ? 'Just now' : `${mins}m ago`;
    }
  }

  // Update agent monitor
  renderAgentMonitor(s);
  if (s.activeSessionCount !== undefined) {
    document.getElementById('stat-sessions').textContent = s.activeSessionCount;
  }
}

function renderAgentMonitor(s) {
  const el = document.getElementById('agent-monitor');
  if (!el) return;
  const statusColor = s.working ? 'var(--accent-blue)' : s.online ? 'var(--accent-green)' : 'var(--accent-red)';
  const statusText = s.working ? 'Working' : s.online ? (s.status === 'idle' ? 'Idle' : 'Online') : 'Offline';
  el.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <div style="width:12px;height:12px;border-radius:50%;background:${statusColor};box-shadow:0 0 8px ${statusColor}"></div>
        <strong style="font-size:15px">${statusText}</strong>
      </div>
      ${s.activeModel ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px"><i class="fa-solid fa-microchip"></i> Model: <strong>${s.activeModel}</strong></div>` : ''}
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px"><i class="fa-solid fa-layer-group"></i> Sessions: <strong>${s.activeSessionCount || 0}</strong></div>
      ${s.lastActivity ? `<div style="font-size:12px;color:var(--text-muted)"><i class="fa-solid fa-clock"></i> Last: ${formatTime(s.lastActivity)}</div>` : ''}
    </div>
    ${s.recentActions?.length ? `
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700;margin-bottom:8px">Recent Actions</div>
      ${s.recentActions.map(a => `<div class="tool-call-tag"><i class="fa-solid fa-wrench"></i> ${a.tool}</div>`).join('')}
    ` : '<div class="empty-state" style="padding:16px"><p>No recent actions</p></div>'}
  `;
}

// ===== System Health =====
async function loadSystemHealth() {
  systemHealth = await api('/system/health');
  renderSystemHealth();
  if (systemHealth.uptime) {
    const h = Math.floor(systemHealth.uptime / 3600);
    const d = Math.floor(h / 24);
    document.getElementById('stat-uptime').textContent = d > 0 ? `${d}d` : `${h}h`;
  }
}

function renderSystemHealth() {
  const el = document.getElementById('system-health');
  if (!el || !systemHealth) return;
  const s = systemHealth;
  const cpuColor = s.cpu.percent > 80 ? 'var(--accent-red)' : s.cpu.percent > 50 ? 'var(--accent-yellow)' : 'var(--accent-green)';
  const memColor = s.memory.percent > 80 ? 'var(--accent-red)' : s.memory.percent > 50 ? 'var(--accent-yellow)' : 'var(--accent-green)';
  el.innerHTML = `
    <div class="health-grid">
      <div class="health-item">
        <div class="gauge-ring" style="--pct:${s.cpu.percent}%;background:conic-gradient(${cpuColor} ${s.cpu.percent}%, var(--bg-hover) 0%)">
          <span>${s.cpu.percent}%</span>
        </div>
        <div class="health-label">CPU</div>
      </div>
      <div class="health-item">
        <div class="gauge-ring" style="--pct:${s.memory.percent}%;background:conic-gradient(${memColor} ${s.memory.percent}%, var(--bg-hover) 0%)">
          <span>${s.memory.percent}%</span>
        </div>
        <div class="health-label">RAM</div>
      </div>
      <div class="health-item">
        <div class="gauge-ring" style="--pct:${s.disk.percent}%;background:conic-gradient(var(--accent-blue) ${s.disk.percent}%, var(--bg-hover) 0%)">
          <span>${s.disk.percent}%</span>
        </div>
        <div class="health-label">Disk</div>
      </div>
      ${s.temperature !== null ? `
      <div class="health-item">
        <div class="health-value" style="font-size:22px;color:${s.temperature > 70 ? 'var(--accent-red)' : 'var(--accent-cyan)'}">${s.temperature}°</div>
        <div class="health-label">Temp</div>
      </div>` : ''}
    </div>
    <div style="margin-top:14px;font-size:11px;color:var(--text-muted)">
      <div>${s.hostname} · ${s.arch} · Node ${s.nodeVersion}</div>
      <div>OpenClaw ${s.openclawVersion}</div>
    </div>
  `;
}

// ===== Goals =====
async function loadGoals() {
  goals = await api('/goals');
  renderGoalsOverview();
}

function renderGoalsOverview() {
  const el = document.getElementById('goals-overview');
  if (!el || !goals.length) return;
  el.innerHTML = goals.map(g => {
    const pct = Math.min(100, Math.round((g.current_value / g.target_value) * 100));
    const color = g.project === 'ordx' ? 'orange' : g.project === 'cfdaware' ? 'purple' : 'green';
    return `
      <div class="progress-container" style="cursor:pointer" onclick="openGoalModal(${g.id})">
        <div class="progress-label">
          <span>${g.goal}</span>
          <span>${pct}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${color}" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderProjectGoals(project, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const pg = goals.filter(g => g.project === project);
  if (!pg.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="card" style="margin-bottom:20px">' + pg.map(g => {
    const pct = Math.min(100, Math.round((g.current_value / g.target_value) * 100));
    const color = project === 'ordx' ? 'orange' : project === 'cfdaware' ? 'purple' : 'green';
    return `
      <div class="progress-container" style="cursor:pointer" onclick="openGoalModal(${g.id})">
        <div class="progress-label"><span>${g.goal}</span><span>${pct}%</span></div>
        <div class="progress-bar"><div class="progress-fill ${color}" style="width:${pct}%"></div></div>
      </div>`;
  }).join('') + '</div>';
}

function openGoalModal(id) {
  const g = goals.find(x => x.id === id);
  if (!g) return;
  const form = document.getElementById('goal-form');
  form.goalId.value = g.id;
  form.goal.value = g.goal;
  form.current_value.value = g.current_value;
  form.target_value.value = g.target_value;
  document.getElementById('goal-modal').classList.add('active');
}
function closeGoalModal() { document.getElementById('goal-modal').classList.remove('active'); }

async function submitGoal(e) {
  e.preventDefault();
  const form = e.target;
  await api(`/goals/${form.goalId.value}`, {
    method: 'PUT',
    body: JSON.stringify({
      goal: form.goal.value,
      current_value: parseFloat(form.current_value.value),
      target_value: parseFloat(form.target_value.value)
    })
  });
  closeGoalModal();
  await loadGoals();
}

// ===== Quick Command =====
async function sendCommand() {
  const input = document.getElementById('command-input');
  const cmd = input.value.trim();
  if (!cmd) return;
  input.value = '';
  const res = await api('/command', { method: 'POST', body: JSON.stringify({ command: cmd }) });
  showToast(res.success ? 'Command sent to Dorf!' : 'Failed to send command');
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'command-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ===== Tasks =====
async function loadTasks() {
  tasks = await api('/tasks');
  renderKanban();
  updateTaskStats();
}

function updateTaskStats() {
  const active = tasks.filter(t => t.status !== 'done').length;
  document.getElementById('stat-tasks-active').textContent = active;
}

function renderKanban() {
  const board = document.getElementById('kanban-board');
  if (!board) return;
  const filter = document.getElementById('project-filter')?.value;
  const cols = [
    { status: 'backlog', title: 'Backlog' },
    { status: 'todo', title: 'To Do' },
    { status: 'in-progress', title: 'In Progress' },
    { status: 'done', title: 'Done' }
  ];
  const ft = filter ? tasks.filter(t => t.project === filter) : tasks;
  board.innerHTML = cols.map(col => {
    const ct = ft.filter(t => t.status === col.status);
    return `<div class="kanban-column" data-status="${col.status}" ondragover="event.preventDefault()" ondrop="dropTask(event)">
      <div class="kanban-column-header"><span class="kanban-column-title">${col.title}</span><span class="kanban-count">${ct.length}</span></div>
      <div class="kanban-cards">${ct.map(renderTaskCard).join('')}</div>
    </div>`;
  }).join('');
}

function renderTaskCard(t) {
  const pb = t.project ? `<span class="project-badge ${t.project}">${t.project.toUpperCase()}</span>` : '';
  return `<div class="task-card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${t.id}')" onclick="openEditTaskModal(${t.id})" data-id="${t.id}">
    <div class="task-title">${esc(t.title)}</div>
    <div class="task-meta">
      <span class="task-assignee ${t.assignee}">${t.assignee === 'dorf' ? '🦡' : t.assignee === 'proteus' ? '👤' : '—'} ${t.assignee !== 'unassigned' ? t.assignee : ''}</span>
      ${pb}<span class="task-priority ${t.priority}">${t.priority}</span>
    </div>
  </div>`;
}

function renderProjectTasks(project, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const pt = tasks.filter(t => t.project === project && t.status !== 'done').slice(0, 8);
  if (!pt.length) { el.innerHTML = '<div class="empty-state"><p>No open tasks</p></div>'; return; }
  el.innerHTML = pt.map(t => `<div class="task-card" style="cursor:default">
    <div class="task-title">${esc(t.title)}</div>
    <div class="task-meta"><span class="task-assignee ${t.assignee}">${t.assignee === 'dorf' ? '🦡' : '👤'}</span><span class="task-priority ${t.priority}">${t.priority}</span></div>
  </div>`).join('');
}

async function dropTask(e) {
  e.preventDefault();
  const id = e.dataTransfer.getData('text/plain');
  const col = e.target.closest('.kanban-column');
  await api(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status: col.dataset.status }) });
  loadTasks();
}

let editingTaskId = null;
function openNewTaskModal() {
  editingTaskId = null;
  document.getElementById('modal-title').textContent = 'New Task';
  document.getElementById('task-form').reset();
  document.getElementById('delete-task-btn').style.display = 'none';
  document.getElementById('task-modal').classList.add('active');
}
function openEditTaskModal(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  editingTaskId = id;
  document.getElementById('modal-title').textContent = 'Edit Task';
  const f = document.getElementById('task-form');
  f.title.value = t.title || '';
  f.description.value = t.description || '';
  f.project.value = t.project || '';
  f.priority.value = t.priority || 'medium';
  f.assignee.value = t.assignee || 'unassigned';
  f.taskStatus.value = t.status || 'backlog';
  document.getElementById('delete-task-btn').style.display = 'inline-flex';
  document.getElementById('task-modal').classList.add('active');
}
function closeTaskModal() { document.getElementById('task-modal').classList.remove('active'); editingTaskId = null; }

async function submitTask(e) {
  e.preventDefault();
  const f = e.target;
  const data = { title: f.title.value, description: f.description.value, project: f.project.value, priority: f.priority.value, assignee: f.assignee.value, status: f.taskStatus.value };
  if (editingTaskId) await api(`/tasks/${editingTaskId}`, { method: 'PUT', body: JSON.stringify(data) });
  else await api('/tasks', { method: 'POST', body: JSON.stringify({ ...data, status: 'backlog' }) });
  closeTaskModal();
  loadTasks();
}

async function deleteTask() {
  if (!editingTaskId || !confirm('Delete this task?')) return;
  await api(`/tasks/${editingTaskId}`, { method: 'DELETE' });
  closeTaskModal();
  loadTasks();
}

// ===== News =====
async function loadNews() {
  news = await api('/news');
}

function renderNewsItems(items, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items?.length) { el.innerHTML = '<div class="empty-state"><p>No news</p></div>'; return; }
  el.innerHTML = items.slice(0, 8).map(i => `<div class="news-item">
    <a href="${i.url}" target="_blank" class="news-title">${esc(i.title)}</a>
    <div class="news-meta">${i.source || ''} ${i.published ? '· ' + i.published : ''}</div>
  </div>`).join('');
}
function renderAllNews() { renderNewsItems(news.cfd, 'news-cfd'); renderNewsItems(news.crypto, 'news-crypto'); renderNewsItems(news.ordinals, 'news-ordinals'); }
function renderCFDNews() { renderNewsItems(news.cfd, 'cfd-news'); }
function renderOrdinalsNews() { renderNewsItems(news.ordinals, 'ordinals-news'); }

// ===== Market =====
async function loadMarket() {
  market = await api('/market');
  tradfi = await api('/market/tradfi');
  renderPriceTicker();
  renderMarketTables();
}

function renderPriceTicker() {
  const el = document.getElementById('price-ticker');
  if (!el) return;
  if (!market?.length && !tradfi?.length) { el.innerHTML = '<div class="ticker-item">Loading...</div>'; return; }
  let items = [];
  (tradfi || []).slice(0, 4).forEach(t => {
    const c = t.change24h || 0;
    items.push(`<div class="ticker-item"><span class="ticker-symbol">${t.symbol}</span><span class="ticker-price">$${fmtPrice(t.price)}</span><span class="ticker-change ${c >= 0 ? 'positive' : 'negative'}">${c >= 0 ? '+' : ''}${c.toFixed(1)}%</span></div>`);
  });
  (market || []).slice(0, 6).forEach(c => {
    const ch = c.change24h || 0;
    items.push(`<div class="ticker-item"><span class="ticker-symbol">${c.symbol}</span><span class="ticker-price">$${fmtPrice(c.price)}</span><span class="ticker-change ${ch >= 0 ? 'positive' : 'negative'}">${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%</span></div>`);
  });
  el.innerHTML = items.join('');
}

function renderMarketTables() {
  renderMarketTable(market, 'crypto-market', false);
  renderMarketTable(tradfi, 'tradfi-market', true);
}

function renderMarketTable(data, id, isTradfi) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!data?.length) { el.innerHTML = '<div class="empty-state"><p>No data</p></div>'; return; }
  el.innerHTML = `<table class="data-table"><thead><tr><th>Asset</th><th style="text-align:right">Price</th><th style="text-align:right">24h</th></tr></thead><tbody>${
    data.slice(0, 15).map(i => {
      const c = i.change24h || 0;
      return `<tr><td><strong>${i.symbol}</strong> <span style="color:var(--text-muted);font-size:11px">${isTradfi ? i.name : ''}</span></td><td style="text-align:right">$${fmtPrice(i.price)}</td><td style="text-align:right" class="${c >= 0 ? 'positive' : 'negative'}">${c >= 0 ? '+' : ''}${c.toFixed(1)}%</td></tr>`;
    }).join('')
  }</tbody></table>`;
}

// ===== Portfolio =====
let portfolioData = null;
async function loadPortfolio() {
  portfolioData = await api('/portfolio');
  await loadTradFiAccounts();
  renderHoldings();
  renderProjectGoals('portfolio', 'portfolio-goals');
  renderMarketTables();
  // Auto-update portfolio recovery goal
  updatePortfolioGoal();
}

function togglePortfolioForm() {
  const el = document.getElementById('portfolio-form-container');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function addHolding() {
  const sym = document.getElementById('pf-symbol').value.trim();
  const name = document.getElementById('pf-name').value.trim();
  const amount = parseFloat(document.getElementById('pf-amount').value) || 0;
  const cost = parseFloat(document.getElementById('pf-cost').value) || 0;
  if (!sym) return;
  await api('/portfolio', { method: 'POST', body: JSON.stringify({ symbol: sym, name, amount, cost_basis: cost }) });
  document.getElementById('pf-symbol').value = '';
  document.getElementById('pf-name').value = '';
  document.getElementById('pf-amount').value = '';
  document.getElementById('pf-cost').value = '';
  togglePortfolioForm();
  loadPortfolio();
}

function renderHoldings() {
  const el = document.getElementById('holdings-table');
  if (!el || !portfolioData) return;
  const { holdings, crypto } = portfolioData;
  if (!holdings?.length) { el.innerHTML = '<div class="empty-state"><p>No holdings. Add some!</p></div>'; return; }

  let totalValue = 0, totalCost = 0;
  const rows = holdings.map(h => {
    const cm = crypto?.find(c => c.symbol.toLowerCase() === h.symbol.toLowerCase());
    const price = cm?.price || 0;
    const value = h.amount * price;
    const pnl = value - h.cost_basis;
    const pnlPct = h.cost_basis > 0 ? ((pnl / h.cost_basis) * 100) : 0;
    totalValue += value;
    totalCost += h.cost_basis;
    return { ...h, price, value, pnl, pnlPct };
  });

  el.innerHTML = `<table class="data-table"><thead><tr><th>Asset</th><th style="text-align:right">Amount</th><th style="text-align:right">Price</th><th style="text-align:right">Value</th><th style="text-align:right">P&L</th><th></th></tr></thead><tbody>${
    rows.map(r => `<tr>
      <td><strong>${r.symbol.toUpperCase()}</strong> <span style="color:var(--text-muted);font-size:11px">${r.name || ''}</span></td>
      <td style="text-align:right">${r.amount}</td>
      <td style="text-align:right">$${fmtPrice(r.price)}</td>
      <td style="text-align:right">$${r.value.toFixed(2)}</td>
      <td style="text-align:right" class="${r.pnl >= 0 ? 'positive' : 'negative'}">${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(2)} (${r.pnlPct.toFixed(1)}%)</td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteHolding(${r.id})" title="Remove"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`).join('')
  }</tbody></table>`;

  // P&L Summary — combined crypto + tradfi
  const tradfiValue = tradfiAccounts.reduce((sum, a) => sum + (a.total_balance || 0), 0);
  const tradfiCost = tradfiAccounts.reduce((sum, a) => sum + (a.cost_basis || 0), 0);
  const combinedValue = totalValue + tradfiValue;
  const combinedCost = totalCost + tradfiCost;
  const combinedPnl = combinedValue - combinedCost;
  const pnlEl = document.getElementById('pnl-summary');
  if (pnlEl) {
    pnlEl.innerHTML = `
      <div style="text-align:center;padding:20px">
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:4px">Total Portfolio Value</div>
        <div style="font-size:28px;font-weight:800;color:var(--accent-blue)">$${combinedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Crypto: $${totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })} · TradFi: $${tradfiValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:16px;margin-bottom:4px">Total P&L</div>
        <div style="font-size:24px;font-weight:700" class="${combinedPnl >= 0 ? 'positive' : 'negative'}">${combinedPnl >= 0 ? '+' : ''}$${combinedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Cost basis: $${combinedCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
      </div>
    `;
  }

  // Allocation chart — include tradfi accounts
  const allAllocations = [
    ...rows.map(r => ({ label: r.symbol.toUpperCase(), value: r.value })),
    ...(tradfiAccounts || []).map(a => ({ label: a.account_name, value: a.total_balance }))
  ];
  renderAllocationChart(allAllocations);
}

function renderAllocationChart(items) {
  const canvas = document.getElementById('chart-allocation');
  if (!canvas) return;
  if (charts.allocation) charts.allocation.destroy();
  const data = items.filter(i => i.value > 0);
  if (!data.length) return;
  const colors = ['#58a6ff', '#3fb950', '#a371f7', '#d29922', '#f85149', '#db6d28', '#39d2c0', '#8b949e', '#e3b341', '#56d4dd', '#f778ba', '#7ee787'];
  charts.allocation = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(i => i.label),
      datasets: [{ data: data.map(i => i.value), backgroundColor: colors.slice(0, data.length), borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: '#8b949e', font: { size: 11 } } } }
    }
  });
}

async function deleteHolding(id) {
  if (!confirm('Remove this holding?')) return;
  await api(`/portfolio/${id}`, { method: 'DELETE' });
  loadPortfolio();
}

// ===== Traditional / TradFi Accounts =====
let tradfiAccounts = [];

function toggleTradFiForm() {
  const el = document.getElementById('tradfi-form-container');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function loadTradFiAccounts() {
  tradfiAccounts = await api('/portfolio/traditional');
  renderTradFiHoldings();
}

async function addTradFiAccount() {
  const name = document.getElementById('tf-name').value.trim();
  const balance = parseFloat(document.getElementById('tf-balance').value) || 0;
  const cost = parseFloat(document.getElementById('tf-cost').value) || 0;
  const desc = document.getElementById('tf-desc').value.trim();
  if (!name) return;
  await api('/portfolio/traditional', { method: 'POST', body: JSON.stringify({ account_name: name, total_balance: balance, cost_basis: cost, description: desc }) });
  document.getElementById('tf-name').value = '';
  document.getElementById('tf-balance').value = '';
  document.getElementById('tf-cost').value = '';
  document.getElementById('tf-desc').value = '';
  toggleTradFiForm();
  loadPortfolio();
}

async function updateTradFiBalance(id) {
  const input = document.getElementById(`tf-bal-${id}`);
  const newBal = parseFloat(input.value);
  if (isNaN(newBal)) return;
  await api(`/portfolio/traditional/${id}`, { method: 'PUT', body: JSON.stringify({ total_balance: newBal }) });
  showToast('Balance updated');
  loadPortfolio();
}

async function deleteTradFiAccount(id) {
  if (!confirm('Remove this account?')) return;
  await api(`/portfolio/traditional/${id}`, { method: 'DELETE' });
  loadPortfolio();
}

function renderTradFiHoldings() {
  const el = document.getElementById('tradfi-holdings-table');
  if (!el) return;
  if (!tradfiAccounts?.length) { el.innerHTML = '<div class="empty-state"><p>No traditional accounts. Add your brokerage, 401k, etc.</p></div>'; return; }

  let totalValue = 0, totalCost = 0;
  tradfiAccounts.forEach(a => { totalValue += a.total_balance; totalCost += a.cost_basis; });
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0;

  el.innerHTML = `<table class="data-table"><thead><tr><th>Account</th><th style="text-align:right">Balance</th><th style="text-align:right">Cost Basis</th><th style="text-align:right">P&L</th><th style="text-align:right">Update</th><th></th></tr></thead><tbody>${
    tradfiAccounts.map(a => {
      const pnl = a.total_balance - a.cost_basis;
      const pnlPct = a.cost_basis > 0 ? ((pnl / a.cost_basis) * 100) : 0;
      return `<tr>
        <td><strong>${esc(a.account_name)}</strong>${a.description ? ` <span style="color:var(--text-muted);font-size:11px">${esc(a.description)}</span>` : ''}</td>
        <td style="text-align:right">$${a.total_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="text-align:right">$${a.cost_basis.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="text-align:right" class="${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)</td>
        <td style="text-align:right"><div style="display:flex;gap:4px;justify-content:flex-end"><input type="number" id="tf-bal-${a.id}" class="input" style="width:120px;margin:0;padding:4px 8px;font-size:12px" value="${a.total_balance}" step="any"><button class="btn btn-sm" onclick="updateTradFiBalance(${a.id})" title="Update"><i class="fa-solid fa-check"></i></button></div></td>
        <td><button class="btn btn-sm btn-danger" onclick="deleteTradFiAccount(${a.id})" title="Remove"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`;
    }).join('')
  }
  <tr style="border-top:2px solid var(--border-color);font-weight:700">
    <td>Total Traditional</td>
    <td style="text-align:right">$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    <td style="text-align:right">$${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    <td style="text-align:right" class="${totalPnl >= 0 ? 'positive' : 'negative'}">${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)} (${totalPnlPct.toFixed(1)}%)</td>
    <td colspan="2"></td>
  </tr></tbody></table>`;
}

// ===== Auto-update Portfolio Recovery Goal =====
async function updatePortfolioGoal() {
  if (!portfolioData || !goals.length) return;
  const { holdings, crypto } = portfolioData;

  // Compute crypto value
  let cryptoValue = 0;
  (holdings || []).forEach(h => {
    const cm = (crypto || []).find(c => c.symbol.toLowerCase() === h.symbol.toLowerCase());
    cryptoValue += h.amount * (cm?.price || 0);
  });

  // Compute tradfi value
  const tradfiValue = (tradfiAccounts || []).reduce((sum, a) => sum + (a.total_balance || 0), 0);
  const totalValue = cryptoValue + tradfiValue;

  // Update portfolio recovery goal (target: $2M)
  const portfolioGoal = goals.find(g => g.project === 'portfolio');
  if (portfolioGoal) {
    const target = 2000000;
    const pct = Math.min(100, Math.round((totalValue / target) * 100));
    // Only update if value changed
    if (portfolioGoal.target_value !== target || Math.abs(portfolioGoal.current_value - pct) >= 1) {
      await api(`/goals/${portfolioGoal.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          current_value: pct,
          target_value: 100,
          goal: 'Portfolio Recovery',
          description: `$${totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })} / $2,000,000 target`
        })
      });
      await loadGoals();
    }
  }
}

// ===== Activity Feed =====
async function loadActivity() {
  const [dbActivity, sessionActivity] = await Promise.all([
    api('/activity?limit=15'),
    api('/agent/activity?limit=15')
  ]);

  // Merge
  const merged = [
    ...dbActivity.map(a => ({ ...a, source: 'db', ts: new Date(a.created_at).getTime() })),
    ...sessionActivity.map(a => ({ ...a, source: 'session', ts: new Date(a.timestamp).getTime(), created_at: a.timestamp }))
  ];
  merged.sort((a, b) => b.ts - a.ts);
  renderActivity(merged.slice(0, 20));
}

function renderActivity(items) {
  const el = document.getElementById('activity-feed');
  if (!el) return;
  if (!items?.length) { el.innerHTML = '<div class="empty-state"><p>No recent activity</p></div>'; return; }
  el.innerHTML = items.map(i => {
    const icon = i.source === 'session'
      ? (i.type === 'tool_call' ? '🔧' : i.role === 'user' ? '👤' : '🦡')
      : getActivityIcon(i.type);
    const roleTag = i.role ? `<span class="activity-role">${i.role}</span>` : '';
    return `<div class="activity-item">
      <div class="activity-icon">${icon}</div>
      <div class="activity-content">
        <div class="activity-message">${roleTag}${esc(i.message)}</div>
        <div class="activity-time">${formatTime(i.created_at || i.timestamp)}</div>
      </div>
    </div>`;
  }).join('');
}

function getActivityIcon(type) {
  return { task_created: '➕', task_updated: '✏️', task_assigned: '🦡', command_sent: '📡' }[type] || '📌';
}

// ===== Git Activity =====
async function loadGitActivity() {
  const commits = await api('/system/git');
  const el = document.getElementById('git-feed');
  if (!el) return;
  if (!commits?.length) { el.innerHTML = '<div class="empty-state"><i class="fa-brands fa-git-alt"></i><p>No git repos found</p></div>'; return; }
  el.innerHTML = commits.map(c => `<div class="commit-item">
    <span class="commit-hash">${c.hash}</span>
    <div style="min-width:0;flex:1">
      <div class="commit-msg">${esc(c.message)}</div>
      <div><span class="commit-repo">${c.repo}</span> <span class="commit-time">${c.author} · ${formatTime(c.date)}</span></div>
    </div>
  </div>`).join('');
}

// ===== Sessions =====
async function loadSessions() {
  sessions = await api('/agent/sessions');
  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  renderSessionList(sessions);
}

function renderSessionList(list) {
  document.getElementById('session-list-container').style.display = 'block';
  document.getElementById('session-detail').style.display = 'none';
  const el = document.getElementById('session-list');
  if (!list?.length) { el.innerHTML = '<div class="empty-state"><p>No sessions</p></div>'; return; }
  el.innerHTML = list.map(s => `<div class="session-item" onclick="viewSession('${s.sessionId}')">
    <div>
      <div class="session-name">${esc(s.label || s.key)}</div>
      <div class="session-meta">${s.chatType || ''} · ${s.lastChannel || ''}</div>
    </div>
    <div class="session-meta">${s.updatedAt ? formatTime(s.updatedAt) : ''}</div>
  </div>`).join('');
}

function filterSessions() {
  const q = document.getElementById('session-search').value.toLowerCase();
  const filtered = sessions.filter(s => (s.label || s.key).toLowerCase().includes(q) || (s.lastChannel || '').toLowerCase().includes(q));
  renderSessionList(filtered);
}

async function viewSession(id) {
  currentSessionId = id;
  const msgs = await api(`/agent/session/${id}`);
  allSessionMessages = msgs;
  document.getElementById('session-list-container').style.display = 'none';
  document.getElementById('session-detail').style.display = 'block';
  renderChatMessages(msgs);
}

function backToSessions() {
  document.getElementById('session-list-container').style.display = 'block';
  document.getElementById('session-detail').style.display = 'none';
  currentSessionId = null;
}

function renderChatMessages(msgs) {
  const el = document.getElementById('chat-messages');
  const chatMsgs = msgs.filter(m => m.type === 'message' && m.message);
  if (!chatMsgs.length) { el.innerHTML = '<div class="empty-state"><p>Empty session</p></div>'; return; }
  el.innerHTML = chatMsgs.map(m => {
    const msg = m.message;
    const role = msg.role || 'unknown';
    let content = '';
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          content += formatChatText(block.text);
        } else if (block.type === 'toolCall') {
          content += `<div class="tool-call-tag"><i class="fa-solid fa-wrench"></i> ${block.name}()</div>`;
        } else if (block.type === 'toolResult') {
          const txt = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
          content += `<pre>${esc(txt?.substring(0, 500) || '')}</pre>`;
        }
      }
    } else if (typeof msg.content === 'string') {
      content = formatChatText(msg.content);
    }
    if (!content.trim()) return '';
    const modelTag = msg.model ? `<span class="model-tag">${msg.model}</span>` : '';
    return `<div class="chat-message ${role}" data-text="${esc((content || '').toLowerCase())}">
      <div class="chat-role">${role} ${modelTag}</div>
      <div class="chat-content">${content}</div>
      <div class="chat-time">${m.timestamp || ''}</div>
    </div>`;
  }).filter(Boolean).join('');
}

function filterChat() {
  const q = document.getElementById('chat-search').value.toLowerCase();
  document.querySelectorAll('#chat-messages .chat-message').forEach(el => {
    el.style.display = (el.dataset.text || '').includes(q) ? '' : 'none';
  });
}

function formatChatText(text) {
  // Basic markdown-like formatting
  let html = esc(text);
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // Newlines
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ===== Usage / Costs =====
async function loadUsage() {
  usageData = await api('/agent/usage');
  if (!usageData) return;

  document.getElementById('usage-total-cost').textContent = '$' + usageData.totalCost.toFixed(2);
  document.getElementById('usage-total-input').textContent = fmtTokens(usageData.totalInput);
  document.getElementById('usage-total-output').textContent = fmtTokens(usageData.totalOutput);

  // Today's cost for overview
  const today = new Date().toISOString().split('T')[0];
  const todayData = usageData.daily.find(d => d.date === today);
  document.getElementById('stat-cost-today').textContent = '$' + (todayData?.cost || 0).toFixed(2);

  renderDailyCostChart();
  renderModelTokensChart();
  renderModelBreakdownTable();
}

function renderDailyCostChart() {
  const canvas = document.getElementById('chart-daily-cost');
  if (!canvas || !usageData?.daily?.length) return;
  if (charts.dailyCost) charts.dailyCost.destroy();
  const last14 = usageData.daily.slice(-14);
  charts.dailyCost = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: last14.map(d => d.date.slice(5)),
      datasets: [{ label: 'Cost ($)', data: last14.map(d => d.cost), backgroundColor: 'rgba(88,166,255,0.5)', borderColor: '#58a6ff', borderWidth: 1, borderRadius: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { display: false }, ticks: { color: '#5a6572', font: { size: 10 } } }, y: { grid: { color: '#1e2a3a' }, ticks: { color: '#5a6572', callback: v => '$' + v.toFixed(2) } } },
      plugins: { legend: { display: false } }
    }
  });
}

function renderModelTokensChart() {
  const canvas = document.getElementById('chart-model-tokens');
  if (!canvas || !usageData?.models) return;
  if (charts.modelTokens) charts.modelTokens.destroy();
  const models = Object.entries(usageData.models).sort((a, b) => b[1].cost - a[1].cost);
  const colors = ['#58a6ff', '#3fb950', '#a371f7', '#d29922', '#f85149', '#db6d28', '#39d2c0'];
  charts.modelTokens = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: models.map(([, v]) => v.displayName),
      datasets: [
        { label: 'Input', data: models.map(([, v]) => v.input), backgroundColor: 'rgba(88,166,255,0.6)', borderRadius: 3 },
        { label: 'Output', data: models.map(([, v]) => v.output), backgroundColor: 'rgba(163,113,247,0.6)', borderRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      scales: { x: { grid: { color: '#1e2a3a' }, ticks: { color: '#5a6572', callback: v => fmtTokens(v) } }, y: { grid: { display: false }, ticks: { color: '#8b949e', font: { size: 11 } } } },
      plugins: { legend: { labels: { color: '#8b949e', font: { size: 11 } } } }
    }
  });
}

function renderModelBreakdownTable() {
  const el = document.getElementById('model-breakdown-table');
  if (!el || !usageData?.models) return;
  const models = Object.entries(usageData.models).sort((a, b) => b[1].cost - a[1].cost);
  el.innerHTML = `<thead><tr><th>Model</th><th style="text-align:right">Messages</th><th style="text-align:right">Input</th><th style="text-align:right">Output</th><th style="text-align:right">Cost</th></tr></thead>
  <tbody>${models.map(([k, v]) => `<tr><td><strong>${v.displayName}</strong> <span style="color:var(--text-muted);font-size:10px">${k}</span></td><td style="text-align:right">${v.count}</td><td style="text-align:right">${fmtTokens(v.input)}</td><td style="text-align:right">${fmtTokens(v.output)}</td><td style="text-align:right">$${v.cost.toFixed(4)}</td></tr>`).join('')}</tbody>`;
}

// ===== Cron Jobs =====
async function loadCron() {
  const jobs = await api('/agent/cron');
  const el = document.getElementById('cron-list');
  if (!el) return;
  if (!jobs?.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-clock"></i><p>No cron jobs configured</p></div>'; return; }
  el.innerHTML = jobs.map(j => `<div class="cron-item">
    <div class="cron-status ${j.status === 'ok' ? 'ok' : j.status === 'error' ? 'error' : 'unknown'}"></div>
    <div style="flex:1;min-width:0">
      <div class="cron-name">${esc(j.name || j.id || 'Unknown')}</div>
      <div class="cron-schedule">${esc(j.schedule || '')}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:12px;color:var(--text-secondary)">${esc(j.next || '')}</div>
      <div style="font-size:10px;color:var(--text-muted)">Last: ${esc(j.last || 'never')}</div>
    </div>
  </div>`).join('');
}

// ===== Research Notes =====
async function loadNotes() {
  const files = await api('/workspace/markdown');
  const el = document.getElementById('md-file-list');
  if (!el) return;
  if (!files?.length) { el.innerHTML = '<div class="empty-state"><p>No markdown files</p></div>'; return; }
  el.innerHTML = files.sort((a, b) => b.modified.localeCompare?.(a.modified) || 0).slice(0, 50).map(f =>
    `<div class="file-item" onclick="viewNote('${esc(f.path)}')">
      <span class="file-icon">📝</span>
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-meta">${formatBytes(f.size)}</span>
    </div>`
  ).join('');
}

async function loadCFDNotes() {
  const files = await api('/workspace/markdown');
  const cfdFiles = (files || []).filter(f => f.path.toLowerCase().includes('cfd') || f.path.toLowerCase().includes('folate'));
  const el = document.getElementById('cfd-notes');
  if (!el) return;
  if (!cfdFiles.length) { el.innerHTML = '<div class="empty-state"><p>No CFD notes found</p></div>'; return; }
  el.innerHTML = cfdFiles.slice(0, 10).map(f =>
    `<div class="file-item" onclick="navigateTo('notes');setTimeout(()=>viewNote('${esc(f.path)}'),100)">
      <span class="file-icon">📝</span><span class="file-name">${esc(f.name)}</span>
    </div>`
  ).join('');
}

async function viewNote(path) {
  const data = await api(`/workspace/file?path=${encodeURIComponent(path)}`);
  const el = document.getElementById('md-content');
  if (!el) return;
  if (data.error) { el.innerHTML = `<div class="empty-state"><p>${data.error}</p></div>`; return; }
  el.innerHTML = renderMarkdown(data.content);
}

function renderMarkdown(text) {
  // Simple markdown to HTML
  let html = esc(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return '<div class="markdown-content"><p>' + html + '</p></div>';
}

// ===== Notifications =====
async function loadNotifications() {
  const data = await api('/notifications/unread');
  const badge = document.getElementById('notif-badge');
  if (data.count > 0) {
    badge.textContent = data.count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function toggleNotifications() {
  const panel = document.getElementById('notification-panel');
  const isOpen = panel.classList.toggle('open');
  if (isOpen) loadNotificationList();
}

async function loadNotificationList() {
  const notifs = await api('/notifications?limit=20');
  const el = document.getElementById('notif-list');
  if (!notifs?.length) { el.innerHTML = '<div class="empty-state" style="padding:20px"><p>No notifications</p></div>'; return; }
  el.innerHTML = notifs.map(n => `<div class="notif-item ${n.read ? '' : 'unread'}" onclick="markNotifRead(${n.id})">
    <div class="notif-title">${esc(n.title)}</div>
    ${n.message ? `<div class="notif-msg">${esc(n.message)}</div>` : ''}
    <div class="notif-time">${formatTime(n.created_at)}</div>
  </div>`).join('');
}

async function markNotifRead(id) {
  await api(`/notifications/${id}/read`, { method: 'PUT' });
  loadNotifications();
  loadNotificationList();
}

async function markAllRead() {
  await api('/notifications/read-all', { method: 'PUT' });
  loadNotifications();
  loadNotificationList();
}

// Close notification panel on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.notification-bell') && !e.target.closest('#notification-panel')) {
    document.getElementById('notification-panel')?.classList.remove('open');
  }
});

// ===== Files =====
async function loadFiles() {
  files = await api('/files');
  renderFiles();
}

function renderFiles() {
  const el = document.getElementById('file-list');
  if (!el) return;
  if (!files?.length) { el.innerHTML = '<div class="empty-state"><p>No files</p></div>'; return; }
  const grouped = {};
  files.forEach(f => {
    const dir = f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : 'root';
    if (!grouped[dir]) grouped[dir] = [];
    grouped[dir].push(f);
  });
  el.innerHTML = Object.entries(grouped).slice(0, 20).map(([dir, fs]) => `
    <div style="margin-bottom:16px">
      <h4 style="color:var(--text-muted);font-size:11px;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">📁 ${dir}</h4>
      ${fs.slice(0, 10).map(f => `<div class="file-item"><span class="file-icon">${getFileIcon(f.name)}</span><span class="file-name">${f.name}</span><span class="file-meta">${formatBytes(f.size)}</span></div>`).join('')}
    </div>
  `).join('');
}

// ===== Overview =====
async function renderOverview() {
  renderPriceTicker();
  renderGoalsOverview();
  loadNotifications();
  if (usageData) {
    const today = new Date().toISOString().split('T')[0];
    const td = usageData.daily.find(d => d.date === today);
    document.getElementById('stat-cost-today').textContent = '$' + (td?.cost || 0).toFixed(2);
  } else {
    // Quick load for cost stat
    api('/agent/usage').then(d => {
      if (!d) return;
      usageData = d;
      const today = new Date().toISOString().split('T')[0];
      const td = d.daily.find(x => x.date === today);
      document.getElementById('stat-cost-today').textContent = '$' + (td?.cost || 0).toFixed(2);
    });
  }
}

// ===== Helpers =====
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

function formatBytes(b) {
  if (!b) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}

function fmtPrice(p) {
  if (!p) return '0';
  return p < 1 ? p.toFixed(4) : p.toLocaleString('en-US', { maximumFractionDigits: p < 100 ? 2 : 0 });
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  return { md: '📝', json: '📋', js: '📜', ts: '📜', py: '🐍', html: '🌐', css: '🎨', pdf: '📕', png: '🖼️', jpg: '🖼️', txt: '📄', sh: '⚙️' }[ext] || '📄';
}

// ===== Boot =====
checkAuth();
