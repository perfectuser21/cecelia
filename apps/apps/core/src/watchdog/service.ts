/**
 * Watchdog Service - Agent activity monitoring
 * Monitors agent output files for staleness and triggers patrol when needed
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';

// Types
export interface WatchedAgent {
  agent_id: string;
  output_file: string;
  timeout_seconds: number;
  registered_at: string;
  last_activity: string;
  status: 'healthy' | 'stale' | 'triggered';
}

interface WatchdogConfig {
  checkIntervalMs: number;
  defaultTimeoutSeconds: number;
}

// In-memory storage for watched agents
const watchedAgents: Map<string, WatchedAgent> = new Map();

// Configuration
const config: WatchdogConfig = {
  checkIntervalMs: 10000, // 10 seconds
  defaultTimeoutSeconds: 120, // 2 minutes
};

// Background monitor interval reference
let monitorInterval: NodeJS.Timeout | null = null;

/**
 * Get file modification time in seconds since epoch
 */
function getFileMtime(filePath: string): number | null {
  try {
    const stats = fs.statSync(filePath);
    return Math.floor(stats.mtimeMs / 1000);
  } catch {
    return null;
  }
}

/**
 * Check if file exists
 */
function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Register an agent for monitoring
 */
export function registerAgent(
  agentId: string,
  outputFile: string,
  timeoutSeconds?: number
): WatchedAgent {
  const now = new Date().toISOString();
  const mtime = getFileMtime(outputFile);
  const lastActivity = mtime
    ? new Date(mtime * 1000).toISOString()
    : now;

  const agent: WatchedAgent = {
    agent_id: agentId,
    output_file: outputFile,
    timeout_seconds: timeoutSeconds || config.defaultTimeoutSeconds,
    registered_at: now,
    last_activity: lastActivity,
    status: 'healthy',
  };

  watchedAgents.set(agentId, agent);
  console.log(`[Watchdog] Registered agent ${agentId}, output: ${outputFile}`);
  return agent;
}

/**
 * Unregister an agent from monitoring
 */
export function unregisterAgent(agentId: string): boolean {
  const existed = watchedAgents.has(agentId);
  if (existed) {
    watchedAgents.delete(agentId);
    console.log(`[Watchdog] Unregistered agent ${agentId}`);
  }
  return existed;
}

/**
 * Get current status of an agent
 */
export function getAgentStatus(agentId: string): WatchedAgent | null {
  const agent = watchedAgents.get(agentId);
  if (!agent) return null;

  // Refresh status from file mtime
  return refreshAgentStatus(agent);
}

/**
 * Get all watched agents with current status
 */
export function getAllAgentStatuses(): WatchedAgent[] {
  const agents: WatchedAgent[] = [];
  for (const agent of watchedAgents.values()) {
    agents.push(refreshAgentStatus(agent));
  }
  return agents;
}

/**
 * Refresh agent status based on file mtime
 */
function refreshAgentStatus(agent: WatchedAgent): WatchedAgent {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const mtime = getFileMtime(agent.output_file);

  if (mtime === null) {
    // File doesn't exist or can't be read - consider stale if was registered
    const elapsedSinceRegistration =
      nowSeconds - Math.floor(new Date(agent.registered_at).getTime() / 1000);

    if (elapsedSinceRegistration > agent.timeout_seconds) {
      agent.status = 'stale';
    }
    return agent;
  }

  agent.last_activity = new Date(mtime * 1000).toISOString();
  const elapsed = nowSeconds - mtime;

  if (agent.status !== 'triggered') {
    agent.status = elapsed > agent.timeout_seconds ? 'stale' : 'healthy';
  }

  return agent;
}

/**
 * Trigger patrol for a specific agent
 */
export async function triggerPatrol(agentId: string): Promise<{
  success: boolean;
  message: string;
  agent?: WatchedAgent;
}> {
  const agent = watchedAgents.get(agentId);
  if (!agent) {
    return { success: false, message: `Agent ${agentId} not found` };
  }

  try {
    // Update status to triggered
    agent.status = 'triggered';
    watchedAgents.set(agentId, agent);

    // Execute cecelia-patrol command
    console.log(`[Watchdog] Triggering patrol for agent ${agentId}`);

    // Use spawn for non-blocking execution
    const patrol = spawn('cecelia-patrol', ['--task-id', agentId], {
      detached: true,
      stdio: 'ignore',
    });
    patrol.unref();

    return {
      success: true,
      message: `Patrol triggered for agent ${agentId}`,
      agent,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Watchdog] Failed to trigger patrol: ${message}`);
    return { success: false, message: `Failed to trigger patrol: ${message}` };
  }
}

/**
 * Check all agents and trigger patrol for stale ones
 */
export function checkAllAgents(): {
  checked: number;
  stale: string[];
  triggered: string[];
} {
  const result = {
    checked: 0,
    stale: [] as string[],
    triggered: [] as string[],
  };

  for (const [agentId, agent] of watchedAgents.entries()) {
    result.checked++;
    const refreshed = refreshAgentStatus(agent);

    if (refreshed.status === 'stale') {
      result.stale.push(agentId);
      // Auto-trigger patrol
      triggerPatrol(agentId).then((r) => {
        if (r.success) {
          result.triggered.push(agentId);
        }
      });
    }
  }

  return result;
}

/**
 * Start the background monitor
 */
export function startMonitor(): void {
  if (monitorInterval) {
    console.log('[Watchdog] Monitor already running');
    return;
  }

  console.log(
    `[Watchdog] Starting monitor, check interval: ${config.checkIntervalMs}ms`
  );
  monitorInterval = setInterval(() => {
    const result = checkAllAgents();
    if (result.stale.length > 0) {
      console.log(
        `[Watchdog] Check complete: ${result.checked} agents, ${result.stale.length} stale`
      );
    }
  }, config.checkIntervalMs);
}

/**
 * Stop the background monitor
 */
export function stopMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[Watchdog] Monitor stopped');
  }
}

/**
 * Check if monitor is running
 */
export function isMonitorRunning(): boolean {
  return monitorInterval !== null;
}

/**
 * Get watchdog configuration
 */
export function getConfig(): WatchdogConfig {
  return { ...config };
}

/**
 * Update watchdog configuration
 */
export function updateConfig(updates: Partial<WatchdogConfig>): WatchdogConfig {
  if (updates.checkIntervalMs !== undefined) {
    config.checkIntervalMs = updates.checkIntervalMs;
  }
  if (updates.defaultTimeoutSeconds !== undefined) {
    config.defaultTimeoutSeconds = updates.defaultTimeoutSeconds;
  }

  // Restart monitor with new interval if running
  if (monitorInterval) {
    stopMonitor();
    startMonitor();
  }

  return { ...config };
}

/**
 * Clear all watched agents (for testing)
 */
export function clearAllAgents(): void {
  watchedAgents.clear();
}
