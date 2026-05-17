/**
 * Watchdog REST API Routes
 * Base path: /api/watchdog
 */

import { Router, Request, Response } from 'express';
import * as watchdogService from './service.js';

const router = Router();

/**
 * POST /api/watchdog/register
 * Register an agent for monitoring
 *
 * Body: { agent_id, output_file, timeout?: number }
 */
router.post('/register', (req: Request, res: Response) => {
  try {
    const { agent_id, output_file, timeout } = req.body;

    if (!agent_id) {
      return res.status(400).json({
        success: false,
        error: 'agent_id is required',
      });
    }

    if (!output_file) {
      return res.status(400).json({
        success: false,
        error: 'output_file is required',
      });
    }

    const agent = watchdogService.registerAgent(
      agent_id,
      output_file,
      timeout
    );

    return res.json({
      success: true,
      data: agent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/watchdog/status
 * Get status of all watched agents
 */
router.get('/status', (_req: Request, res: Response) => {
  try {
    const agents = watchdogService.getAllAgentStatuses();
    const monitorRunning = watchdogService.isMonitorRunning();
    const config = watchdogService.getConfig();

    return res.json({
      success: true,
      data: {
        monitor_running: monitorRunning,
        config,
        agents,
        total_agents: agents.length,
        healthy: agents.filter((a) => a.status === 'healthy').length,
        stale: agents.filter((a) => a.status === 'stale').length,
        triggered: agents.filter((a) => a.status === 'triggered').length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/watchdog/:agent_id
 * Get status of a specific agent
 */
router.get('/:agent_id', (req: Request, res: Response) => {
  try {
    const { agent_id } = req.params;
    const agent = watchdogService.getAgentStatus(agent_id);

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: `Agent ${agent_id} not found`,
      });
    }

    return res.json({
      success: true,
      data: agent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * DELETE /api/watchdog/:agent_id
 * Unregister an agent from monitoring
 */
router.delete('/:agent_id', (req: Request, res: Response) => {
  try {
    const { agent_id } = req.params;
    const existed = watchdogService.unregisterAgent(agent_id);

    if (!existed) {
      return res.status(404).json({
        success: false,
        error: `Agent ${agent_id} not found`,
      });
    }

    return res.json({
      success: true,
      message: `Agent ${agent_id} unregistered`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/watchdog/trigger/:agent_id
 * Manually trigger patrol for an agent
 */
router.post('/trigger/:agent_id', async (req: Request, res: Response) => {
  try {
    const { agent_id } = req.params;
    const result = await watchdogService.triggerPatrol(agent_id);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.message,
      });
    }

    return res.json({
      success: true,
      message: result.message,
      data: result.agent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/watchdog/monitor/start
 * Start the background monitor
 */
router.post('/monitor/start', (_req: Request, res: Response) => {
  try {
    watchdogService.startMonitor();
    return res.json({
      success: true,
      message: 'Monitor started',
      monitor_running: watchdogService.isMonitorRunning(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/watchdog/monitor/stop
 * Stop the background monitor
 */
router.post('/monitor/stop', (_req: Request, res: Response) => {
  try {
    watchdogService.stopMonitor();
    return res.json({
      success: true,
      message: 'Monitor stopped',
      monitor_running: watchdogService.isMonitorRunning(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/watchdog/check
 * Manually trigger a check of all agents
 */
router.post('/check', (_req: Request, res: Response) => {
  try {
    const result = watchdogService.checkAllAgents();
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
