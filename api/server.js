#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 5220;

app.use(cors());
app.use(express.json());

function readJSON(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    return null;
  }
}

function calculateHealth(state) {
  const { stats, lastError } = state;
  const failed = stats?.failed || 0;
  const succeeded = stats?.succeeded || 0;
  const total = stats?.total || 0;

  if (failed > 0 || (lastError && lastError.severity === 'critical')) {
    return 'red';
  }

  if (lastError || (total > 0 && succeeded < total)) {
    return 'yellow';
  }

  return 'green';
}

app.get('/api/state', (req, res) => {
  const stateFile = join(PROJECT_ROOT, 'state', 'state.json');
  const state = readJSON(stateFile);

  if (!state) {
    return res.status(500).json({ error: 'Failed to read state.json' });
  }

  const derivedHealth = calculateHealth(state);

  res.json({
    ...state,
    derivedHealth,
  });
});

app.get('/api/runs', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const runsDir = join(PROJECT_ROOT, 'runs');

  if (!existsSync(runsDir)) {
    return res.json([]);
  }

  try {
    const runIds = readdirSync(runsDir).filter(name => {
      const fullPath = join(runsDir, name);
      return statSync(fullPath).isDirectory();
    });

    const runs = runIds
      .map(runId => {
        const runPath = join(runsDir, runId);
        const summaryFile = join(runPath, 'summary.json');
        const summary = readJSON(summaryFile);

        if (!summary) return null;

        return {
          runId,
          taskId: summary.taskId,
          intent: summary.intent,
          status: summary.status,
          startedAt: summary.startedAt,
          completedAt: summary.completedAt,
          duration: summary.duration,
          error: summary.error,
          mtime: statSync(runPath).mtime.getTime(),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map(({ mtime, ...rest }) => rest);

    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list runs', details: err.message });
  }
});

app.get('/api/runs/:runId', (req, res) => {
  const { runId } = req.params;
  const runPath = join(PROJECT_ROOT, 'runs', runId);
  const summaryFile = join(runPath, 'summary.json');

  if (!existsSync(summaryFile)) {
    return res.status(404).json({ error: 'Run not found' });
  }

  const summary = readJSON(summaryFile);
  res.json(summary);
});

app.get('/api/runs/:runId/result', (req, res) => {
  const { runId } = req.params;
  const runPath = join(PROJECT_ROOT, 'runs', runId);
  const resultFile = join(runPath, 'result.json');

  if (!existsSync(resultFile)) {
    return res.status(404).json({ error: 'Result not found' });
  }

  const result = readJSON(resultFile);
  res.json(result);
});

// Get queue status
app.get('/api/queue', (req, res) => {
  const queueFile = join(PROJECT_ROOT, 'queue', 'queue.jsonl');

  if (!existsSync(queueFile)) {
    return res.json([]);
  }

  try {
    const content = readFileSync(queueFile, 'utf-8');
    const tasks = content
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .map(task => ({
        ...task,
        age: Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 1000),
      }));

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read queue', details: err.message });
  }
});

// Get worker status
app.get('/api/worker', (req, res) => {
  const workerStateFile = join(PROJECT_ROOT, 'worker', 'worker-state.json');

  if (!existsSync(workerStateFile)) {
    return res.json({
      status: 'idle',
      currentTask: null,
      uptime: 0,
      lastCrash: null,
    });
  }

  const state = readJSON(workerStateFile);
  res.json(state || {
    status: 'idle',
    currentTask: null,
    uptime: 0,
    lastCrash: null,
  });
});

// Get run evidence files
app.get('/api/runs/:runId/evidence', (req, res) => {
  const { runId } = req.params;
  const runPath = join(PROJECT_ROOT, 'runs', runId);

  if (!existsSync(runPath)) {
    return res.status(404).json({ error: 'Run not found' });
  }

  try {
    const files = readdirSync(runPath).filter(name => {
      const fullPath = join(runPath, name);
      return statSync(fullPath).isFile();
    });

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list evidence files', details: err.message });
  }
});

// Get run log file
app.get('/api/runs/:runId/logs/:filename', (req, res) => {
  const { runId, filename } = req.params;
  const filePath = join(PROJECT_ROOT, 'runs', runId, filename);

  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file', details: err.message });
  }
});

