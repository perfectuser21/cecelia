# Learning: migration 312 orchestrator DB 结构

### 根本原因
LangGraph checkpoint 把"Brain 进程内状态"和"git/PR/DB 外部真相"变成两份账本，desync 是 resume 三陷阱根因。T1 用"外部真相可重推导的轻量字段 + append-only 决策日志"替代 checkpoint 存储。

### 踩过的坑
- **schema challenger P0**：phase 扩枚举漏 `A_planning` 存量值 → 有存量行的生产库 ADD CONSTRAINT 全表校验直接失败，两台生产 schema 分叉
- **schema challenger P0**：新 phase 值在 watchdog 白名单之外 → v2 run 超时无人看管（T4 修；硬顺序依赖：T4 合并前生产不得出现 v2 run）
- **spec 与既有决策冲突**：spec 原写"selfcheck 同 PR bump 312"，实现期发现 issue 14d66027 既有决策"地板不随 migration bump，只有代码真依赖才 bump"——既有决策优先，bump 挪到 T2（首个依赖方）
- **worktree 被外部力量删除两次**（~10:50 / ~11:33，未提交改动全丢）：凶手未定位（janitor 无 worktree 逻辑、Brain emergencyCleanup 需 slot、cmd_cleanup 需已合并 PR，全排除）。止损 = 立即 commit + push 上远端
- **本地全量 vitest worker OOM**（tinypool "Worker exited unexpectedly"）：非本改动引入，与并行 session 抢资源有关；quickcheck 判定"worker 异常退出但无测试失败 → 继续"

### 下次预防
- [ ] 任何 CHECK 枚举收紧/替换类 migration：先 grep 代码里该字段全部合法值消费方（watchdog/patrol/graph），再查生产存量 DISTINCT 值
- [ ] append-only 承诺必须落 trigger SQL 并 proven-to-fire（亲眼看 UPDATE/DELETE 报红），不落=假承诺
- [ ] migration 测试跟 305 惯例走文件断言（CI 无真 Postgres）；真库行为验证在本地 dev DB 事务内跑完 ROLLBACK
- [ ] 改 EXPECTED_SCHEMA_VERSION 前先读 selfcheck.test.js 的地板注释（issue 14d66027）
- [ ] worktree 里的实现改动尽快 commit+push，不留长时间未提交状态（存在未定位的 worktree reaper）
