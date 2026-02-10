const fetch = require('node-fetch');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const SESSIONS_DIR = path.join(process.env.HOME || '/home/pro', '.openclaw/agents/main/sessions');
const SESSIONS_JSON = path.join(SESSIONS_DIR, 'sessions.json');

// Model cost rates per million tokens (input/output)
const MODEL_COSTS = {
  'claude-opus-4-6': { input: 15, output: 75, name: 'Opus' },
  'claude-sonnet-4-20250514': { input: 3, output: 15, name: 'Sonnet' },
  'claude-haiku-3-5-20241022': { input: 0.25, output: 1.25, name: 'Haiku' },
  'gemini-2.5-pro': { input: 1.25, output: 10, name: 'Gemini Pro' },
  'gemini-2.5-flash': { input: 0.15, output: 0.60, name: 'Gemini Flash' },
  'grok-3': { input: 3, output: 15, name: 'Grok' },
  'grok-4-1-fast-reasoning': { input: 3, output: 15, name: 'Grok' },
  'kimi-k2.5': { input: 0.60, output: 2.40, name: 'Kimi' },
};

function matchModelCost(modelName) {
  if (!modelName) return { input: 3, output: 15, name: 'Unknown' };
  const lower = modelName.toLowerCase();
  if (lower.includes('opus')) return MODEL_COSTS['claude-opus-4-6'];
  if (lower.includes('sonnet')) return MODEL_COSTS['claude-sonnet-4-20250514'];
  if (lower.includes('haiku')) return MODEL_COSTS['claude-haiku-3-5-20241022'];
  if (lower.includes('gemini') && lower.includes('pro')) return MODEL_COSTS['gemini-2.5-pro'];
  if (lower.includes('gemini') && lower.includes('flash')) return MODEL_COSTS['gemini-2.5-flash'];
  if (lower.includes('grok')) return MODEL_COSTS['grok-4-1-fast-reasoning'];
  if (lower.includes('kimi')) return MODEL_COSTS['kimi-k2.5'];
  // Skip non-model entries
  if (['unknown', 'gateway-injected', 'delivery-mirror'].includes(lower)) return { input: 0, output: 0, name: modelName };
  return { input: 3, output: 15, name: modelName };
}

async function getAgentStatus() {
  try {
    const res = await fetch(GATEWAY_URL, { timeout: 5000 });
    if (!res.ok) return { online: false, working: false, status: 'offline' };

    let lastActivity = null;
    let isWorking = false;
    let activeModel = null;
    let activeSessionCount = 0;
    let recentActions = [];

    try {
      if (fs.existsSync(SESSIONS_JSON)) {
        const sessions = JSON.parse(fs.readFileSync(SESSIONS_JSON, 'utf8'));
        let maxUpdated = 0;
        for (const [key, session] of Object.entries(sessions)) {
          if (session.updatedAt) {
            activeSessionCount++;
            if (session.updatedAt > maxUpdated) {
              maxUpdated = session.updatedAt;
            }
          }
        }
        if (maxUpdated > 0) {
          lastActivity = new Date(maxUpdated).toISOString();
          isWorking = (Date.now() - maxUpdated) < 30000;
        }

        // Parse recent JSONL for model and actions
        const recent = getRecentMessages(3);
        for (const msg of recent) {
          if (msg.message?.model) activeModel = msg.message.model;
          if (msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'toolCall') {
                recentActions.push({
                  tool: block.name,
                  time: msg.timestamp,
                  args: typeof block.arguments === 'object' ? Object.keys(block.arguments).join(',') : ''
                });
              }
            }
          }
        }
      }
    } catch (e) { /* ignore */ }

    return {
      online: true,
      working: isWorking,
      lastActivity: lastActivity || new Date().toISOString(),
      status: isWorking ? 'working' : 'idle',
      activeModel,
      activeSessionCount,
      recentActions: recentActions.slice(0, 5)
    };
  } catch (err) {
    return { online: false, working: false, status: 'offline', error: err.message };
  }
}

async function getSessions() {
  try {
    if (!fs.existsSync(SESSIONS_JSON)) return [];
    const sessions = JSON.parse(fs.readFileSync(SESSIONS_JSON, 'utf8'));
    return Object.entries(sessions).map(([key, s]) => ({
      key,
      sessionId: s.sessionId,
      chatType: s.chatType,
      lastChannel: s.lastChannel,
      updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
      sessionFile: s.sessionFile,
      label: s.origin?.label || key
    }));
  } catch (err) {
    return [];
  }
}

function getRecentMessages(count = 10) {
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
    let allMsgs = [];
    for (const file of files) {
      const fullPath = path.join(SESSIONS_DIR, file);
      const stat = fs.statSync(fullPath);
      // Only read files modified in last 24h for performance
      if (Date.now() - stat.mtimeMs > 86400000) continue;
      const lines = fs.readFileSync(fullPath, 'utf8').trim().split('\n');
      // Read last N lines
      const tail = lines.slice(-count * 2);
      for (const line of tail) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'message') allMsgs.push(obj);
        } catch (e) { /* skip bad lines */ }
      }
    }
    allMsgs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return allMsgs.slice(0, count);
  } catch (e) {
    return [];
  }
}

function getSessionLog(sessionId) {
  try {
    const filePath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    const messages = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        messages.push(obj);
      } catch (e) { /* skip */ }
    }
    return messages;
  } catch (e) {
    return [];
  }
}

