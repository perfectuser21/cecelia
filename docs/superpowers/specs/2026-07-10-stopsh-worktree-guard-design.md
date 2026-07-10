# stop.sh 孤儿 worktree 清理补 Guard A

## 背景

`packages/engine/hooks/stop.sh` 有一段孤儿 worktree 自动清理逻辑：每次 Stop Hook
触发（每个并发 session 每轮对话结束）都会跑一次，遍历 `git worktree list --porcelain`，
对每个 worktree 查其分支对应 PR 是否 MERGED，是则 `git worktree remove --force` 删除。

这段逻辑完全没有 Brain 侧 `zombie-sweep.js`/`zombie-cleaner.js` 已有的 Guard A
（PR #3694，2026-07-10 合并）三层防护：

1. **无锁**：多个并发 worktree session 各自的 stop.sh 会同时无锁读写同一份
   `.git/worktrees` 共享元数据。`startup-recovery.js` 的代码注释已明确写
   "prune 期间别人 worktree remove 会撕坏 .git/worktrees 元数据，必须互斥"。
2. **`--force` 强制删除**：不检查目标 worktree 是否有未提交改动。
3. **不检查活跃锁**：不检查 `.dev-lock` / `.dev-mode.*`，无法识别"正在被用"的 worktree。

触发频率上，stop.sh 比 Brain 侧 20-30 分钟一次的 tick 高一个数量级（本机同时
跑 4 个 worktree session 时，每个 session 每轮对话结束都触发一次），是
07-09/07-10 晚间反复删除活跃 session worktree的最可能根因（含本次 T5 dreaming-L1
任务 session-ff86e281 在 push 过程中被清空）。

## 设计

在 `stop.sh` 孤儿 worktree 清理代码块前后加三层防护，与 `zombie-sweep.js` 对齐：

1. **flock 互斥**：锁文件放主仓 `git-common-dir` 下（`stop-worktree-cleanup.lock`），
   非阻塞式获取（`flock -w 5`，5 秒拿不到就跳过本轮，不阻塞 Stop Hook 主流程）。
   模式参考 `scripts/quickcheck.sh` 已有的 flock 用法。
2. **未提交改动检查**：对每个候选 worktree 跑 `git status --porcelain`，非空则跳过
   （不强制删有本地改动的 worktree，即使其分支 PR 已 MERGED）。
3. **活跃锁检查**：候选 worktree 根目录存在 `.dev-lock` 或 `.dev-mode.*` 文件则跳过
   （这些文件标记"正被某个 dev session 占用"）。

三层检查顺序：活跃锁 → 未提交改动 → PR 已合并才删（前两层任一命中就 continue，
不查 PR 状态，省一次 `gh` API 调用）。

## 影响范围

只改 `stop.sh` 一个文件里的这一段逻辑，不改其他路由（architect-lock/decomp-mode
分支不受影响）。清理行为变得更保守（更多情况下选择跳过而非删除），不会引入新的
误删风险；唯一的回归风险是"该删的没删"（孤儿 worktree 堆积），可接受——比误删活跃
session 的后果轻得多。

## 测试策略

Bash 脚本，用一次性测试脚本（非 vitest）验证三个场景，仿照仓库里其他 hook 测试
的手工验证方式：
1. 构造一个已合并分支的干净 worktree → 应被删除（回归原有行为）
2. 构造一个已合并分支但有未提交改动的 worktree → 应跳过并保留
3. 构造一个已合并分支但有 `.dev-lock` 的 worktree → 应跳过并保留

不追加 CI 集成（stop.sh 是 hook 脚本，仓库里其他 hook 也没有 vitest 覆盖，遵循现
有模式，用手工验证脚本留痕即可）。

## 验收标准

- [ ] 三个场景手工验证通过（脚本化，输出留痕）
- [ ] `bash -n stop.sh` 语法检查通过
- [ ] CI 全绿
