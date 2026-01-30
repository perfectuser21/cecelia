/**
 * Panorama REST API Routes
 * Base path: /api/panorama
 */

import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const router = Router();

// Dev runs directory for plan data
const DEV_RUNS_DIR = process.env.DEV_RUNS_DIR || join(process.env.HOME || '/home/xx', 'dev/.dev-runs');

interface VitalsData {
  cpu: {
    usage: number;
    cores: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  uptime: {
    seconds: number;
    formatted: string;
  };
  load: number[];
}

interface PlanItem {
  id: string;
  content: string;
  completed: boolean;
  priority?: 'high' | 'medium' | 'low';
}

interface PlanData {
  date: string;
  items: PlanItem[];
  source: string;
}

/**
 * Get system vitals using shell commands
 */
function getSystemVitals(): VitalsData {
  // CPU usage
  let cpuUsage = 0;
  let cpuCores = 1;
  try {
    const cpuInfo = execSync("grep -c ^processor /proc/cpuinfo", { encoding: 'utf-8' }).trim();
    cpuCores = parseInt(cpuInfo, 10) || 1;

    const loadAvg = execSync("cat /proc/loadavg", { encoding: 'utf-8' }).trim().split(' ');
    cpuUsage = (parseFloat(loadAvg[0]) / cpuCores) * 100;
  } catch {
    // Default values on error
  }

  // Memory info
  let memTotal = 0, memUsed = 0, memFree = 0, memPercent = 0;
  try {
    const memInfo = execSync("free -b", { encoding: 'utf-8' });
    const memLine = memInfo.split('\n')[1].split(/\s+/);
    memTotal = parseInt(memLine[1], 10);
    memUsed = parseInt(memLine[2], 10);
    memFree = parseInt(memLine[3], 10);
    memPercent = (memUsed / memTotal) * 100;
  } catch {
    // Default values on error
  }

  // Disk info
  let diskTotal = 0, diskUsed = 0, diskFree = 0, diskPercent = 0;
  try {
    const diskInfo = execSync("df -B1 /", { encoding: 'utf-8' });
    const diskLine = diskInfo.split('\n')[1].split(/\s+/);
    diskTotal = parseInt(diskLine[1], 10);
    diskUsed = parseInt(diskLine[2], 10);
    diskFree = parseInt(diskLine[3], 10);
    diskPercent = (diskUsed / diskTotal) * 100;
  } catch {
    // Default values on error
  }

  // Uptime
  let uptimeSeconds = 0;
  let uptimeFormatted = 'Unknown';
  try {
    const uptimeRaw = execSync("cat /proc/uptime", { encoding: 'utf-8' }).trim().split(' ')[0];
    uptimeSeconds = Math.floor(parseFloat(uptimeRaw));

    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);

    if (days > 0) {
      uptimeFormatted = `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      uptimeFormatted = `${hours}h ${minutes}m`;
    } else {
      uptimeFormatted = `${minutes}m`;
    }
  } catch {
    // Default values on error
  }

  // Load average
  let load: number[] = [0, 0, 0];
  try {
    const loadAvg = execSync("cat /proc/loadavg", { encoding: 'utf-8' }).trim().split(' ');
    load = [parseFloat(loadAvg[0]), parseFloat(loadAvg[1]), parseFloat(loadAvg[2])];
  } catch {
    // Default values on error
  }

  return {
    cpu: { usage: cpuUsage, cores: cpuCores },
    memory: { total: memTotal, used: memUsed, free: memFree, percent: memPercent },
    disk: { total: diskTotal, used: diskUsed, free: diskFree, percent: diskPercent },
    uptime: { seconds: uptimeSeconds, formatted: uptimeFormatted },
    load,
  };
}

/**
 * Parse .plan.md file to extract tasks
 */
function parsePlanFile(content: string): PlanItem[] {
  const items: PlanItem[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match markdown checkbox: - [ ] or - [x]
    const match = line.match(/^[-*]\s*\[([ xX])\]\s*(.+)$/);
    if (match) {
      const completed = match[1].toLowerCase() === 'x';
      const text = match[2].trim();

      // Check for priority markers
      let priority: 'high' | 'medium' | 'low' | undefined;
      if (text.includes('[HIGH]') || text.includes('[!]')) {
        priority = 'high';
      } else if (text.includes('[LOW]')) {
        priority = 'low';
      }

      items.push({
        id: `plan-${items.length + 1}`,
        content: text.replace(/\[(HIGH|LOW|!)\]/g, '').trim(),
        completed,
        priority,
      });
    }
  }

  return items;
}

/**
 * Get today's plan from .plan.md or .dev-runs
 */
function getTodaysPlan(): PlanData {
  const today = new Date().toISOString().split('T')[0];
  const homeDir = process.env.HOME || '/home/xx';

  // Try .plan.md in home directory first
  const planPath = join(homeDir, '.plan.md');
  if (existsSync(planPath)) {
    try {
      const content = readFileSync(planPath, 'utf-8');
      const items = parsePlanFile(content);
      return {
        date: today,
        items,
        source: '.plan.md',
      };
    } catch {
      // Fall through to next source
    }
  }

  // Try .dev-runs directory
  const devRunsPlanPath = join(DEV_RUNS_DIR, 'plan.md');
  if (existsSync(devRunsPlanPath)) {
    try {
      const content = readFileSync(devRunsPlanPath, 'utf-8');
      const items = parsePlanFile(content);
      return {
        date: today,
        items,
        source: '.dev-runs/plan.md',
      };
    } catch {
      // Fall through to empty
    }
  }

  return {
    date: today,
    items: [],
    source: 'none',
  };
}

/**
 * GET /api/panorama/vitals
 * Get VPS system vitals
 */
router.get('/vitals', (_req: Request, res: Response) => {
  try {
    const vitals = getSystemVitals();
    return res.json({
      success: true,
      data: vitals,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/panorama/plan
 * Get today's plan
 */
router.get('/plan', (_req: Request, res: Response) => {
  try {
    const plan = getTodaysPlan();
    return res.json({
      success: true,
      data: plan,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/panorama/health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Read monitor data from host-generated JSON file
 * The vps-monitor script runs on the host and writes to /tmp/vps-monitor.json
 */
function getHostMonitorData(): any | null {
  const monitorFile = '/tmp/vps-monitor.json';
  try {
    if (existsSync(monitorFile)) {
      const content = readFileSync(monitorFile, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // File not available or parse error
  }
  return null;
}

/**
 * Get running Claude sessions from host monitor data
 */
function getClaudeSessions(): { sessions: any[]; total: number } {
  const hostData = getHostMonitorData();
  if (hostData?.claude) {
    return {
      sessions: hostData.claude.sessions || [],
      total: hostData.claude.active_sessions || 0,
    };
  }

  // Fallback to container-local detection (limited)
  const sessions: any[] = [];
  try {
    const psOutput = execSync(
      "ps aux | grep -E 'claude' | grep -v grep | grep -v chrome-devtools",
      { encoding: 'utf-8' }
    );

    const lines = psOutput.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 11) {
        const pid = parts[1];
        const cpu = parseFloat(parts[2]);
        const mem = parseFloat(parts[3]);
        const time = parts[9];

        let cwd = '';
        try {
          cwd = execSync(`readlink -f /proc/${pid}/cwd 2>/dev/null`, { encoding: 'utf-8' }).trim();
        } catch {
          // Ignore - process may have ended
        }

        const project = cwd.split('/').pop() || 'unknown';
        const repo = cwd.includes('/dev/') ? cwd.split('/dev/')[1]?.split('/')[0] || '' : '';

        sessions.push({
          pid,
          cpu,
          memory: mem,
          runtime: time,
          project,
          repository: repo,
          cwd,
          status: cpu > 10 ? 'active' : 'idle',
        });
      }
    }
  } catch {
    // No claude sessions running
  }

  return { sessions, total: sessions.length };
}

/**
 * Get Docker containers status from host monitor data
 */
function getDockerContainers(): any[] {
  const hostData = getHostMonitorData();
  if (hostData?.docker?.containers) {
    return hostData.docker.containers;
  }

  // Fallback (won't work in container without socket)
  const containers: any[] = [];
  try {
    const output = execSync(
      'docker ps --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>/dev/null',
      { encoding: 'utf-8' }
    );

    const lines = output.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const [name, status, ports] = line.split('|');
      containers.push({ name, status, ports: ports || '' });
    }
  } catch {
    // Docker not available or error
  }

  return containers;
}

/**
 * GET /api/panorama/command-center
 * Get comprehensive command center data
 * Prefers host monitor data when available
 */
router.get('/command-center', (_req: Request, res: Response) => {
  try {
    // Try to get host monitor data first (most accurate)
    const hostData = getHostMonitorData();

    if (hostData) {
      // Use host monitor data directly
      const byRepository: Record<string, any[]> = {};
      for (const session of hostData.claude?.sessions || []) {
        const repo = session.repository || 'other';
        if (!byRepository[repo]) {
          byRepository[repo] = [];
        }
        byRepository[repo].push(session);
      }

      return res.json({
        success: true,
        data: {
          timestamp: hostData.timestamp,
          vps: hostData.vps,
          claude: {
            active_sessions: hostData.claude?.active_sessions || 0,
            sessions: hostData.claude?.sessions || [],
            by_repository: byRepository,
          },
          docker: hostData.docker,
          capacity: hostData.capacity,
        },
      });
    }

    // Fallback to container-local detection
    const vitals = getSystemVitals();
    const claudeSessions = getClaudeSessions();
    const containers = getDockerContainers();

    const byRepository: Record<string, any[]> = {};
    for (const session of claudeSessions.sessions) {
      const repo = session.repository || 'other';
      if (!byRepository[repo]) {
        byRepository[repo] = [];
      }
      byRepository[repo].push(session);
    }

    return res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        vps: {
          cpu: {
            usage: Math.round(vitals.cpu.usage * 10) / 10,
            cores: vitals.cpu.cores,
            load: vitals.load,
          },
          memory: {
            total_gb: Math.round(vitals.memory.total / 1024 / 1024 / 1024 * 10) / 10,
            used_gb: Math.round(vitals.memory.used / 1024 / 1024 / 1024 * 10) / 10,
            percent: Math.round(vitals.memory.percent * 10) / 10,
          },
          disk: {
            total_gb: Math.round(vitals.disk.total / 1024 / 1024 / 1024),
            used_gb: Math.round(vitals.disk.used / 1024 / 1024 / 1024),
            percent: Math.round(vitals.disk.percent * 10) / 10,
          },
          uptime: vitals.uptime.formatted,
        },
        claude: {
          active_sessions: claudeSessions.total,
          sessions: claudeSessions.sessions,
          by_repository: byRepository,
        },
        docker: {
          containers: containers,
          running: containers.filter(c => c.status.startsWith('Up')).length,
        },
        capacity: {
          max_concurrent: 3,
          current_load: claudeSessions.total,
          available_slots: Math.max(0, 3 - claudeSessions.total),
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * Read planner data from host-generated JSON file
 */
function getPlannerData(): any | null {
  const plannerFile = '/tmp/vps-planner.json';
  try {
    if (existsSync(plannerFile)) {
      const content = readFileSync(plannerFile, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // File not available or parse error
  }
  return null;
}

/**
 * GET /api/panorama/planner
 * Get comprehensive planning data - repos, PRDs, capacity
 */
router.get('/planner', (_req: Request, res: Response) => {
  try {
    const data = getPlannerData();

    if (!data) {
      return res.json({
        success: false,
        error: 'Planner data not available',
      });
    }

    return res.json({
      success: true,
      data,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/panorama/status
 * Simple status endpoint for AI/voice assistant integration
 * Returns human-readable summary of current state
 */
router.get('/status', (_req: Request, res: Response) => {
  try {
    const hostData = getHostMonitorData();

    if (!hostData) {
      return res.json({
        success: true,
        summary: 'VPS 监控数据不可用',
        details: null,
      });
    }

    const claudeActive = (hostData.claude?.sessions || []).filter((s: any) => s.status === 'active').length;
    const claudeIdle = (hostData.claude?.sessions || []).filter((s: any) => s.status === 'idle').length;
    const dockerRunning = hostData.docker?.running || 0;
    const cpuUsage = hostData.vps?.cpu?.usage || 0;
    const memPercent = hostData.vps?.memory?.percent || 0;
    const available = hostData.capacity?.available_slots || 0;

    // Build human-readable summary
    const lines: string[] = [];
    lines.push(`VPS 运行时间: ${hostData.vps?.uptime || 'unknown'}`);
    lines.push(`CPU: ${cpuUsage}% | 内存: ${memPercent}%`);
    lines.push(`Claude 会话: ${claudeActive} 活跃, ${claudeIdle} 空闲`);
    lines.push(`Docker 容器: ${dockerRunning} 运行中`);
    lines.push(`可用容量: ${available} 个槽位`);

    // List active sessions
    if (claudeActive > 0) {
      lines.push('');
      lines.push('活跃会话:');
      for (const session of (hostData.claude?.sessions || []).filter((s: any) => s.status === 'active')) {
        lines.push(`  - ${session.project} (${session.repository || 'no repo'}) CPU: ${session.cpu}%`);
      }
    }

    return res.json({
      success: true,
      summary: lines.join('\n'),
      details: {
        uptime: hostData.vps?.uptime,
        cpu: cpuUsage,
        memory: memPercent,
        claude_active: claudeActive,
        claude_idle: claudeIdle,
        docker_running: dockerRunning,
        available_slots: available,
        active_projects: (hostData.claude?.sessions || [])
          .filter((s: any) => s.status === 'active')
          .map((s: any) => s.project),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * Semantic Brain API proxy routes
 * Forward requests to the Task Intelligence system
 */
const SEMANTIC_BRAIN_URL = process.env.SEMANTIC_BRAIN_URL || 'http://localhost:5220';

/**
 * POST /api/panorama/tasks/parse
 * Parse PRD content into structured tasks
 */
router.post('/tasks/parse', async (req: Request, res: Response) => {
  try {
    const { intent, context, use_history } = req.body;

    const response = await fetch(`${SEMANTIC_BRAIN_URL}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent, context, use_history }),
    });

    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/panorama/tasks/schedule
 * Schedule tasks and generate execution plan
 */
