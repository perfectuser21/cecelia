---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；不修改代码、配置、API、数据结构或现有文档。
**大小**: S

## Invariant 映射

- Planner 分支：N/A，本角色保持服务端签发分支，交付不修改 planner 分支。
- 凭据安全：B-03 只验证 Bearer 占位符，不允许真实 token 值进入文档。
- 端点鉴权：B-03 要求两个既有端点的 `internalAuthOrLoopback` 与远端 Bearer 说明。
- 禁止写死：B-05 要求 `base_sha` 由生产 Brain 自解析，不出现固定值。
- 真环境验收：N/A，PRD 明确禁止真实派发且本单无真实环境接缝。
- 验证命令：B-01 至 B-06 与 E2E 均为可执行 Vitest/bash，失败传播非零退出。

## ARTIFACT 条目

- [ ] [ARTIFACT] 唯一产品交付文件为新增中文文档 `docs/current/attempt-run-bridge-guide.md`
  Test: `BASE=7a156f791feca8815bfabfbadce2ad874acf02af; ACTUAL=$(git diff --name-status "$BASE"...HEAD -- . ":(exclude)sprints/coding-harness-20260902071446-1718kr/**"); [ "$ACTUAL" = $'A\tdocs/current/attempt-run-bridge-guide.md' ]`

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 按 POST 端点说明创建运行
  动作: 打开 `docs/current/attempt-run-bridge-guide.md`，阅读「端点用途与鉴权」章节中的 POST 条目。
  预期观察: `POST /api/brain/harness/attempt-run` 与“创建运行”在同一条说明中明确关联。
  等待预算: 0s
  留证: Vitest 输出中 POST 用途机械断言的通过记录。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "POST /api/brain/harness/attempt-run 用于创建运行"'

- [ ] [BEHAVIOR] [L1] B-02: 按 GET 端点说明查询状态
  动作: 阅读同一章节中的 GET 条目。
  预期观察: `GET /api/brain/harness/attempt-run/:id` 与“查询状态”在同一条说明中明确关联，而非只出现端点字符串。
  等待预算: 0s
  留证: Vitest 输出中 GET 用途机械断言的通过记录。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "GET /api/brain/harness/attempt-run/:id 用于查询状态"'

- [ ] [BEHAVIOR] [L1] B-03: 理解两个端点的鉴权边界
  动作: 阅读「端点用途与鉴权」章节的鉴权说明。
  预期观察: 中文正文说明 `internalAuthOrLoopback`，且宿主/远端携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，不含真实 token。
  等待预算: 0s
  留证: Vitest 输出中鉴权边界断言的通过记录。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "两个端点说明 internalAuthOrLoopback 鉴权边界"'

- [ ] [BEHAVIOR] [L1] B-04: 查阅封闭的九项角色白名单
  动作: 阅读文档「角色白名单」章节并逐项核对编号列表。
  预期观察: 列表与生产实现九项角色按顺序完全相等，恰好九项且没有“等”或“其他角色”。
  等待预算: 0s
  留证: Vitest 输出中精确数组比较的通过记录。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "角色白名单使用封闭枚举且恰好列出九项角色"'

- [ ] [BEHAVIOR] [L1] B-05: 按文档区分 payload 必填与可省略字段
  动作: 阅读文档「payload 字段」章节，核对四个字段的要求。
  预期观察: `sprint_dir`、`base_repo`、`branch` 均为必填；`base_sha` 可省略并由生产 Brain 自解析，未被写成必填或固定值。
  等待预算: 0s
  留证: Vitest 输出中字段正向与负向 oracle 的通过记录。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "payload 精确区分三个必填字段与可省略 base_sha"'

- [ ] [BEHAVIOR] [L1] B-06: 从文档识别派发失败的三个回滚终态
  动作: 阅读文档「派发失败自动回滚」章节。
  预期观察: 同一章节同时明确 `run→failed`、`session→closed`、`task→cancelled`，没有遗漏对象。
  等待预算: 0s
  留证: Vitest 输出中三项终态断言的通过记录。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚同时给出 run session task 三个终态"'

## 失败语义

任一内容断言或精确范围断言失败即 Sprint 验收失败；不接受缺节、近义角色、开放枚举、历史文件或额外文件作为降级结果。
