---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Preview workflow-route-authorities current-SHA gate

**范围**: 真实 preview workflow 请求/响应收据、preview route server-owned authority gate、isolated PG identity/SHA 对账、legacy adapter 原路径、postmerge staging/promotion/report 独立记录、零生产 mutation
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] workflow start/status contract 测试固定读取真实 `.github/workflows/preview-deploy.yml`，不允许 helper seam
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/preview-deploy.yml','utf8');if(!c.includes('/api/brain/preview/start')||!c.includes('/api/brain/preview/status/'))process.exit(1)"

- [ ] [ARTIFACT] preview route PG contract 测试文件存在并覆盖 authority/blocker/legacy/postmerge 四类场景
  Test: node -e "const c=require('fs').readFileSync('sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts','utf8');['stale_check_sha','wrong_repo','wrong_run_task','missing_required_context','preview_required_failure','local_required_context_failure','missing_context_mapping','external_infrastructure_failure','legacy adapter','postmerge staging','production promotion','final report'].forEach(k=>{if(!c.includes(k))process.exit(1)})"

- [ ] [ARTIFACT] task-plan 明确 `review_required=true` 语义与 `TEST_DATABASE_URL` 安全约束
  Test: node -e "const c=require('fs').readFileSync('sprints/07272326-kernel-d3b00fb0/task-plan.json','utf8');if(!c.includes('review_required=true')||!c.includes('TEST_DATABASE_URL'))process.exit(1)"

## BEHAVIOR 条目（全部三段式、真实执行）

- [ ] [BEHAVIOR] [L2] workflow start step 保留原始 HTTP status/body 且逐项发送 authority identifiers
  动作: 执行从真实 `.github/workflows/preview-deploy.yml` 提取出的 start step，对本地 HTTP 记录器发请求
  预期观察: 收据同时保留 status 与 body；请求体含 `pr_number/branch_name/repository/base_repo/workflow_run_id/task_id/run_id/check_sha/review_required`
  Test: manual:bash -c "npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-workflow-route-authority.contract.test.ts -t 'workflow start step 保留原始 HTTP status/body 且逐项发送 authority identifiers' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] workflow start step 在 422 时仍保留 body 与 status，不允许 `curl -f/-s` 吞收据
  动作: 对同一真实 start step 注入返回 422 JSON 的本地 HTTP 记录器
  预期观察: 脚本业务断言失败，但测试仍能读到完整 422 body 与状态码；丢 body/只剩 exit code 都不合格
  Test: manual:bash -c "npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-workflow-route-authority.contract.test.ts -t 'workflow start step 在 422 时仍保留 body 与 status' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] workflow status step 读取真实 `/preview/status/:pr` 时保留 body/reason，而不是只吞成空字符串
  动作: 执行真实 status polling step，对返回 `reason=stale_check_sha` 的本地 HTTP 记录器轮询
  预期观察: 轮询记录可见 `status` 与 `reason`，具名 blocker 可被独立断言
  Test: manual:bash -c "npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-workflow-route-authority.contract.test.ts -t 'workflow status step 保留 body 中的 status/reason' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] preview route 只把 caller 字段当 identifier claim 并写 authority-bound receipt
  动作: 在 isolated PG 中种下 preview/task/run 记录，并用真实 GitHub PR #4372 当前 Draft/head 发起 route 合同测试
  预期观察: route 从服务端真相补全 `target_environment/repository/base_repo/current_head_sha/required_contexts`；`orchestrator_decision_log` 与业务 receipt 按 repository/run/task/current SHA 精确对账
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'preview route 只把 caller 字段当 identifier claim 并写 authority-bound receipt' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] stable blocker: stale_check_sha 独立拒绝旧 head 收据
  动作: 用真实 GitHub PR #4372 当前 head 派生一条过期 SHA 负例，再发起同 route 合同测试
  预期观察: 仅该负例返回稳定 `stale_check_sha`；同一 identity 的 current head 正例单独通过
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'stable blocker: stale_check_sha' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] stable blocker: wrong_repo 与 wrong_run_task 各自独立拒绝，不允许 OR 合并
  动作: 分别构造 wrong_repo 与 wrong_run_task 两条 isolated PG 负例
  预期观察: 两条各自返回精确 stable reason，且各自正例只在 identity 全等时通过
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'stable blocker: wrong_repo|stable blocker: wrong_run_task' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] stable blocker: missing_required_context / preview_required_failure / local_required_context_failure / missing_context_mapping / external_infrastructure_failure 各自独立
  动作: 为五类 context/infra blocker 分别创建单独测试输入与单独 mutation
  预期观察: 每条各返自己的 stable reason；没有 combined object/grep reason 假绿
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'stable blocker: missing_required_context|stable blocker: preview_required_failure|stable blocker: local_required_context_failure|stable blocker: missing_context_mapping|stable blocker: external_infrastructure_failure' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] generator-fix uses the real preview seam and current-head binding
  动作: 通过真实 generator-fix 入口重放 preview receipt，对比 helper seam 与真实 route 的差异
  预期观察: 只有真实 preview route→isolated DB→GitHub current head 路径被接受；helper existence 或 caller 自喂 SHA 不构成通过
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'generator-fix uses the real preview seam' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] legacy adapter 原路径保持原 pass/fail 语义并且记录隔离
  动作: 直接调用真实 legacy adapter 原入口，而不是给新 route 打 legacy label
  预期观察: original pass/fail semantics 保持；legacy receipt 与新 route receipt 互不串线，但 current SHA gate 同样生效
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'legacy adapter 原路径保持原 pass/fail 语义' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] postmerge staging / production promotion / final report 各有独立记录与独立终态
  动作: 在 isolated PG 中分别种下 evaluator PASS、judge PASS、人审 PASS，同 final SHA 读取三类后置动作记录
  预期观察: staging、promotion、report 各自产生独立 record；新 head 出现时三者全部失效
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'postmerge staging|production promotion|final report' --reporter=verbose"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 零生产 mutation：contract/evaluator 阶段绝不 POST approval、绝不 merge、绝不 deploy
  动作: 在真实 route/adapter 合同测试中挂 merge/deploy/approval spies，并只读已种下授权记录
  预期观察: 负向场景下 `mergeSpy=0 deploySpy=0 approvalPost=0`；读取到同一 final SHA 的授权记录后，正向场景只有对应后置动作 spy 为 1
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t '零生产 mutation' --reporter=verbose"
  期望: exit 0

