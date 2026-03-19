# Learning: probeEvolution 查询错误表导致链路失败

## 事件摘要

capability-probe 中 `probeEvolution` 函数曾查询 `cecelia_events` 表（错误），
应查询 `component_evolutions` 表，导致 evolution probe 持续报告失败，
Brain 自我感知链路中断，影响后续能力判断。

### 根本原因

- `probeEvolution` 代码开发时使用了错误的表名 `cecelia_events`，
  而 evolution 数据实际存储在 `component_evolutions` 表
- 无单元测试覆盖 `probeEvolution` 的具体 SQL 查询，导致错误未被提前发现
- PR #1177 修复了表名错误

### 下次预防

- [ ] 每个新 probe 函数上线时，必须同时提交单元测试验证其 SQL 使用正确的表
- [ ] 测试应使用 `pool.query.mock.calls` 断言 SQL 中包含预期的表名
- [ ] `probeEvolution` 现已有 2 个回归测试覆盖（本 PR 添加）
