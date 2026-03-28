# Learning: CI L2 brain-new-files-check 与 brain-l2 行为不一致

## 根本原因

`brain-new-files-check` 独立 job（PR #1649）只检查 `.agent-knowledge/brain.md`，
但 `brain-l2` 内嵌步骤（同一文件）已经支持 `brain.md` **或** `DEFINITION.md` 两选一。
导致同一 CI 文件中存在两套标准，新增 Brain 文件时用 `DEFINITION.md` 更新会通过 `brain-l2` 但被 `brain-new-files-check` 拒绝。

## 下次预防

- [ ] CI 文件中同一语义检查的多处实现，写完第一处立即对比其他处，确保逻辑一致
- [ ] `brain-new-files-check` 独立 job 的逻辑与 `brain-l2` 内嵌步骤应保持同步，任一修改时同步更新另一处
- [ ] PR description 中说明 "接受 X 或 Y" 时，所有相关检查均需实现"或"逻辑，不能遗漏
