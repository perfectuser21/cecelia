---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在，且实现差异不包含代码目录
  Test: bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; test -f "$DOC"; node -e '\''const s=require("fs").readFileSync(process.argv[1],"utf8");if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)'\'' "$DOC"; ! git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750...HEAD -- packages apps | grep -q .'

## Invariant 映射

- INV-1 凭据安全：B-02 断言仅展示 `$CECELIA_INTERNAL_TOKEN` 引用，不展示真实 token。
- INV-2 端点鉴权：B-02 要求两个端点均说明 `internalAuthOrLoopback`。
- INV-3 禁止写死环境：B-02 要求 Bearer 值来自环境变量。
- INV-4 Planner 分支：N/A，本 Sprint 不执行 Planner，也不修改分支协议。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 说明两个端点用途
  动作: 读者打开说明页并查找 POST 创建派发与 GET 按 id 查询说明
  预期观察: 两个端点字面及各自用途同时存在
  等待预算: 0s
  留证: Vitest 输出中 `说明两个端点用途` 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "说明两个端点用途"'

- [ ] [BEHAVIOR] [L1] B-02: 说明鉴权且不泄露 token
  动作: 读者查看鉴权章节并按宿主或远端调用说明设置 Authorization
  预期观察: 文档写明 internalAuthOrLoopback 与 Bearer 环境变量，未展示疑似真实 token
  等待预算: 0s
  留证: Vitest 输出中 `说明鉴权且不泄露 token` 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "说明鉴权且不泄露 token"'

- [ ] [BEHAVIOR] [L1] B-03: 列出九项角色白名单
  动作: 读者查看角色章节并逐项核对白名单
  预期观察: planner、proposer、critic、generator、generator-fix、evaluator、evaluator-fix、judge、reporter 恰为九项冻结角色
  等待预算: 0s
  留证: Vitest 输出中 `列出九项角色白名单` 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "列出九项角色白名单"'

- [ ] [BEHAVIOR] [L1] B-04: 说明 payload 必填与 base_sha 省略语义
  动作: 读者查看 payload 章节并区分必填与可省略字段
  预期观察: 三个必填字段和生产 Brain 自解析 base_sha 的语义完整
  等待预算: 0s
  留证: Vitest 输出中 `说明 payload 必填与 base_sha 省略语义` 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "说明 payload 必填与 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-05: 说明派发失败三对象回滚
  动作: 读者查看失败处理章节并核对 run、session、task 最终状态
  预期观察: 自动回滚同时包含 run → failed、session → closed、task → cancelled
  等待预算: 0s
  留证: Vitest 输出中 `说明派发失败三对象回滚` 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "说明派发失败三对象回滚"'
