# Learning: fix-stop-hook-stage4-completion

## 背景

`packages/quality/hooks/stop.sh` 在 CI pass 后直接 `exit 0`，跳过了 Stage 4（Learning 写入、PR 合并、cleanup_done 标记）。这导致整个工作流在 CI 通过时就被认为完成，没有走完最后的交付步骤。

## 根本原因

stop.sh 的 CI pass 逻辑沿用了早期"CI 通过 = 任务完成"的假设，但正确的完成条件要经过四步：CI 全绿 → Learning 写入功能分支 → PR 合并到 main → cleanup_done: true 写入 .dev-mode。CI 通过只是必要条件之一，不是终止条件。
`packages/engine/lib/devloop-check.sh` 已经有完整的 Stage 4 检查逻辑（SSOT，第 498-566 行），但 `packages/quality/hooks/stop.sh` 是独立的实现，没有同步该逻辑，导致两套 stop hook 行为不一致。
`cleanup_done: true` 才是唯一合法的 exit 0 出口：只有写入 cleanup_done 才能保证 Learning 和 PR 合并都已完成。

## 下次预防

修改 stop hook 逻辑时，必须以 devloop-check.sh 作为 SSOT 参考，不允许在 cleanup_done 之前 exit 0。新增任何退出路径时，先问：这个路径是否保证了 Learning 已推到 PR 分支、PR 已合并？

## Checklist

- [x] CI pass 后的 exit 0 替换为 cleanup_done 检查
- [x] 新增 Step 10: cleanup_done: true → exit 0（唯一出口）
- [x] 新增 Step 11: PR 已合并检查 + step_4_ship 验证
- [x] 新增 Step 12: PR 未合并时提示 Learning → 执行合并
- [x] bash -n 语法检查通过
- [x] 逻辑与 devloop-check.sh SSOT 对齐
