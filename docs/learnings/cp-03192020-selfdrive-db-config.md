# Learning: Self-Drive 间隔可配置化
## 分支
`cp-03192020-selfdrive-db-config`
### 根本原因
Self-Drive 12 小时间隔硬编码，太慢。应该像人一样持续思考。
### 下次预防
- [ ] 新增定时任务时，间隔必须从 brain_config 读取，不硬编码
