---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 只新增 `docs/current/attempt-run-bridge.md` 中文说明；不修改运行时代码、测试或配置。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文件位于唯一约定路径
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge.md';const s=fs.readFileSync(p,'utf8');if((s.match(/[\u4e00-\u9fff]/g)||[]).length<20)process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能区分两个端点的用途
  动作: 打开说明并阅读端点章节
  预期观察: POST 被说明为创建并派发，GET 被说明为按 id 查询运行状态
  等待预算: 0s
  留证: Vitest 输出中 B-01 对应测试结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901125536-w93uqq/tests/attempt-run-bridge-doc.test.ts -t "中文说明分别解释 POST 创建派发与 GET 按 id 查询"'

- [ ] [BEHAVIOR] [L1] B-02: 宿主或远端读者不会误用 loopback 鉴权豁免
  动作: 阅读鉴权章节并按宿主或远端场景构造 Authorization header
  预期观察: 文档明确 internalAuthOrLoopback，且宿主/远端必须携带 Bearer CECELIA_INTERNAL_TOKEN
  等待预算: 0s
  留证: Vitest 输出中 B-02 对应测试结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901125536-w93uqq/tests/attempt-run-bridge-doc.test.ts -t "鉴权章节区分 loopback 与宿主远端 Bearer 要求"'

- [ ] [BEHAVIOR] [L1] B-03: 调用方只能从精确九项白名单选择角色
  动作: 阅读角色白名单章节并核对生产接受的角色集合
  预期观察: 恰好看到九项合法角色，无缺项、无额外项
  等待预算: 0s
  留证: Vitest 输出中 B-03 对应测试结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901125536-w93uqq/tests/attempt-run-bridge-doc.test.ts -t "角色章节精确列出九项生产白名单"'

- [ ] [BEHAVIOR] [L1] B-04: 调用方能区分 payload 必填字段与可省略 base_sha
  动作: 阅读 payload 章节并构造含 sprint_dir、base_repo、branch 的请求
  预期观察: 三字段明确标为必填，base_sha 明确可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中 B-04 对应测试结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901125536-w93uqq/tests/attempt-run-bridge-doc.test.ts -t "payload 章节锁定三个必填字段与 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-05: 调用方能解释派发失败后的三类终态
  动作: 阅读失败回滚章节并通过 GET 查询结果解释失败
  预期观察: run 为 failed、session 为 closed、task 为 cancelled，三者同时出现
  等待预算: 0s
  留证: Vitest 输出中 B-05 对应测试结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901125536-w93uqq/tests/attempt-run-bridge-doc.test.ts -t "失败回滚章节同时说明三类对象终态与查询观察方式"'

- [ ] [BEHAVIOR] [L1] B-06: 实现差异保持仅目标文档
  动作: 将候选 HEAD 与固定 implementation baseline 比较，并排除冻结 Sprint 合同产物
  预期观察: 剩余产品差异路径集合完全等于 docs/current/attempt-run-bridge.md
  等待预算: 0s
  留证: git diff 路径输出
  Test: manual:bash -c 'BASE=393815bcbc288a4f9c357f3812024b52659a2dee; FILES=$(git diff --name-only "$BASE"...HEAD | grep -v "^sprints/coding-harness-20260901125536-w93uqq/" | sort -u); [ "$FILES" = "docs/current/attempt-run-bridge.md" ]'

## Invariant 映射

- [ ] [BEHAVIOR] [L1] INV-1: 端点鉴权铁律在说明中不被弱化
  动作: 阅读鉴权章节并检查远端约束
  预期观察: 宿主/远端被明确要求携带 Authorization Bearer token
  等待预算: 0s
  留证: Vitest 鉴权测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901125536-w93uqq/tests/attempt-run-bridge-doc.test.ts -t "鉴权章节区分 loopback 与宿主远端 Bearer 要求"'

- INV-2 Planner 分支：N/A，本 Sprint 不操作 Planner workspace 或分支。

## 接缝清单

（纯文档，无真实世界接缝；N/A）

