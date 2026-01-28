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
const PORT = process.env.CECELIA_API_PORT || process.env.PORT || 5681;

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

app.get('/api/failures', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const runsDir = join(PROJECT_ROOT, 'runs');

  if (!existsSync(runsDir)) {
    return res.json([]);
  }

  try {
    const runIds = readdirSync(runsDir).filter(name => {
      const fullPath = join(runsDir, name);
      return statSync(fullPath).isDirectory();
    });

    const failures = runIds
      .map(runId => {
        const runPath = join(runsDir, runId);
        const summaryFile = join(runPath, 'summary.json');
        const summary = readJSON(summaryFile);

        if (!summary || summary.status !== 'failed') return null;

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

    res.json(failures);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list failures', details: err.message });
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

// Get run evidence file (download)
app.get('/api/runs/:runId/evidence/:filename', (req, res) => {
  const { runId, filename } = req.params;
  const filePath = join(PROJECT_ROOT, 'runs', runId, filename);

  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'Evidence file not found' });
  }

  try {
    res.download(filePath);
  } catch (err) {
    res.status(500).json({ error: 'Failed to download file', details: err.message });
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

// P1 endpoint: Enqueue task (requires authentication)
app.post('/api/enqueue', async (req, res) => {
  const token = req.headers['x-cecelia-token'];
  const expectedToken = process.env.CECELIA_API_TOKEN || 'default-dev-token';

  if (!token || token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing token' });
  }

  try {
    const { source, intent, priority, payload } = req.body;

    if (!intent || !priority) {
      return res.status(400).json({ error: 'Missing required fields: intent, priority' });
    }

    const taskSource = source || 'api';
    const taskPayload = JSON.stringify(payload || {});

    // Call gateway.sh to add task
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execPromise = promisify(exec);

    const gatewayScript = join(PROJECT_ROOT, 'gateway', 'gateway.sh');
    const command = `bash "${gatewayScript}" add "${taskSource}" "${intent}" "${priority}" '${taskPayload}'`;

    const { stdout, stderr } = await execPromise(command);

    if (stderr && !stderr.includes('Task added')) {
      return res.status(500).json({ error: 'Failed to enqueue task', details: stderr });
    }

    res.status(201).json({
      success: true,
      message: 'Task enqueued successfully',
      output: stdout.trim(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to enqueue task', details: err.message });
  }
});

// Task System API routes
import projectsRouter from './src/task-system/projects.js';
import goalsRouter from './src/task-system/goals.js';
import tasksRouter from './src/task-system/tasks.js';
import linksRouter from './src/task-system/links.js';
import runsRouter from './src/task-system/runs.js';

app.use('/api/projects', projectsRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/tasks', linksRouter);
app.use('/api/runs', runsRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Legacy endpoint for backward compatibility
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('Cecelia Quality API: http://localhost:' + PORT);
});
