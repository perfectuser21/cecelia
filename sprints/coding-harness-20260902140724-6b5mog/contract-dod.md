---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

task_request_hash: `83916a00537fa91361e9226d897605f62da559f9c65f04cdac3badec865baf81`
implementation_baseline: `d32b864de5adf8d3083c91f31ed3f5f7f58be985`

manager_feedback_ack: `source_stage_attempt=2; source_idempotency_key=coding-harness-20260902140724-6b5mog:a1:contract:2; unresolved=[]`

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不改代码或其他文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文目标文档存在且非空
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[一-龥]/.test(s))process.exit(1)"
- [ ] [ARTIFACT] canonical 非 sprint 变更集合严格等于唯一目标文档
  Test: BASE_SHA=d32b864de5adf8d3083c91f31ed3f5f7f58be985 bash -c 'ACTUAL=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^sprints/coding-harness-20260902140724-6b5mog/" | sort); [ "$ACTUAL" = "docs/current/attempt-run-bridge-guide.md" ]'
- [ ] [ARTIFACT] manager feedback ack 精确写入且四项 fresh evidence 有执行入口
  Test: node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs manager-feedback

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者能确定两个端点用途与远端鉴权边界
  动作: 阅读说明中的“端点与鉴权”章节并按示例准备宿主或远端请求
  预期观察: POST 明确为异步派发、GET 明确为按 id 查询，且宿主/远端必须带 Bearer token、不得声称远端免鉴权
  等待预算: 0s
  留证: oracle stdout 中的 `OK endpoints-auth`
  Test: manual:bash -c 'node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs endpoints-auth'

- [ ] [BEHAVIOR] [L2] B-02: 读者得到封闭且恰好九项的角色白名单
  动作: 阅读“角色白名单”并逐项准备 role 值
  预期观察: 九项集合与生产路由完全相等，且 commander、publisher 不会被误认为可用角色
  等待预算: 0s
  留证: oracle stdout 中的 `OK roles`
  Test: manual:bash -c 'node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs roles'

- [ ] [BEHAVIOR] [L2] B-03: 读者能区分 payload 必填项与可省略 base_sha
  动作: 阅读“请求 payload”并构造包含 sprint_dir、base_repo、branch 的请求
  预期观察: 三项被标为必填，base_sha 被标为可省略并由生产 Brain 自解析，且未混入必填集合
  等待预算: 0s
  留证: oracle stdout 中的 `OK payload`
  Test: manual:bash -c 'node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs payload'

- [ ] [BEHAVIOR] [L2] B-04: 读者能完整识别派发失败的三个回滚终态
  动作: 阅读“派发失败自动回滚”并核对 run、session、task
  预期观察: 同时看到 run→failed、session→closed、task→cancelled，缺任一映射均失败
  等待预算: 0s
  留证: oracle stdout 中的 `OK rollback`
  Test: manual:bash -c 'node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs rollback'

- [ ] [BEHAVIOR] [L2] INV-1: 语义判定不只检查 ok:true
  动作: 执行四类内容 oracle
  预期观察: oracle 检查端点用途、封闭集合、字段义务和三对象终态，未使用 ok:true 作为成功依据
  等待预算: 0s
  留证: 四条 oracle 的 OK stdout
  Test: manual:bash -c 'for x in endpoints-auth roles payload rollback; do node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs "$x"; done'

- [ ] [BEHAVIOR] [L2] B-05: manager feedback ack 与四项 fresh evidence 可机械核验
  动作: 执行 manager-feedback oracle 读取本轮合同、DoD 与冻结 Test Contract carrier
  预期观察: 精确确认 source_stage_attempt=2、指定 source_idempotency_key、unresolved=[]，并找到四项修正的本轮证据及执行入口
  等待预算: 0s
  留证: oracle stdout 中的 `OK manager-feedback`
  Test: manual:bash -c 'node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs manager-feedback'

### 其余 Invariant 映射

- INV-2 环境来源：N/A，本 sprint 不读取或更改 target_environment 运行逻辑。
- INV-3 真实历史：N/A，本 sprint 不复用历史合同验收结果；oracle 读取当前候选树。
- INV-4 共享禁区：由 canonical 范围 ARTIFACT oracle 保证 CI 与代码文件均未修改。
