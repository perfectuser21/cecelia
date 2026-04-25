# Learning: dispatcher initiative-lock 收紧到 harness 类型

### 根本原因

`packages/brain/src/dispatcher.js` 的 initiative-level lock 用 `project_id` 一刀切：
同一 `project_id` 任意 `in_progress` task 都会阻拒新派发。

bb245cb4 Initiative 跑 Phase A（harness pipeline）期间，同 project 下的 dev/talk/audit 任务全被
`reason: initiative_locked` 拒派 = 整个 project 死锁。lock 设计初衷是防止 harness pipeline
内部互相抢资源（比如同 Initiative 的两个 harness_task 并行跑），不应牵连通用任务。

### 下次预防

- [ ] 任何"按 project_id / sprint_dir 一刀切"的 lock/限流前先确认是否要按 task_type 维度收紧
- [ ] 引入新 lock 时显式声明白名单 / 黑名单常量，禁止隐式默认全锁
- [ ] dispatcher.js lock SQL 改动必须配单元测试覆盖至少 3 case：
      同类锁定（lock 应触发）、跨类放行（不应锁）、反向放行（blocker 不在白名单）
- [ ] 涉及 dispatcher 的 PR review 必须列出"哪些 task_type 会被该改动影响"
