/**
 * Executor Module - Remote RCI execution
 */
import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getRepoById } from './registry.js';
import { getContractByRepoId } from './contracts.js';

const PROJECT_ROOT = join(import.meta.dirname, '../..');
const RUNS_DIR = join(PROJECT_ROOT, 'quality-runs');

// In-memory store for active runs
const activeRuns = new Map();

/**
 * Execute QA for a repo
 */
export async function executeQA(repoId, options = {}) {
  const repo = getRepoById(repoId);
  if (!repo) {
    throw new Error(`Repo '${repoId}' not found in registry`);
  }

  if (!existsSync(repo.path)) {
    throw new Error(`Repo path '${repo.path}' does not exist`);
  }

  const contract = getContractByRepoId(repoId);
  const runId = randomUUID().slice(0, 8);
  const runDir = join(RUNS_DIR, runId);

  // Create run directory
  if (!existsSync(RUNS_DIR)) {
    mkdirSync(RUNS_DIR, { recursive: true });
  }
  mkdirSync(runDir);

  // Initialize run state
  const run = {
    runId,
    repoId,
    repoName: repo.name,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    rciResults: [],
    output: '',
    error: null,
  };

  activeRuns.set(runId, run);

  // Write initial state
  writeRunState(runDir, run);

  // Execute QA command
  const qaCommand = repo.runners?.qa || 'npm test';
  const [cmd, ...args] = qaCommand.split(' ');

  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: repo.path,
      shell: true,
      env: { ...process.env, PYTHONPATH: repo.path },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const success = code === 0;

      // Parse RCI results from output
      const rciResults = parseRciResults(stdout + stderr, contract?.rcis || []);

      // Update run state
      run.status = success ? 'passed' : 'failed';
      run.completedAt = new Date().toISOString();
      run.output = stdout;
      run.error = success ? null : stderr;
      run.exitCode = code;
      run.rciResults = rciResults;

      // Write final state
      writeRunState(runDir, run);

      resolve(run);
    });

    proc.on('error', (err) => {
      run.status = 'error';
      run.completedAt = new Date().toISOString();
      run.error = err.message;

      writeRunState(runDir, run);
      resolve(run);
    });
  });
}

/**
 * Parse test output to extract RCI results
 */
function parseRciResults(output, rcis) {
  const results = [];

  for (const rci of rcis) {
    // Try to find test result in output
    const passed = !output.includes('FAILED') &&
                   !output.includes('Error:') &&
                   !output.includes('FAIL ');

    results.push({
      id: rci.id,
      name: rci.name,
      status: passed ? 'passed' : 'failed',
      scope: rci.scope,
      priority: rci.priority,
    });
  }

  return results;
}

/**
 * Write run state to disk
 */
function writeRunState(runDir, run) {
  const statePath = join(runDir, 'run.json');
  writeFileSync(statePath, JSON.stringify(run, null, 2));
}

/**
 * Get run by ID
 */
export function getRunById(runId) {
  // Check active runs first
  if (activeRuns.has(runId)) {
    return activeRuns.get(runId);
  }

  // Check on disk
  const runDir = join(RUNS_DIR, runId);
  const statePath = join(runDir, 'run.json');

  if (existsSync(statePath)) {
    try {
      return JSON.parse(readFileSync(statePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Execute QA for all repos
 */
export async function executeAll(options = {}) {
  const { getRepoById, getAllRepos } = await import('./registry.js');
  const repos = getAllRepos().filter(r => r.enabled);

  const results = [];

  for (const repo of repos) {
    try {
      const result = await executeQA(repo.id, options);
      results.push(result);
    } catch (err) {
      results.push({
        repoId: repo.id,
        status: 'error',
        error: err.message,
      });
    }
  }

  return results;
}
