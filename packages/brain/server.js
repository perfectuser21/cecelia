import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import brainRoutes from './src/routes.js';
import ceceliaRoutes from './src/cecelia-routes.js';
import traceRoutes from './src/trace-routes.js';
import memoryRoutes from './src/routes/memory.js';
import profileFactsRoutes from './src/routes/profile-facts.js';
import clusterRoutes from './src/routes/cluster.js';
import vpsMonitorRoutes from './src/routes/vps-monitor.js';
import infraStatusRoutes from './src/routes/infra-status.js';
import { getFleetStatus, startFleetRefresh } from './src/fleet-resource-cache.js';
import taskProjectsRoutes from './src/routes/task-projects.js';
import taskGoalsRoutes from './src/routes/task-goals.js';
import taskAreasRoutes from './src/routes/task-areas.js';
import taskTasksRoutes from './src/routes/task-tasks.js';
import innerLifeRoutes from './src/routes/inner-life.js';
import intentMatchRoutes from './src/routes/intent-match.js';
import selfReportsRoutes from './src/routes/self-reports.js';
import narrativesRoutes from './src/routes/narratives.js';
import cognitiveMapRoutes from './src/routes/cognitive-map.js';
import brainManifestRoutes from './src/routes/brain-manifest.js';
import perceptionSignalsRoutes from './src/routes/perception-signals.js';
import architectureRoutes from './src/routes/architecture.js';
import taskRouterDiagnoseRoutes from './src/routes/task-router-diagnose.js';
import notebookAuditRoutes from './src/routes/notebook-audit.js';
import alertingRoutes from './src/routes/alerting.js';
import systemReportsRoutes from './src/routes/system-reports.js';
import evolutionRoutes from './src/routes/evolution.js';
import recurringRoutes from './src/routes/recurring.js';
import statsRoutes from './src/routes/stats.js';
import alexPagesRoutes from './src/routes/alex-pages.js';
import metricsRoutes from './src/routes/metrics.js';
import ruminationRoutes from './src/routes/rumination.js';
import curiosityRoutes from './src/routes/curiosity.js';
import knowledgeRoutes from './src/routes/knowledge.js';
import devRecordsRoutes from './src/routes/dev-records.js';
import designDocsRoutes from './src/routes/design-docs.js';
import userAnnotationsRoutes from './src/routes/user-annotations.js';
import strategicDecisionsRoutes from './src/routes/strategic-decisions.js';
import conversationCapturesRoutes from './src/routes/conversation-captures.js';
import contentPipelineRoutes from './src/routes/content-pipeline.js';
import selfDriveRoutes from './src/routes/self-drive.js';
import okrHierarchyRoutes from './src/routes/okr-hierarchy.js';
import strategyTreeRoutes from './src/routes/strategy-tree.js';
import krConvergenceRoutes from './src/routes/kr-convergence.js';
import contextRoutes from './src/routes/context.js';
import { initTickLoop } from './src/tick.js';
import { runSelfCheck } from './src/selfcheck.js';
import { runMigrations } from './src/migrate.js';
import pool from './src/db.js';
import { initNarrativeTimer } from './src/cognitive-core.js';
import { initWebSocketServer, shutdownWebSocketServer } from './src/websocket.js';
import { loadActiveProfile } from './src/model-profile.js';
import { loadSpendingCapsFromDB } from './src/account-usage.js';
import { WebSocketServer } from 'ws';
import { handleRealtimeWebSocket } from './src/orchestrator-realtime.js';
import { handleChat } from './src/orchestrator-chat.js';
import { getScanStatus } from './src/task-generator-scheduler.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || process.env.BRAIN_PORT || 5221;

// ============== Process-level Exception Handlers ==============
// Prevent uncaught exceptions from crashing the entire service
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  // Exit so external supervisor (systemd/docker) can restart cleanly
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection at:', promise);
  console.error('Reason:', reason);
  // Log to file/monitoring service here
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await shutdownWebSocketServer();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await shutdownWebSocketServer();
  process.exit(0);
});
// ============================================================

// CORS
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Body parser
app.use(express.json({ limit: '256kb' }));

// Mount memory routes (before brain routes to avoid conflicts)
app.use('/api/brain/memory', memoryRoutes);
app.use('/api/brain/profile/facts', profileFactsRoutes);

