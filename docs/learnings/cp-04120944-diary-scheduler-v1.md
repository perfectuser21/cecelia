### 根本原因

diary-scheduler.js 日报内容仅含 PR/任务数量，缺少 KR 进度和异常告警板块，导致管家闭环信息不完整。

### 下次预防

- [ ] 日报类模块增加内容时，先确认 DB 表是否有对应字段（diary_date 用于去重）
- [ ] buildDiaryContent 接受完整 stats 对象，避免日后扩展时参数散乱
- [ ] 测试文件用 vitest describe 分组，覆盖零值/有值/边界三类场景
