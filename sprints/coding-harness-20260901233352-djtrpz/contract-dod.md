---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文 Markdown 文档，含精确 task_request_hash
  Test: `grep -Fxq 'task_request_hash: 239fe1b9cb13af9ee1c12171b0671dd016272a07bf59ddfda51e786809fc5946' docs/current/attempt-run-bridge-guide.md`

## Invariant 映射

- [分支归属] N/A：该铁律约束 Planner；本角色在服务端签发 proposer 分支。
- [凭据安全] 由 B-01 负向检查禁止疑似真实 Bearer 值，仅允许变量名。
- [端点鉴权] 由 B-01 要求两个端点与 `internalAuthOrLoopback`、Bearer 规则同页出现。
- [基线权威] 由 B-05 固定使用 `inputs.implementation_baseline.base_sha=37fc357d927b1429de59e1b50e4de762c5e7ea18`。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 文档包含端点用途与鉴权边界
  动作: 在候选提交树读取 attempt-run 桥接说明的端点与鉴权节。
  预期观察: 创建、查询用途明确；loopback 与远端规则分开；远端要求 Bearer 环境变量且无真实 token。
  等待预算: 0s
  留证: grep 命中输出及负向凭据扫描结果
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -Fq "POST /api/brain/harness/attempt-run" "$DOC" && grep -Fq "GET /api/brain/harness/attempt-run/:id" "$DOC" && grep -Fq "internalAuthOrLoopback" "$DOC" && grep -Fq "Bearer CECELIA_INTERNAL_TOKEN" "$DOC" && ! grep -Eq "Bearer [A-Za-z0-9._-]{20,}" "$DOC"'

- [ ] [BEHAVIOR] [L1] B-02: 角色白名单恰好九项并与实现一致
  动作: 解析文档的角色清单并与服务端 `ALLOWED_ROLES` 常量对照。
  预期观察: 九项逐字相等，无遗漏、重复、别名或额外角色。
  等待预算: 0s
  留证: Vitest 角色集合断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好九项并与实现一致"'

- [ ] [BEHAVIOR] [L1] B-03: payload 区分必填字段与可省略 base_sha
  动作: 读取 payload 节并逐字段核对必填/可省略语义。
  预期观察: `sprint_dir`、`base_repo`、`branch` 为必填，`base_sha` 可省略且由生产 Brain 自解析。
  等待预算: 0s
  留证: 四条字段语义 grep 结果
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -Eq "sprint_dir.*必填" "$DOC" && grep -Eq "base_repo.*必填" "$DOC" && grep -Eq "branch.*必填" "$DOC" && grep -Eq "base_sha.*(可省略|选填).*生产 Brain.*自解析" "$DOC"'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败包含三个回滚终态
  动作: 读取失败回滚节并逐项核对 run、session、task 的终态。
  预期观察: 同时出现 `run→failed`、`session→closed`、`task→cancelled`。
  等待预算: 0s
  留证: 三个终态字面 grep 结果
  Test: manual:bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -Fq "run→failed" "$DOC" && grep -Fq "session→closed" "$DOC" && grep -Fq "task→cancelled" "$DOC"'

- [ ] [BEHAVIOR] [L1] B-05: canonical 基线范围只允许新增目标文档
  动作: 相对 authoritative implementation baseline 检查候选提交的完整 diff name-status。
  预期观察: 输出精确且仅为一行新增 `docs/current/attempt-run-bridge-guide.md`。
  等待预算: 0s
  留证: `git diff --name-status` 完整输出
  Test: manual:bash -c 'BASE=37fc357d927b1429de59e1b50e4de762c5e7ea18; ACTUAL=$(git diff --name-status "$BASE"...HEAD); [ "$ACTUAL" = $'"'"'A\tdocs/current/attempt-run-bridge-guide.md'"'"' ]'
