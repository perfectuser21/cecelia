---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文说明，不修改生产代码。
**大小**: S

## Invariant 映射

- [ ] [BEHAVIOR] [L1] INV-1: 权威实现基线不被文档中的可省略 base_sha 替代
  动作: 读取说明中 payload 的 `base_sha` 描述
  预期观察: 明确其可省略且由生产 Brain 解析，并声明它不替代本次冻结实现基线
  等待预算: 0s
  留证: Vitest 输出中的测试名与断言结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts -t "payload 必填与 base_sha 省略语义"'

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文说明 `docs/current/attempt-run-bridge-guide.md`
  Test: node -e "const fs=require('node:fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"
- [ ] [ARTIFACT] 变更范围不含生产代码
  Test: bash -c "! git diff --name-only f4f1f511f854ec6fdc0a8512bfe9183181be3fb9...HEAD | grep -Eq '^packages/brain/src/|^apps/|^packages/engine/'"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 两个端点用途完整
  动作: 打开文档的端点用途章节，分别查找创建与查询说明
  预期观察: POST 用于创建并派发，GET 用于按 attempt id 查询运行状态
  等待预算: 0s
  留证: Vitest 输出中 `两个端点用途完整` 的通过记录
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts -t "两个端点用途完整"'

- [ ] [BEHAVIOR] [L1] B-02: 远端必须 Bearer 且没有免鉴权误述
  动作: 阅读鉴权章节并检查宿主/远端调用说明
  预期观察: 文档要求宿主/远端携带 Bearer token，且不存在远端或宿主免鉴权表述
  等待预算: 0s
  留证: Vitest 正向与反向断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts -t "远端必须 Bearer 且没有免鉴权误述"'

- [ ] [BEHAVIOR] [L1] B-03: 角色章节集合恰等于九项白名单
  动作: 读取角色白名单章节的列表项
  预期观察: 集合严格等于实现中的九项角色，不多不少且无别名
  等待预算: 0s
  留证: Vitest 集合相等断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts -t "角色章节集合恰等于九项白名单"'

- [ ] [BEHAVIOR] [L1] B-04: payload 必填与 base_sha 省略语义
  动作: 阅读 payload 章节并核对字段义务
  预期观察: `sprint_dir`、`base_repo`、`branch` 标为必填；`base_sha` 可省略并由生产 Brain 解析
  等待预算: 0s
  留证: Vitest 字段断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts -t "payload 必填与 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-05: 派发失败三对象自动回滚
  动作: 阅读派发失败章节并核对 run、session、task 的终态
  预期观察: 同时出现 `run→failed`、`session→closed`、`task→cancelled`
  等待预算: 0s
  留证: Vitest 三对象完整性断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts -t "派发失败三对象自动回滚"'
