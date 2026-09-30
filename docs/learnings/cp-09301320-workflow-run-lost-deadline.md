# 整批跑了 6 小时没人判死（09-30）

### 根本原因
- Commander run 在 Brain 里是 ZenithJoy 桥建的 device_job 镜像单（in_progress），终态只靠执行机 finalize 回执；执行机死循环不 finalize、escort 被移除，Brain 侧没有任何"总时限到期即 lost"的程序判据，三部手机各卡 6 小时。
- 现有 6h 超时只覆盖 Notion ssh 直派的 workflow_run（reapSshWorkflowRuns），镜像单不在其内。
- 读侧 `resolveWorkflow` 只从账本 run_id 的 `-crontab-` 前缀推 workflow，对标 run 前缀写死会错归到关键词获客。

### 下次预防
- [ ] 任何外部执行体的 in_progress 单必须有程序判 lost 的总时限（SQL 内比较时间，禁 JS 解析无时区时间）
- [ ] 判 lost 与善后分离：善后每步 fail-open 且只做一次（payload 标记），对账翻回 in_progress 也不重复放锁
- [ ] 能力/工作流归类只认任务 payload 字段，不从账本 run_id 前缀推
- [ ] tasks 时间列是 timestamp without time zone：测试写入用 NOW() - interval，不用 ISO 'Z' 字符串（会话 TZ 非 UTC 时会把 5h 前当未来）
