---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge.md` 中文文档及本 sprint 冻结验收产物，不修改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `docs/current/attempt-run-bridge.md` 存在且标题为中文 attempt-run 桥接说明
  Test: node -e "const fs=require('node:fs');const p='docs/current/attempt-run-bridge.md';const s=fs.readFileSync(p,'utf8');if(!/^# .*attempt-run.*桥接.*说明/m.test(s))process.exit(1)"

- [ ] [ARTIFACT] 相对 implementation baseline 无 docs/current 与本 sprint 目录之外的变更
  Test: bash -c 'BAD=$(git diff --name-only c3f8bb46d1c3108af22025fd577717f75ec1e4c1...HEAD | awk '\''! /^(docs\/current\/|sprints\/coding-harness-20260831083208-k8r6yo\/)/'\''); [ -z "$BAD" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能识别创建、查询端点与鉴权边界
  动作: 打开说明文档，核对两个端点用途及 loopback、宿主和远端鉴权要求
  预期观察: 文档包含两个端点、`internalAuthOrLoopback` 和 Bearer 环境变量示例，且不含真实令牌
  等待预算: 0s
  留证: Vitest 对应测试输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "说明创建与查询端点用途和鉴权边界"'

- [ ] [BEHAVIOR] [L1] B-02: 读者看到与生产实现一致的九项角色白名单
  动作: 打开「角色白名单」一节并逐项读取角色
  预期观察: 列表按生产顺序恰含九项，不多不少
  等待预算: 0s
  留证: Vitest 角色数组差异输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "逐项列出生产角色白名单九项且不多不少"'

- [ ] [BEHAVIOR] [L1] B-03: 读者能区分 payload 必填字段与可省略基线
  动作: 阅读 payload 一节并核对四个字段的必填性
  预期观察: `sprint_dir`、`base_repo`、`branch` 标为必填，`base_sha` 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 对应测试输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "说明 payload 必填字段与 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-04: 读者能完整识别派发失败的三个回滚终态
  动作: 阅读派发失败一节并逐项核对 run、session、task
  预期观察: 同一节同时出现 `run→failed`、`session→closed`、`task→cancelled`
  等待预算: 0s
  留证: Vitest 对应测试输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "说明派发失败自动回滚的三个终态"'

## Invariant 覆盖

- [端点鉴权] B-01 要求两个端点和 `internalAuthOrLoopback` 同时出现。
- [凭据安全] B-01 拒绝疑似真实 Bearer token，只允许环境变量名。
- [日志脱敏] N/A：不修改日志，文档不写 PII 或聊天内容。
- [禁止环境假设] B-03 明确 `base_sha` 由生产 Brain 解析，不要求调用方写死。
- [真环境验收] N/A：纯文档变更，无运行时接缝。
