---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明页位于 `docs/current/attempt-run-bridge-guide.md`
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const c=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者能识别两个端点用途及鉴权
  动作: 执行冻结测试读取最终说明页的端点与鉴权章节
  预期观察: POST、GET、internalAuthOrLoopback 与远端 Bearer 写法同时存在
  等待预算: 0s
  留证: vitest 指定用例输出
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831234617-skjrw4/tests/attempt-run-bridge-doc.test.ts -t "文档说明两个端点用途与 internalAuthOrLoopback 鉴权" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-02: 读者能获得完整九角色白名单
  动作: 执行冻结测试逐项读取说明页中的角色字面值
  预期观察: 九项生产白名单全部出现，缺任一项即失败
  等待预算: 0s
  留证: vitest 指定用例输出
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831234617-skjrw4/tests/attempt-run-bridge-doc.test.ts -t "文档逐项列出九个角色白名单" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-03: 读者能区分 payload 必填字段和可选 base_sha
  动作: 执行冻结测试读取 payload 章节的四个字段及省略语义
  预期观察: sprint_dir、base_repo、branch 均出现，base_sha 明确可省略并由生产 Brain 解析
  等待预算: 0s
  留证: vitest 指定用例输出
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831234617-skjrw4/tests/attempt-run-bridge-doc.test.ts -t "文档说明 payload 三个必填字段与 base_sha 省略语义" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-04: 读者能确认派发失败的自动回滚终态
  动作: 执行冻结测试读取失败回滚章节
  预期观察: run → failed、session → closed、task → cancelled 三项全部出现
  等待预算: 0s
  留证: vitest 指定用例输出
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831234617-skjrw4/tests/attempt-run-bridge-doc.test.ts -t "文档说明派发失败后的三项自动回滚终态" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-05: 实现范围仅包含目标说明页
  动作: 相对权威实现基线检查实现侧变更路径，并排除本 sprint 合同产物
  预期观察: 唯一实现侧路径为 docs/current/attempt-run-bridge-guide.md
  等待预算: 0s
  留证: git diff --name-only 输出
  Test: manual:bash -c 'cd /workspace && CHANGED=$(git diff --name-only 88929fa377f5bed3cd1876a575c366ff1b93c0d5...HEAD | awk '"'"'!/^sprints\/coding-harness-20260831234617-skjrw4\//'"'"'); [ "$CHANGED" = "docs/current/attempt-run-bridge-guide.md" ]'

## Invariant 映射

- N/A：bundle 未注入额外铁律清单；仓库 AGENTS 硬规则由“仅文档实现、不改 Brain 代码、不提交凭据”范围约束覆盖。
