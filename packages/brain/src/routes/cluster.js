/**
 * Cluster session management routes (migrated from apps/api/src/cluster/routes.ts)
 *
 * GET  /scan-sessions      — 扫描宿主机 Claude 进程
 * GET  /session-info/:pid  — 读取进程 cwd（项目目录）
 * GET  /session-providers   — 批量获取进程 provider/model
 * POST /kill-session       — 安全 kill claude 前台进程
 *
 * Brain Docker has pid:host, so /proc reads work for host processes.
 */

import { Router } from 'express';
import { execSync } from 'child_process';
import { readFileSync, readlinkSync, existsSync } from 'fs';

const router = Router();

function readCmdline(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    return raw.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

function readProcessEnv(pid, keys) {
  const result = {};
  for (const k of keys) result[k] = null;
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, 'utf-8');
    const entries = raw.split('\0');
    for (const entry of entries) {
      const eqIdx = entry.indexOf('=');
      if (eqIdx === -1) continue;
      const key = entry.slice(0, eqIdx);
      if (keys.includes(key)) {
        result[key] = entry.slice(eqIdx + 1);
      }
    }
  } catch {
    // cannot read environ
  }
  return result;
}

function isForegroundClaude(args) {
  if (args.length === 0) return false;
  const bin = args[0];
  if (!bin.endsWith('/claude') && bin !== 'claude') return false;
  if (args.includes('-p')) return false;
  return true;
}

// GET /scan-sessions
router.get('/scan-sessions', (_req, res) => {
  try {
    const stdout = execSync(
      'ps aux | grep -E " claude( |$)" | grep -v grep | grep -v "/bin/bash"',
      { encoding: 'utf-8', timeout: 5000 }
    );
    const processes = [];
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const parts = line.split(/\s+/);
      if (parts.length >= 11) {
        const pid = parseInt(parts[1], 10);
        if (!Number.isFinite(pid) || pid <= 0) continue;
        processes.push({
          pid,
          cpu: `${parts[2]}%`,
          memory: `${parts[3]}%`,
          startTime: parts[8],
          command: parts.slice(10).join(' ').slice(0, 120),
        });
      }
    }
    const headed = processes.filter(p => !p.command.includes(' -p ')).length;
    const headless = processes.filter(p => p.command.includes(' -p ')).length;
    res.json({ processes, total: processes.length, headed, headless, scanned_at: new Date().toISOString() });
  } catch {
    res.json({ processes: [], total: 0, headed: 0, headless: 0, scanned_at: new Date().toISOString() });
  }
});

// GET /session-info/:pid
router.get('/session-info/:pid', (req, res) => {
  const pid = parseInt(req.params.pid, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return res.status(400).json({ error: 'Invalid PID' });
  }
  if (!existsSync(`/proc/${pid}`)) {
    return res.status(404).json({ error: 'Process not found' });
  }

  const args = readCmdline(pid);
  if (!args) {
    return res.status(404).json({ error: 'Cannot read process info' });
  }

  let cwd = null;
  try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { cwd = null; }

  let projectName = null;
  if (cwd) {
    const parts = cwd.split('/').filter(Boolean);
    projectName = parts.length >= 2 ? parts.slice(-2).join('/') : parts[parts.length - 1] || cwd;
  }

  const env = readProcessEnv(pid, ['CECELIA_PROVIDER', 'CECELIA_MODEL', 'ANTHROPIC_BASE_URL']);
  let provider = 'anthropic';
  let model = env.CECELIA_MODEL;
  if (env.CECELIA_PROVIDER) {
    provider = env.CECELIA_PROVIDER;
  } else if (env.ANTHROPIC_BASE_URL?.includes('minimax')) {
    provider = 'minimax';
  }

  res.json({ pid, cwd, projectName, cmdline: args.join(' '), isForeground: isForegroundClaude(args), provider, model });
});

// GET /session-providers?pids=123,456
router.get('/session-providers', (req, res) => {
  const pidsRaw = (req.query.pids) || '';
  const pids = pidsRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
  if (pids.length === 0) return res.json({});

  const result = {};
  for (const pid of pids) {
    if (!existsSync(`/proc/${pid}`)) continue;
    const env = readProcessEnv(pid, ['CECELIA_PROVIDER', 'CECELIA_MODEL', 'ANTHROPIC_BASE_URL']);
    let provider = 'anthropic';
    if (env.CECELIA_PROVIDER) {
      provider = env.CECELIA_PROVIDER;
    } else if (env.ANTHROPIC_BASE_URL?.includes('minimax')) {
      provider = 'minimax';
    }
    result[pid] = { provider, model: env.CECELIA_MODEL };
  }
  res.json(result);
});

// POST /kill-session
router.post('/kill-session', (req, res) => {
  const pid = parseInt(req.body?.pid, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return res.status(400).json({ error: 'Invalid PID' });
  }
  if (!existsSync(`/proc/${pid}`)) {
    return res.status(404).json({ error: 'Process not found' });
  }

  const args = readCmdline(pid);
  if (!args) {
    return res.status(404).json({ error: 'Cannot read process info' });
  }

  if (!isForegroundClaude(args)) {
    return res.status(403).json({ error: 'Not a foreground claude process', cmdline: args.join(' ') });
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    return res.status(500).json({ error: `SIGTERM failed: ${err.message}` });
  }

  setTimeout(() => {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
  }, 60000);

  res.json({ ok: true, pid, signal: 'SIGTERM' });
});

export default router;
