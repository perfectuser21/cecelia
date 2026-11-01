/**
 * Watchdog Service Tests
 * Tests for agent activity monitoring
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, type SpawnOptions } from 'child_process';
import {
  registerAgent,
  unregisterAgent,
  getAgentStatus,
  getAllAgentStatuses,
  triggerPatrol,
  checkAllAgents,
  startMonitor,
  stopMonitor,
  isMonitorRunning,
  getConfig,
  updateConfig,
  clearAllAgents,
} from '../service.js';

// The patrol implementation remains real. Replace only its process boundary with
// a real, owned Node child; no external cecelia-patrol binary can be launched.
const patrolBoundary = vi.hoisted(() => ({
  script: '', receipt: '', completions: [] as Array<Promise<number | null>>,
}));
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>();
  const controlledSpawn = vi.fn((command: string, args: string[], options: SpawnOptions) => {
    if (command !== 'cecelia-patrol' || !patrolBoundary.script) throw new Error(`Unexpected child command: ${command}`);
    const child = actual.spawn(process.execPath, [patrolBoundary.script, ...args], {
      ...options, env: { ...process.env, WATCHDOG_TEST_RECEIPT: patrolBoundary.receipt },
    });
    patrolBoundary.completions.push(new Promise(resolve => {
      const timeout = setTimeout(() => { child.kill('SIGTERM'); }, 3000);
      child.once('close', code => { clearTimeout(timeout); resolve(code); });
    }));
    return child;
  });
  // Both ESM and CommonJS default consumption must use the controlled boundary.
  return { ...actual, spawn: controlledSpawn, default: { ...actual, spawn: controlledSpawn } };
});
let TEST_DIR: string;

describe('Watchdog Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cecelia-watchdog-test-'));
    patrolBoundary.script = path.join(TEST_DIR, 'patrol-child.cjs');
    patrolBoundary.receipt = path.join(TEST_DIR, 'patrol-receipt.json');
    patrolBoundary.completions = [];
    fs.writeFileSync(patrolBoundary.script, `
      require('node:fs').writeFileSync(process.env.WATCHDOG_TEST_RECEIPT,
        JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }));
    `);
    clearAllAgents();
    stopMonitor();
    updateConfig({ checkIntervalMs: 10000, defaultTimeoutSeconds: 120 });
  });

  afterEach(async () => {
    stopMonitor();
    try {
      expect(await Promise.all(patrolBoundary.completions)).toEqual(patrolBoundary.completions.map(() => 0));
    } finally {
      clearAllAgents();
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('Agent Registration', () => {
    it('registers an agent successfully', () => {
      const outputFile = path.join(TEST_DIR, 'test-agent.output');
      fs.writeFileSync(outputFile, 'test output');

      const agent = registerAgent('test-agent-1', outputFile, 120);

      expect(agent.agent_id).toBe('test-agent-1');
      expect(agent.output_file).toBe(outputFile);
      expect(agent.timeout_seconds).toBe(120);
      expect(agent.status).toBe('healthy');
      expect(agent.registered_at).toBeDefined();
      expect(agent.last_activity).toBeDefined();
    });

    it('registers agent with default timeout', () => {
      const outputFile = path.join(TEST_DIR, 'test-agent-default.output');
      fs.writeFileSync(outputFile, 'test output');

      const agent = registerAgent('test-agent-default', outputFile);

      expect(agent.timeout_seconds).toBe(120); // Default is 120 seconds
    });

    it('handles non-existent output file', () => {
      const outputFile = path.join(TEST_DIR, 'nonexistent.output');

      const agent = registerAgent('test-agent-nonexistent', outputFile);

      expect(agent.agent_id).toBe('test-agent-nonexistent');
      // last_activity should be set to registered_at when file doesn't exist
      expect(agent.last_activity).toBeDefined();
    });
  });

  describe('Agent Unregistration', () => {
    it('unregisters an existing agent', () => {
      const outputFile = path.join(TEST_DIR, 'test-unregister.output');
      fs.writeFileSync(outputFile, 'test output');

      registerAgent('agent-to-unregister', outputFile);
      const result = unregisterAgent('agent-to-unregister');

      expect(result).toBe(true);
      expect(getAgentStatus('agent-to-unregister')).toBeNull();
    });

    it('returns false for non-existent agent', () => {
      const result = unregisterAgent('nonexistent-agent');
      expect(result).toBe(false);
    });
  });

  describe('Agent Status', () => {
    it('returns healthy status for recently active agent', () => {
      const outputFile = path.join(TEST_DIR, 'healthy-agent.output');
      fs.writeFileSync(outputFile, 'fresh output');

      registerAgent('healthy-agent', outputFile, 120);
      const status = getAgentStatus('healthy-agent');

      expect(status).not.toBeNull();
      expect(status!.status).toBe('healthy');
    });

    it('returns null for non-existent agent', () => {
      const status = getAgentStatus('nonexistent');
      expect(status).toBeNull();
    });

    it('detects stale agent based on file mtime', async () => {
      const outputFile = path.join(TEST_DIR, 'stale-agent.output');
      fs.writeFileSync(outputFile, 'old output');

      // Set file mtime to 3 minutes ago (180 seconds)
      const oldTime = new Date(Date.now() - 180 * 1000);
      fs.utimesSync(outputFile, oldTime, oldTime);

      registerAgent('stale-agent', outputFile, 120);
      const status = getAgentStatus('stale-agent');

      expect(status).not.toBeNull();
      expect(status!.status).toBe('stale');
    });

    it('returns healthy for agent within timeout', async () => {
      const outputFile = path.join(TEST_DIR, 'within-timeout.output');
      fs.writeFileSync(outputFile, 'output');

      // Set file mtime to 1 minute ago (60 seconds)
      const recentTime = new Date(Date.now() - 60 * 1000);
      fs.utimesSync(outputFile, recentTime, recentTime);

      registerAgent('within-timeout-agent', outputFile, 120);
      const status = getAgentStatus('within-timeout-agent');

      expect(status).not.toBeNull();
      expect(status!.status).toBe('healthy');
    });
  });

  describe('Get All Agent Statuses', () => {
    it('returns empty array when no agents', () => {
      const agents = getAllAgentStatuses();
      expect(agents).toEqual([]);
    });

    it('returns all registered agents', () => {
      const file1 = path.join(TEST_DIR, 'agent1.output');
      const file2 = path.join(TEST_DIR, 'agent2.output');
      fs.writeFileSync(file1, 'output1');
      fs.writeFileSync(file2, 'output2');

      registerAgent('agent-1', file1);
      registerAgent('agent-2', file2);

      const agents = getAllAgentStatuses();

      expect(agents.length).toBe(2);
      expect(agents.map((a) => a.agent_id)).toContain('agent-1');
      expect(agents.map((a) => a.agent_id)).toContain('agent-2');
    });
  });

  describe('Trigger Patrol', () => {
    it('returns error for non-existent agent', async () => {
      const result = await triggerPatrol('nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('triggers patrol for existing agent', async () => {
      const outputFile = path.join(TEST_DIR, 'patrol-test.output');
      fs.writeFileSync(outputFile, 'output');

      registerAgent('patrol-agent', outputFile);

      const result = await triggerPatrol('patrol-agent');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Patrol triggered');
      expect(result.agent).toBeDefined();
      expect(result.agent!.status).toBe('triggered');
      expect(spawn).toHaveBeenCalledWith('cecelia-patrol', ['--task-id', 'patrol-agent'], { detached: true, stdio: 'ignore' });
      expect(await Promise.all(patrolBoundary.completions)).toEqual([0]);
      const receipt = JSON.parse(fs.readFileSync(patrolBoundary.receipt, 'utf8'));
      expect(receipt.argv).toEqual(['--task-id', 'patrol-agent']);
      expect(receipt.pid).toBeGreaterThan(0);
      expect(receipt.pid).not.toBe(process.pid);
    });

    it('updates agent status to triggered', async () => {
      const outputFile = path.join(TEST_DIR, 'status-update.output');
      fs.writeFileSync(outputFile, 'output');

      registerAgent('status-agent', outputFile);
      await triggerPatrol('status-agent');

      const status = getAgentStatus('status-agent');
      expect(status!.status).toBe('triggered');
    });
  });

  describe('Check All Agents', () => {
    it('returns empty arrays when no agents', () => {
      const result = checkAllAgents();

      expect(result.checked).toBe(0);
      expect(result.stale).toEqual([]);
    });

    it('identifies stale agents', async () => {
      const healthyFile = path.join(TEST_DIR, 'healthy.output');
      const staleFile = path.join(TEST_DIR, 'stale.output');
      fs.writeFileSync(healthyFile, 'healthy');
      fs.writeFileSync(staleFile, 'stale');

      // Set stale file mtime to 3 minutes ago
      const oldTime = new Date(Date.now() - 180 * 1000);
      fs.utimesSync(staleFile, oldTime, oldTime);

      registerAgent('healthy-check', healthyFile, 120);
      registerAgent('stale-check', staleFile, 120);

      const result = checkAllAgents();

      expect(result.checked).toBe(2);
      expect(result.stale).toContain('stale-check');
      expect(result.stale).not.toContain('healthy-check');
    });
  });

  describe('Monitor Control', () => {
    it('starts monitor', () => {
      expect(isMonitorRunning()).toBe(false);

      startMonitor();

      expect(isMonitorRunning()).toBe(true);
    });

    it('stops monitor', () => {
      startMonitor();
      expect(isMonitorRunning()).toBe(true);

      stopMonitor();

      expect(isMonitorRunning()).toBe(false);
    });

    it('does not start duplicate monitors', () => {
      startMonitor();
      startMonitor(); // Should not throw or create duplicate

      expect(isMonitorRunning()).toBe(true);
    });
  });

  describe('Configuration', () => {
    it('returns default configuration', () => {
      const config = getConfig();

      expect(config.checkIntervalMs).toBe(10000);
      expect(config.defaultTimeoutSeconds).toBe(120);
    });

    it('updates configuration', () => {
      const updated = updateConfig({
        checkIntervalMs: 5000,
        defaultTimeoutSeconds: 60,
      });

      expect(updated.checkIntervalMs).toBe(5000);
      expect(updated.defaultTimeoutSeconds).toBe(60);

      // Reset to defaults
      updateConfig({
        checkIntervalMs: 10000,
        defaultTimeoutSeconds: 120,
      });
    });

    it('restarts monitor when config changes', () => {
      startMonitor();
      expect(isMonitorRunning()).toBe(true);

      updateConfig({ checkIntervalMs: 5000 });

      expect(isMonitorRunning()).toBe(true);

      // Reset
      updateConfig({ checkIntervalMs: 10000 });
    });
  });

  describe('Edge Cases', () => {
    it('handles file being deleted after registration', () => {
      const outputFile = path.join(TEST_DIR, 'deleted.output');
      fs.writeFileSync(outputFile, 'output');

      registerAgent('deleted-file-agent', outputFile, 120);

      // Delete the file
      fs.unlinkSync(outputFile);

      const status = getAgentStatus('deleted-file-agent');

      // Should still return agent, status depends on time since registration
      expect(status).not.toBeNull();
    });

    it('handles multiple registrations of same agent', () => {
      const outputFile = path.join(TEST_DIR, 'duplicate.output');
      fs.writeFileSync(outputFile, 'output');

      registerAgent('duplicate-agent', outputFile, 60);
      registerAgent('duplicate-agent', outputFile, 120);

      const status = getAgentStatus('duplicate-agent');
      expect(status!.timeout_seconds).toBe(120); // Second registration overwrites
    });
  });
});
