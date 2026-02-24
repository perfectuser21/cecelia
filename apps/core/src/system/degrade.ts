/**
 * Degrade Policy Module
 * Phase 4.3: 猝死保护 (Graceful Degradation)
 *
 * Monitors service health and manages degraded mode:
 * - Brain down → Write to DLQ, continue in local mode
 * - Service recovered → Auto-reconnect and replay DLQ
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CHECK_INTERVAL_MS = 30000; // 30 seconds
const BRAIN_API = process.env.BRAIN_API || 'http://localhost:5220';
const WORKSPACE_API = process.env.WORKSPACE_API || 'http://localhost:5211';
const DLQ_SCRIPT = path.resolve(__dirname, '../../../../scripts/dlq-utils.sh');

// Service health state
interface ServiceHealth {
  healthy: boolean;
  lastCheck: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  latencyMs: number | null;
}

interface DegradeState {
  degraded: boolean;
  reason: string | null;
  enteredAt: Date | null;
  services: {
    brain: ServiceHealth;
    workspace: ServiceHealth;
    quality: ServiceHealth;
    n8n: ServiceHealth;
  };
}

// Service endpoints
const QUALITY_API = process.env.QUALITY_API || 'http://localhost:5681';
const N8N_API = process.env.N8N_BACKEND || 'http://localhost:5679';

// Global state
const state: DegradeState = {
  degraded: false,
  reason: null,
  enteredAt: null,
  services: {
    brain: { healthy: true, lastCheck: null, lastError: null, consecutiveFailures: 0, latencyMs: null },
    workspace: { healthy: true, lastCheck: null, lastError: null, consecutiveFailures: 0, latencyMs: null },
    quality: { healthy: true, lastCheck: null, lastError: null, consecutiveFailures: 0, latencyMs: null },
    n8n: { healthy: true, lastCheck: null, lastError: null, consecutiveFailures: 0, latencyMs: null },
  },
};

let checkIntervalId: NodeJS.Timeout | null = null;

/**
 * Check if a service is healthy (with latency measurement)
 */
async function checkServiceHealth(
  name: string,
  url: string,
  timeoutMs: number = 5000
): Promise<{ healthy: boolean; error: string | null; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const response = await fetch(url, { signal: controller.signal });
    const latencyMs = Date.now() - startTime;
    clearTimeout(timeout);

    if (response.ok) {
      return { healthy: true, error: null, latencyMs };
    }
    return { healthy: false, error: `HTTP ${response.status}`, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    clearTimeout(timeout);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { healthy: false, error: message, latencyMs };
  }
}

/**
 * Update service health state
 */
function updateServiceHealth(
  service: 'brain' | 'workspace' | 'quality' | 'n8n',
  result: { healthy: boolean; error: string | null; latencyMs: number }
): void {
  const svc = state.services[service];
  svc.lastCheck = new Date();
  svc.latencyMs = result.latencyMs;

  if (result.healthy) {
    svc.healthy = true;
    svc.lastError = null;
    svc.consecutiveFailures = 0;
  } else {
    svc.healthy = false;
    svc.lastError = result.error;
    svc.consecutiveFailures++;
  }
}

/**
 * Evaluate and update degraded state
 */
function evaluateDegradeState(): void {
  const brainDown = !state.services.brain.healthy;
  const workspaceDown = !state.services.workspace.healthy;

  const shouldDegrade = brainDown; // We only degrade if Brain is down

  if (shouldDegrade && !state.degraded) {
    // Enter degraded mode
    state.degraded = true;
    state.reason = brainDown ? 'Brain service unavailable' : 'Service unavailable';
    state.enteredAt = new Date();
    console.log(`[DEGRADE] Entered degraded mode: ${state.reason}`);
  } else if (!shouldDegrade && state.degraded) {
    // Exit degraded mode
    console.log(`[DEGRADE] Services recovered, exiting degraded mode`);
    state.degraded = false;
    state.reason = null;
    state.enteredAt = null;

    // Trigger DLQ replay on recovery
    triggerDLQReplay().catch((err) => {
      console.error('[DEGRADE] DLQ replay failed:', err);
    });
  }
}

/**
 * Trigger DLQ replay when services recover
 */
