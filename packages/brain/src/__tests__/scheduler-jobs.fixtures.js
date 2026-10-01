import { vi } from 'vitest';

vi.mock('../preview-cache-scheduler.js', () => ({ runPreviewCacheJanitor: vi.fn().mockResolvedValue({ status: 'disabled' }) }));
vi.mock('../projection/company-key-results.js', () => ({ runCompanyKrProjection: vi.fn(async () => ({ skipped: true })) }));

vi.mock('../node-onboarding/service.js', () => ({
  runNodeOnboardingJob: vi.fn().mockResolvedValue({ reconciled: 0, errors: 0, scheduled: 0 }),
}));

vi.mock('../daily-review-scheduler.js', () => ({
  triggerArchReview: vi.fn().mockResolvedValue({ triggered: false, skipped_window: true }),
  triggerCiPatrol: vi.fn().mockResolvedValue({ triggered: false, skipped_window: true }),
}));
vi.mock('../active-goals-zero-trigger.js', () => ({
  maybeTriggerStrategySession: vi.fn().mockResolvedValue({ created: false, reason: 'active_goals_present' }),
}));
vi.mock('../daily-backup-scheduler.js', () => ({
  scheduleDailyBackup: vi.fn().mockResolvedValue({ inWindow: false, triggered: false, alreadyDone: false }),
}));
vi.mock('../battle-report.js', () => ({
  maybeGenerateBattleReport: vi.fn().mockResolvedValue({ skipped: true, reason: 'outside_window' }),
}));
vi.mock('../line-dreaming.js', () => ({
  maybeRunLineDreaming: vi.fn().mockResolvedValue({ created: false, reason: 'outside_window' }),
}));
vi.mock('../ledger-hygiene.js', () => ({
  maybeRunLedgerHygiene: vi.fn().mockResolvedValue({ triggered: false }),
}));
vi.mock('../capture-triage.js', () => ({
  runCaptureTriage: vi.fn().mockResolvedValue({ skipped: true, processed: 0, failed: 0 }),
}));
vi.mock('../receipt-collector.js', () => ({
  runReceiptCollector: vi.fn().mockResolvedValue({ skipped: true, timedOut: 0 }),
}));
vi.mock('../launchd-patrol.js', () => ({
  runLaunchdPatrol: vi.fn().mockResolvedValue({ skipped: true }),
}));
vi.mock('../direction-proposer.js', () => ({
  maybeRunDirectionProposer: vi.fn().mockResolvedValue({ triggered: false }),
}));
vi.mock('../postdeploy-verifier.js', () => ({
  runPostdeployVerifier: vi.fn().mockResolvedValue({ triggered: false }),
}));
vi.mock('../seven-ring-audit.js', () => ({
  runSevenRingAuditJob: vi.fn().mockResolvedValue({ skipped: true }),
}));
vi.mock('../guard-drill.js', () => ({
  runGuardDrill: vi.fn().mockResolvedValue({ skipped: true }),
}));
vi.mock('../morning-cockpit-bark.js', () => ({
  runMorningCockpitBark: vi.fn().mockResolvedValue({ skipped: true, reason: 'outside_window' }),
}));
vi.mock('../cron/drift-sentinel.js', () => ({
  runDriftSentinel: vi.fn().mockResolvedValue({ skipped: true, reason: 'interval_not_reached' }),
}));
vi.mock('../promise-map-nightly.js', () => ({
  runPromiseMapNightly: vi.fn().mockResolvedValue({ ok: true, passed: 4, failed: 0 }),
}));

// disk-guard 真实 handler 会 ssh 逃逸宿主跑 df/worktree 收割——单测绝不能碰真机，
// 且本地跑会超时（多 worktree × ConnectTimeout 叠加 >30s）。行为由 disk-guard 自己的测试覆盖。
vi.mock('../cron/disk-guard.js', () => ({
  runDiskGuard: vi.fn().mockResolvedValue({ ok: true, pct: 50, level: 'ok' }),
}));

// machine-vitals 真实 handler 会走 execFile(docker/df) 系统调用——在 fake timers 下
// 不受 vi 的虚拟时钟驱动，会挂住整轮串行 job（machine-vitals 现排 JOBS 首位）。
// 其行为本身由 machine-vitals.test.js / machine-vitals-wiring.test.js 覆盖，这里纯 mock 掉。
vi.mock('../machine-vitals.js', () => ({
  sampleMachineVitals: vi.fn().mockResolvedValue({ sampled_at: Date.now(), error: null }),
}));

vi.mock('../codex-test-gen.js', () => ({
  runCodexTestGen: vi.fn().mockResolvedValue({ queued: [], count: 0 }),
}));

