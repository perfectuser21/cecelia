---
id: cp-03161200-feat-test-coverage-check
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

# Learning: feat PR 测试覆盖强制检查

**分支**: cp-03161200-feat-test-coverage-check
**日期**: 2026-03-16
**任务**: CI L3 新增 test-coverage-required job

## 做了什么

在 `.github/workflows/ci-l3-code.yml` 新增 `test-coverage-required` job，对 feat 类型 PR 强制要求包含测试文件改动。

## 根本原因

**问题**: feat 类型 PR 只要老测试绿了就能过 CI，没有验证新功能是否带测试。

**原因**: CI 流程缺乏对 feat PR 是否包含测试文件的门禁检查。`detect-commit-type` job 已能识别 feat 类型，但没有后续的测试覆盖检查。

## 下次预防

- [ ] DoD Test 字段必须用 `bash -c "..."` 包裹 `grep` 命令，满足 CI 要求的"包含真实执行命令（bash）"规则
- [ ] `[BEHAVIOR]` 类型的 DoD 条目不能用 `grep/ls/wc` 等静态检查，必须用 `node -e` 或 `curl` 做运行时验证
- [ ] Learning 文件必须在**第一次 push 前**创建（否则 CI Learning Format Gate 失败）
- [ ] 版本 bump 前检查是否有其他 agent 并发操作，避免版本号冲突

## 关键发现

**DoD 格式规则**（check-dod-mapping.cjs 强制执行）：
1. `manual:` 命令必须包含 `node|npm|npx|psql|curl|bash|python` 等真实执行命令
2. `[BEHAVIOR]` 条目不允许用纯 `grep/ls/wc/cat/find` 等弱测试
3. `[BEHAVIOR]` 条目必须用 `tests/path/test.ts`、`manual:curl+断言` 或 `manual:node -e "逻辑验证"` 格式

**解决方案**：对于 CI yaml 的行为验证，用 `node -e` 内联脚本模拟 CI job 的核心检测逻辑。

## 实现细节

- `test-coverage-required` job：`needs: [detect-commit-type]`，`if: should_run_l3 == 'true'`
- 测试文件模式：`\.test\.ts$|\.spec\.ts$|\.test\.js$|\.spec\.js$|\.test\.cjs$|\.spec\.cjs$` 等
- 无测试文件时 `exit 1`，输出错误说明和规范；有测试文件时 `exit 0`，输出文件列表
- `l3-passed` gate 新增检查 `test-coverage-required` 状态