// Migrated local routes (from apps/api → Brain)
app.use('/api/brain/cluster', clusterRoutes);
app.use('/api/brain/vps-monitor', vpsMonitorRoutes);
app.use('/api/brain/infra-status', infraStatusRoutes);
app.get('/api/brain/fleet', (_req, res) => {
  const fleet = getFleetStatus();
  const online = fleet.filter(s => s.online);
  res.json({
    servers: fleet,
    summary: { total: fleet.length, online: online.length, totalEffectiveSlots: online.reduce((s, e) => s + e.effectiveSlots, 0) },
    timestamp: Date.now(),
  });
});
app.use('/api/brain/tasks/projects', taskProjectsRoutes);
app.use('/api/brain/projects', taskProjectsRoutes); // 供 /decomp SKILL.md Phase 2 引用
app.use('/api/brain/tasks/goals', taskGoalsRoutes);
app.use('/api/brain/goals', taskGoalsRoutes); // 别名，供 /api/brain/goals/audit 访问
app.use('/api/brain/tasks/areas', taskAreasRoutes);
app.use('/api/brain/tasks/tasks', taskTasksRoutes);
app.use('/api/brain/inner-life', innerLifeRoutes);
app.use('/api/brain/intent', intentMatchRoutes);
app.use('/api/brain/self-reports', selfReportsRoutes);
app.use('/api/brain/narratives', narrativesRoutes);
app.use('/api/brain/cognitive-map', cognitiveMapRoutes);
app.use('/api/brain/manifest', brainManifestRoutes);
app.use('/api/brain/perception-signals', perceptionSignalsRoutes);
app.use('/api/brain/architecture', architectureRoutes);
app.use('/api/brain/task-router', taskRouterDiagnoseRoutes);
app.use('/api/brain/notebook-audit', notebookAuditRoutes);
app.use('/api/brain/alerting', alertingRoutes);
app.use('/api/brain/reports', systemReportsRoutes);
app.use('/api/brain/evolution', evolutionRoutes);
app.use('/api/brain/recurring-tasks', recurringRoutes);
app.use('/api/brain/stats', statsRoutes);
app.use('/api/brain/alex-pages', alexPagesRoutes);
app.use('/api/brain/metrics', metricsRoutes);
app.use('/api/brain/rumination', ruminationRoutes);
app.use('/api/brain/curiosity', curiosityRoutes);
app.use('/api/brain/knowledge', knowledgeRoutes);
app.use('/api/brain/dev-records', devRecordsRoutes);
app.use('/api/brain/design-docs', designDocsRoutes);
app.use('/api/brain/user-annotations', userAnnotationsRoutes);
app.use('/api/brain/strategic-decisions', strategicDecisionsRoutes);
app.use('/api/brain/conversation-captures', conversationCapturesRoutes);
app.use('/api/brain/pipelines', contentPipelineRoutes);
app.use('/api/brain', contentPipelineRoutes); // /api/brain/content-types
app.use('/api/brain/self-drive', selfDriveRoutes);
app.use('/api/brain/okr', okrHierarchyRoutes);
app.use('/api/brain/context', contextRoutes);
app.use('/api/brain/strategy-tree', strategyTreeRoutes);
app.use('/api/brain/kr/convergence', krConvergenceRoutes);

// Mount brain routes
app.use('/api/brain', brainRoutes);

// POST /api/brain/tasks fallback: brainRoutes 无 POST /tasks handler，此处补齐
// 必须在 brainRoutes 之后，避免干扰已有 GET/PATCH /api/brain/tasks
app.use('/api/brain/tasks', taskTasksRoutes);

// Mount cecelia task execution routes
app.use('/api/cecelia', ceceliaRoutes);

// Mount trace observability routes
app.use('/api/brain/trace', traceRoutes);