vi.mock('../capture-aging.js', () => ({
  runCaptureAging: vi.fn().mockResolvedValue({ skipped: false, overdue_captures: 0, overdue_atoms: 0, retried: 0, parked_by_aging: 0 }),
}));

// conversation-capture 真实 handler 会扫描本机 ~/.claude/projects 真实文件并调用
// pushCapture——在这个纯路由行为单测里必须 mock 掉，否则结果依赖本机磁盘状态
// 且会被 pushCapture 对假 pool（query 恒返回 {rows:[]}）的真实失败信号触发
// job 失败，这不是本测试想覆盖的东西（conversation-capture 自身逻辑由
// conversation-capture.test.js + integration 测试覆盖）。
vi.mock('../conversation-capture.js', () => ({
  runConversationCapture: vi.fn().mockResolvedValue({ ok: true, pushed: 0, errors: 0 }),
}));

vi.mock('../triage-officer-rank.js', () => ({
  maybeRunTriageOfficerRank: vi.fn().mockResolvedValue({ skipped: true, reason: 'outside_window' }),
  LEADERBOARD_KEY: 'triage_officer_leaderboard',
}));

vi.mock('../triage-officer-15min.js', () => ({
  runTriageOfficer15min: vi.fn().mockResolvedValue({ skipped: true, merged: 0, autoApproved: 0 }),
}));

vi.mock('../conversation-ttl-archiver.js', () => ({
  runConversationTtlArchiver: vi.fn().mockResolvedValue({ skipped: true, archived: 0 }),
}));

vi.mock('../notion-capture-ingest.js', () => ({
  runNotionCaptureIngest: vi.fn().mockResolvedValue({ skipped: true, reason: 'interval_gate' }),
}));

vi.mock('../notion-inbox-push.js', () => ({
  runNotionProductPush: vi.fn().mockResolvedValue({ skipped: true, reason: 'empty_leaderboard' }),
}));

vi.mock('../notion-verdict-ingest.js', () => ({
  runNotionVerdictIngest: vi.fn().mockResolvedValue({ skipped: true, reason: 'not_configured' }),
}));

vi.mock('../projection/commands.js', () => ({
  applyProjectionCommands: vi.fn().mockResolvedValue({ claimed: 0, applied: 0, rejected: 0, errors: 0 }),
}));

vi.mock('../projection/outbox.js', () => ({
  runProjectionOutbox: vi.fn().mockResolvedValue({ claimed: 0, done: 0, deferred: 0, failed: 0, dead: 0 }),
}));

vi.mock('../ops-model-accounts-collector.js', () => ({
  runModelAccountsCollector: vi.fn(async () => ({ collected: 0, results: [] })),
}));
vi.mock('../projection/notion.js', () => ({
  runNotionTaskCommandIngest: vi.fn().mockResolvedValue({ skipped: true, reason: 'not_configured' }),
}));

// openclaw-agent 收割真实 handler 会 ssh 到执行机读 ~/brain-runs/<run_id>.exit——
// 与 disk-guard 同理：纯路由行为单测绝不碰真机，且假 pool 喂出来的 run_id 会让
// 每行都卡满 ssh ConnectTimeout，整轮串行 job 被拖垮。
// 收割逻辑本身由 openclaw-agent-executor.test.js 覆盖。
vi.mock('../openclaw-agent-executor.js', () => ({
  reapOpenclawAgentRuns: vi.fn().mockResolvedValue({ reaped: 0, completed: 0, failed: 0 }),
}));

// script 收割（棒 3）同理：真实 handler 会 ssh 到跑场机读 .exit，纯路由单测绝不碰真机；
// 收割逻辑由 script-executor.test.js / integration/script-executor-chain.pg.integration.test.js 覆盖。
vi.mock('../script-executor.js', () => ({
  reapScriptRuns: vi.fn().mockResolvedValue({ reaped: 0, completed: 0, failed: 0, retried: 0 }),
}));

// 秋米设备对账的真实 handler 会扫库。「哨兵写入失败不影响 job 结果」那条用例的假 pool 对
// 所有 query 一律 reject，真 handler 会把那个 reject 变成 job 失败——验的是哨兵，却被对账带红。
// 与 openclaw-agent-reaper 同理：纯注册/路由行为单测不碰库。对账逻辑本体由 device-delegation.test.js 覆盖。
vi.mock('../routing/device-delegation.js', () => ({
  reconcileDelegatedDeviceJobs: vi.fn().mockResolvedValue({ checked: 0, completed: 0, failed: 0 }),
}));

