---
branch: cp-03151530-engine-dual-gate
date: 2026-03-15
pr: "#963"
type: learning
---

# Learning: Engine 双重 Gate 状态机 — Script Gate 层加深

## 做了什么

在 `branch-protect.sh` 和 `check-dod-mapping.cjs` 加入 DoD 深度检查：
- 条目数 < 3 → 拒绝（任何真实功能需要 ARTIFACT + BEHAVIOR + GATE 三类）
- 无 `[BEHAVIOR]` 条目 → 拒绝（静态产出物 ≠ 运行时验证）

## 根本原因

### 坑 1：feature-registry.yml 盲追加导致 YAML 格式损坏

用 `cat >>` 追加 `- version:` 列表条目到文件末尾，但文件顶层是 map 结构（`changelog`、`platform_features` 等 key），不是列表。
**根因**：没有先读文件结构，就假设它是列表。

### 坑 2：DoD GATE 测试依赖本地临时文件

Task Card 的 GATE Test 命令引用 `/tmp/test-no-behavior.md`（只在本地创建），CI 没有这个文件，导致 exit 2 而非预期 exit 1。
**根因**：用运行时状态（临时文件）而不是静态代码验证来写 GATE 测试。

### 坑 3：加新 Phase 0 检查后，质量元测试 fixture 未同步

`test-check-dod-mapping.sh` 场景 3 fixture 只有 2 条无 BEHAVIOR 条目，Phase 0 新增后变为 exit 1，破坏了"期望 exit 0"的测试。
**根因**：加新拒绝规则时，没有同步检查所有测试 fixture 是否满足新的最低要求。

## 下次预防

- [ ] 向结构化 YAML/JSON 文件追加内容时，用 node 读取后修改，不用 `cat >>`
- [ ] DoD GATE Test 命令只用静态 `grep -c` 验证代码存在性，不依赖运行时状态或临时文件
- [ ] 加新 gate 检查规则时，grep 所有 `tests/` 目录下相关 fixture，确认都满足新的最低要求
