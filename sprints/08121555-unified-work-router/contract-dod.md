---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Unified Work Router

## ARTIFACT 条目

- [ ] [ARTIFACT] Work Router、事务 store、receipt API、migration 411、Map preflight、动作闸和 scratch smoke 按冻结设计落位
  Test: node -e "for(const p of ['packages/brain/src/work-router.js','packages/brain/src/work-routing-store.js','packages/brain/src/routes/work-routing.js','packages/brain/migrations/411_work_routing_receipts.sql','packages/brain/scripts/smoke/unified-work-router-smoke.sh'])require('fs').accessSync(p)"

- [ ] [ARTIFACT] Brain 版本与 DEFINITION 同步，且实现无调试日志、死代码或未使用 import
  Test: node scripts/facts-check.mjs

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: credential origin 归一化、日志脱敏与活跃 Kernel workspace 保护 [接缝×2]
  动作: 在真实临时 Git remote/worktree 中配置含 percent-encoded userinfo 的 origin，登记 active Kernel run 后执行两次 workspace reconcile
  预期观察: 等价 origin 不被判 orphan，日志不含 userinfo，active detached cwd 保留，非活跃孤儿仍可清理
  等待预算: 20s
  留证: 两次命令 stdout/stderr 脱敏扫描与 worktree list
  Test: manual:bash -c 'npx vitest run sprints/08121555-unified-work-router/tests/recovery-workspace-contract.test.ts packages/brain/src/harness-worktree.integration.test.js'

- [ ] [BEHAVIOR] [L2] B-02: Knife 0-1 路由合同、四档正向映射与原子 receipt [接缝×2]
  动作: 对真实空 PostgreSQL 提交四个 change_kind、unknown coding、歧义 repo 与重复 source 请求，并尝试 UPDATE/DELETE receipt
  预期观察: 四档 4/4 命中批准 profile；coding 均为 harness_initiative；歧义阻塞；task/receipt 同事务同生灭；重复请求幂等；UPDATE/DELETE 拒绝
  等待预算: 60s
  留证: Vitest 输出与 5 分钟时间窗 work_routing_receipts 查询
  Test: manual:bash -c 'DB_URL="$DB_URL" npx vitest run sprints/08121555-unified-work-router/tests/knife01-routing-contract.test.ts packages/brain/src/__tests__/integration/work-routing-store.integration.test.js'

- [ ] [BEHAVIOR] [L2] B-03: Knife 2 冻结 33 入口并锁定三个既有陷阱
  动作: 从 VALID_TASK_TYPES 与 task creation inventory 实时扫描全部入口，再执行 Planner、Proposal、Capture、Intent、Actions 入口合同
  预期观察: 70 类型唯一；33 入口逐项有合同且无业务裸 INSERT；Planner 有 task_type；Proposal 不以 skill 充 task_type；Capture 只写真实 decisions 列
  等待预算: 90s
  留证: inventory 逐项报告与受影响 Vitest 输出
  Test: manual:bash -c 'npx vitest run sprints/08121555-unified-work-router/tests/knife01-routing-contract.test.ts packages/brain/src/__tests__/work-router-entrypoints.test.js packages/brain/src/routes/__tests__/capture-atoms-routing.test.js'

- [ ] [BEHAVIOR] [L2] B-04: Knife 3 fresh Map 建立 required Impact Contract 与窄化 recovery [接缝×2]
  动作: 对真实临时 repo 依次提供 fresh、missing、stale、revision mismatch、scanner invalid 与跨 repo Map
  预期观察: 仅 fresh 同 repo 基线进入 Structure Gate；其余不创建 Provider；合法 map_recovery 单次消费且修复后全量重扫 fresh
  等待预算: 60s
  留证: preflight reason_code、Provider attempt 计数、Impact Contract 与 scanner revision 查询
  Test: manual:bash -c 'DB_URL="$DB_URL" npx vitest run sprints/08121555-unified-work-router/tests/knife3-map-contract.test.ts packages/brain/src/orchestrator/preflight/map-impact-contract.integration.test.js packages/brain/src/orchestrator/__tests__/map-recovery-contract.test.js'

