---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 产品文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 相对权威基线的产品路径变更集合精确等于目标文档
  Test: bash -c "F=$(git diff --name-only 5d25dcd6addb8ba30c742281b682589a3b95eaab...HEAD -- docs/current packages apps scripts | sort); [ \"$F\" = docs/current/attempt-run-bridge-guide.md ]"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 文档说明 POST 发起与 GET 查询用途
  动作: 读取目标文档并执行端点用途冻结测试
  预期观察: 中文标题存在，POST 为发起用途，GET 为查询用途
  等待预算: 0s
  留证: Vitest 用例输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "文档为中文且分别说明 POST 发起与 GET 查询用途"'

- [ ] [BEHAVIOR] [L2] B-02: 鉴权说明区分 loopback 与宿主远端
  动作: 执行鉴权章节冻结测试
  预期观察: 宿主/远端必须带 Bearer 占位符，且没有真实 token
  等待预算: 0s
  留证: Vitest 用例输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露令牌"'

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单精确包含九项
  动作: 执行角色章节冻结测试
  预期观察: 九项名称及顺序与权威实现一致，白名单外不支持
  等待预算: 0s
  留证: Vitest 用例输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "角色白名单完整列出九项且明确白名单外不支持"'

- [ ] [BEHAVIOR] [L2] B-04: payload 必填与省略边界正确
  动作: 执行 payload 章节冻结测试
  预期观察: 三项标为必填，base_sha 标为可省略且生产自解析
  等待预算: 0s
  留证: Vitest 用例输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "payload 节声明三个必填字段及 base_sha 生产自解析"'

- [ ] [BEHAVIOR] [L2] B-05: 派发失败回滚链完整
  动作: 执行失败回滚章节冻结测试
  预期观察: run、session、task 按指定顺序进入终态
  等待预算: 0s
  留证: Vitest 用例输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "派发失败节完整说明 run session task 的回滚终态和顺序"'

## Invariant 映射

- [ ] [BEHAVIOR] [L2] INV-1: 不修改代码或额外产品文件
  动作: 比对权威基线与 HEAD 的产品路径变更集合
  预期观察: 集合中只有 docs/current/attempt-run-bridge-guide.md
  等待预算: 0s
  留证: git diff 文件列表与 exit code
  Test: manual:bash -c 'F=$(git diff --name-only 5d25dcd6addb8ba30c742281b682589a3b95eaab...HEAD -- docs/current packages apps scripts | sort); [ "$F" = docs/current/attempt-run-bridge-guide.md ]'

其余 PRD 注入的 area 历史铁律与纯文档产品文件无交集，显式 N/A；不得据此扩大范围。
