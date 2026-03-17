# Learning: L2 concurrency group run_number 破坏并发取消语义

## 根本原因

`run_number` 使每次 run 的 group name 唯一，导致 `cancel-in-progress: true` 无法匹配同分支的旧 run，实际上等同于 `cancel-in-progress: false`。

当初加 `run_number` 是为了绕过 pending 死锁（彼时 `cancel-in-progress: false`），但后来改为 `true` 后没有同步移除 `run_number`，反而破坏了新的语义。

## 修复

将 group 从 `l2-v2-${{ github.ref }}-${{ github.run_number }}` 改为 `l2-${{ github.ref }}`，保留 `cancel-in-progress: true`。

## 下次预防

- [ ] 修改 `cancel-in-progress` 时，同步检查 `group` 是否含有使其唯一化的变量（如 run_number、run_id）
- [ ] `cancel-in-progress: true` + group 含 `run_number` = 自相矛盾，CI review 时应直接报警