router.post('/tasks/schedule', async (req: Request, res: Response) => {
  try {
    const { tasks, constraints } = req.body;

    const response = await fetch(`${SEMANTIC_BRAIN_URL}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks, constraints }),
    });

    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/panorama/tasks/plan
 * Generate execution plan with bottleneck analysis
 */
router.post('/tasks/plan', async (req: Request, res: Response) => {
  try {
    const { tasks } = req.body;

    const response = await fetch(`${SEMANTIC_BRAIN_URL}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks }),
    });

    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/panorama/tasks/detector/status
 * Get detector service status
 */
router.get('/tasks/detector/status', async (_req: Request, res: Response) => {
  try {
    const response = await fetch(`${SEMANTIC_BRAIN_URL}/detector/status`);
    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/panorama/tasks/detector/events
 * Get recent events from detector
 */
router.get('/tasks/detector/events', async (req: Request, res: Response) => {
  try {
    const params = new URLSearchParams();
    if (req.query.limit) params.append('limit', String(req.query.limit));
    if (req.query.event_type) params.append('event_type', String(req.query.event_type));
    if (req.query.severity) params.append('severity', String(req.query.severity));

    const url = `${SEMANTIC_BRAIN_URL}/detector/events${params.toString() ? '?' + params.toString() : ''}`;
    const response = await fetch(url);
    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/panorama/roadmap
 * Get comprehensive roadmap view combining repos, PRDs, and parsed tasks
 */
router.get('/roadmap', async (_req: Request, res: Response) => {
  try {
    // Get planner data (repos, PRDs)
    const plannerData = getPlannerData();
    if (!plannerData) {
      return res.json({
        success: false,
        error: 'Planner data not available',
      });
    }

    // Build roadmap structure
    const roadmap: any = {
      timestamp: new Date().toISOString(),
      summary: {
        total_repos: plannerData.summary.total_repos,
        total_prds: plannerData.summary.pending_prds,
        active_work: plannerData.summary.active_working,
        capacity: plannerData.capacity,
      },
      repositories: plannerData.repositories.map((repo: any) => ({
        name: repo.name,
        branch: repo.branch,
        status: repo.status,
        prd_count: repo.prd_count,
        has_session: repo.has_session,
        // PRDs for this repo
        prds: plannerData.pending_work
          .filter((p: any) => p.repo === repo.name)
          .map((p: any) => ({
            file: p.file,
            title: p.title,
            path: p.path,
          })),
      })),
      active_work: plannerData.active_work,
    };

    return res.json({
      success: true,
      data: roadmap,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/panorama/roadmap/parse-prd
 * Parse a specific PRD file into tasks
 */
router.post('/roadmap/parse-prd', async (req: Request, res: Response) => {
  try {
    const { prd_path } = req.body;

    if (!prd_path) {
      return res.status(400).json({
        success: false,
        error: 'prd_path is required',
      });
    }

    // Read PRD content
    if (!existsSync(prd_path)) {
      return res.status(404).json({
        success: false,
        error: `PRD file not found: ${prd_path}`,
      });
    }

    const prdContent = readFileSync(prd_path, 'utf-8');

    // Send to Semantic Brain for parsing
    const response = await fetch(`${SEMANTIC_BRAIN_URL}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: prdContent,
        context: { source: 'prd', path: prd_path },
        use_history: false,
      }),
    });

    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/panorama/execute
 * 触发 Cecelia 执行 PRD（通过宿主机执行器服务）
 */
router.post('/execute', async (req: Request, res: Response) => {
  try {
    const { prd_path, priority } = req.body;

    if (!prd_path) {
      return res.status(400).json({
        success: false,
        error: 'prd_path is required',
      });
    }

    // 调用宿主机的 cecelia-executor 服务
    const EXECUTOR_URL = process.env.CECELIA_EXECUTOR_URL || 'http://localhost:5230';

    const response = await fetch(`${EXECUTOR_URL}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prd_path, priority }),
    });

    const data = await response.json() as { success: boolean; data?: Record<string, unknown>; error?: string };

    if (data.success) {
      return res.json({
        success: true,
        data: {
          ...data.data,
          priority: priority || 'P1',
          message: 'Cecelia execution started',
        },
      });
    } else {
      return res.status(400).json(data);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/panorama/full
 * Full system panorama - aggregates all subsystems into one view
 */
router.get('/full', async (_req: Request, res: Response) => {
  try {
    const BRAIN_API = process.env.BRAIN_API || 'http://localhost:5220';
    const QUALITY_API = process.env.QUALITY_API || 'http://localhost:5681';
    const N8N_API = process.env.N8N_BACKEND || 'http://localhost:5678';

    // Fetch VPS data
    const vpsData = getHostMonitorData() || {
      vps: getSystemVitals(),
      timestamp: new Date().toISOString(),
    };

    // Fetch brain status (with timeout)
    let brainData: any = { health: 'unavailable' };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${BRAIN_API}/api/brain/status`, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        brainData = await response.json();
        brainData.health = 'ok';
      }
    } catch {
      brainData = { health: 'unavailable', error: 'Service not responding' };
    }

    // Fetch quality status (with timeout)
    let qualityData: any = { health: 'unavailable' };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${QUALITY_API}/api/state`, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        qualityData = await response.json();
        qualityData.health = qualityData.health || 'ok';
      }
    } catch {
      qualityData = { health: 'unavailable', error: 'Service not responding' };
    }

    // Fetch GitHub panorama (local endpoint)
    let githubData: any = { health: 'unavailable' };
    try {
      const response = await fetch('http://localhost:5212/api/github/panorama');
      if (response.ok) {
        const result = await response.json() as { data?: any };
        githubData = { health: 'ok', ...result.data };
      }
    } catch {
      githubData = { health: 'unavailable', error: 'Service not responding' };
    }

    // Check services health
    const services = [
      {
        name: 'semantic-brain',
        port: 5220,
        status: brainData.health === 'ok' ? 'up' : 'down',
        endpoint: BRAIN_API,
      },
      {
        name: 'quality',
        port: 5681,
        status: qualityData.health === 'ok' || qualityData.health === 'degraded' ? 'up' : 'down',
        endpoint: QUALITY_API,
      },
      {
        name: 'n8n',
        port: 5678,
        status: 'unknown', // Would need health check
        endpoint: N8N_API,
      },
    ];

    // Check N8N health
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${N8N_API}/healthz`, { signal: controller.signal });
      clearTimeout(timeout);
      services[2].status = response.ok ? 'up' : 'down';
    } catch {
      services[2].status = 'down';
    }

    return res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        vps: vpsData.vps || vpsData,
        brain: brainData,
        quality: qualityData,
        github: githubData,
        services,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/panorama/execution/:taskId
 * 获取执行状态
 */
router.get('/execution/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const logFile = `/tmp/cecelia-${taskId}.log`;

    if (!existsSync(logFile)) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').slice(-50); // 最后 50 行

    // 检查是否完成
    const isComplete = content.includes('<promise>DONE</promise>') ||
                       content.includes('DONE') ||
                       content.includes('completed');

    return res.json({
      success: true,
      data: {
        task_id: taskId,
        status: isComplete ? 'completed' : 'running',
        log_tail: lines.join('\n'),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
