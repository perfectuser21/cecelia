---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-usage.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文文档且实现 diff 不含代码或其他文档
  Test: bash -c 'git diff --name-only f9634a9c99096d934044cf1f6ab968627cf4e82c...HEAD | grep -v "^sprints/coding-harness-20260902042428-nv8xr5/" | diff -u <(printf "%s\n" docs/current/attempt-run-bridge-usage.md) -'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者可找到两个端点及鉴权说明
  动作: 打开中文说明并阅读端点与鉴权章节
  预期观察: POST、GET 用途、internalAuthOrLoopback 和远端 Bearer 方式均明确出现
  等待预算: 0s
  留证: Vitest 输出中“说明两个端点及鉴权方式”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts -t "说明两个端点及鉴权方式"'

- [ ] [BEHAVIOR] [L1] B-02: 读者可核对九项角色白名单
  动作: 阅读角色白名单章节并逐项核对角色名
  预期观察: 九项冻结角色全部出现，且明确白名单外角色不接受
  等待预算: 0s
  留证: Vitest 输出中“列出九项角色白名单”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts -t "列出九项角色白名单"'

- [ ] [BEHAVIOR] [L1] B-03: 读者可区分 payload 必填项与 base_sha 省略语义
  动作: 阅读 payload 章节并核对字段要求
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中“区分 payload 必填字段与可省略 base_sha”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts -t "区分 payload 必填字段与可省略 base_sha"'

- [ ] [BEHAVIOR] [L1] B-04: 读者可识别派发失败后的完整回滚
  动作: 阅读派发失败章节并核对 run、session、task 三类对象
  预期观察: 文档分别给出 run → failed、session → closed、task → cancelled
  等待预算: 0s
  留证: Vitest 输出中“说明派发失败的三对象回滚状态”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts -t "说明派发失败的三对象回滚状态"'

## Invariant 覆盖

- [规划分支] N/A：Proposer 已在服务端签发的 propose branch 工作，Sprint 实现不涉及 Planner checkout。
- [凭据安全] 由 B-01 约束文档只引用环境变量名，不写 token 值。
- [端点鉴权] 由 B-01 明确两个端点均使用 `internalAuthOrLoopback`。
- [真环境验证] N/A：PRD 明确本 Sprint 不实际调用端点，且只新增静态文档。
