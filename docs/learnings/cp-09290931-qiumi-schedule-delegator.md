# 秋米任务委派即派、无视安排时间（09-29）

### 根本原因
- 中文表只有「预期完成日期」（截止语义），入账后只写 due_at；派发器只认 payload.next_run_at，不看 due_at → 委派即派。
- 内容日历能按点发，是 media agent 自己在 OpenClaw 挂定时，不是 Brain 排期；换 agent 或写法就失效。
- 派发器早就有 next_run_at 闸（失败重试退避用），只是入账从没把开始时间传给它。

### 下次预防
- [ ] 新增「什么时候执行」语义时，先查派发器已有的时间闸（dispatch-helpers next_run_at），复用而不是另造
- [ ] 比较「人改了时间没有」要和自己上次写入的值（scheduled_start）比，不能和会被别的机制改写的字段（next_run_at 退避）比
- [ ] 往 Notion 写新列之前先建列，否则建页 400