- [ ] [BEHAVIOR] [L2] B-05: receipt validation API 真实认证、完整 schema 与稳定 reason_code [接缝×2]
  动作: 以无 token、错误 Bearer token、有效 `CECELIA_INTERNAL_TOKEN` 和 superseded receipt 四次真实 HTTP 请求 validation API；有效请求逐字段携带 task/run/repo/branch/base_sha
  预期观察: 前两次 HTTP 401 且分别为 auth_required/auth_invalid；有效请求 HTTP 200、exact keys 与六个上下文字段匹配；superseded 请求 HTTP 409 且 reason_code=receipt_superseded
  等待预算: 20s
  留证: 四次 HTTP status 与脱敏 JSON body（不得记录 token）
  Test: manual:bash -c ': "${CECELIA_INTERNAL_TOKEN:?}"; : "${ROUTING_RECEIPT_ID:?}"; : "${SUPERSEDED_ROUTING_RECEIPT_ID:?}"; : "${ROUTING_TASK_ID:?}"; : "${ROUTING_RUN_ID:?}"; : "${ROUTING_REPO:?}"; : "${ROUTING_BRANCH:?}"; : "${ROUTING_BASE_SHA:?}"; U="http://127.0.0.1:5221/api/brain/work-routing/receipts/$ROUTING_RECEIPT_ID/validate?task_id=$ROUTING_TASK_ID&run_id=$ROUTING_RUN_ID&repo=$ROUTING_REPO&branch=$ROUTING_BRANCH&base_sha=$ROUTING_BASE_SHA"; A=$(mktemp); I=$(mktemp); S=$(mktemp); X=$(mktemp); trap '"'"'rm -f "$A" "$I" "$S" "$X"'"'"' EXIT; [ "$(curl -sS -o "$A" -w "%{http_code}" "$U")" = 401 ] && jq -e '"'"'keys==["error","reason_code","valid"] and .valid==false and .reason_code=="auth_required" and (.error|type=="string" and length>0)'"'"' "$A"; [ "$(curl -sS -H "Authorization: Bearer invalid-contract-token" -o "$I" -w "%{http_code}" "$U")" = 401 ] && jq -e '"'"'keys==["error","reason_code","valid"] and .valid==false and .reason_code=="auth_invalid"'"'"' "$I"; [ "$(curl -sS -H "Authorization: Bearer $CECELIA_INTERNAL_TOKEN" -o "$S" -w "%{http_code}" "$U")" = 200 ] && jq -e --arg rid "$ROUTING_RECEIPT_ID" --arg tid "$ROUTING_TASK_ID" --arg run "$ROUTING_RUN_ID" --arg repo "$ROUTING_REPO" --arg branch "$ROUTING_BRANCH" --arg sha "$ROUTING_BASE_SHA" '"'"'keys==["base_sha","branch","repo","routing_receipt_id","run_id","task_id","valid"] and .valid==true and .routing_receipt_id==$rid and .task_id==$tid and .run_id==$run and .repo==$repo and .branch==$branch and .base_sha==$sha'"'"' "$S"; V="http://127.0.0.1:5221/api/brain/work-routing/receipts/$SUPERSEDED_ROUTING_RECEIPT_ID/validate?task_id=$ROUTING_TASK_ID&run_id=$ROUTING_RUN_ID&repo=$ROUTING_REPO&branch=$ROUTING_BRANCH&base_sha=$ROUTING_BASE_SHA"; [ "$(curl -sS -H "Authorization: Bearer $CECELIA_INTERNAL_TOKEN" -o "$X" -w "%{http_code}" "$V")" = 409 ] && jq -e '"'"'keys==["error","reason_code","valid"] and .valid==false and .reason_code=="receipt_superseded"'"'"' "$X"'

- [ ] [BEHAVIOR] [L2] B-06: Knife 4 有头无头动作闸与 Generator trust boundary [接缝×2]
  动作: 真实 worktree 对合法/缺失/过期/superseded/mismatch receipt 执行读写工具，并启动 Generator 容器命令链
  预期观察: 无效写动作前 exit 2 或 Dispatcher 拒绝 executor；只读通过；Generator push 失败且 callback/lease 凭据不可见
  等待预算: 90s
  留证: hook exit code、route_violation、容器 uid/capability/env/push 输出
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && npx vitest run sprints/08121555-unified-work-router/tests/knife4-guards-contract.test.ts packages/brain/src/routes/__tests__/work-routing-validation.integration.test.js packages/brain/src/orchestrator/__tests__/dispatcher-routing-receipt.test.js && bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh'

- [ ] [BEHAVIOR] [L2] B-07: Knife 5 scratch 多入口、stale/resume、迁移与可观测性真实验收 [接缝×2]
  动作: 在 attempt-scoped DB 从 API、Intent、Capture 建 coding，并建 content、research、read-only review 对照，随后制造 stale Map、refresh 并 resume
  预期观察: coding 3/3 有 receipt/Harness/正确 Map/active Impact；对照不误路由；stale 不进 Provider且恢复保留审计
  等待预算: 180s
  留证: smoke stdout 与 5 分钟时间窗 DB 查询结果
  Test: manual:bash -c 'DB_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh && DB_URL="$DB_URL" npx vitest run sprints/08121555-unified-work-router/tests/knife5-acceptance-contract.test.ts packages/brain/src/__tests__/work-routing-observability.test.js'

- [ ] [BEHAVIOR] [L2] INV-01: required DevGate 与版本事实保持一致
  动作: 对候选最终提交依次执行三项 Brain DevGate
  预期观察: facts、版本同步与 DoD 映射全部 exit 0
  等待预算: 60s
  留证: 三命令完整 stdout 和 exit code
  Test: manual:bash -c 'node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs'

- [ ] [BEHAVIOR] [L2] INV-02: 凭据与日志安全不回退
  动作: 运行 recovery regression 并扫描其捕获日志中的 URL userinfo 与 callback/lease token 名值
  预期观察: 测试真实走 credential origin，输出只含脱敏 URL，敏感值命中数为 0
  等待预算: 30s
  留证: Vitest 日志脱敏扫描输出
  Test: manual:bash -c 'npx vitest run sprints/08121555-unified-work-router/tests/recovery-workspace-contract.test.ts packages/brain/src/harness-worktree.integration.test.js'

## 铁律显式 N/A

- 租户隔离/双租户：路由 receipt 不承载租户业务数据；真实 DB 测试仍创建至少两个 source 并断言不串。
- 端点鉴权：receipt validation API 的真实 Bearer 认证、成功 exact schema 与稳定错误 reason_code 由 B-05 独立机检。
- 真机/RPA、视频、发布：本 Sprint 不涉及，N/A。
- 周期扫描付费第三方 API、后台 job consumer、OS 多端 UI：本 Sprint 不涉及，N/A。

## 失败判定

任一 BEHAVIOR 非零、任一接缝两次结果不一致、出现新增 `legacy_exempt`、Provider 在无 active Impact Contract 时启动、或日志泄露凭据，均为 Sprint FAIL。
