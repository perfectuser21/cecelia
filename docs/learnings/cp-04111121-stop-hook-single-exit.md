## stop hook ready_to_merge 中间状态导致人工介入（2026-04-11）

### 根本原因
devloop-check.sh 条件 6（CI 通过 + step_4 done）返回 `ready_to_merge` 状态，stop-dev.sh 将其解释为 exit 2 并在 reason 中附加"请手动执行 gh pr merge"。Claude 把这条 action 输出给用户，用户需要手动介入。违反了"单一出口原则"（exit 0 唯一条件 = PR merged + cleanup_done）。

该状态是一次"P0 修复"留下的残留，原意是避免自动合并失败时无人处理，但结果是每次都需要用户介入。

### 下次预防
- [ ] 任何新增的中间状态（非 done/blocked）都必须在 devloop-check-gates.test.ts 中有断言禁止
- [ ] CI in_progress 和类似的"等待"状态不应输出 action 字段（只输出 reason）
- [ ] 合并失败处理方式：blocked（exit 2）+ action 指向 Claude 可执行的命令，而非用户操作
