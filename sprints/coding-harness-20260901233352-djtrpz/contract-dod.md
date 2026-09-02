---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文说明文档且正文带精确追踪哈希
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const c=fs.readFileSync(p,'utf8');if(!/[一-龥]/.test(c)||!c.includes('task_request_hash: 239fe1b9cb13af9ee1c12171b0671dd016272a07bf59ddfda51e786809fc5946'))process.exit(1)"

- [ ] [ARTIFACT] 产品变更路径严格只有目标文档
  Test: bash -c 'ACTUAL=$(git diff --name-only 37fc357d927b1429de59e1b50e4de762c5e7ea18...HEAD -- . ":(exclude)sprints/coding-harness-20260901233352-djtrpz" | sort); [ "$ACTUAL" = "docs/current/attempt-run-bridge-guide.md" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 端点用途与鉴权边界可独立核对
  动作: 读取「端点用途」「鉴权方式」章节，并运行章节级正向与矛盾变体负向断言
  预期观察: POST=创建/派发、GET=查询/轮询；loopback 条件与宿主/远端 Bearer 要求清晰，矛盾文字被拒绝
  等待预算: 30s
  留证: Vitest 指定用例输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t "端点用途与鉴权边界结构化且矛盾表述会失败"'

- [ ] [BEHAVIOR] [L2] B-02: 角色白名单是恰好九项的封闭集合
  动作: 解析「角色白名单」章节的逐项列表
  预期观察: 列表与服务端九项角色按字面及顺序完全相等，无缺项或额外项
  等待预算: 30s
  留证: Vitest 指定用例输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好逐项列出九个服务端角色"'

- [ ] [BEHAVIOR] [L2] B-03: payload 必填与可省略语义逐字段锁定
  动作: 解析「payload 字段」章节并分别检查四个字段，再注入两种矛盾表述
  预期观察: 三个字段各自为必填，base_sha 为可省略且由生产 Brain 自解析；矛盾变体被拒绝
  等待预算: 30s
  留证: Vitest 指定用例输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t "payload 三个必填字段与 base_sha 可省略语义独立且矛盾表述会失败"'

- [ ] [BEHAVIOR] [L2] B-04: 派发失败三类资源全部回滚到终态
  动作: 读取「派发失败自动回滚」章节并检查三个状态转换
  预期观察: 同一章节同时出现 run→failed、session→closed、task→cancelled
  等待预算: 30s
  留证: Vitest 指定用例输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901233352-djtrpz/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚同时锁定 run session task 三个终态"'

## Invariant 映射

- [分支归属] N/A：Planner 分支归属由上游签发与校验，本 docs-only 产品交付不修改 Planner 状态。
- [凭据安全] 由 B-01 与 ARTIFACT 检查约束示例只出现变量名，不接受真实 token 值。
- [端点鉴权] 由 B-01 结构化断言锁定两个端点的 `internalAuthOrLoopback` 与远端 Bearer 边界。
- [基线权威] ARTIFACT 范围检查固定采用 `inputs.implementation_baseline.base_sha=37fc357d...`，不采用角色 checkout 替换。
