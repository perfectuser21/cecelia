---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明页存在且是唯一生产交付文件
  Test: bash -c 'BASE=7a156f791feca8815bfabfbadce2ad874acf02af; DOC=docs/current/attempt-run-bridge-guide.md; test -f "$DOC" && git diff --name-only "$BASE" -- docs/current packages apps | sort | diff -u <(printf "%s\n" "$DOC") -'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: POST 创建与 GET 状态查询给出可执行语义 oracle
  动作: 阅读 POST 示例及其 HTTP 202/LAUNCHED/ID 断言，再阅读 GET 轮询示例
  预期观察: POST 成功条件可机检，GET 使用 attempt_id 且明确成功终态与 404 失败语义
  等待预算: 0s
  留证: Vitest 定向测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "POST 创建与 GET 状态查询给出可执行语义 oracle"'

- [ ] [BEHAVIOR] [L1] B-02: 鉴权区分 loopback 与宿主远端且不泄露令牌
  动作: 阅读鉴权章节并比较本机 loopback 与宿主/远端请求要求
  预期观察: 两端点标明 internalAuthOrLoopback，远端带 Bearer 占位符且无真实 token
  等待预算: 0s
  留证: Vitest 定向测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "鉴权区分 loopback 与宿主远端且不泄露令牌"'

- [ ] [BEHAVIOR] [L1] B-03: 角色白名单逐项列出九项角色
  动作: 阅读角色白名单章节并逐项核对生产路由接受的角色
  预期观察: 九个唯一角色逐行列出，无“等”省略，无 commander/publisher
  等待预算: 0s
  留证: Vitest 定向测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "角色白名单逐项列出九项角色"'

- [ ] [BEHAVIOR] [L1] B-04: payload 必填三字段且 base_sha 可省略由生产 Brain 自解析
  动作: 阅读 payload 字段章节并核对必填/可省略分类
  预期观察: sprint_dir、base_repo、branch 各标必填，base_sha 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 定向测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "payload 必填三字段且 base_sha 可省略由生产 Brain 自解析"'

- [ ] [BEHAVIOR] [L1] B-05: 派发失败回滚同时说明 run session task 三个终态
  动作: 阅读派发失败自动回滚章节并核对三个资源终态
  预期观察: 同一章节完整显示 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: Vitest 定向测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902071446-1718kr/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚同时说明 run session task 三个终态"'

## Invariant 覆盖

- INV-1 Planner 分支：N/A，本角色保留服务端签发的 proposer 分支，合同不要求切换 planner 分支。
- INV-2 凭据安全：由 B-02 拒绝硬编码 token。
- INV-3 端点鉴权：由 B-02 明确两端点的 `internalAuthOrLoopback`。
- INV-4 禁止写死：由 B-04 明确 `base_sha` 可由生产 Brain 自解析。
- INV-5 真环境验收：N/A，PRD 禁止真实派发且本 sprint 不改真实接缝。
- INV-6 验证命令：所有行为条目均为可执行 Vitest 命令，RED 与语法检查必须留证。
