---
id: learning-cp-03161502-l1-ci-affected-packages
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

# Learning: L1 CI 接入 affected-packages.js

**Branch**: cp-03161502-l1-ci-affected-packages
**Date**: 2026-03-16

## 做了什么

将 `ci-l1-process.yml` 的 `changes` job 从手动 grep engine 路径改为调用 `affected-packages.js` 脚本，输出全部五个包（brain/engine/quality/workflows/frontend）的受影响状态，并让 `quality-meta-tests` job 加上条件，只在 quality 或 engine 改动时运行。

## 根本原因

### 为何之前只有 engine output

原始实现只是手动 `grep -q "^packages/engine/"` 判断 engine 是否改动，因为 L1 CI 的历史设计中只有 engine 有需要条件跳过的 job（engine-l1、dev-health-check）。其他包没有 job 使用条件，所以没有扩展需求。

随着 quality-meta-tests 从 hk-vps 迁移到 ubuntu-latest，运行更快但仍然是不必要的全量触发。

## 关键决策

### quality-meta-tests 触发条件

`quality-meta-tests` 在 quality **或** engine 改动时触发（OR 逻辑），理由：
- engine 改动可能影响 quality 系统的 meta tests（meta tests 依赖 engine scripts）
- pure brain/workflows/frontend 改动不需要跑 quality meta tests

### l1-passed 中 skipped 状态处理

原 `quality-meta-tests` 检查是硬性 `!= success`（skipped 视为失败）。改为按条件判断后，只有在 quality 或 engine 改动时才验证结果。这保持了安全性：真正改了 quality/engine 就必须通过测试，否则 skipped 是正常预期。

### frontend output 的映射

`affected-packages.js` 内部用 `api` 和 `dashboard` 两个包名，但 CI job 习惯用 `frontend` 统称前端。在 changes job 中用 `grep -qE '"api"|"dashboard"'` 将两者合并为 `frontend` output。

## 下次预防

- [ ] 新增需要条件跳过的 job 时，先检查 changes job 是否已有对应 output，不要重复手动 grep 路径
- [ ] l1-passed gate 中新增条件性 job 时，参照 engine-l1 的模式：用 `changes.outputs.XXX == 'true'` 保护条件判断，避免 skipped 误报失败
- [ ] affected-packages.js 中 `ALL_PACKAGES` 列表更新时，同步更新 changes job 中的 for 循环包名列表
