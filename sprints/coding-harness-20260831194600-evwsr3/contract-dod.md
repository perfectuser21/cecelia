---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 唯一实现产物是中文 Markdown 说明文档，且无代码变化
  Test: bash -c 'test -f docs/current/attempt-run-bridge-guide.md; grep -qE "[一-龥]" docs/current/attempt-run-bridge-guide.md; BAD=$(git diff --name-only c04405fcfc1b5985b90273f52dbf0eee11b3888b...HEAD -- . ":(exclude)sprints/coding-harness-20260831194600-evwsr3/**" | grep -v "^docs/current/attempt-run-bridge-guide.md$" || true); [ -z "$BAD" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 中文文档说明提交与查询两个端点用途
  动作: 打开 `docs/current/attempt-run-bridge-guide.md` 并阅读端点用途节。
  预期观察: POST 被说明为提交 attempt-run，GET `:id` 被说明为按 id 查询。
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试为 PASS。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t "中文文档说明提交与查询两个端点用途" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露凭据
  动作: 阅读鉴权节并分别核对 loopback、宿主及远端调用说明。
  预期观察: 页面显示 `internalAuthOrLoopback`，宿主/远端必须使用 `Bearer CECELIA_INTERNAL_TOKEN`，且无真实 token。
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试为 PASS。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t "鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露凭据" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单完整列出权威九项且无增漏
  动作: 阅读角色白名单并逐项与权威实现基线的 `ALLOWED_ROLES` 核对。
  预期观察: 九个角色按权威顺序出现且没有别名或额外角色。
  等待预算: 0s
  留证: Vitest 对角色数组的完整相等断言输出。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t "角色白名单完整列出权威九项且无增漏" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: payload 节区分三个必填字段与可省略 base_sha
  动作: 阅读 payload 节并核对必填、可省略字段分类。
  预期观察: `sprint_dir`、`base_repo`、`branch` 为必填；`base_sha` 可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试为 PASS。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t "payload 节区分三个必填字段与可省略 base_sha" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: 派发失败节完整说明三类资源自动回滚终态
  动作: 阅读派发失败节并核对 run、session、task 三类状态。
  预期观察: 同一节显示 `run→failed`、`session→closed`、`task→cancelled`，并明确这是自动回滚。
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试为 PASS。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t "派发失败节完整说明三类资源自动回滚终态" --reporter=verbose'

## Invariant 映射

- [分支归属] N/A：该铁律约束 Planner workspace；本角色不切换 planner branch，合同固定在服务端签发的 proposer branch。
- [凭据安全] 由 B-02 与 ARTIFACT 条目覆盖：只允许变量名，不允许真实 secret。
- [端点鉴权] 由 B-02 覆盖：两个已有端点均须记录 `internalAuthOrLoopback`，本 Sprint 不新增端点。

