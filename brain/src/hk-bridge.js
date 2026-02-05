#!/usr/bin/env node
/**
 * HK VPS Bridge - 上报资源状态给 US Brain
 * 监听 :5225，返回 CPU/内存/Claude 进程信息
 */

import http from 'http';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const PORT = process.env.BRIDGE_PORT || 5225;

async function getClaudeProcesses() {
  try {
    const { stdout } = await execAsync('ps aux | grep -E " claude( |$)" | grep -v grep | grep -v bash');
    const lines = stdout.trim().split('\n').filter(Boolean);

    return lines.map(line => {
      const parts = line.split(/\s+/);
      if (parts.length >= 11) {
        return {
          pid: parseInt(parts[1]),
          cpu: `${parts[2]}%`,
          memory: `${parts[3]}%`,
          startTime: parts[8],
          command: parts.slice(10).join(' ').slice(0, 80)
        };
      }
      return null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function getResources() {
  const cpuCores = os.cpus().length;
  const loadAvg = os.loadavg()[0];
  const memTotal = os.totalmem();
  const memFree = os.freemem();

  return {
    cpu_cores: cpuCores,
    cpu_load: Math.round(loadAvg * 10) / 10,
    cpu_pct: Math.round((loadAvg / cpuCores) * 100),
    mem_total_gb: Math.round(memTotal / (1024 * 1024 * 1024) * 10) / 10,
    mem_free_gb: Math.round(memFree / (1024 * 1024 * 1024) * 10) / 10,
    mem_used_pct: Math.round((1 - memFree / memTotal) * 100)
  };
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/status' || req.url === '/') {
    const processes = await getClaudeProcesses();
    const resources = getResources();

    const status = {
      success: true,
      server: 'hk',
      timestamp: new Date().toISOString(),
      resources,
      slots: {
        max: 3,
        used: processes.length,
        available: Math.max(0, 3 - processes.length),
        reserved: 0,
        processes
      }
    };

    res.writeHead(200);
    res.end(JSON.stringify(status, null, 2));
  } else if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[HK Bridge] Listening on port ${PORT}`);
  console.log(`[HK Bridge] Resources: ${os.cpus().length} cores, ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB RAM`);
});