// Trigger QA
app.post('/api/trigger/runQA', (req, res) => {
  try {
    const { priority = 'P1', payload = {} } = req.body;
    const { execSync } = require('child_process');

    const taskPayload = {
      source: 'manual',
      intent: 'runQA',
      priority,
      payload: {
        project: payload.project || 'cecelia-workspace',
        branch: payload.branch || 'develop',
        triggeredBy: payload.triggeredBy || 'user',
      }
    };

    const result = execSync(
      `bash ${join(PROJECT_ROOT, 'gateway/gateway.sh')} add manual runQA ${priority} '${JSON.stringify(taskPayload.payload)}'`,
      { encoding: 'utf-8' }
    );

    const taskIdMatch = result.match(/Task ID: ([a-f0-9-]+)/);
    const taskId = taskIdMatch ? taskIdMatch[1] : 'unknown';

    res.json({
      taskId,
      message: 'QA task queued successfully',
      queuePosition: 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger QA', details: err.message });
  }
});

// Sync Notion
app.post('/api/trigger/syncNotion', (req, res) => {
  try {
    const { execSync } = require('child_process');

    const result = execSync(
      `bash ${join(PROJECT_ROOT, 'gateway/gateway.sh')} add manual syncNotion P2 '{}'`,
      { encoding: 'utf-8' }
    );

    const taskIdMatch = result.match(/Task ID: ([a-f0-9-]+)/);
    const taskId = taskIdMatch ? taskIdMatch[1] : 'unknown';

    res.json({
      taskId,
      message: 'Notion sync task queued'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger sync', details: err.message });
  }
});

// Health Check
app.post('/api/trigger/healthCheck', (req, res) => {
  try {
    const workerStateFile = join(PROJECT_ROOT, 'worker', 'worker-state.json');
    const queueFile = join(PROJECT_ROOT, 'queue', 'queue.jsonl');
    const stateFile = join(PROJECT_ROOT, 'state', 'state.json');

    const worker = existsSync(workerStateFile) ? readJSON(workerStateFile) : { status: 'idle' };

    let queueLength = 0;
    if (existsSync(queueFile)) {
      const content = readFileSync(queueFile, 'utf-8');
      queueLength = content.split('\n').filter(Boolean).length;
    }

    const state = existsSync(stateFile) ? readJSON(stateFile) : {};

    res.json({
      worker: {
        status: worker.status || 'unknown',
        pid: worker.pid || null,
        uptime: worker.uptime || 0
      },
      queue: {
        length: queueLength
      },
      heartbeat: {
        lastRun: state.lastHeartbeat || null
      },
      disk: {
        used: 0,
        total: 0
      },
      memory: {
        used: 0,
        total: 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Health check failed', details: err.message });
  }
});

// Clear Queue
app.delete('/api/queue/clear', (req, res) => {
  try {
    const queueFile = join(PROJECT_ROOT, 'queue', 'queue.jsonl');

    if (!existsSync(queueFile)) {
      return res.json({ cleared: 0, message: 'Queue already empty' });
    }

    const content = readFileSync(queueFile, 'utf-8');
    const count = content.split('\n').filter(Boolean).length;

    const { writeFileSync } = require('fs');
    writeFileSync(queueFile, '');

    res.json({ cleared: count, message: `Queue cleared (${count} tasks deleted)` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear queue', details: err.message });
  }
});

// Restart Worker
app.post('/api/worker/restart', (req, res) => {
  try {
    const { execSync } = require('child_process');

    // Send SIGTERM to worker if running
    try {
      execSync(`pkill -f "worker/worker.sh"`, { encoding: 'utf-8' });
    } catch (e) {
      // Worker might not be running
    }

    // Start worker
    const result = execSync(
      `cd ${PROJECT_ROOT} && nohup bash worker/worker.sh > /tmp/worker.log 2>&1 & echo $!`,
      { encoding: 'utf-8' }
    );

    const pid = parseInt(result.trim());

    res.json({
      status: 'restarted',
      pid: pid || null,
      message: 'Worker restarted successfully'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restart worker', details: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('Cecelia Quality API: http://localhost:' + PORT);
});
