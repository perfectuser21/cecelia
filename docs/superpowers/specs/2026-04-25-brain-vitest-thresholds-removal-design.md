# Brain vitest thresholds 移除：让 diff-cover 成为唯一覆盖率门禁

**Date**: 2026-04-25
**Brain Task**: `ca349880-814f-489c-a96e-3c2ed03232b4`
**Type**: CI 配置修复（单文件，删 7 行）

## 背景

CI job `brain-diff-coverage` 流程：

1. `npx vitest run --coverage` 生成 `coverage/lcov.info`
2. `diff-cover coverage/lcov.info --fail-under=80` 校验 PR 新增行覆盖率

`packages/brain/vitest.config.js` 中存在全局阈值配置：

```js
thresholds: {
  statements: 75,
  branches: 75,
  functions: 80,
  lines: 75,
  perFile: false
}
```

当前 brain 全局覆盖率约 67%，低于 75% 阈值 → 第 1 步 vitest 直接 exit 非 0 → 第 2 步 diff-cover 永远跑不到 → 所有 Harness Generator PR（即便新增代码 100% 覆盖）一律被 brain-diff-coverage 卡死。

## 目标

让 PR 新增代码覆盖率（diff-cover --fail-under=80）成为 brain 唯一覆盖率门禁，全局阈值由 diff-cover 隐含演进（每次合入新代码必须 ≥80%，全局自然爬升）。

## 设计

### 改动

删除 `packages/brain/vitest.config.js` 第 133-139 行（`thresholds:` 块及末尾逗号），共 7 行。

### 架构影响

- vitest 只输出 lcov.info / json-summary 等 reporter 产物，不再做全局阈值判定
- diff-cover 阶段保留 `--fail-under=80`，仍是硬门禁
- 后续若想强化全局阈值，应在 diff-cover 之外另起 job，不要复活 vitest threshold

### 数据流

```
vitest run --coverage  →  coverage/lcov.info
                                 ↓
         diff-cover --compare-branch=origin/main --fail-under=80
                                 ↓
                          PASS / FAIL
```

### 错误处理

- vitest OOM worker 容错（已有）保持不变
- 删除 thresholds 不引入新错误路径
- 若 vitest 仍因测试失败 fail（非 threshold），diff-cover 不会执行——这是合理行为

### 测试

`[BEHAVIOR]` Test：`manual:node -e "..."` 读取 `packages/brain/vitest.config.js`，断言不含 `thresholds:` 字段。

CI brain-diff-coverage 自身跑通即活体证明（diff-cover 第 2 步成功执行）。

## 成功标准

- `packages/brain/vitest.config.js` 不含 `thresholds:` 字段
- CI brain-diff-coverage job 跑通到 diff-cover 阶段（不再因全局覆盖率 fail）
- 当前 PR 全部 CI 绿（含 brain-diff-coverage）

## 不在范围

- 不调整 diff-cover `--fail-under=80` 数值
- 不动 coverage reporter / include / exclude
- 不补 brain 测试覆盖率
