## 关闭 harness_initiative 无头 kernel 派发入口（2026-10-12）

### 根本原因

- 无头 kernel 自 09-30 起已经事实停摆：30 天 372 次派发全败 `kernel_authority_not_created`（112 单），最后一次成功派发是 09-30。但 dispatch-route 仍判 harness_initiative=kernel 可用，dispatcher 照样选单、claim、调 executor，失败后回 queued 反复重试，只留 failed_dispatch 噪音。
- 调研口径误判：「7 单无头排队单 20 天没派」里有 5 单其实带 `headed_manual` **布尔** true（jsonb 布尔，`payload->>'headed_manual'` 同样得 'true'），本来就被选单 SQL 排除；真正无头的只有 10-11 新建的 2 单 relay-baton 子单，没派出去是因为 taskPool 14/14 满（dispatchAllowed=false），派出去也必败。
- #6173/#6174 不是 kernel 产出：是有头会话（cp-MMDDHHMM 分支、作者本人）建单忘带 headed_manual 也没 claim，PR 早已合并；tick 随后把单当无头派了 3 次全败，最后由收账逻辑合成 handoff 标 completed，`executor_kind=kernel-process` 只是派发时打的标。

### 下次预防

- [ ] 查 `headed_manual` 一律用 `payload->>'headed_manual'`（字符串/布尔都识别），别用 `payload->'headed_manual' = '"true"'` 这种只认字符串的写法。
- [ ] 判断「执行体是谁」看 dispatch_events / task_events 的 dispatched 与 failed_dispatch，不看 executor_kind（它是派发时打的标，不代表真跑过）。
- [ ] 关一个执行入口分两步：先关派发（drain 收口，零上游事务风险），等建单方改投新类型后再在建单入口收紧；直接在建单处拒会连带回滚 GP 签字等上游事务，并让 40+ 条 kernel 集成测试整片红。
- [ ] dispatcher 新增任何一条 pool.query 都会让按顺序排队的 mockResolvedValueOnce 测试错位，改前先 grep `drain retired` 找全部依赖顺序的测试一并补。
