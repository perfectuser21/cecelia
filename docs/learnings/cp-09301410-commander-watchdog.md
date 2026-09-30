# escort 被移除后 5 小时无人陪跑（09-30）

### 根本原因
- 陪跑 Commander（OpenClaw cron escort）只有"起跑时登记一次"，没有活性证据：被 `cron rm`、网关重启吞掉、或 SOP 跑飞，Brain 与执行机都不知道，run 就此裸跑。
- Brain 单是起跑后由 wall-report 建的，escort 拿不到单号，心跳无法按单号写——只能按 TAG 定位（payload.tag → 账本 run_id → serial）。
- 趋势层（连续零产出 / 手机一天无成功批）此前没有程序算，只靠人看日志。

### 下次预防
- [ ] 任何"陪跑者/看护者"必须有心跳写进被看护对象的账（payload.commander_heartbeat_at），看门狗只认心跳不认"登记过"
- [ ] 接班判据用 GREATEST(心跳, 上次接班)：只 COALESCE 会让旧心跳把刚接班的行再拉一次（pg 集成测试抓到）
- [ ] 外部 id 解析正则别写死 [a-f0-9]（openclaw id 是 uuid，但测试桩/别的系统不是），按白名单字符集放宽
- [ ] 接班上限 + Bark 落 payload 标记，SQL 过滤，绝不靠进程内计数（Brain 重启即归零）
