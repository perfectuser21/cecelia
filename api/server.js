#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Quality Activation modules
import * as registry from './lib/registry.js';
import * as contracts from './lib/contracts.js';
import * as executor from './lib/executor.js';
import * as dashboard from './lib/dashboard.js';

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

// ==========================================
// M1: Registry API
// ==========================================

// GET /api/repos - List all repos
app.get('/api/repos', (req, res) => {
  try {
    const repos = registry.getAllRepos();
    res.json(repos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/repos/:id - Get single repo
app.get('/api/repos/:id', (req, res) => {
  try {
    const repo = registry.getRepoById(req.params.id);
    if (!repo) {
      return res.status(404).json({ error: 'Repo not found' });
    }
    res.json(repo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/repos - Register new repo
app.post('/api/repos', (req, res) => {
  try {
    const { id, name, path, type, git_url, main_branch, priority, runners } = req.body;

    if (!id || !path) {
      return res.status(400).json({ error: 'Missing required fields: id, path' });
    }

    const repo = registry.registerRepo({
      id, name, path, type, git_url, main_branch, priority, runners,
    });

    res.status(201).json(repo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/repos/:id - Remove repo
app.delete('/api/repos/:id', (req, res) => {
  try {
    const success = registry.removeRepo(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Repo not found' });
    }
    res.json({ success: true, message: `Repo '${req.params.id}' removed` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/repos/discover - Discover unregistered repos
app.post('/api/repos/discover', (req, res) => {
  try {
    const { register } = req.body;

    const discovered = registry.discoverRepos();

    // If register array provided, register those repos
    if (Array.isArray(register) && register.length > 0) {
      const registered = registry.registerDiscovered(register);
      return res.json({
        discovered,
        registered,
      });
    }

    res.json({ discovered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// M2: Contract API
// ==========================================

// GET /api/contracts - List all contracts
app.get('/api/contracts', (req, res) => {
  try {
    const contractList = contracts.getAllContracts();
    res.json(contractList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contracts/:repoId - Get repo's RCI list
app.get('/api/contracts/:repoId', (req, res) => {
  try {
    const contract = contracts.getContractByRepoId(req.params.repoId);
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found for repo' });
    }
    res.json(contract);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contracts/:repoId/rci/:rciId - Get single RCI
app.get('/api/contracts/:repoId/rci/:rciId', (req, res) => {
  try {
    const rci = contracts.getRciById(req.params.repoId, req.params.rciId);
    if (!rci) {
      return res.status(404).json({ error: 'RCI not found' });
    }
    res.json(rci);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// M3: Execution Engine
// ==========================================

// POST /api/execute - Execute QA for a repo
app.post('/api/execute', async (req, res) => {
  try {
    const { repoId, options } = req.body;

    if (!repoId) {
      return res.status(400).json({ error: 'Missing required field: repoId' });
    }

    const result = await executor.executeQA(repoId, options || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/execute/all - Execute QA for all repos
app.post('/api/execute/all', async (req, res) => {
  try {
    const { options } = req.body;
    const results = await executor.executeAll(options || {});
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/execute/:runId - Get execution status
app.get('/api/execute/:runId', (req, res) => {
  try {
    const run = executor.getRunById(req.params.runId);
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// M5: Dashboard Data
// ==========================================

// GET /api/dashboard/overview - All repos health overview
app.get('/api/dashboard/overview', (req, res) => {
  try {
    const overview = dashboard.getDashboardOverview();
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/repo/:id - Single repo dashboard
app.get('/api/dashboard/repo/:id', (req, res) => {
  try {
    const data = dashboard.getRepoDashboard(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'Repo not found' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/history - History/trend data
app.get('/api/dashboard/history', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const history = dashboard.getDashboardHistory(days);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Health & Legacy endpoints
// ==========================================

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
