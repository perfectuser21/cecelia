---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；合同产物位于本 sprint 目录。
**大小**: S

## Invariant 映射

- 凭据安全：B-01 断言仅出现环境变量占位符，不出现疑似真实 Bearer 值。
- 端点鉴权：B-01 断言两个端点与远端 Bearer 要求。
- 环境假设：B-03 断言 `base_sha` 可由生产 Brain 自解析，不写死运行值。
- 真环境验证：N/A，本次不改变真实调用链，仅陈述既有契约。
- Planner 分支：N/A，本次不修改 Planner 或分支行为。

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于 `docs/current/attempt-run-bridge-guide.md` 且只新增该实现文件
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';if(!fs.existsSync(p)||!fs.readFileSync(p,'utf8').includes('attempt-run 桥接使用说明'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 两个端点用途与远端 Bearer 缺失负向约束
  动作: 阅读“端点用途与鉴权”节，按宿主或远端调用方式核对请求头。
  预期观察: POST 创建派发、GET 按 id 查询；远端缺失或无效 Bearer 明确被拒绝，且示例不泄露真实 token。
  等待预算: 0s
  留证: Vitest 输出中该测试为 PASS。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与远端 Bearer 缺失负向约束"'

- [ ] [BEHAVIOR] [L1] B-02: 九项角色白名单恰好列全
  动作: 阅读“角色白名单”节并逐项核对角色。
  预期观察: 九项角色与 PRD 集合完全相同，无白名单外角色、重复项或“等”省略。
  等待预算: 0s
  留证: Vitest 输出中该测试为 PASS。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "九项角色白名单恰好列全"'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填字段与 base_sha 省略语义
  动作: 阅读“payload 字段”节，核对必填与可省略字段。
  预期观察: `sprint_dir`、`base_repo`、`branch` 明确必填；`base_sha` 明确可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 输出中该测试为 PASS。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段与 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败三对象终态且不保留 running
  动作: 阅读“派发失败自动回滚”节，核对 run、session、task 的失败终态。
  预期观察: 文档同时给出 `run→failed`、`session→closed`、`task→cancelled`，并明确派发失败不会让对象仍处于 running/in_progress。
  等待预算: 0s
  留证: Vitest 输出中该测试为 PASS。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "派发失败三对象终态且不保留 running"'

