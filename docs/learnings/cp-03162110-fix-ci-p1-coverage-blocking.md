---
id: learning-cp-03162110-fix-ci-p1-coverage-blocking
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

# Learning: CI P1 — coverage-delta 改为阻塞 + 只对 feat: PR 跑

## 任务概要

让 `coverage-delta` 成为真正有牙齿的门禁：只对 `feat:` PR 运行，失败时阻止合并。

## 根本原因

### 问题 1：coverage-delta 非阻塞

L3 Gate 里原逻辑：
```bash
if [ "${{ needs.coverage-delta.result }}" = "failure" ]; then
  echo "⚠️  Coverage Delta Check 失败（非阻塞，覆盖率报告供参考）"
  # ← 没有 FAILED=true，不阻止合并
fi
```
vitest.config.js 已配置阈值（75/75/80/75），但 CI gate 不执行，覆盖率掉到 0% 也能合并。

### 问题 2：fix:/chore: PR 重复跑测试

`coverage-delta` 的 `if:` 条件只看 `should_run_l3 && brain_changed`，不区分 commit type。P0 修复后 `fix:` 也会跑 L3，导致 brain-unit + coverage-delta 两次完整测试（共 ~25 分钟）。

## 修复方案

### coverage-delta 条件加 commit_type 检查

```yaml
# 修改前
if: needs.detect-commit-type.outputs.should_run_l3 == 'true' && needs.changes.outputs.brain == 'true' && needs.brain-unit.result == 'success'

# 修改后（只对 feat: 跑）
if: ... && needs.detect-commit-type.outputs.commit_type == 'feat' && ...
```

### L3 Gate 中 coverage-delta 改为阻塞

```bash
# 修改后
if [ brain_changed ] && [ commit_type == 'feat' ]; then
  if [ coverage-delta == 'failure' ]; then
    echo "FAIL: Coverage Delta Check failed"
    FAILED=true   # ← 现在真的阻塞了
  fi
fi
```

## 技术要点

- `commit_type` output 由 `detect-commit-type` job 输出，可在 `if:` 表达式和 `run:` 里用
- `feat` 判断用 `== 'feat'`，不包含 `feat!`（breaking change）——breaking 也应该跑 coverage
  - 实际上 breaking change 的 commit_type 是 `breaking`，不是 `feat`，所以需要单独处理
  - 当前版本先只覆盖 `feat`，breaking change 的覆盖率检查后续补充
- 阈值在 `packages/brain/vitest.config.js` 的 `thresholds` 字段，不在 CI 里定义

## 下次预防

- [x] coverage 门禁：设了阈值必须同步在 CI gate 里执行，光有 vitest 配置不够
- [x] 双重测试：coverage job 应该只在真正需要 coverage 数据的 commit type 上跑
- [ ] feat! (breaking change) 的 coverage-delta 后续补充
