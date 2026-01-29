/**
 * Watchdog Service Tests
 * Tests for agent activity monitoring
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
  WatchedAgent,
} from '../service.js';

// Test directory for output files
const TEST_DIR = path.join(os.tmpdir(), 'watchdog-test');

describe('Watchdog Service', () => {
  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }

    // Clear all agents before each test
    clearAllAgents();

    // Stop monitor if running
    stopMonitor();
  });

  afterEach(() => {
    // Cleanup test files
    try {
      if (fs.existsSync(TEST_DIR)) {
        const files = fs.readdirSync(TEST_DIR);
        for (const file of files) {
          fs.unlinkSync(path.join(TEST_DIR, file));
        }
        fs.rmdirSync(TEST_DIR);
      }
    } catch {
      // Ignore cleanup errors
    }

    // Stop monitor
    stopMonitor();
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

      // Mock the spawn to avoid actually running cecelia-patrol
      vi.mock('child_process', () => ({
        spawn: vi.fn(() => ({
          unref: vi.fn(),
        })),
        execSync: vi.fn(),
      }));

      const result = await triggerPatrol('patrol-agent');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Patrol triggered');
      expect(result.agent).toBeDefined();
      expect(result.agent!.status).toBe('triggered');
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
