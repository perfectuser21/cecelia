## QuickCheck 并发互斥锁（2026-04-14）

### 根本原因
scripts/quickcheck.sh 无互斥锁，导致多个 git push（多 worktree、或用户连续触发）各自启动独立 vitest，互相抢 CPU/内存。PR #2332 推送时 3 个 vitest 同时跑，最长 25 分钟未完，push 卡死。

### 下次预防
- [ ] 任何调用 `npx vitest run`（全套）的入口脚本都应考虑互斥（pre-push / pre-commit / git hook）
- [ ] flock `-w` 和 `-n` 不要同时用（`-n` 覆盖 `-w`，立即失败而非等待）— 本次 Spec Review 抓到
- [ ] 用正则从真实脚本切片构造测试 fixture 是反模式 — 未来倾向用 env var 或独立 function 注入测试逻辑（本次 Code Review 提醒，延后改）
