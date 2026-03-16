---
id: learning-cp-03161230-dod-execution-gate
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

# Learning: DoD Execution Gate

**分支**: cp-03161230-dod-execution-gate
**日期**: 2026-03-16
**结果**: 实现完成

---

## 做了什么

新增 `packages/engine/scripts/devgate/dod-execution-gate.sh`，在 CI L1 `dod-check` job 中实际执行 Task Card 中 `[BEHAVIOR]` 条目的 `Test:` 命令。

解决了 `check-dod-mapping.cjs` 只检查 Test 字段**格式**、从不**执行**的盲区。

---

## 踩的坑

### 坑 1: macOS sed 不支持 `\s`

**现象**: 脚本中 `sed 's/^\s*Test:\s*//'` 在 macOS 上不生效，`\s` 被当作字面量。

**根本原因**: macOS 使用 BSD sed，不支持 Perl 风格的 `\s`（GNU sed 支持）。需要改用 POSIX 字符类 `[[:space:]]`。

**下次预防**:
- [ ] 写 shell 脚本时，所有 sed 模式改用 `[[:space:]]` 代替 `\s`
- [ ] 在 macOS 本地先测试，不要在 CI 上发现

---

### 坑 2: branch-protect.sh v25 要求 per-branch PRD

**现象**: 创建了 `.task-cp-*.md` 但 hook 报错 `[ERROR] packages/ 子目录开发需要 per-branch PRD`。

**根本原因**: hook 的 `find_prd_dod_dir` 函数只查找 `.prd-${branch}.md`，不查找 `.task-${branch}.md`（尽管 task card 也包含 PRD 信息）。v25 对 `packages/` 子目录开发额外要求有 `.prd-<branch>.md`。

**下次预防**:
- [ ] 在 `packages/` 子目录下开发时，同时创建 `.task-*.md` 和 `.prd-*.md`（或者只创建 `.prd-*.md`）
- [ ] 记住：v25 保护不认 task card 格式

---

### 坑 3: .dev-mode 缺少 `tasks_created: true`

**现象**: 写 packages/ 文件时报错 `[ERROR] Task Checkpoint 未创建`。

**根本原因**: branch-protect.sh 检查 `.dev-mode.${branch}` 文件中是否有 `tasks_created: true` 字段。

**下次预防**:
- [ ] 创建 `.dev-mode.*` 时始终加入 `tasks_created: true`

---

## 下次更好做

- CI L1 execution gate 的 `manual:bash` 命令里不要有 shell 特殊字符嵌套（双引号内的单引号），容易解析失败，用 `node -e` 更安全
- DoD 的 `[ARTIFACT]` 条目用 `stat` 而不是 `test -f`（后者被 check-dod-mapping.cjs 禁止）
