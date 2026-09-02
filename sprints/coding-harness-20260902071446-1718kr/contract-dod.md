---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；不修改代码、配置、API、数据结构或现有文档。
**大小**: S

## Invariant 映射

- Planner 分支：N/A，本角色保持服务端签发分支，交付不修改 planner 分支。
- 凭据安全：B-01 只验证 Bearer 占位符，不允许真实 token 值进入文档。
- 端点鉴权：B-01 要求两个既有端点的 `internalAuthOrLoopback` 与远端 Bearer 说明。
- 禁止写死：B-03 要求 `base_sha` 由生产 Brain 自解析，不出现固定值。
- 真环境验收：N/A，PRD 明确禁止真实派发且本单无真实环境接缝。
- 验证命令：B-01 至 B-04 与 E2E 均为可执行 Vitest/bash，失败传播非零退出。

## ARTIFACT 条目

- [ ] [ARTIFACT] 唯一产品交付文件为新增中文文档 `docs/current/attempt-run-bridge-guide.md`
  Test: `BASE=7a156f791feca8815bfabfbadce2ad874acf02af; ACTUAL=$(git diff --name-status "$BASE"...HEAD -- . ":(exclude)sprints/coding-harness-20260902071446-1718kr/**"); [ "$ACTUAL" = $'A\tdocs/current/attempt-run-bridge-guide.md' ]`

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 打开说明后理解两个端点及鉴权边界
  动作: 打开 `docs/current/attempt-run-bridge-guide.md`，阅读端点用途与鉴权章节。
  预期观察: 中文正文同时说明 POST 创建、GET 查询、`internalAuthOrLoopback`，以及宿主/远端的 Bearer token 占位符，且不含真实 token。
  等待预算: 0s
  留证: Vitest 输出中该测试的通过记录。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "中文文档说明 POST 创建与 GET 查询端点及鉴权边界"'

- [ ] [BEHAVIOR] [L1] B-02: 查阅封闭的九项角色白名单
  动作: 阅读文档「角色白名单」章节并逐项核对编号列表。
  预期观察: 列表与生产实现九项角色按顺序完全相等，恰好九项且没有“等”或“其他角色”。
  等待预算: 0s
  留证: Vitest 输出中精确数组比较的通过记录。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "角色白名单使用封闭枚举且恰好列出九项角色"'

- [ ] [BEHAVIOR] [L1] B-03: 按文档区分 payload 必填与可省略字段
  动作: 阅读文档「payload 字段」章节，核对四个字段的要求。
  预期观察: `sprint_dir`、`base_repo`、`branch` 均为必填；`base_sha` 可省略并由生产 Brain 自解析，未被写成必填或固定值。
  等待预算: 0s
  留证: Vitest 输出中字段正向与负向 oracle 的通过记录。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "payload 精确区分三个必填字段与可省略 base_sha"'

- [ ] [BEHAVIOR] [L1] B-04: 从文档识别派发失败的三个回滚终态
  动作: 阅读文档「派发失败自动回滚」章节。
  预期观察: 同一章节同时明确 `run→failed`、`session→closed`、`task→cancelled`，没有遗漏对象。
  等待预算: 0s
  留证: Vitest 输出中三项终态断言的通过记录。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚同时给出 run session task 三个终态"'

## 失败语义

任一内容断言或精确范围断言失败即 Sprint 验收失败；不接受缺节、近义角色、开放枚举、历史文件或额外文件作为降级结果。
