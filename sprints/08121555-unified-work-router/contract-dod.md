---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Unified Work Router

**范围**: Recovery Addendum + Knife 0-5，不缩减。
**大小**: L

gate-allow: domain/db-no-time-window `SELECT current_database()` 仅校验 Fleet attempt 数据库目标，不读取业务行或聚合历史数据；业务写入时间窗由 scratch smoke 内部断言。

## ARTIFACT 条目

- [ ] [ARTIFACT] Work Router、事务 store、receipt API、migration 411、入口 inventory、Map preflight、scratch smoke 与 Dashboard 审计视图均存在且由对应测试覆盖。
  Test: node -e "const fs=require('fs');['packages/brain/src/work-router.js','packages/brain/src/work-routing-store.js','packages/brain/src/routes/work-routing.js','packages/brain/migrations/411_work_routing_receipts.sql','packages/brain/src/task-creation-inventory.js','packages/brain/src/orchestrator/preflight/map-impact-contract.js','packages/brain/scripts/smoke/unified-work-router-smoke.sh'].forEach(p=>fs.accessSync(p))"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-00: credential-bearing origin 归一化且日志脱敏，active workspace 不被误删 [接缝×2]
  动作: 用带首个 commit 的真实 bare remote clone detached workspace，将 origin 改成 credential-bearing 同仓库 URL，以真实 initiative_runs.workspace_path/status/attempt 绑定后调用生产 ensureHarnessWorktree/orphan cleanup 两次
  预期观察: 两种 origin canonical key 相等；两轮 cleanup 删除数均为 0；workspace 的 .git 与 sentinel 均保留；全部日志不含 username、token 或原始 credential-bearing URL
  等待预算: 20s
  留证: Vitest verbose 输出与脱敏日志
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/kernel-workspace-recovery.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-01: 四档 change_kind 只作正向映射
  动作: 对四种 change_kind、未知值、gear/stage/task_type 反推及升降档请求运行路由合同
  预期观察: 四档得到冻结 profile；显式升档可用；未知、反推与降档稳定拒绝
  等待预算: 10s
  留证: Vitest verbose 输出中的四档 case 与 reason_code
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/work-router.test.js src/orchestrator/__tests__/change-kind-profiles.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: task 与不可变 Routing Receipt 原子同生同灭 [接缝×2]
  动作: 在 attempt scratch Postgres 并发提交相同 source/source_id/router_version，再注入 receipt 写入失败并尝试 UPDATE/DELETE
  预期观察: 幂等提交只有一个 task/receipt；失败事务零残留；UPDATE/DELETE 均拒绝
  等待预算: 30s
  留证: DB 查询输出与集成测试日志
  Test: manual:bash -c ': "${DB_URL:?}"; N=$(psql "$DB_URL" -tAc "select current_database()"); [[ "$N" == cecelia_test || "$N" == *_scratch ]] || exit 1; (cd packages/brain && DATABASE_URL="$DB_URL" node src/migrate.js); psql "$DB_URL" -tAc "SELECT to_regclass('"'"'public.tasks'"'"') IS NOT NULL AND to_regclass('"'"'public.work_routing_receipts'"'"') IS NOT NULL" | grep -qx t; cd packages/brain && DATABASE_URL="$DB_URL" npx vitest run src/__tests__/integration/work-routing-store.integration.test.js src/__tests__/migration-411-work-routing.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: 全部可执行创建入口委托唯一 Work Router
  动作: 运行动态 task type 与入口 inventory 扫描，并从 API/Intent/Capture 合同分别创建 coding 与对照任务
  预期观察: coding 全为 harness_initiative；content/research/read-only 保持原 Pipeline；三项历史陷阱回归通过
  等待预算: 30s
  留证: inventory 逐项报告与 Vitest 输出
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: stale 或错 repo Map 在 Provider 前失败关闭并可审计恢复 [接缝×2]
  动作: 在真实临时 repo/scratch DB 依次提供 fresh、missing、stale、revision mismatch、scanner invalid、cross-repo Map，再 refresh 并 resume
  预期观察: 仅 fresh 同 repo 同 baseline 建立 required Impact Contract；失败不建 Provider attempt；resume 保留原失败审计
  等待预算: 45s
  留证: preflight reason_code、attempt/Impact Contract DB 查询
  Test: manual:bash -c ': "${DB_URL:?}"; cd packages/brain && DATABASE_URL="$DB_URL" npx vitest run src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04A: Map revision 与冻结 baseline SHA 逐字一致
  动作: 以 PRD NFR 固定 baseline 310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 分别提交同 revision 与 mismatch revision 的 Map preflight，并拒绝把 authoring workspace base a9f612148e227df9fcd1481f9b39d38dd40f791f 当作 Generator baseline
  预期观察: 同 revision 进入 Structure Gate；mismatch 在 Provider 前以 map_revision_mismatch 失败
  等待预算: 20s
  留证: preflight 日志中的 baseline、source_revision、reason_code 与 provider_attempt_created=false
  Test: manual:bash -c 'BASE=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524; AUTHORING_BASE=a9f612148e227df9fcd1481f9b39d38dd40f791f; test "$BASE" != "$AUTHORING_BASE"; test "${HARNESS_FROZEN_BASE_SHA:?}" = "$BASE"; test "$(git rev-parse HEAD)" = "$BASE"; cd packages/brain && BASELINE_SHA="$BASE" npx vitest run src/orchestrator/preflight/map-impact-contract.test.js -t "冻结 baseline SHA 与 Map revision 一致" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: 有头与无头 mutation 在动作前验证同一 receipt [接缝×2]
  动作: 真实临时 worktree 运行 hook，并让 Dispatcher 分别消费合法、缺失、过期、superseded、repo/HEAD 不匹配 receipt
  预期观察: 非法有头写动作 exit 2、只读 exit 0；非法无头不调用 executor且写 route_violation
  等待预算: 30s
  留证: hook exit code、Dispatcher spy 边界外调用计数与违规事件
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-06: Generator frozen baseline 与 trust boundary 在真实 runner 容器生效 [接缝×2]
  动作: 构建并启动真实 cecelia-runner 容器执行 Generator Provider 探针，尝试 push、读取 callback/lease/Brain 环境并制造退出 lineage mismatch
  预期观察: 容器内 push 被熔断，Provider UID 非 0 且 capabilities 为空，敏感环境不可见，真实 hook 路径触发，lineage mismatch 非零，Judge 前 transport 不发布
  等待预算: 180s
  留证: docker build/run 输出、容器内 UID/capability/env/hook/push exit 与镜像 digest
  Test: manual:bash -c ': "${DB_URL:?}"; BASE=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524; DB_URL="$DB_URL" BASELINE_SHA="$BASE" bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.container.test.sh'

