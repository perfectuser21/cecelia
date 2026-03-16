---
id: learning-cp-03161230-dod-execution-gate
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

### [2026-03-16] CI L1 DoD Execution Gate 实现——macOS sed \s 不兼容 + branch-protect 新格式要求

**失败统计**：CI 失败 1 次（Learning 格式），本地调试 2 次

### 根本原因

1. **macOS sed `\s` 不兼容**：脚本中 `sed 's/^\s*Test:\s*//'` 在 macOS BSD sed 上不生效，`\s` 被当作字面量，导致 Test 行提取失败，所有命令被标记为 DEFERRED。macOS 需要用 `[[:space:]]` POSIX 字符类。

2. **branch-protect v25 不识别 `.task-*.md` 作为 per-branch PRD**：`find_prd_dod_dir` 函数只查找 `.prd-${branch}.md`，在 `packages/` 子目录开发时即使有 task card 也不满足要求，需要额外创建 `.prd-<branch>.md`。

3. **`.dev-mode` 缺少 `tasks_created: true`**：branch-protect.sh 检查此字段，初始创建 `.dev-mode` 时未加入导致 hook 阻止写代码。

### 下次预防

- [ ] 写 shell 脚本时，所有 sed 正则用 `[[:space:]]` 代替 `\s`（跨平台兼容）
- [ ] 在 `packages/` 子目录下开发时，同时创建 `.prd-<branch>.md`（即使已有 task card）
- [ ] 创建 `.dev-mode.*` 时必须包含 `tasks_created: true` 字段
- [ ] Learning 文件必须用 `### 根本原因` 和 `### 下次预防` 三级标题（不能用粗体或其他格式）

**影响程度**: Low（所有问题本地可修复，功能实现正确）
