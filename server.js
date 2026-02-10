require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = require('./src/db/schema');
const { getCryptoMarket, getTradFiMarket, getTickerPrices } = require('./src/services/market');
const { getAllNews, fetchPubMedCFD, fetchBraveNews } = require('./src/services/news');
const {
  getAgentStatus, getSessions, sendTask,
  getSessionLog, getUsageStats, getActivityFromSessions,
  getCronJobs
} = require('./src/services/openclaw');
const { getSystemHealth, getGitActivity, getWorkspaceFiles, readMarkdownFile } = require('./src/services/system');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'dorf2026';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Auth middleware
const authMiddleware = (req, res, next) => {
  if (req.path === '/auth') return next();
  const authHeader = req.headers.authorization;
  const cookieAuth = req.headers.cookie?.split(';').find(c => c.trim().startsWith('mc_auth='));
  if (authHeader === `Bearer ${APP_PASSWORD}` ||
      cookieAuth?.split('=')[1]?.trim() === APP_PASSWORD ||
      req.query.auth === APP_PASSWORD) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
};

app.use('/api', authMiddleware);

// ===== Auth =====
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    res.json({ success: true, token: APP_PASSWORD });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// ===== Agent Status =====
app.get('/api/agent/status', async (req, res) => {
  res.json(await getAgentStatus());
});

app.get('/api/agent/sessions', async (req, res) => {
  res.json(await getSessions());
});

app.get('/api/agent/session/:id', (req, res) => {
  res.json(getSessionLog(req.params.id));
});

app.get('/api/agent/usage', (req, res) => {
  res.json(getUsageStats());
});

app.get('/api/agent/activity', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json(getActivityFromSessions(limit));
});

app.get('/api/agent/cron', (req, res) => {
  res.json(getCronJobs());
});

// ===== Quick Command =====
app.post('/api/command', async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Command required' });
  const success = await sendTask(command);
  db.prepare('INSERT INTO command_history (command, status) VALUES (?, ?)').run(command, success ? 'sent' : 'failed');
  db.prepare('INSERT INTO activity_log (type, message, metadata) VALUES (?, ?, ?)')
    .run('command_sent', `Command sent: ${command.substring(0, 80)}`, JSON.stringify({ command }));
  broadcast({ type: 'activity' });
  res.json({ success });
});

app.get('/api/command/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json(db.prepare('SELECT * FROM command_history ORDER BY created_at DESC LIMIT ?').all(limit));
});

// ===== Tasks =====
app.get('/api/tasks', (req, res) => {
  res.json(db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all());
});