// GET /api/brain/scan-status
app.get('/api/brain/scan-status', (_req, res) => {
  try {
    res.json(getScanStatus());
  } catch (err) {
    console.error('[scan-status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/conversation-summary — 对话结束 summary 触发
// Stop Hook 调用，触发 conversation-consolidator 写入 memory_stream
app.post('/api/brain/conversation-summary', async (req, res) => {
  try {
    const { runConversationConsolidator } = await import('./src/conversation-consolidator.js');
    await runConversationConsolidator();
    res.json({ success: true, message: 'conversation summary triggered' });
  } catch (err) {
    console.error('[POST /api/brain/conversation-summary]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/brain/orchestrator/chat
app.post('/api/brain/orchestrator/chat', async (req, res) => {
  try {
    const { message, messages = [], context = {} } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });
    const result = await handleChat(message, context, messages);
    res.json(result);
  } catch (err) {
    console.error('[orchestrator/chat]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check at root
app.get('/', (_req, res) => {
  res.json({ service: 'cecelia-brain', status: 'running', port: PORT });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Error:', err.message);
  res.status(500).json({ success: false, error: err.message });
});

// Run migrations with retry (PG transient failures should not kill the process)
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    await runMigrations(pool);
    break;
  } catch (err) {
    if (attempt === 3) {
      console.error('[FATAL] Migration failed after 3 attempts:', err.message);
      process.exit(1);
    }
    console.warn(`[Server] Migration failed (attempt ${attempt}/3), retrying in 5s...`, err.message);
    await new Promise(r => setTimeout(r, 5000));
  }
}

try {
  const selfCheckOk = await runSelfCheck(pool);
  if (!selfCheckOk) {
    console.warn('[Server] Self-check failed, starting in degraded mode');
  }
} catch (selfCheckErr) {
  console.warn('[Server] Self-check error, starting in degraded mode:', selfCheckErr.message);
}

// Load active model profile
try {
  await loadActiveProfile(pool);
  console.log('[Server] Model profile loaded');
} catch (err) {
  console.warn('[Server] Failed to load model profile, using fallback:', err.message);
}

// Restore spending cap state from DB (survives Brain restarts)
await loadSpendingCapsFromDB();

// Realtime WebSocket server (noServer mode, manually handle upgrade)
const realtimeWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url.startsWith('/api/brain/orchestrator/realtime/ws')) {
    realtimeWss.handleUpgrade(req, socket, head, (ws) => {
      handleRealtimeWebSocket(ws, req);
    });
  }
  // /ws path handled by initWebSocketServer's own WSS
});

/**
 * Auto-start cecelia-bridge on port 3457 if not already running.
 * Idempotent: skips if /health returns 200.
 */
async function startCeceliaBridge() {
  const BRIDGE_PORT = process.env.BRIDGE_PORT || 3457;
  const bridgeUrl = `http://localhost:${BRIDGE_PORT}`;
  try {
    const res = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log('[Server] cecelia-bridge already running on port', BRIDGE_PORT);
      return;
    }
  } catch (_) {
    // Not running — will start below
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const bridgeScript = join(__dirname, 'scripts', 'cecelia-bridge.cjs');
  const logFile = createWriteStream('/tmp/cecelia-bridge.log', { flags: 'a' });
  // Wait for the stream to open before passing to spawn.
  // On Linux (ubuntu-latest) a freshly created WriteStream has fd:null until
  // the underlying file is opened; passing fd:null to spawn throws
  // "TypeError: The argument stdio is invalid".
  await new Promise((resolve, reject) => {
    logFile.once('open', resolve);
    logFile.once('error', reject);
  });

  const child = spawn(process.execPath, [bridgeScript], {
    detached: false,
    stdio: ['ignore', logFile, logFile],
    env: { ...process.env, BRIDGE_PORT: String(BRIDGE_PORT) },
  });

  child.on('error', (err) => {
    console.error('[Server] Failed to start cecelia-bridge:', err.message);
  });

  child.on('exit', (code, signal) => {
    if (code !== null) {
      console.warn(`[Server] cecelia-bridge exited with code ${code}`);
    }
  });

  console.log(`[Server] cecelia-bridge started (pid=${child.pid}), log: /tmp/cecelia-bridge.log`);
}

if (!process.env.VITEST) server.listen(PORT, async () => {
  console.log(`Cecelia Brain running on http://localhost:${PORT}`);

  // Initialize WebSocket server
  initWebSocketServer(server);
  console.log(`WebSocket server ready at ws://localhost:${PORT}/ws`);
  console.log(`Realtime WebSocket ready at ws://localhost:${PORT}/api/brain/orchestrator/realtime/ws`);

  // Initialize narrative timer from DB (prevent duplicate diary on restart)
  await initNarrativeTimer(pool);
  console.log('[Server] Narrative timer initialized from DB');

  // Startup recovery: environment cleanup (worktree / lock slot / dev-mode files)
  const { runStartupRecovery } = await import('./src/startup-recovery.js');
  await runStartupRecovery();

  // Load dynamic task type routing configs from DB into memory cache
  const { loadCache: loadTaskTypeCache } = await import('./src/task-type-config-cache.js');
  try {
    await loadTaskTypeCache(pool);
  } catch (cacheErr) {
    console.warn('[Server] task-type-config-cache load failed (non-fatal):', cacheErr.message);
  }

  // Log concurrency ceiling configuration for observability
  const { MAX_SEATS, INTERACTIVE_RESERVE, syncOrphanTasksOnStartup } = await import('./src/executor.js');
  console.log(`[Server] Concurrency config: MAX_SEATS=${MAX_SEATS} INTERACTIVE_RESERVE=${INTERACTIVE_RESERVE}`);

  // Sync orphan in_progress tasks with actual processes (requeue vs fail with process check)
  try {
    const syncResult = await syncOrphanTasksOnStartup();
    const failed = (syncResult.orphans_fixed || 0) - (syncResult.requeued || 0) - (syncResult.rebuilt || 0);
    console.log(`[Server] Startup sync: orphans_found=${syncResult.orphans_found} requeued=${syncResult.requeued} rebuilt=${syncResult.rebuilt} failed=${failed}`);
  } catch (syncErr) {
    console.error('[Server] Startup sync failed:', syncErr.message);
  }

  // Initialize Fleet Resource Cache (全局多机器资源感知)
  startFleetRefresh();
  console.log('[Server] Fleet Resource Cache started (30s interval) - 全局资源感知');

  // Initialize tick loop if enabled in DB
  await initTickLoop();

  // Initialize Monitoring Loop (auto-healing)
  const { startMonitorLoop } = await import('./src/monitor-loop.js');
  startMonitorLoop();
  console.log('[Server] Monitoring Loop started (30s interval) - P0: Auto-healing for stuck/spike/pressure');

  // Initialize Capability Probe (self-awareness — 每小时探测关键链路健康)
  const { startProbeLoop } = await import('./src/capability-probe.js');
  startProbeLoop();
  console.log('[Server] Capability Probe started (1h interval) - self-awareness for critical pathways');

  // Initialize Capability Scanner (孤岛发现 — 每 6 小时扫描能力健康地图)
  const { startScanLoop } = await import('./src/capability-scanner.js');
  startScanLoop();
  console.log('[Server] Capability Scanner started (6h interval) - island detection for unused capabilities');

  // Initialize Self-Drive Engine (自驱 — 看到体检报告后自主创建任务)
  const { startSelfDriveLoop } = await import('./src/self-drive.js');
  startSelfDriveLoop();
  console.log('[Server] Self-Drive Engine started (12h interval) - autonomous task creation from health data');

  // Initialize Evolution Scanner (进化追踪 — 扫描自身代码演进)
  try {
    const { scanEvolutionIfNeeded } = await import('./src/evolution-scanner.js');
    // 启动后 10 分钟首次扫描，之后每 24 小时
    setTimeout(async () => {
      try { await scanEvolutionIfNeeded(pool); } catch (e) { console.warn('[Server] Evolution scan failed:', e.message); }
      setInterval(async () => {
        try { await scanEvolutionIfNeeded(pool); } catch (e) { console.warn('[Server] Evolution scan failed:', e.message); }
      }, 24 * 60 * 60 * 1000);
    }, 10 * 60 * 1000);
    console.log('[Server] Evolution Scanner scheduled (24h interval, first run in 10min)');
  } catch (e) {
    console.warn('[Server] Evolution Scanner init failed (non-fatal):', e.message);
  }

  // Initialize Nightly Tick (每日质检 + 对齐)
  try {
    const { startNightlyScheduler } = await import('./src/nightly-tick.js');
    startNightlyScheduler();
    console.log('[Server] Nightly Scheduler started');
  } catch (e) {
    console.warn('[Server] Nightly Scheduler init failed (non-fatal):', e.message);
  }

  // Layer 2 蒸馏文档初始化（SOUL seed + WORLD_STATE/SELF_MODEL/USER_PROFILE 定时更新）
  try {
    const { seedSoul, refreshWorldState, refreshSelfModel, refreshUserProfile } = await import('./src/distilled-docs.js');
    // 启动时确保 SOUL 存在
    await seedSoul();
    // WORLD_STATE: 启动后延迟 10s 刷新，之后每 24h
    setTimeout(async () => {
      try { await refreshWorldState(); } catch (e) { console.warn('[Server] WORLD_STATE refresh failed:', e.message); }
    }, 10 * 1000);
    setInterval(async () => {
      try { await refreshWorldState(); } catch (e) { console.warn('[Server] WORLD_STATE cron failed:', e.message); }
    }, 24 * 60 * 60 * 1000);
    // SELF_MODEL: 启动后延迟 5min 首次刷新，之后每 24h
    setTimeout(async () => {
      try { await refreshSelfModel(); } catch (e) { console.warn('[Server] SELF_MODEL refresh failed:', e.message); }
    }, 5 * 60 * 1000);
    setInterval(async () => {
      try { await refreshSelfModel(); } catch (e) { console.warn('[Server] SELF_MODEL cron failed:', e.message); }
    }, 24 * 60 * 60 * 1000);
    // USER_PROFILE: 启动后延迟 2min 首次刷新，之后每 6h
    setTimeout(async () => {
      try { await refreshUserProfile(); } catch (e) { console.warn('[Server] USER_PROFILE refresh failed:', e.message); }
    }, 2 * 60 * 1000);
    setInterval(async () => {
      try { await refreshUserProfile(); } catch (e) { console.warn('[Server] USER_PROFILE cron failed:', e.message); }
    }, 6 * 60 * 60 * 1000);
    console.log('[Server] Layer 2 蒸馏文档已初始化（SOUL seeded, WORLD_STATE/SELF_MODEL 每24h, USER_PROFILE 每6h）');
  } catch (e) {
    console.warn('[Server] Layer 2 distilled docs init failed (non-fatal):', e.message);
  }

  // Backfill learnings embeddings（启动时补全 embedding=null 的历史记录，每批10条）
  try {
    const { backfillLearningEmbeddings } = await import('./src/embedding-service.js');
    // 启动后延迟 30s 再跑，避免影响启动速度；之后每小时跑一批
    setTimeout(async () => {
      try { await backfillLearningEmbeddings(); } catch (e) { console.warn('[Server] Embedding backfill failed:', e.message); }
    }, 30 * 1000);
    setInterval(async () => {
      try { await backfillLearningEmbeddings(); } catch (e) { console.warn('[Server] Embedding backfill failed:', e.message); }
    }, 60 * 60 * 1000);
    console.log('[Server] Embedding backfill scheduled (startup+1h interval)');
  } catch (e) {
    console.warn('[Server] Embedding backfill init failed (non-fatal):', e.message);
  }

  // Initialize Conversation Consolidator (对话空闲超时总结，每 5 分钟检查)
  try {
    const { runConversationConsolidator } = await import('./src/conversation-consolidator.js');
    setInterval(async () => {
      try { await runConversationConsolidator(); } catch (e) { console.warn('[Server] Conversation consolidator failed:', e.message); }
    }, 5 * 60 * 1000);
    console.log('[Server] Conversation Consolidator scheduled (5min interval)');
  } catch (e) {
    console.warn('[Server] Conversation Consolidator init failed (non-fatal):', e.message);
  }

  // Initialize Promotion Job Loop (P1)
  const { startPromotionJobLoop } = await import('./src/promotion-job.js');
  startPromotionJobLoop();
  console.log('[Server] Promotion Job Loop started (10min interval) - P1: Auto-promote probation→active, auto-disable failed');

  // Initialize Dopamine System (多巴胺奖赏回路 — 任务完成→奖赏→习惯形成)
  try {
    const { initDopamineListeners } = await import('./src/dopamine.js');
    initDopamineListeners();
    console.log('[Server] Dopamine reward system initialized');
  } catch (e) {
    console.warn('[Server] Dopamine system init failed (non-fatal):', e.message);
  }

  // Auto-start cecelia-bridge if not already running
  await startCeceliaBridge();

  // Sync Learning rules into learnings table (non-blocking, best-effort)
  // Ensures learning-retriever.js has data to inject into /dev task prompts
  try {
    const distillScript = join(__dirname, 'scripts', 'distill-learnings.js');
    const distill = spawn(process.execPath, [distillScript], {
      detached: false,
      stdio: 'pipe',
      env: { ...process.env },
    });
    distill.stdout.on('data', (d) => console.log('[distill-learnings]', d.toString().trim()));
    distill.stderr.on('data', (d) => console.warn('[distill-learnings]', d.toString().trim()));
    distill.on('exit', (code) => {
      if (code !== 0) console.warn(`[distill-learnings] exited with code ${code}`);
      else console.log('[Server] distill-learnings completed — learnings table synced');
    });
    console.log('[Server] distill-learnings started (pid=' + distill.pid + ')');
  } catch (e) {
    console.warn('[Server] distill-learnings failed to start (non-fatal):', e.message);
  }
});

export default app;