// owner-decision-deadline 真实 handler 会查 tasks/开事务；行为由 integration/owner-decision-approval.pg.integration.test.js 覆盖，
// 这里只验注册（顺序/声明的活性尺子/needsPool）。
vi.mock('../owner-decision-deadline.js', () => ({
  runOwnerDecisionDeadline: vi.fn().mockResolvedValue({ skipped: true }),
}));

// backbone-contract-sync 真实 handler 会打 GitHub/Notion——单测绝不真发网络；行为由 activity-contract-sync.test.js 覆盖。
vi.mock('../activity-contract-sync.js', () => ({
  runBackboneContractJob: vi.fn().mockResolvedValue({ sync: { skipped: true }, push: null }),
}));

// skill-dist-drift 真实 handler 会 ssh 到 MMV/跑场机取清单——单测绝不真发 ssh；行为由 skill-dist-drift.test.js（注入假执行器）覆盖。
vi.mock('../skill-dist-drift.js', () => ({
  runSkillDistDrift: vi.fn().mockResolvedValue({ skipped: true, reason: 'interval_gate' }),
}));

// skill-inventory-sync 真实 handler 会 ssh 到 MMV 跑采集程序——单测绝不真发 ssh；行为由 skill-inventory-sync.test.js 与 integration 覆盖。
// skill-registry-projection 真实 handler 会打 Notion——单测绝不真发网络；行为由 skill-registry-projection.test.js（假 Notion）覆盖。
vi.mock('../skill-registry-projection.js', () => ({
  runSkillRegistryProjection: vi.fn().mockResolvedValue({ skipped: true, reason: 'interval_gate' }),
}));

vi.mock('../skill-inventory-sync.js', () => ({
  runSkillInventorySync: vi.fn().mockResolvedValue({ skipped: true, reason: 'interval_gate' }),
}));

// recurring-tasks 真实 handler 会扫 recurring_tasks 并建单；行为由 recurring-engine.test.js（假库）
// 与 integration/recurring-engine.pg.integration.test.js（真库）覆盖，这里只验注册与接线。
vi.mock('../recurring.js', () => ({
  runRecurringTasksJob: vi.fn().mockResolvedValue({ checked: 0, created: [], baseline: 0, missed: 0 }),
}));

// alerting-flush 真实 handler 会读写 working_memory 并发飞书；持久化行为由 alerting-persist.test.js 覆盖，
// 这里只验注册与接线。部分 mock：保留 raise 等导出。
vi.mock('../alerting.js', async (importOriginal) => ({
  ...(await importOriginal()),
  flushAlertsIfNeeded: vi.fn().mockResolvedValue({ p1: false, p2: false }),
}));

// workflow-run-lost-deadline 真实 handler 会 ssh 执行机放锁/回桌面——单测绝不真发；行为由 workflow-run-lost-deadline.test.js 覆盖。
vi.mock('../workflow-run-lost-deadline.js', () => ({
  runWorkflowRunLostDeadline: vi.fn().mockResolvedValue({ scanned: 0, lost: 0 }),
}));

// commander-watchdog / workflow-trend-bark 真实 handler 会 ssh MMV 登记 escort 与发 Bark——单测绝不真发；行为由 commander-watchdog.test.js 覆盖。
vi.mock('../commander-watchdog.js', () => ({
  runCommanderWatchdog: vi.fn().mockResolvedValue({ scanned: 0, relaunched: 0, barked: 0 }),
  runWorkflowTrendBark: vi.fn().mockResolvedValue({ skipped: 'outside_window' }),
}));

vi.mock('../ops-scheduler-liveness.js', () => ({
  runSchedulerLiveness: vi.fn().mockResolvedValue({ ok: true, jobs: 0, flippedDead: 0, recovered: 0 }),
}));

// ops-collector / openclaw-guards 真实 handler 会 ssh 逃逸 + execFileSync docker（后者甚至会 docker restart 生产网关）——
// 单测绝不能碰真机；行为由各自的测试覆盖。部分 mock：只替换 handler，保留其它导出给 notion-push-sync 等模块用。
vi.mock('../ops-collector.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runOpsCollector: vi.fn().mockResolvedValue({ skipped: true }),
}));
vi.mock('../openclaw-guards.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runOpenclawGuards: vi.fn().mockResolvedValue({ skipped: true }),
}));


// 注册表单测隔离北京05:00的真实判官；判官行为仍由自身测试覆盖。
vi.mock('../crystal-judge.js', () => ({
  maybeRunCrystalJudge: vi.fn().mockResolvedValue({ triggered: false, reason: 'outside_window' }),
}));
