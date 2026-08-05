# 工厂 GP 五件套第一刀设计：F0~F7 八条最薄 smoke + F2 sidecar 钉子

Brain task: ea63b9aa；决策：归位体系 2a8bf656；事故来源 issue 53e7ee4b。

## 背景
8 条工厂 journey 7 条标 mvp、0 条有 smoke 守卫（口头 mvp）；2026-08-05 十一连爆全因工厂自身无灯变红。拍板：把业务 GP 五件套纪律套进工厂域，walking skeleton 先铺最薄层。

## 机制事实（研究员实证，ref=origin/main b3702cc3b6）
- 棘轮登记只改 2 处：脚本放 `packages/brain/scripts/smoke/`（glob 目录，`scripts/smoke/e2e/` 不在内）+ 文件名加入 `packages/quality/smoke-allowlist.txt`；不登记= UNREGISTERED 红
- 调用契约：`bash "$script"` 无参、cwd=仓根、exit 0=PASS；惯例 `set -euo pipefail`、`BRAIN_URL` 可覆盖、断言用 node -e 不用 jq
- CI 环境：postgres(pgvector) 库 `cecelia_test` **migrations 全跑过**；**Brain 容器活着**（BRAIN_URL 通、/tick/status 就绪门）；PG* 全套可 psql 直连。限制：`CECELIA_TICK_ENABLED=false`（不能断言调度真执行）、零历史数据、无 Notion/Langfuse/微信凭据
- cecelia 棘轮无 FIRE_TEST 约定 → 本刀自建**脚本内开发期约定**：`FIRE_TEST=1` 时故意断言失败（proven-to-fire 验证口），CI 不设此变量
- `journeys.e2e_test_path` 仅 ledger 展示（present/missing），无执行器——回填仍做（账本诚实）

## 交付物

### 1. 八个 smoke（命名 `factory-f<N>-<slug>-smoke.sh`）
统一模板：头部诚实声明（本闸级别=结构/契约级为主+若干运行时点；**结构级断言不代表运行时行为已验证**；tick=false 环境下不断言调度真跑）、`set -euo pipefail`、`ok()/fail()` 计数、`FIRE_TEST=1` 自炸口、结尾 `PASS: n FAIL: 0`。

断言表（[运行时]=真打 CI 活 Brain/psql；[结构]=grep/node -e 导入）：

| 脚本 | 断言（2~4 条/条） |
|---|---|
| **factory-f0-proposal-smoke.sh** | [运行时] psql `golden_paths` 表存在且 status CHECK 含 candidate/approved/vetoed；psql `golden_path` 表含 owner_task_id 列；GET /api/brain/golden-paths 与 /decisions 均 200。[结构] routes/golden-paths.js 含 /approve 与 /veto；executor.js 含 'golden_path_proposal' 分支 |
| **factory-f1-devloop-smoke.sh** | [结构] node -e 导入 lib/review-task-types.js：数组含 code_review/arch_review；executor.js、callback-processor.js、routes/execution.js 三处 import 该 SSOT（防复制漂移）。[运行时] psql `dispatch_events` 表存在。[结构] executor.js 含 triggerCodexReview 与 requeueTask |
| **factory-f2-deploy-smoke.sh** | **[结构·钉子] `scripts/lib/bluegreen-sidecar.sh` 必须含 drain-cancel 调用**（53e7ee4b：现 0 处=今天必红，修复同 PR）。[结构] brain-deploy.sh 含 drain_before_swap + drain_cancel_with_retry 定义。[运行时] POST /tick/drain → drain-status.draining=true → POST /tick/drain-cancel 恢复（幂等，测后复原，先例 smoke-runtime.sh:138-168）。[结构] drain.js 导出 DRAIN_RESTORE_MAX_AGE_MS；scripts/smoke/e2e/deploy-daily-drill.sh 存在 |
| **factory-f3-nightly-smoke.sh** | [结构] scheduler-jobs.js JOBS 含 arch-review 与 ci-patrol；server.js 调 startSchedulerJobsLoop；daily-review-scheduler.js 含 arch_review 窗口与 ci_patrol 北京 08:00+当日去重；tick-runner.js 挂 line-strategist-dispatch。诚实声明：只证注册表有，不证到点真跑 |
| **factory-f4-selfheal-smoke.sh** | [结构] node -e 导入 executor-contracts.js：VALID_EXECUTOR_KINDS 恰 7 kind 且每 kind 有 probe 函数；lib/codex-review-liveness.js 导出 probeCodexReviewLock+CODEX_REVIEW_LOCK_DIR 且 contracts import 它。[运行时] psql `circuit_breaker_states` 表存在；GET /api/brain/health 200 且含 organs 键 |
| **factory-f5-cockpit-smoke.sh** | [运行时] GET /api/brain/health 200 organs 含 scheduler/circuit_breaker 子键；GET /api/brain/healthz status∈ok/degraded/critical。诚实声明：前端渲染不在本闸 |
| **factory-f6-inbox-smoke.sh** | [运行时] psql `capture_atoms` 与 `captures` 表存在；GET /api/brain/capture-atoms 200。[结构] scheduler-jobs.js 含 capture-triage / triage-officer-rank / triage-officer-15min 三条 |
| **factory-f7-memory-smoke.sh** | [运行时] psql `working_memory` 与 `memory_stream` 表存在。[结构] notion-push-sync.js 导出 runNotionPushSync 与 buildDecisionNotionProperties。诚实声明：Notion 真推送无凭据不验证 |

### 2. `packages/quality/smoke-allowlist.txt` 追加 8 行（按字母序插入既有排序位置）

### 3. F2 钉子逼出的修复：`scripts/lib/bluegreen-sidecar.sh`
compose up 成功 + 新 Brain healthz 等待通过之后，追加 drain-cancel 轮询：`curl -m 5 -X POST "$BRAIN_URL/api/brain/tick/drain-cancel"` 重试 ≤5 次（间隔 5s），成功/失败都响亮日志（不 fail 部署——cancel 失败时 15min 过期闸与 getDrainStatus 是下一层兜底，但必须留下红日志痕迹）。BRAIN_URL 取 sidecar 既有变量（读脚本现状适配）。

### 4. merge 后 DB 收尾（不进 PR）：journeys.e2e_test_path 八条回填 `packages/brain/scripts/smoke/factory-fN-...-smoke.sh` + notion_synced_at=NULL

## TDD 顺序
commit-1：8 smoke + allowlist（本地实跑：F0/F1/F3~F7 七绿 + **F2 红**=钉子实弹；每条 FIRE_TEST=1 亲见自炸红）；commit-2：sidecar 修复 → F2 转绿。棘轮"新债不许欠"由 PR 终态满足（CI 跑 PR head）。

## 测试策略
unit=八条 smoke 本体（它们就是测试）+ FIRE_TEST 自炸验证；integration=本地对活 Brain 实跑全部八条（本机 5221 生产 Brain，F2 的 drain/drain-cancel 幂等且有先例）；E2E=CI Smoke Glob Runner TOTAL 351→359 UNREGISTERED=0 全绿。

## 不做
- 不动既有 smoke/denylist/debt；不进 smoke-core（蓝绿 pre-swap 子集，另议）
- 不做 F 系夜巡独立 workflow（五件套第 3 件，下一刀）
- 不断言"调度真跑/Notion 真推"（环境限制，诚实声明）
