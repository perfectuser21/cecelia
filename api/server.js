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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('Cecelia Quality API: http://localhost:' + PORT);
});