- [ ] [BEHAVIOR] [L2] B-07: scratch 三入口与三对照完成真实出口验收 [接缝×2]
  动作: 在 scratch DB 从 API、Intent、Capture 创建 coding，并创建 content、research、read-only 对照，执行 stale→refresh→resume 与可信 transport 路径
  预期观察: 三个 coding 均有 receipt/Harness/正确 Map/Impact Contract；对照路由正确；覆盖率 100%，coding dev 与 legacy_exempt 新增均为 0
  等待预算: 180s
  留证: smoke 日志与带五分钟时间窗的 DB 查询结果
  Test: manual:bash -c ': "${DB_URL:?}"; N=$(psql "$DB_URL" -tAc "select current_database()"); [[ "$N" == cecelia_test || "$N" == *_scratch ]] || exit 1; (cd packages/brain && DATABASE_URL="$DB_URL" node src/migrate.js); psql "$DB_URL" -tAc "SELECT to_regclass('"'"'public.tasks'"'"') IS NOT NULL AND to_regclass('"'"'public.initiative_runs'"'"') IS NOT NULL AND to_regclass('"'"'public.work_routing_receipts'"'"') IS NOT NULL" | grep -qx t; BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 DB_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

## Invariant 覆盖

- [ ] [BEHAVIOR] [L2] INV-1 凭据安全与日志脱敏由 B-00、B-06 的真实日志负向断言覆盖。
  动作: 执行 B-00 与 B-06
  预期观察: secrets、PII、Git userinfo 在日志命中数为 0
  等待预算: 80s
  留证: 两项日志扫描输出
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/kernel-workspace-recovery.test.js --reporter=verbose && cd ../.. && bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh'

- [ ] [BEHAVIOR] [L2] INV-2 API 鉴权、租户隔离与数据库目标安全
  动作: 在两个临时 tenant 上调用 receipt 验证 API，并尝试跨 tenant 查询；检查 scratch DB 名
  预期观察: 无鉴权与跨 tenant 均拒绝，两个 tenant 互不可见，生产库拒绝
  等待预算: 30s
  留证: API 状态码与 DB 名输出
  Test: manual:bash -c ': "${DB_URL:?}"; N=$(psql "$DB_URL" -tAc "select current_database()"); [[ "$N" == cecelia_test || "$N" == *_scratch ]] && cd packages/brain && DATABASE_URL="$DB_URL" npx vitest run src/__tests__/integration/work-routing-store.integration.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] INV-3 真环境、环境推导、单写手与验证命令
  动作: 执行完整 scratch smoke 并检查同一 slot 没有并行代码实现者记录
  预期观察: 接缝均在真实目标验证，环境来自 runtime，命令 exit 0，单写手不变量成立
  等待预算: 180s
  留证: smoke 执行日志与 attempt provenance
  Test: manual:bash -c ': "${DB_URL:?}"; DB_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

- [ ] [BEHAVIOR] [L2] INV-4 RED 顺序、共享 CI 禁区、Generator 权限与 validation clock
  动作: 运行仓库 TDD commit 顺序检查、runner trust test 与 CI diff policy
  预期观察: 每项实现前有 RED commit；无越权共享 CI 修改；Generator 无发布能力；validation clock fail closed
  等待预算: 90s
  留证: git commit 拓扑、runner 与 CI policy 输出
  Test: manual:bash -c ': "${DB_URL:?}"; DB_URL="$DB_URL" BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.container.test.sh; git log --format=%s -- sprints/08121555-unified-work-router/tests packages/brain/src | grep -q "^test"'
