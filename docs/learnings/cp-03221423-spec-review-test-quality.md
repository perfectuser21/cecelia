# Learning: spec-review SKILL.md 新增维度D DoD Test字段可执行性验证

## 根本原因

branch-protect.sh 在 `packages/` 子目录下工作时，会从文件所在目录向上遍历寻找 `.prd.md` 或 `.prd-{branch}.md`。如果中间目录（如 `packages/workflows/`）存在旧的 `.prd.md`，会提前返回并以该目录为 `PRD_DOD_DIR`，导致根目录的 task card 不被发现。

## 下次预防

- [ ] 在 `packages/workflows/` 下开发时，必须同时在根目录和 `packages/workflows/` 下创建 per-branch PRD/task card 文件
- [ ] 这是 MEMORY.md 中已记录的规则：「packages/workflows/ 子树下开发时，PRD/DoD 必须放两处」
- [ ] `.dev-mode` 中必须有 `tasks_created: true` 字段，否则 bash-guard.sh 会阻止 step_2: done 写入