function getUsageStats() {
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
    const daily = {};   // date -> { tokens, cost, byModel }
    const models = {};  // model -> { input, output, cost, count }
    let totalCost = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const file of files) {
      const fullPath = path.join(SESSIONS_DIR, file);
      let lines;
      try {
        lines = fs.readFileSync(fullPath, 'utf8').trim().split('\n');
      } catch (e) { continue; }

      for (const line of lines) {
        let obj;
        try { obj = JSON.parse(line); } catch (e) { continue; }
        if (obj.type !== 'message' || !obj.message?.usage) continue;

        const msg = obj.message;
        const usage = msg.usage;
        const model = msg.model || 'unknown';
        const rates = matchModelCost(model);
        const inputTok = usage.input || 0;
        const outputTok = usage.output || 0;
        const cacheRead = usage.cacheRead || 0;
        const cacheWrite = usage.cacheWrite || 0;

        // Use pre-computed cost if available, otherwise estimate
        let msgCost = 0;
        if (usage.cost && typeof usage.cost === 'object' && usage.cost.total) {
          msgCost = Math.max(0, usage.cost.total);
        } else {
          const inputCost = (inputTok * rates.input / 1000000);
          const cacheReadCost = (cacheRead * rates.input * 0.1 / 1000000);
          const outputCost = (outputTok * rates.output / 1000000);
          msgCost = inputCost + cacheReadCost + outputCost;
        }

        totalCost += msgCost;
        totalInput += inputTok;
        totalOutput += outputTok;

        // Daily breakdown
        const date = obj.timestamp ? obj.timestamp.split('T')[0] : 'unknown';
        if (!daily[date]) daily[date] = { input: 0, output: 0, cost: 0, messages: 0, byModel: {} };
        daily[date].input += inputTok;
        daily[date].output += outputTok;
        daily[date].cost += msgCost;
        daily[date].messages++;
        if (!daily[date].byModel[model]) daily[date].byModel[model] = { input: 0, output: 0, cost: 0 };
        daily[date].byModel[model].input += inputTok;
        daily[date].byModel[model].output += outputTok;
        daily[date].byModel[model].cost += msgCost;

        // Model breakdown
        if (!models[model]) models[model] = { input: 0, output: 0, cost: 0, count: 0, displayName: rates.name };
        models[model].input += inputTok;
        models[model].output += outputTok;
        models[model].cost += msgCost;
        models[model].count++;
      }
    }

    // Sort daily by date
    const sortedDaily = Object.entries(daily)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));

    return {
      totalCost,
      totalInput,
      totalOutput,
      daily: sortedDaily,
      models,
    };
  } catch (e) {
    return { totalCost: 0, totalInput: 0, totalOutput: 0, daily: [], models: {} };
  }
}

function getActivityFromSessions(limit = 20) {
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
    let items = [];

    for (const file of files) {
      const fullPath = path.join(SESSIONS_DIR, file);
      const stat = fs.statSync(fullPath);
      if (Date.now() - stat.mtimeMs > 172800000) continue; // 48h
      let lines;
      try { lines = fs.readFileSync(fullPath, 'utf8').trim().split('\n'); } catch (e) { continue; }

      const tail = lines.slice(-30);
      for (const line of tail) {
        let obj;
        try { obj = JSON.parse(line); } catch (e) { continue; }
        if (obj.type !== 'message') continue;
        const msg = obj.message;
        if (!msg || !msg.role) continue;

        let snippet = '';
        let actType = 'message';
        if (msg.content && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              snippet = block.text.substring(0, 120);
              break;
            }
            if (block.type === 'toolCall') {
              actType = 'tool_call';
              snippet = `${block.name}(${typeof block.arguments === 'object' ? Object.keys(block.arguments).slice(0,2).join(', ') : ''})`;
              break;
            }
          }
        } else if (typeof msg.content === 'string') {
          snippet = msg.content.substring(0, 120);
        }

        if (!snippet) continue;
        items.push({
          type: actType,
          role: msg.role,
          message: snippet,
          model: msg.model,
          timestamp: obj.timestamp,
          sessionFile: file
        });
      }
    }

    items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return items.slice(0, limit);
  } catch (e) {
    return [];
  }
}

function getCronJobs() {
  try {
    const raw = execSync('openclaw cron list 2>/dev/null', {
      encoding: 'utf8', timeout: 10000
    });
    
    // Find header line to determine column positions
    const headerMatch = raw.match(/^(ID\s+Name\s+Schedule\s+Next\s+Last\s+Status\s+Target\s+Agent.*)$/m);
    if (!headerMatch) return [];
    
    const header = headerMatch[0];
    // Get column start positions from header
    const cols = {
      id: header.indexOf('ID'),
      name: header.indexOf('Name'),
      schedule: header.indexOf('Schedule'),
      next: header.indexOf('Next'),
      last: header.indexOf('Last'),
      status: header.indexOf('Status'),
      target: header.indexOf('Target'),
      agent: header.indexOf('Agent')
    };
    
    const fromHeader = raw.substring(raw.indexOf(header));
    const dataLines = fromHeader.split('\n').slice(1).filter(l => l.trim() && l.match(/^[0-9a-f]{8}-/));
    
    return dataLines.map(line => ({
      id: line.substring(cols.id, cols.name).trim(),
      name: line.substring(cols.name, cols.schedule).trim(),
      schedule: line.substring(cols.schedule, cols.next).trim(),
      next: line.substring(cols.next, cols.last).trim(),
      last: line.substring(cols.last, cols.status).trim(),
      status: line.substring(cols.status, cols.target).trim(),
      target: line.substring(cols.target, cols.agent).trim(),
      agent: line.substring(cols.agent).trim()
    })).filter(j => j.id);
  } catch (e) {
    return [];
  }
}

async function sendTask(message) {
  try {
    execSync(`openclaw wake --text "${message.replace(/"/g, '\\"')}" --mode now`, {
      encoding: 'utf8', timeout: 10000
    });
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  getAgentStatus, getSessions, sendTask,
  getSessionLog, getUsageStats, getActivityFromSessions,
  getCronJobs, getRecentMessages
};
