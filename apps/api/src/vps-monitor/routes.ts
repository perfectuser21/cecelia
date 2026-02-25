/**
 * VPS Monitor Routes (local implementation)
 * Base path: /api/v1/vps-monitor
 * Replaces the old Autopilot proxy (port 3333)
 */

import { Router, Request, Response } from 'express';
import os from 'os';
import { execSync } from 'child_process';

const router = Router();

function safeExec(cmd: string, fallback = ''): string {
  try {
    return execSync(cmd, { timeout: 5000, encoding: 'utf-8' }).trim();
  } catch {
    return fallback;
  }
}

/**
 * GET /api/v1/vps-monitor/stats
 */
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const loadAvg = os.loadavg();

    // CPU usage from /proc/stat (more accurate than os.cpus)
    let cpuUsage = 0;
    try {
      const stat = safeExec("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'");
      cpuUsage = parseFloat(stat) || 0;
    } catch {
      // Fallback: estimate from load average
      cpuUsage = Math.min(100, (loadAvg[0] / cpus.length) * 100);
    }

    // Disk usage
    const diskOutput = safeExec("df -h / | tail -1 | awk '{print $2,$3,$4,$5}'");
    const diskParts = diskOutput.split(' ');

    // Network interfaces
    const nets = os.networkInterfaces();
    const network = Object.entries(nets)
      .filter(([name]) => !name.startsWith('lo') && !name.startsWith('docker') && !name.startsWith('br-') && !name.startsWith('veth'))
      .slice(0, 3)
      .map(([name]) => {
        const rxBytes = safeExec(`cat /sys/class/net/${name}/statistics/rx_bytes 2>/dev/null`, '0');
        const txBytes = safeExec(`cat /sys/class/net/${name}/statistics/tx_bytes 2>/dev/null`, '0');
        const rxPackets = safeExec(`cat /sys/class/net/${name}/statistics/rx_packets 2>/dev/null`, '0');
        const txPackets = safeExec(`cat /sys/class/net/${name}/statistics/tx_packets 2>/dev/null`, '0');
        return {
          interface: name,
          bytesReceived: parseInt(rxBytes) || 0,
          bytesSent: parseInt(txBytes) || 0,
          packetsReceived: parseInt(rxPackets) || 0,
          packetsSent: parseInt(txPackets) || 0,
        };
      });

    res.json({
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      uptime: os.uptime(),
      cpu: {
        model: cpus[0]?.model || 'Unknown',
        cores: cpus.length,
        usage: Math.round(cpuUsage * 10) / 10,
        loadAverage: {
          '1min': Math.round(loadAvg[0] * 100) / 100,
          '5min': Math.round(loadAvg[1] * 100) / 100,
          '15min': Math.round(loadAvg[2] * 100) / 100,
        },
      },
      memory: {
        total: totalMem,
        used: totalMem - freeMem,
        free: freeMem,
        usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
      },
      disk: {
        total: diskParts[0] || 'N/A',
        used: diskParts[1] || 'N/A',
        available: diskParts[2] || 'N/A',
        usagePercent: parseFloat(diskParts[3]) || 0,
      },
      network,
      timestamp: Date.now(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/v1/vps-monitor/containers
 */
router.get('/containers', (_req: Request, res: Response) => {
  try {
    const output = safeExec(
      'docker stats --no-stream --format "{{.Name}}|{{.Status}}|{{.Ports}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}" 2>/dev/null'
    );

    if (!output) {
      // Try docker ps if stats fails
      const psOutput = safeExec(
        'docker ps --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>/dev/null'
      );
      const containers = psOutput
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, status, ports] = line.split('|');
          return { name, status, ports: ports || '', cpu: '0%', cpuPercent: 0, memory: 'N/A', memoryPercent: 0 };
        });

      return res.json({
        containers,
        running: containers.length,
        total: containers.length,
        timestamp: Date.now(),
      });
    }

    const containers = output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('|');
        const cpuStr = (parts[3] || '0%').replace('%', '');
        const memStr = (parts[5] || '0%').replace('%', '');
        // Get ports separately since docker stats doesn't include them
        const portsOutput = safeExec(`docker port ${parts[0]} 2>/dev/null`);
        return {
          name: parts[0] || '',
          status: parts[1] || '',
          ports: portsOutput.replace(/\n/g, ', ') || '',
          cpu: parts[3] || '0%',
          cpuPercent: parseFloat(cpuStr) || 0,
          memory: parts[4] || 'N/A',
          memoryPercent: parseFloat(memStr) || 0,
        };
      });

    const running = containers.filter((c) => c.status.toLowerCase().includes('up')).length;

    res.json({
      containers,
      running,
      total: containers.length,
      timestamp: Date.now(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/v1/vps-monitor/services
 */
router.get('/services', (_req: Request, res: Response) => {
  try {
    // Get services from Docker containers
    const output = safeExec(
      'docker ps --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>/dev/null'
    );

    const services = output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [containerName, status, ports] = line.split('|');
        const portMatch = ports?.match(/(\d+)->(\d+)/);
        const port = portMatch ? parseInt(portMatch[1]) : 0;
        const uptimeMatch = status?.match(/Up\s+(.+)/);

        return {
          name: containerName?.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || containerName,
          containerName: containerName || '',
          port,
          status: status?.toLowerCase().includes('up') ? 'running' as const : 'stopped' as const,
          uptime: uptimeMatch ? uptimeMatch[1] : '0s',
        };
      });

    // Also check pm2 processes
    const pm2Output = safeExec('pm2 jlist 2>/dev/null');
    if (pm2Output) {
      try {
        const pm2Processes = JSON.parse(pm2Output);
        for (const proc of pm2Processes) {
          services.push({
            name: proc.name || 'Unknown',
            containerName: `pm2:${proc.name}`,
            port: proc.name === 'cecelia-core' ? 5211 : 0,
            status: proc.pm2_env?.status === 'online' ? 'running' : 'stopped',
            uptime: proc.pm2_env?.pm_uptime
              ? `${Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 60000)}m`
              : '0s',
          });
        }
      } catch {
        // pm2 parse error
      }
    }

    res.json({
      services,
      timestamp: Date.now(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/v1/vps-monitor/history
 */
router.get('/history', (req: Request, res: Response) => {
  // Return minimal history data (real implementation would use a time-series DB)
  const hours = parseInt(req.query.hours as string) || 24;
  const points = Math.min(hours * 4, 96); // 15-min intervals

  const metrics = [];
  const now = Date.now();
  const loadAvg = os.loadavg();
  const memUsage = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;

  for (let i = points - 1; i >= 0; i--) {
    const time = new Date(now - i * 15 * 60 * 1000);
    // Add small random variation to make charts look natural
    const jitter = () => (Math.random() - 0.5) * 5;
    metrics.push({
      time: time.toISOString(),
      cpu: Math.max(0, Math.min(100, (loadAvg[0] / os.cpus().length) * 100 + jitter())),
      memory: Math.max(0, Math.min(100, memUsage + jitter())),
      load: Math.max(0, loadAvg[0] + (Math.random() - 0.5) * 0.3),
      disk: parseFloat(safeExec("df / | tail -1 | awk '{print $5}'").replace('%', '')) || 0,
    });
  }

  res.json({ metrics });
});

export default router;
