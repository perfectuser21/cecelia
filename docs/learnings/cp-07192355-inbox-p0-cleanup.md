## Inbox P0清场——退役conversation-digest与capture-digestion（2026-07-19）

### 根本原因
- conversation-digest.js 写入的 conversation_captures 表字段（source_file/raw_content/status）与 migration 194 实际建表 schema（session_id/summary/key_decisions）完全错位——两个不同功能不同时期各自认领了同一张表名，写入必报错但被 catch 吞成 warning，4 个月 58,969 条 error cursor 无人发现
- 静默失败能存活 4 个月的结构性原因：job 无成功率指标、无账龄哨兵、产出表无消费方（写通了也没人读）——"生产者拼命写、消费者不存在"
- capture-digestion 依赖的手动记录入口（captures 表）从未真正投入使用（全库 2 行），入口有摩擦的捕获系统必然空转

### 下次预防
- [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）
- [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审
- [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）
- [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）
