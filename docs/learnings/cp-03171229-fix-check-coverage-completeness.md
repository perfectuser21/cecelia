# Learning: 补 check-coverage-completeness.mjs CI 接入与测试

**Branch**: cp-03171229-fix-check-coverage-completeness
**Task ID**: 68966a37-6a20-408b-96d7-0121cfd139c1
**Date**: 2026-03-17
**PR**: #1013

---

## 任务背景

PR #1004 关闭时遗漏了 check-coverage-completeness.mjs。并行 agent 的 commit 69800a629 只将脚本文件本身合并进了 main，但 CI 接入和测试文件均缺失。

---

## 实际执行情况

### 根本原因

任务描述说"脚本完全没进 main"，但实际上脚本已通过 commit 69800a629 进入 main。任务的真正缺口是：
1. 没有接入 CI（任务说 brain-l2，实际应是 engine-l2）
2. 没有测试文件

### 正确判断

- 看到任务描述与代码现状不符时，以代码为准（SSOT 原则）
- 脚本属于 `packages/engine/scripts/devgate/`，应接入 `engine-l2` job，而非 `brain-l2`（brain-l2 只检查 Brain 相关一致性）
- 任务描述中"参考 check-rci-health.mjs 的接入方式"实际指向 `ci-l1-process.yml`，但更合适的位置是 `engine-l2`（与其他 engine devgate 脚本一致）

---

## 教训

### 根本原因

并行 agent 开发时，一个 PR 关闭了并没有完整合并所有变更。后续补救时又只合并了脚本文件，遗漏了 CI 接入和测试。

### 下次预防

- [ ] 新增 devgate 脚本时，在同一个 PR 中包含：① 脚本文件 ② 测试文件 ③ CI 接入 ④ feature-registry.yml changelog，缺一不可
- [ ] check-coverage-completeness.mjs 现在会在 engine-l2 检查中主动提示哪些 devgate 脚本缺少测试文件
- [ ] 任务描述与代码现状不一致时，先检查最新 commit，以代码为准

---

## 关键决策

**为什么接入 engine-l2 而非 brain-l2？**

- 脚本路径：`packages/engine/scripts/devgate/check-coverage-completeness.mjs`
- `brain-l2` job 在 `if: needs.changes.outputs.brain == 'true'` 条件下运行，只有 brain 代码变更时才执行
- `engine-l2` job 在 `if: needs.changes.outputs.engine == 'true'` 条件下运行，与其他 engine devgate 检查一致
- `check-rci-health.mjs` 实际接入了 `ci-l1-process.yml`（L1 流程检查），而非 L2

**为什么不用 --strict 模式？**

- 当前 engine 有多个 hooks 和脚本没有完整测试覆盖，--strict 会让 CI 立即失败
- 警告模式（默认）让 CI 通过同时展示待补充测试的清单，给后续改进提供可见性
- 将来测试完善后可切换为 --strict

---

## 产出物

- 新增：`packages/engine/tests/devgate/check-coverage-completeness.test.ts`（16 个测试用例）
- 修改：`.github/workflows/ci-l2-consistency.yml`（engine-l2 job 新增步骤）
- 版本：engine 12.94.0 → 12.95.0