async function triggerDLQReplay(): Promise<void> {
  try {
    console.log('[DEGRADE] Triggering DLQ replay...');
    const { stdout: statusOutput } = await execAsync(`bash ${DLQ_SCRIPT} status`);
    const status = JSON.parse(statusOutput);

    if (status.total_pending > 0) {
      console.log(`[DEGRADE] Found ${status.total_pending} pending DLQ entries, replaying...`);

      if (status.memory.pending > 0) {
        const { stdout: memoryResult } = await execAsync(`bash ${DLQ_SCRIPT} replay memory`);
        console.log('[DEGRADE] Memory replay:', JSON.parse(memoryResult));
      }

      if (status.evidence.pending > 0) {
        const { stdout: evidenceResult } = await execAsync(`bash ${DLQ_SCRIPT} replay evidence`);
        console.log('[DEGRADE] Evidence replay:', JSON.parse(evidenceResult));
      }
    } else {
      console.log('[DEGRADE] No pending DLQ entries');
    }
  } catch (error) {
    console.error('[DEGRADE] DLQ replay error:', error);
    throw error;
  }
}

/**
 * Run health check cycle
 */
async function runHealthCheck(): Promise<void> {
  // Check all services in parallel for better performance
  const [brainResult, workspaceResult, qualityResult, n8nResult] = await Promise.all([
    checkServiceHealth('brain', `${BRAIN_API}/api/brain/tick/status`),
    checkServiceHealth('workspace', `${WORKSPACE_API}/api/system/health`),
    checkServiceHealth('quality', `${QUALITY_API}/api/state`),
    checkServiceHealth('n8n', `${N8N_API}/healthz`),
  ]);

  // Update all service health states
  updateServiceHealth('brain', brainResult);
  updateServiceHealth('workspace', workspaceResult);
  updateServiceHealth('quality', qualityResult);
  updateServiceHealth('n8n', n8nResult);

  // Evaluate degraded state
  evaluateDegradeState();
}

/**
 * Start periodic health checks
 */
export function startHealthChecks(): void {
  if (checkIntervalId) {
    console.log('[DEGRADE] Health checks already running');
    return;
  }

  console.log(`[DEGRADE] Starting health checks (interval: ${CHECK_INTERVAL_MS}ms)`);

  // Run immediately
  runHealthCheck().catch((err) => {
    console.error('[DEGRADE] Health check error:', err);
  });

  // Then run periodically
  checkIntervalId = setInterval(() => {
    runHealthCheck().catch((err) => {
      console.error('[DEGRADE] Health check error:', err);
    });
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop periodic health checks
 */
export function stopHealthChecks(): void {
  if (checkIntervalId) {
    clearInterval(checkIntervalId);
    checkIntervalId = null;
    console.log('[DEGRADE] Health checks stopped');
  }
}

/**
 * Get current degrade state
 */
export function getDegradeState(): DegradeState {
  return { ...state };
}

/**
 * Check if system is degraded
 */
export function isDegraded(): boolean {
  return state.degraded;
}

/**
 * Manually trigger degraded mode (for testing)
 */
export function setDegraded(degraded: boolean, reason?: string): void {
  if (degraded) {
    state.degraded = true;
    state.reason = reason || 'Manual degradation';
    state.enteredAt = new Date();
    console.log(`[DEGRADE] Manually entered degraded mode: ${state.reason}`);
  } else {
    state.degraded = false;
    state.reason = null;
    state.enteredAt = null;
    console.log('[DEGRADE] Manually exited degraded mode');
  }
}

/**
 * Run immediate health check
 */
export async function checkNow(): Promise<DegradeState> {
  await runHealthCheck();
  return getDegradeState();
}

/**
 * Get comprehensive health status with latency info
 */
export interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    [key: string]: {
      status: 'healthy' | 'unhealthy';
      latency_ms: number | null;
      last_check: string | null;
      error: string | null;
    };
  };
  degraded: boolean;
  degraded_reason: string | null;
}

export function getHealthStatus(): HealthStatus {
  const services: HealthStatus['services'] = {};

  for (const [name, svc] of Object.entries(state.services)) {
    services[name] = {
      status: svc.healthy ? 'healthy' : 'unhealthy',
      latency_ms: svc.latencyMs,
      last_check: svc.lastCheck?.toISOString() || null,
      error: svc.lastError,
    };
  }

  // Determine overall health
  const healthyCount = Object.values(state.services).filter(s => s.healthy).length;
  const totalCount = Object.keys(state.services).length;

  let overall: 'healthy' | 'degraded' | 'unhealthy';
  if (healthyCount === totalCount) {
    overall = 'healthy';
  } else if (healthyCount === 0) {
    overall = 'unhealthy';
  } else {
    overall = 'degraded';
  }

  return {
    overall,
    services,
    degraded: state.degraded,
    degraded_reason: state.reason,
  };
}
