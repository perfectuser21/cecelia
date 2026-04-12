### 根本原因

harness_fix R58 被 Brain 派发，但功能（active_pipelines 字段）已于 PR #2282 合并并通过。
所有三项合同测试（字段存在、DB 一致、harness_generator 注入不影响计数）均正常运行。

### 下次预防

- [ ] Brain 应在派发 harness_fix 前先查询已有 PASS eval-round，避免重复派发
- [ ] 若上一轮 PASS，本轮无 FAIL 文件，直接验证通过即可关闭任务
