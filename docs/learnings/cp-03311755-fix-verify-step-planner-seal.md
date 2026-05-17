# Learning: verify-step.sh Gate Planner 执法闭环

**Branch**: `cp-03311755-fix-verify-step-planner-seal`
**Date**: 2026-03-31

## 根本原因

`devloop-check.sh` 在 Stop Hook（PostResponse）中检查 Planner seal，但此时代码已经写入。`verify-step.sh` 的 `verify_step1()` 是 PreToolUse 拦截点，却只校验 Task Card 格式，未验证 `.dev-gate-planner.{branch}` 物理文件是否存在。这导致 Claude 可以：

1. 手动写 `step_1_spec: done` 到 `.dev-mode`
2. `verify_step1()` 通过（Task Card 格式OK）
3. 进入 Stage 2 写代码
4. Stop Hook 发现 Planner seal 缺失 → BLOCKED → 但代码已经写了

执法点在代码写入之后，等同于无效执法。

## 下次预防

- [ ] 新增拦截逻辑时，确认拦截点在写入行为之前（PreToolUse），而不是之后（PostResponse/Stop Hook）
- [ ] `verify_step1()` 是 `step_1_spec: done` 的唯一 PreToolUse 门，任何 Stage 1 完成的证据校验都应在此处
- [ ] 现有测试文件（verify-step.test.ts）中的"通过"场景需同步更新，因为新 gate 会改变通过条件
- [ ] 文件系统 seal 机制：gate 文件 = 物理凭证，不可仅靠 `.dev-mode` 字段（内存可伪造，文件不可）