## Invariant 条目（PRD 铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 语义成功必须看 stable reason / semantic fields，不看 HTTP 200 或 grep `ok`
  动作: 运行 workflow 与 route blocker 负例
  预期观察: 断言直接比对 `reason` 与 schema 字段
  Test: manual:bash -c "npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-workflow-route-authority.contract.test.ts -t '保留 body' --reporter=verbose"

- [ ] [BEHAVIOR] [L2] INV-2 `target_environment` 必须来自 DB/task payload，不从 caller/body 猜
  动作: route authority 合同测试写入 `tasks.payload.target_environment=local_api`
  预期观察: receipt 中采用 DB 真值
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'identifier claim' --reporter=verbose"

- [ ] [BEHAVIOR] [L2] INV-3 记录身份必须核对 repository/run/task/current SHA，不允许“最近一条”
  动作: 构造两条同 PR 不同 run/SHA receipt
  预期观察: 只有全等 identity 命中
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'authority-bound receipt' --reporter=verbose"

- [ ] [BEHAVIOR] [L2] INV-4 base_repo/PR 锚点缺失时 fail-closed
  动作: 去掉 `repository/base_repo` 标识重放 workflow request
  预期观察: route 拒绝并写 stable reason
  Test: manual:bash -c "npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-workflow-route-authority.contract.test.ts -t 'authority identifiers' --reporter=verbose"

- [ ] [BEHAVIOR] [L2] INV-5 SHA 真相只能来自 GitHub/server-owned entity，禁止 caller 自喂
  动作: 同一 receipt 中传错 `check_sha`
  预期观察: 返回 `stale_check_sha` 或等价稳定拒绝
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'stale_check_sha' --reporter=verbose"

- [ ] [BEHAVIOR] [L2] INV-6 `TEST_DATABASE_URL` 必填且经 `current_database()+inet_server_addr()` 校验
  动作: 用缺失、`cecelia`、loopback 生产等 URL 作为负例
  预期观察: 连接/写入前直接失败
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'TEST_DATABASE_URL safety gate' --reporter=verbose"

- [ ] [BEHAVIOR] [L2] INV-7 真 GitHub / 真数据库接缝只有在真目标上验过才算 done
  动作: route PG 合同测试显式读取 PR #4372 Draft/head
  预期观察: 无 GitHub 真读时业务断言失败，而不是 skip 当 pass
  Test: manual:bash -c "TEST_DATABASE_URL=\"$TEST_DATABASE_URL\" npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-route-authority.pg.contract.test.ts -t 'GitHub PR #4372' --reporter=verbose"

- [ ] [BEHAVIOR] [L2] INV-8 共享 CI 文件改动必须以真实 workflow 行为验收
  动作: 提取真实 workflow step shell 运行
  预期观察: 行为层断言失败/通过来自执行结果，不是 grep 源码
  Test: manual:bash -c "npx vitest run sprints/07272326-kernel-d3b00fb0/tests/preview-workflow-route-authority.contract.test.ts --reporter=verbose"

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] 同一 current SHA 下 workflow→route→DB/GitHub/decision log→legacy/postmerge 的独立记录完整闭环
  期望: `TEST_DATABASE_URL` 指向安全测试库时，E2E 脚本读取 PR #4372 当前 head，运行 workflow/route 合同测试，且所有记录 identity/SHA 对齐

