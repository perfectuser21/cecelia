## Brain {VERSION} — 秋米任务按预期开始时间排期派发 + 委派人

- 中文「任务」表：预期完成日期 改名「预期开始时间」（=开始执行时间），新增「预期结束时间」「委派人」；英文 Tasks 新增 Delegated By，Plan Date 写开始~结束区间（决策 51c09285，任务 0b3592c9）。
- 入账：预期开始时间 → payload.next_run_at + scheduled_start（派发器没到点不派；只写日期=当天 00:00 上海），预期结束时间 → due_at；开始时间在未来时中文保持「委派」并在 OpenClaw结果 写「🕐 已排期 MM-DD HH:mm，到点派发」，英文 Planned。
- 委派人：写了就用；空着按页面创建者补（人=Notion 名字，集成机器人=「Agent（未标注）」）并回写中文表；存 payload.delegated_by。
- 改期：已排期的行在中文表改预期开始时间 → 急停步复用已有「委派+brain:」查询跟着改 next_run_at（只和 scheduled_start 比，不冲掉失败重试退避）。
