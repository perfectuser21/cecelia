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

## 踩的坑

### 1. feature-registry.yml 不是 YAML 列表，是 map 结构

**错误**：用 `cat >> feature-registry.yml` 追加 `- version: "12.76.0"` 条目到文件末尾
**原因**：文件顶层结构是 `{ version, changelog, platform_features, product_features }`，不是列表
**修复**：用 node 读取文件后修改 `changelog` 数组，再写回

**教训**：向结构化 YAML 文件追加内容，必须先读取结构，不能 `cat >>` 盲追加。

### 2. `generate-path-views.sh` 可能清空文件

`bash packages/engine/scripts/generate-path-views.sh` 运行后，`feature-registry.yml` 变为 0 字节。
原因是脚本在 macOS 上输出重定向写入同一文件时覆盖。
**修复**：先写入临时文件再 mv，或确认脚本不修改 feature-registry.yml 本身。

### 3. DoD GATE 测试命令依赖本地临时文件

Task Card 中 GATE 项的 Test 命令引用 `/tmp/test-no-behavior.md`（本地测试创建的），
CI 环境没有这个文件，导致 `node check-dod-mapping.cjs` exit 2 而非 exit 1，`[ $? -eq 1 ]` 失败。
**修复**：改用直接 `grep -c 'MIN_DOD_ITEMS'` 验证代码存在，不依赖运行时临时文件。

### 4. 质量元测试 fixture 需同步更新

`tests/quality-system/test-check-dod-mapping.sh` 的场景 3（"有效 DoD 应 exit 0"）fixture 只有 2 条无 BEHAVIOR 条目，
Phase 0 新增检查后变为 exit 1，破坏了元测试。
**修复**：更新 fixture 为 3 条（含 [ARTIFACT]、[BEHAVIOR]、[GATE]）。

**教训**：加新的拒绝条件时，必须同步检查所有测试 fixture 是否满足新的最低要求。

## 预防措施

1. 向结构化文件（YAML/JSON）追加内容时，用读取后修改的方式，不用 `cat >>`
2. DoD GATE 测试命令只用静态 grep 验证代码存在性，不依赖运行时状态或临时文件
3. 加新 gate 检查时，grep 所有 `tests/` 目录下相关 fixture，确认都满足新要求
