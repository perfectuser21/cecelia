## self-heal 所有权验证（2026-04-14）

### 根本原因
PR #2340 的 self-heal v16.7.0 从"只愈合 HEAD 匹配的 dev-mode"放宽到"愈合所有活跃 worktree"，但没加"所有权验证"→ 后台 Harness 任务留下的 orphan dev-mode 被当前 session 误愈，lock 写入当前 session_id → devloop_check 让当前 session 接手别人的任务。

### 下次预防
- [ ] 自愈类机制都要问"这是我的吗"而不仅"这能愈合吗"
- [ ] dev-mode 字段加 owner_session 显式所有权标记
- [ ] 写新代码时要想"放宽某条件会不会捅出新的侧漏"
- [ ] v9.1.0 的"跑全套回归"规则已经开始起作用（这个 PR 132 tests 0 failed 是证据）
