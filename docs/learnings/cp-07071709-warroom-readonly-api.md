## warroom 数据层只读端点（handoffs + sentinel/health）（2026-07-07）

### 根本原因
war room 前端一直是"任务清单板"而非"活的作战室"：交接单（tasks.result.handoff）、调度哨兵（working_memory scheduler_job_last_run:*）、用户决策等数据器官全在库里，但没有只读 API 供前端消费——数据生产侧（saveHandoff / scheduler-jobs 哨兵写入）建好后没人补读口。

### 下次预防
- [ ] 新建数据器官（新表/新 JSONB 字段/新 working_memory 键族）时，同 PR 或同 initiative 内规划只读消费端点，避免"写侧完工、读侧悬空"
- [ ] smoke 守卫必须 proven-to-fire：本次实弹发现模板两个缺陷（`/INSERT|UPDATE|DELETE/i` 误报合法列名 updated_at；`includes` 对被注释的挂载行仍命中）——字符串 includes 断言对"注释掉"场景无效，行为断言用行首正则
- [ ] worktree 内跑 `npm version` 会触发 reify 副作用（软链 node_modules 被替换为真实安装）：改版本号优先手编 package.json + package-lock 两处，或跑完确认主仓 node_modules 未受损
