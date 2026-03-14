---
id: learning-cp-03142149-ci-task-format
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 初始版本
---

# Learning: CI 支持 Task Card 格式

## 背景

dev 工作流 v4.0 引入统一 Task Card（`.task-cp-{branch}.md`），但 CI 的 `cleanup-check` 和 `required-paths-check` 两个 job 仍只识别旧格式（`.prd-*.md` + `.dod-*.md`）。

## 改动

在 `ci-l1-process.yml` 的两处文件查找逻辑前新增 task card 查找分支：
- `cleanup-check` job：优先找 `.task-${GITHUB_HEAD_REF}.md`
- `required-paths-check` job：优先找 `.task-${HEAD_REF}.md`

## 关键经验

1. **DoD Test 字段禁止用 echo**：`echo 'CI 通过由 GitHub Actions 验证'` 会被 check-dod-mapping.cjs 识别为假测试（exit 1）。正确做法是换成真实命令，或改用能退出 0 的 grep 命令。

2. **新分支的 .task-*.md 不能被旧 branch-protect.sh 识别**：本地 hook 仍只认 `.prd-*.md` + `.dod-*.md`，开发时需同时创建旧格式文件让 hook 通过。后续 hook 升级后可统一。

3. **DoD 验收条目必须是 [x] 状态才能通过 CI**：check-dod-mapping.cjs 会检查所有条目的验证状态，`- [ ]` 会被报告为"未验证"。

4. **Learning 文件是硬门禁**：走 /dev 流程的 PR 必须有 `docs/learnings/<branch>.md`，否则 Learning Format Gate 报错。如不需要学习记录，可在 PR title 加 `[SKIP-LEARNING]`。
