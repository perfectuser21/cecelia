/**
 * Cluster session management routes
 *
 * GET  /api/cluster/session-info/:pid  — 读取进程 cwd（项目目录）
 * POST /api/cluster/kill-session       — 安全 kill claude 前台进程
 */

import { Router } from 'express';
import { readlinkSync, readFileSync, existsSync } from 'fs';

const router = Router();

/**
 * 从 /proc/{pid}/cmdline 读取命令行参数
 * 返回 null 如果进程不存在或无法读取
 */
function readCmdline(pid: number): string[] | null {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    return raw.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * 检查 PID 是否为前台 claude 进程（非 claude -p）
 */
function isForegroundClaude(args: string[]): boolean {
  if (args.length === 0) return false;
  const bin = args[0];
  if (!bin.endsWith('/claude') && bin !== 'claude') return false;
  if (args.includes('-p')) return false;
  return true;
}

/**
 * GET /api/cluster/session-info/:pid
 * 读取进程工作目录和命令行，用于 LiveMonitor 展开显示
 */
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

  let cwd: string | null = null;
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    cwd = null;
  }

  // 从路径提取项目名（最后两段）
  let projectName: string | null = null;
  if (cwd) {
    const parts = cwd.split('/').filter(Boolean);
    projectName = parts.length >= 2
      ? parts.slice(-2).join('/')
      : parts[parts.length - 1] || cwd;
  }

  res.json({
    pid,
    cwd,
    projectName,
    cmdline: args.join(' '),
    isForeground: isForegroundClaude(args),
  });
});

/**
 * POST /api/cluster/kill-session
 * Body: { pid: number }
 * 安全 kill claude 前台进程（非 claude -p）
 */
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

  // 安全校验：只允许 kill 前台 claude 进程
  if (!isForegroundClaude(args)) {
    return res.status(403).json({
      error: 'Not a foreground claude process',
      cmdline: args.join(' '),
    });
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err: any) {
    return res.status(500).json({ error: `SIGTERM failed: ${err.message}` });
  }

  // 60 秒后 SIGKILL（如果进程还在）
  setTimeout(() => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 进程已退出，忽略
    }
  }, 60000);

  res.json({ ok: true, pid, signal: 'SIGTERM' });
});

export default router;
