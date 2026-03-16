---
id: learning-cp-03161231-selective-ci-affected-packages
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

# Learning: 基于路径映射的选择性 CI 包影响计算

## 概述

本次实现了 `packages/engine/scripts/affected-packages.js`，基于 git diff 输出的文件列表，通过路径前缀映射计算受影响的包集合。

---

## 关键发现

### 现有 CI 已有选择性执行能力

调研后发现，L2/L3/L4 CI 已经通过各 workflow 自带的 `changes` job + `if` 条件实现了选择性执行。
本次脚本补全了一个统一的计算层，后续可以标准化各 workflow 的检测逻辑。

### 各包之间没有 workspace:* 依赖

调研 `package.json` 时发现各包均无 `workspace:*` 依赖声明（每个包完全独立）。
因此依赖图基于"路径映射 + 逻辑影响关系"实现，而非 npm workspace 依赖。

---

## 踩坑记录

### 根本原因

**DoD 第一条 Test 格式问题**：

```
- [ ] [ARTIFACT] ... 文件存在
  Test: manual:ls packages/engine/scripts/affected-packages.js
```

`check-dod-mapping.cjs` 报错：`ls ... 需要 evidence 文件，或改用 manual:<curl命令> 内联格式`。
原来 `ls` 命令不被 CI 门禁接受，需要改用能验证功能而非仅检查文件存在的命令。

**修复**：改为用 `node ... | python3 ...` 方式同时验证文件存在且可执行。

**branch-protect.sh v25 双重要求**：

在 `packages/` 子目录开发时，hook 要求：
1. 根目录必须有 `.prd-{branch}.md`（per-branch PRD）
2. `.dev-mode.{branch}` 中必须有 `tasks_created: true`

Task Card 格式（`.task-{branch}.md`）不能替代这个检查，必须同时有 `.prd-{branch}.md`。

### 下次预防

- [ ] 在 packages/ 子目录开发时，记得同时创建 `.prd-{branch}.md` 和 `.task-{branch}.md`
- [ ] DoD 的 Test 字段避免使用 `ls`/`cat`/`grep` 纯路径检查，应验证功能行为
- [ ] 开始 /dev 前先检查 `.dev-mode` 是否需要 `tasks_created: true`

---

## 后续可优化方向

1. **CI 集成**：可在 `.github/workflows/` 中调用此脚本，替代各 workflow 重复的 `changes` job 逻辑
2. **rdeps 扩展**：当包之间有 workspace 依赖时，可扩展为读取 `package.json` 的 dependencies
3. **stdin 模式**：`git diff --name-only origin/main...HEAD | node affected-packages.js` 可直接在 CI 中使用
