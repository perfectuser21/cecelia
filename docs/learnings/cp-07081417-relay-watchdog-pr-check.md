# relay watchdog 重复点火出重复 PR

### 根本原因

watchdog 判死 = 容器消失；relay session 全程不回写 pr_url；既有 MERGED 护栏只读 DB 三处 pr_url，全空即失明 → 已开 PR 等 CI/审批的"活任务"被当死跑重点火，新 session 全新分支从头再跑 → 同任务多个重复 PR（5d090237 实证：5 attempt / 4 个 open PR）。

### 下次预防

- [ ] 外部编排的收敛判据必须以外部真相（GitHub）兜底，不能只信自家 DB 回写
- [ ] 任何"重试/重点火"逻辑上线前先问：重试前查过已有产出吗？
- [ ] 阶段二（另任务）：harness-controller 开 PR 后立即回写 pr_url；重点火 session 接续已有分支而非另起
