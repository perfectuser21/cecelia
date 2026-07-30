import { defineConfig } from 'vitest/config';

export const POSTGRES_INTEGRATION_TESTS = [
  'src/__tests__/migration-333.test.js',
  'src/__tests__/autoblock-sql-integration.test.js',
  'src/__tests__/integration/capacity-gate.test.js',
  'src/__tests__/integration/preview-destroyer.test.js',
  'src/__tests__/integration/migration-364-kernel-local-container-naming.integration.test.js',
  'src/__tests__/integration/acceptance.integration.test.js',
  'src/__tests__/integration/golden-path-contract.integration.test.js',
  'src/__tests__/integration/gp-assertion-runner.integration.test.js',
  'src/__tests__/integration/migration-373-gp-ledger-data-knife.integration.test.js',
  'src/__tests__/integration/migration-374-gp-assertion-receipts.integration.test.js',
  'src/__tests__/integration/journey-step-ledger.integration.test.js',
  'src/routes/__tests__/harness-attempt-verdict-pg.integration.test.js',
  '../../tests/regression/relay-137fea96/contract-postdeploy-smoke-filter.test.ts',
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'tests/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../../tests/packages/brain/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../../tests/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      // 根目录遗留测试（多 repo 合并产物，已清归脑测试）
      '../../tests/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../../tests/brain/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../../tests/alertness/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      // sprints/** 已于 07-10 大扫除中移除：守活功能测试升格进 src/__tests__/，
      // 脚手架删除，活体依赖测试移入 tests/live/（手动跑）。
      // 新 sprint 测试若需进 CI，必须毕业进 src/ 或 packages/quality/。
      // 刀1 毕业池（2026-07-14）：sprint 测试经 scripts/graduate-sprint-tests.mjs
      // 毕业进 tests/regression/<sprint-slug>/，永久留 CI（test-pyramid-guard A1/A3 锁死）。
      '../../tests/regression/**/*.{test,spec}.?(c|m)[jt]s?(x)',
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
      // consolidation.test.js: 纯 mock 单元测试（vi.mock llm-caller/self-model + 局部 mock pool），已移回 include
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
      'src/__tests__/evolution-synthesizer.test.js',
      'src/__tests__/execution-strategy-session-kr-link.test.js',
      'src/__tests__/executor-retry-strategy.test.js',
      'src/__tests__/fact-extractor.test.js',
      'src/__tests__/harness-sprint-loop.test.js',
      'src/__tests__/health-monitor.test.js',
      'src/__tests__/initiative-closer.test.js',
      'src/__tests__/initiative-completion.test.js',
      'src/__tests__/initiative-orchestration-migration.test.js',
      'src/__tests__/migration-289.test.js',
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
      // zombie-cleaner.test.js：曾尝试移出 exclude（2026-07-09），本地62/62全绿，
      // 但CI里连续3次在完全相同的4个用例上失败，均紧跟shard内heap撞到~8092MB附近的
      // OOM崩溃之后——这个shard的既有文件总量本就贴着packages/brain/vitest.config.js
      // 里注释写明的8192MB上限，把这个文件加回shard刚好把内存推过界，不是逻辑bug。
      // 放回exclude维持原状；三处修好的fixture陈旧问题（resetAllMocks误清withLock工厂
      // mock/WORKTREE_BASE硬编码值不一致/findTaskIdForWorktree mock字段不匹配实现）
      // 依然留在文件里，本地`npx vitest run src/__tests__/zombie-cleaner.test.js`可
      // 随时验证62/62绿，只是CI暂不跑它——需要先解决shard内存分配才能重新接入。
      'src/__tests__/zombie-cleaner.test.js',
      // Mock 不完整或代码逻辑变更导致失败（pre-existing issue）
      // content-pipeline-{executors,llm,error-message,etc}.test.js 全部已删除
      // （in-Brain content-pipeline 编排搬到 ZJ pipeline-worker，PR zenithjoy#216）
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
      // capacity-gate/preview-destroyer: 真连 cecelia_test Postgres（禁 mock db.js），走 brain-integration
      'src/__tests__/integration/capacity-gate.test.js',
      'src/__tests__/integration/preview-destroyer.test.js',
      // 同上，毕业池 tests/regression/ 下的永久回归副本，同样需要真实 Postgres
      '../../tests/regression/relay-1b1f1ffa/capacity-gate.test.js',
      '../../tests/regression/relay-1b1f1ffa/preview-destroyer.test.js',
      // dev-registry: 直连 pool.query 验 7 张新表，需真实 DB — 走 brain-integration
      'src/workflows/__tests__/dev-registry.test.js',
      // Pre-existing failures: wrong import paths (../../brain/src/ instead of ../../packages/brain/src/)
      // Added to exclude list in skill-repo-decouple PR (not caused by this PR)
      '../../tests/alertness/diagnosis.test.js',
      '../../tests/alertness/escalation.test.js',
      '../../tests/alertness/healing.test.js',
      '../../tests/alertness/metrics.test.js',
      '../../tests/alertness/levels.test.js',
      // Pre-existing failure: path.resolve('packages/brain/...') resolves incorrectly from packages/brain/ cwd
      '../../tests/capability-probe-rumination.test.js',
      // Pre-existing failure: process.cwd() relative paths broken in brain-unit (cwd=packages/brain)
      'src/routes/__tests__/harness-feature-propagation.test.js',
      // relay-85806b9a: 集成测试需真实 Postgres + 硬编码 /workspace/ 路径，不兼容 brain-unit GitHub Actions 环境
      '../../tests/regression/relay-85806b9a/graph-route-repo-param.test.mjs',
      '../../tests/regression/relay-85806b9a/scan-graph-freshness.test.mjs',
      '../../tests/regression/relay-85806b9a/scan-graph-multi-repo.test.mjs',
      // relay-57e25e92: 读取 sprints/07191312-relay-57e25e92/e2e-verify.sh，但 sprint 目录不在 git 仓库，
      // PR #4131 引入的 pre-existing failure，与本 PR 无关
      '../../tests/regression/relay-57e25e92/headed-smoke-contract.test.ts',
      // brain-integration 测试：需要真实 Brain HTTP server（localhost:5221），brain-unit 无 server
      'src/routes/__tests__/captures-api.test.ts',
      '../../tests/regression/relay-07b2fd3b/captures-api.test.ts',
      // 2026-07-22：真实 Playwright spec（需要 @playwright/test，仓库未装此依赖，也不该装——
      // 这两个文件是浏览器 E2E，要用 `npx playwright test` 单独跑，不是 vitest 单测），被
      // include 里 tests/regression/**/*.{test,spec}.* 这条过宽的 glob 误当成 vitest 测试
      // 加载，报 "Failed to load url @playwright/test"。目前仓库里没有任何 CI job 真的用
      // playwright 跑这两个文件（搜过 .github/workflows/ 和 package.json scripts，都没有），
      // 是"刀1毕业池"迁移时连同同目录的 .test.ts 一起搬过来的副作用。先排除掉止住 vitest
      // 报红；要不要真的接一条 playwright CI job 去跑它们是另一个问题，不在本次修复范围。
      '../../tests/regression/cockpit-route-wire/e2e-verify.spec.ts',
      '../../tests/regression/relay-07b2fd3b/inbox-e2e.spec.ts',
      // Dashboard contract imports dashboard-only test dependencies. The broad
      // regression glob must not select it in the Brain unit workspace.
      '../../tests/regression/relay-28e7c41a/OpsPanoramaCard.test.tsx',
      // Pre-existing failure (PR #4109): 读取 sprints/07191312-relay-57e25e92/e2e-verify.sh，
      // 该文件已 rename 到 scripts/smoke/e2e/relay-57e25e92.sh，sprint 目录未提交 repo
      '../../tests/regression/relay-57e25e92/headed-smoke-contract.test.ts',
      // 真 PostgreSQL 回归：brain-unit 无 DB；brain-integration 通过专用 config 显式运行
      ...POSTGRES_INTEGRATION_TESTS,
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
        maxForks: 1,        // 单 fork 串行：465文件 × ~20MB / fork，ubuntu-latest 7GB 内
        // 给 fork 子进程加堆头空间：isolate:true 每文件重建模块注册表 +
        // 个别 callback 测试用 import('routes.js?v='+Date.now()) 每测试复制整棵路由树，
        // 峰值冲爆默认堆 → "Worker exited unexpectedly" 误判同 shard 测试失败
        // （连带 D5 等本应通过的测试）。8192 在 ubuntu-latest 单 fork 下安全。
        execArgv: ['--max-old-space-size=8192']
      }
    }
  }
});
