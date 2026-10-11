## Brain {VERSION} — handoff 下一步四类 + 有头续接待续

- next_steps 四类：resume_headed（有头续接，不派发，原任务 result.pending_resume 挂待续）/ dispatch_headless（无头派发，≡旧 task）/ decision / note（≡旧 done）
- 默认：有头任务未标/认不出 → resume_headed；无头 → note（存量字符串建议不误派）；「完成，无下一步」恒为 note
- PATCH /api/brain/tasks/:id 写 result.handoff 时规范 next_steps 并回 handoff_next_steps（每条被当成什么）
- 新接口：GET /api/brain/handoffs/pending-resume、POST /api/brain/handoffs/pending-resume/:taskId/ack
