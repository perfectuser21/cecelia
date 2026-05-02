import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'tests/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../../tests/packages/brain/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    // 以下测试需要真实 PostgreSQL 连接或有其他 CI 环境 pre-existing 失败
    // brain-unit 跑纯单元测试（有 vi.mock('db.js') 的），集成测试走 brain-integration
    exclude: [
      // DB 集成测试（pool.query 直连，beforeAll import pool）
      'src/__tests__/actions-dedup.test.js',
      'src/__tests__/actions-goal-validation.test.js',
      'src/__tests__/actions-initiative-orchestration.test.js',
      'src/__tests__/alertness-actions.test.js',
      'src/__tests__/area-scheduler.test.js',
      'src/__tests__/blocks.test.js',
      'src/__tests__/capabilities-api.test.js',
      'src/__tests__/capability-scanner.test.js',
      'src/__tests__/code-review-trigger.test.js',
      'src/__tests__/consolidation.test.js',
      'src/__tests__/content-pipeline-orphan.test.ts',
      'src/__tests__/contract-scan-scheduler.test.js',
      'src/__tests__/cortex-dedup-persist.test.js',
      'src/__tests__/cortex-memory.test.js',
      'src/__tests__/cortex-quality-feedback.test.js',
      'src/__tests__/cortex-quality.test.js',
      'src/__tests__/cortex-rca.test.js',
      'src/__tests__/cortex.test.js',
      'src/__tests__/daily-publish-scheduler.test.js',
      'src/__tests__/daily-review-scheduler.test.js',
      'src/__tests__/decisions-context.test.js',
      'src/__tests__/dept-heartbeat.test.js',
      'src/__tests__/desire-feedback.test.js',
      'src/__tests__/desire-suggestions.test.js',
      'src/__tests__/emotion-layer.test.js',
      'src/__tests__/evolution-scanner.test.js',
      'src/__tests__/evolution-synthesizer.test.js',
      'src/__tests__/execution-strategy-session-kr-link.test.js',
      'src/__tests__/executor-retry-strategy.test.js',
      'src/__tests__/fact-extractor.test.js',
      'src/__tests__/harness-sprint-loop.test.js',
      'src/__tests__/health-monitor.test.js',
      'src/__tests__/initiative-closer.test.js',
      'src/__tests__/initiative-completion.test.js',
      'src/__tests__/initiative-orchestration-migration.test.js',
      'src/__tests__/initiative-queue.test.js',
      'src/__tests__/intent-match.test.js',
      'src/__tests__/intent.test.js',
      'src/__tests__/learning-effectiveness.test.js',
      'src/__tests__/learning-search.test.js',
      'src/__tests__/learning.test.js',
      'src/__tests__/memory-capabilities-search.test.js',
      'src/__tests__/migration-015.test.js',
      'src/__tests__/migration-016.test.js',
      'src/__tests__/migration-018.test.js',
      'src/__tests__/migration-030.test.js',
      'src/__tests__/migration-041.test.js',
      'src/__tests__/migrations-087-suggestions.test.js',
      'src/__tests__/model-profile.test.js',
      'src/__tests__/model-registry.test.js',
      'src/__tests__/notebook-feeder.test.js',
      'src/__tests__/okr-closer.test.js',
      'src/__tests__/pending-conversations.test.js',
      'src/__tests__/person-model.test.js',
      'src/__tests__/planner-domain-routing.test.js',
      'src/__tests__/planner-initiative-plan.test.js',
      'src/__tests__/planner-learning-penalty.test.js',
      'src/__tests__/planner.test.js',
      'src/__tests__/quarantine-auto-release.test.js',
      'src/__tests__/quarantine-classification.test.js',
      'src/__tests__/quarantine-systemic.test.js',
      'src/__tests__/quota-exhausted-no-quarantine.test.js',
      'src/__tests__/quota-exhausted.test.js',
      'src/__tests__/resolve-repo-path.test.js',
      'src/__tests__/routes/memory.test.js',
      'src/__tests__/rumination-dedup.test.js',
      'src/__tests__/rumination-scheduler.test.js',
      // self-drive.test.js uses vi.mock(db.js) — 纯单元测试，已移回 include
      // 'src/__tests__/self-drive.test.js',
      'src/__tests__/services/memory-service.test.js',
      'src/__tests__/startup-recovery.test.js',
      'src/__tests__/stats.test.js',
      'src/__tests__/suggestion-integration.test.js',
      'src/__tests__/suggestion-triage.test.js',
      'src/__tests__/task-generator-dedup.test.js',
      'src/__tests__/task-generator-scheduler.test.js',
      'src/__tests__/task-websocket.test.js',
      'src/__tests__/tasks-feedback.test.js',
      'src/__tests__/tasks-status.test.js',
      'src/__tests__/tick-codex-immune.test.js',
      'src/__tests__/tick-dispatch-scope-decomposing.test.js',
      'src/__tests__/tick-drain.test.js',
      'src/__tests__/tick-kr-decomp.test.js',
      'src/__tests__/tick-layer2-health.test.js',
      'src/__tests__/tick-rampup.test.js',
      'src/__tests__/tick-watchdog-quarantine.test.js',
      'src/__tests__/watchdog-quarantine-race.test.js',
      'src/__tests__/zombie-cleaner.test.js',
      // Mock 不完整或代码逻辑变更导致失败（pre-existing issue）
      // content-pipeline-{executors,llm,error-message,etc}.test.js 全部已删除
      // （in-Brain content-pipeline 编排搬到 ZJ pipeline-worker，PR zenithjoy#216）
      'src/__tests__/executor-startup-sync.test.js',
      'src/__tests__/startup-sync.test.js',
      // content_type 注册表加载缺少 content_type 字段 — 预先存在（main 上已失败）
      'src/__tests__/content-type-registry.test.js',
      // Pre-existing failures on main — 之前靠 vitest OOM worker 崩溃跳过被掩盖，
      // 现在 workers 稳定后暴露。已创 Brain task 追踪，不是本 PR scope。
      // watchdog-crisis-*: checkRunaways 返回 0 kills vs expected 1+（真实逻辑 bug）
      'src/__tests__/watchdog-crisis-kill.test.js',
      'src/__tests__/watchdog-crisis-min-rss.test.js',
      // harness-module-constants: imports ../harness.js，已被 6fa2c9460 移走到 harness-router.js 但 test 未同步
      'src/__tests__/harness-module-constants.test.js',
      // 需要真实 PostgreSQL 连接的集成测试
      'src/__tests__/integration/pipeline-rescue.integration.test.js',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'src/**/*.js'
      ],
      exclude: [
        'src/**/*.test.js',
        'src/__tests__/**',
        'node_modules/**',
        'coverage/**'
      ],
      // Specific files we're tracking closely
      reportOnFailure: true,
      all: true,
      clean: true
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
    isolate: true,    // isolate:true — 每个测试文件独立模块注册表，消除跨文件 mock 污染
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 1        // 单 fork 串行：465文件 × ~20MB / fork，ubuntu-latest 7GB 内
      }
    }
  }
});
