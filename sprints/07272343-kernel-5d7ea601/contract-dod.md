---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Preview current-SHA gate recovery

**范围**: 真实 `.github/workflows/preview-deploy.yml` -> `packages/brain/src/routes/preview.js` -> isolated PostgreSQL -> GitHub PR #4372 read-only truth -> `orchestrator_decision_log` current-SHA gate。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js` 存在且含 10 个稳定 reason 独立用例
  Test: node -e "const c=require('fs').readFileSync('sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js','utf8');for (const k of ['stale_check_sha','wrong_repo','wrong_pr','wrong_workflow_run','wrong_run_task','missing_required_context','preview_required_failure','local_required_context_failure','missing_context_mapping','external_infrastructure_failure']) if(!c.includes(k)) process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] 真实 workflow start 成功时只返回 `port/db_name/status`
  动作: 受控 runner 按 `.github/workflows/preview-deploy.yml` 当前 shell 语义发送真实 `POST /api/brain/preview/start` 请求。
  预期观察: HTTP 200，body 顶层 keys 严格等于 `["db_name","port","status"]`，无 forbidden fields。
  验证命令: Test: manual:bash
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case start-success-exact-shape

- [ ] [BEHAVIOR] [L2] `/preview/status/:pr` 返回 exact status-route keys，within 60s 带出 current SHA/Draft/review_required
  动作: 对当前 PR 先执行一次成功 start，再轮询 `GET /api/brain/preview/status/:pr`。
  预期观察: within 60s 获得 HTTP 200，response keys 严格匹配合同，`draft=true` 且 `review_required=true`。
  验证命令: Test: manual:bash
    DEADLINE=$((SECONDS + 60))
    until node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case status-success-exact-shape; do
      [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 60s status route keys still incorrect"; exit 1; }
      sleep 2
    done
    echo "OK: within 60s status route exact keys visible"

- [ ] [BEHAVIOR] [L2] route 把 current SHA 真相落到 isolated PG 与 `orchestrator_decision_log`
  动作: 在隔离 PG 中运行真实 start 链路。
  预期观察: `preview_environments` 与 `orchestrator_decision_log` 各新增 1 行，identity/repository/workflow/task/run/current SHA 全部精确一致。
  验证命令: Test: manual:bash
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case decision-log-ground-truth

- [ ] [BEHAVIOR] [L2] `stale_check_sha` 有独立 test 与独立 counterfactual
  动作: 先以旧 SHA 写入一条 positive receipt，再把 GitHub 当前 head 切到新 SHA 后重放旧请求。
  预期观察: 旧 SHA 独立返回 `reason=stale_check_sha`，新 SHA 独立恢复成功。
  验证命令: Test: manual:bash
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case reason-stale_check_sha

- [ ] [BEHAVIOR] [L2] `wrong_repo` 独立返回稳定 reason
  动作: 发送 repository authority 错配的真实 start 请求。
  预期观察: HTTP 409，body 精确为 `{"error":"preview authorization rejected","reason":"wrong_repo"}`。
  验证命令: Test: manual:bash
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case reason-wrong_repo

- [ ] [BEHAVIOR] [L2] `wrong_pr` 独立返回稳定 reason
  动作: 发送 PR authority 错配的真实 start 请求。
  预期观察: HTTP 409，body 精确为 `wrong_pr`。
  验证命令: Test: manual:bash
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case reason-wrong_pr

- [ ] [BEHAVIOR] [L2] `wrong_workflow_run` 独立返回稳定 reason
  动作: workflow_run_id 错配时重放真实 start 请求。
  预期观察: HTTP 409，body 精确为 `wrong_workflow_run`。
  验证命令: Test: manual:bash
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case reason-wrong_workflow_run

- [ ] [BEHAVIOR] [L2] `wrong_run_task` 独立返回稳定 reason
  动作: task/run authority 错配时重放真实 start 请求。
  预期观察: HTTP 409，body 精确为 `wrong_run_task`。
  验证命令: Test: manual:bash
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case reason-wrong_run_task

- [ ] [BEHAVIOR] [L2] `missing_required_context` 与 `local_required_context_failure` 各自独立，不允许 OR 合并
  动作: 分别构造 authority 缺必填上下文与本地上下文守卫失败两种真实请求。
  预期观察: 两次调用分别返回各自唯一 reason，不互相吞并。
  验证命令: Test: manual:bash
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case reason-missing_required_context
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case reason-local_required_context_failure

- [ ] [BEHAVIOR] [L2] `preview_required_failure`、`missing_context_mapping`、`external_infrastructure_failure` 各自独立
  动作: 分别构造 preview 必要条件失败、context map 缺失、GitHub oracle 故障三种真实链路。
  预期观察: 三次调用分别返回各自唯一 reason，不依赖 regex/表格合并断言。
  验证命令: Test: manual:bash
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case reason-preview_required_failure
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case reason-missing_context_mapping
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case reason-external_infrastructure_failure

- [ ] [BEHAVIOR] [L2] legacy adapter entry `POST /preview/allocate` 仍受同一 current-SHA 门禁与隔离 PG 守卫
  动作: 分别以正确 authority 和错误 authority 调用 named legacy adapter entry。
  预期观察: pass/fail 与新入口一致；错误 authority 不得绕过 gate。
  验证命令: Test: manual:bash
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case legacy-adapter-entry

- [ ] [BEHAVIOR] [L2] B5 最终链路分层存储齐全，merge/deploy spy 次数符合 0/0 与 1/1 合同
  动作: 对同一 current final SHA 驱动 staging/prod/report/verdict/approval 存储链，但停在真实外部动作前。
  预期观察: staging E2E、production promotion、final report、evaluator PASS、judge PASS、human approval rows 各自独立存在；负向 spy=0/0，单条完整授权链正向 spy=1/1。
  验证命令: Test: manual:bash
    node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case final-chain-storage-and-spies

## Invariant 覆盖

- [ ] [BEHAVIOR] INV-1 真环境验证: B1/B2/B3/B4/B5 全部走真实 workflow/route/PG/GitHub 只读链路
  Test: manual:bash node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case environment-seam-proof
- [ ] [BEHAVIOR] INV-2 端点鉴权: `Authorization: Bearer ${DEPLOY_TOKEN}` 缺失或错误时 start 仍 401
  Test: manual:bash node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case auth-required
- INV-3 租户隔离: N/A（本 sprint 不触租户业务表，唯一库写路径是隔离 preview/orchestrator 账本）
- [ ] [BEHAVIOR] INV-4 审批禁直合: merge/deploy/human approval 不做真实 POST
  Test: manual:bash node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case no-real-merge-deploy-post
- [ ] [BEHAVIOR] INV-5 SHA 对账: head 变化后旧 receipt/approval 全失效
  Test: manual:bash node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case head-change-invalidates-old-receipts
- [ ] [BEHAVIOR] INV-6 真实退出码: Red/Green 命令记录真实 exit code，timeout/import/connection refused 不得冒充业务红
  Test: manual:bash node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case red-green-exit-codes
- [ ] [BEHAVIOR] INV-7 多轮真扫: B3 重跑同一 workflow/route 于新 SHA 上，非单轮冷启动假象
  Test: manual:bash node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case rerun-same-workflow-new-sha
- [ ] [BEHAVIOR] INV-8 共享 CI 禁区: 仅 preview workflow/route/related tests 改动，不引入无合同授权的共享基础设施旁路
  Test: manual:bash node sprints/07272343-kernel-5d7ea601/tests/preview-current-sha-gate.test.js --case no-shared-ci-bypass