app.post('/api/tasks', (req, res) => {
  const { title, description, status, priority, assignee, project, due_date } = req.body;
  const result = db.prepare(`
    INSERT INTO tasks (title, description, status, priority, assignee, project, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, description, status || 'backlog', priority || 'medium', assignee || 'unassigned', project, due_date);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  db.prepare('INSERT INTO activity_log (type, message, metadata) VALUES (?, ?, ?)')
    .run('task_created', `Task created: ${title}`, JSON.stringify({ taskId: task.id }));
  broadcast({ type: 'task_created', task });
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const { id } = req.params;
  const { title, description, status, priority, assignee, project, due_date } = req.body;
  const oldTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  db.prepare(`
    UPDATE tasks SET
      title = COALESCE(?, title), description = COALESCE(?, description),
      status = COALESCE(?, status), priority = COALESCE(?, priority),
      assignee = COALESCE(?, assignee), project = COALESCE(?, project),
      due_date = COALESCE(?, due_date), updated_at = CURRENT_TIMESTAMP,
      completed_at = CASE WHEN ? = 'done' THEN CURRENT_TIMESTAMP ELSE completed_at END
    WHERE id = ?
  `).run(title, description, status, priority, assignee, project, due_date, status, id);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (assignee === 'dorf' && oldTask?.assignee !== 'dorf') {
    sendTask(`New task assigned to you: "${task.title}" - ${task.description || 'No description'}`);
    db.prepare('INSERT INTO activity_log (type, message, metadata) VALUES (?, ?, ?)')
      .run('task_assigned', `Task assigned to Dorf: ${task.title}`, JSON.stringify({ taskId: task.id }));
  }
  broadcast({ type: 'task_updated', task });
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  broadcast({ type: 'task_deleted', taskId: req.params.id });
  res.json({ success: true });
});

// ===== Portfolio =====
app.get('/api/portfolio', async (req, res) => {
  const holdings = db.prepare('SELECT * FROM portfolio').all();
  const crypto = await getCryptoMarket();
  res.json({ holdings, crypto });
});

app.post('/api/portfolio', (req, res) => {
  const { symbol, name, amount, cost_basis } = req.body;
  try {
    db.prepare(`
      INSERT INTO portfolio (symbol, name, amount, cost_basis)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        amount = excluded.amount, cost_basis = excluded.cost_basis
    `).run(symbol.toLowerCase(), name, amount || 0, cost_basis || 0);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/portfolio/:id', (req, res) => {
  const { symbol, name, amount, cost_basis } = req.body;
  try {
    db.prepare('UPDATE portfolio SET symbol=?, name=?, amount=?, cost_basis=? WHERE id=?')
      .run(symbol?.toLowerCase(), name, amount, cost_basis, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/portfolio/:id', (req, res) => {
  db.prepare('DELETE FROM portfolio WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== Traditional Portfolio (Stocks/ETFs - Total Balance Only) =====
app.get('/api/portfolio/traditional', (req, res) => {
  res.json(db.prepare('SELECT * FROM portfolio_traditional ORDER BY account_name').all());
});

app.post('/api/portfolio/traditional', (req, res) => {
  const { account_name, total_balance, cost_basis, description } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO portfolio_traditional (account_name, total_balance, cost_basis, description)
      VALUES (?, ?, ?, ?)
    `).run(account_name, total_balance || 0, cost_basis || 0, description);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/portfolio/traditional/:id', (req, res) => {
  const { account_name, total_balance, cost_basis, description } = req.body;
  try {
    db.prepare(`
      UPDATE portfolio_traditional 
      SET account_name=COALESCE(?,account_name), 
          total_balance=COALESCE(?,total_balance), 
          cost_basis=COALESCE(?,cost_basis), 
          description=COALESCE(?,description),
          updated_at=CURRENT_TIMESTAMP 
      WHERE id=?
    `).run(account_name, total_balance, cost_basis, description, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/portfolio/traditional/:id', (req, res) => {
  db.prepare('DELETE FROM portfolio_traditional WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== Market =====
app.get('/api/market', async (req, res) => {
  try { res.json(await getCryptoMarket()); }
  catch (err) { res.json([]); }
});

app.get('/api/market/tradfi', async (req, res) => {
  try { res.json(await getTradFiMarket()); }
  catch (err) { res.json([]); }
});

app.get('/api/ticker', async (req, res) => {
  try { res.json(await getTickerPrices()); }
  catch (err) { res.json({ crypto: [], tradfi: [] }); }
});

// ===== News =====
app.get('/api/news', async (req, res) => { res.json(await getAllNews()); });
app.get('/api/news/cfd', async (req, res) => { res.json(await fetchPubMedCFD()); });
app.get('/api/news/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  res.json(await fetchBraveNews(q, 10));
});

// ===== Goals =====
app.get('/api/goals', (req, res) => {
  res.json(db.prepare('SELECT * FROM goals ORDER BY project, id').all());
});

app.put('/api/goals/:id', (req, res) => {
  const { current_value, goal, target_value, description } = req.body;
  db.prepare(`
    UPDATE goals SET current_value=COALESCE(?,current_value), goal=COALESCE(?,goal),
    target_value=COALESCE(?,target_value), description=COALESCE(?,description),
    updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(current_value, goal, target_value, description, req.params.id);
  res.json(db.prepare('SELECT * FROM goals WHERE id=?').get(req.params.id));
});

app.post('/api/goals', (req, res) => {
  const { goal, target_value, current_value, unit, project, description } = req.body;
  const result = db.prepare('INSERT INTO goals (goal, target_value, current_value, unit, project, description) VALUES (?,?,?,?,?,?)')
    .run(goal, target_value || 100, current_value || 0, unit || '%', project, description);
  res.json(db.prepare('SELECT * FROM goals WHERE id=?').get(result.lastInsertRowid));
});

// ===== System =====
app.get('/api/system/health', (req, res) => { res.json(getSystemHealth()); });
app.get('/api/system/git', (req, res) => { res.json(getGitActivity()); });

// ===== Activity Log =====
app.get('/api/activity', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit));
});

// ===== Notifications =====
app.get('/api/notifications', (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  res.json(db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?').all(limit));
});

app.get('/api/notifications/unread', (req, res) => {
  res.json({ count: db.prepare('SELECT COUNT(*) as c FROM notifications WHERE read=0').get().c });
});

app.put('/api/notifications/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.put('/api/notifications/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE read=0').run();
  res.json({ success: true });
});

// ===== Workspace / Research Notes =====
app.get('/api/workspace/markdown', (req, res) => {
  const workspacePath = process.env.WORKSPACE_PATH || '/home/pro/.openclaw/workspace';
  res.json(getWorkspaceFiles(workspacePath, '.md'));
});

app.get('/api/workspace/file', (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'Path required' });
  const workspacePath = process.env.WORKSPACE_PATH || '/home/pro/.openclaw/workspace';
  const fullPath = path.resolve(workspacePath, filePath);
  // Ensure path is within workspace
  if (!fullPath.startsWith(workspacePath)) return res.status(403).json({ error: 'Forbidden' });
  const content = readMarkdownFile(fullPath);
  if (content === null) return res.status(404).json({ error: 'Not found' });
  res.json({ content, path: filePath });
});

// ===== Files =====
app.get('/api/files', (req, res) => {
  const workspacePath = process.env.WORKSPACE_PATH || '/home/pro/.openclaw/workspace';
  const files = [];
  function scanDir(dir, relativePath = '') {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(relativePath, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          scanDir(fullPath, relPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          files.push({ name: entry.name, path: relPath, fullPath, size: stat.size, modified: stat.mtime });
        }
      }
    } catch (err) {}
  }
  scanDir(workspacePath);
  res.json(files);
});

// ===== WebSocket =====
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) client.send(message);
  });
}

// Periodic broadcasts
setInterval(async () => {
  const status = await getAgentStatus();
  broadcast({ type: 'agent_status', status });
}, 30000);

setInterval(() => {
  broadcast({ type: 'system_health', data: getSystemHealth() });
}, 60000);

// ===== Start =====
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Mission Control running at http://0.0.0.0:${PORT}`);
});

module.exports = { app, broadcast };
