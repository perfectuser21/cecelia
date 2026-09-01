---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 产品文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 唯一产品交付物位于约定路径且不修改代码、配置或既有文档
  Test: bash -c 'D=$(git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750...HEAD -- docs/current packages apps | sort); [ "$D" = "docs/current/attempt-run-bridge-guide.md" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 说明两个端点及各自用途
  动作: 读者打开说明文档并查找 POST 创建派发与 GET 按 id 查询两节
  预期观察: 两个端点及其不同用途均有中文说明
  等待预算: 0s
  留证: Vitest 输出中对应测试通过记录
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "说明两个端点及各自用途"'

- [ ] [BEHAVIOR] [L1] B-02: 说明鉴权与凭据安全
  动作: 读者查看鉴权章节并按宿主机或远端场景构造 Authorization header
  预期观察: 文档明确 internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN 与不得展示真实 token
  等待预算: 0s
  留证: Vitest 输出中对应测试通过记录
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "说明鉴权与凭据安全"'

- [ ] [BEHAVIOR] [L1] B-03: 列全九项角色白名单
  动作: 读者查看角色章节并从白名单选择 attempt 角色
  预期观察: 九项允许角色逐项出现且明确为完整白名单
  等待预算: 0s
  留证: Vitest 输出中对应测试通过记录
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "列全九项角色白名单"'

- [ ] [BEHAVIOR] [L1] B-04: 说明 payload 必填与 base_sha 省略语义
  动作: 读者查看 payload 章节并构造最小有效请求
  预期观察: sprint_dir、base_repo、branch 明确必填，base_sha 明确可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中对应测试通过记录
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "说明 payload 必填与 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-05: 说明三对象派发失败自动回滚
  动作: 读者查看失败处理章节并判断 run、session、task 的最终状态
  预期观察: run→failed、session→closed、task→cancelled 三组映射同时出现
  等待预算: 0s
  留证: Vitest 输出中对应测试通过记录
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "说明三对象派发失败自动回滚"'

## Invariant 映射

- INV-1 凭据安全：映射至 B-02，断言不出现真实 token 字面赋值。
- INV-2 端点鉴权：映射至 B-02，断言两个端点采用 `internalAuthOrLoopback`，远端必须 Bearer token。
- INV-3 禁止写死环境：映射至 B-02，只引用 `$CECELIA_INTERNAL_TOKEN` 环境变量，不写死值。
- N/A：Planner 分支铁律不触及产品文档内容；Proposer 已留在服务端签发分支。
