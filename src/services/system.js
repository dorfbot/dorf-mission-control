const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

function getSystemHealth() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const uptime = os.uptime();

  // CPU usage from /proc/stat
  let cpuPercent = 0;
  try {
    const load = os.loadavg();
    cpuPercent = Math.min(100, Math.round((load[0] / cpus.length) * 100));
  } catch (e) {}

  // Disk usage
  let disk = { total: 0, used: 0, free: 0, percent: 0 };
  try {
    const df = execSync("df -B1 / | tail -1", { encoding: 'utf8' });
    const parts = df.trim().split(/\s+/);
    disk.total = parseInt(parts[1]);
    disk.used = parseInt(parts[2]);
    disk.free = parseInt(parts[3]);
    disk.percent = parseInt(parts[4]);
  } catch (e) {}

  // OpenClaw version
  let ocVersion = 'unknown';
  try {
    ocVersion = execSync('openclaw --version 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
  } catch (e) {}

  // Temperature (RPi)
  let temp = null;
  try {
    const t = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    temp = Math.round(parseInt(t) / 1000);
  } catch (e) {}

  return {
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model || 'unknown',
      percent: cpuPercent,
      loadAvg: os.loadavg()
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      percent: Math.round((usedMem / totalMem) * 100)
    },
    disk,
    uptime,
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    nodeVersion: process.version,
    openclawVersion: ocVersion,
    temperature: temp
  };
}

function getGitActivity(limit = 20) {
  const gitBase = path.join(process.env.HOME || '/home/pro', 'git');
  const repos = ['ordx-app', 'ordx-contracts', 'ordx-authserver-be', 'ordx-rgen', 'ordx-utils', 'ordx-blog', 'site'];
  const commits = [];

  for (const repo of repos) {
    const repoPath = path.join(gitBase, repo);
    if (!fs.existsSync(repoPath)) continue;
    try {
      const log = execSync(
        `cd "${repoPath}" && git log --oneline --format='%H|||%s|||%an|||%aI' -10 2>/dev/null`,
        { encoding: 'utf8', timeout: 5000 }
      );
      for (const line of log.trim().split('\n').filter(l => l)) {
        const [hash, message, author, date] = line.split('|||');
        commits.push({ repo, hash: hash?.substring(0, 8), message, author, date });
      }
    } catch (e) {}
  }

  commits.sort((a, b) => new Date(b.date) - new Date(a.date));
  return commits.slice(0, limit);
}

function getWorkspaceFiles(dir, ext = '.md', maxDepth = 3) {
  const results = [];
  function scan(d, depth) {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          scan(full, depth + 1);
        } else if (entry.name.endsWith(ext)) {
          const stat = fs.statSync(full);
          results.push({
            name: entry.name,
            path: path.relative(dir, full),
            fullPath: full,
            size: stat.size,
            modified: stat.mtime
          });
        }
      }
    } catch (e) {}
  }
  scan(dir, 0);
  return results;
}

function readMarkdownFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

module.exports = { getSystemHealth, getGitActivity, getWorkspaceFiles, readMarkdownFile };
