# Learning: 刀0 照相层复活(registry 双账断链根治第一步)

### 根本原因
registry 一词底下混着两本账:扫描器写的照相层三表(api/db_schema/test_registry,5/26 起无人触发)与端点读的账本层(system_registry,仅 54/6/18 行增量)。旧政权(全量照相)被弃时未收尾,新政权(对抗流水线)只记自己时代——proposer 开工查询命中率跌到 8%/3%/1%,"查不到→自创 [NEW_PATTERN]"成为孤岛制造机。

### 下次预防
- [ ] 凡 derived 表必须带账龄哨兵:数据源停摆 >阈值时消费端响应自动 stale:true,不允许静默陈账
- [ ] 废弃一条数据链路时必须同 PR 收尾:停写入器 + 迁移/关停读取端 + 更新 skill 文档,禁"新链上线旧链悬空"
- [ ] 照相层(机器事实,全量,无判断)与账本层(承诺,拍板入账)永久分层,禁合并、禁互相补录
- [ ] 临时起 Brain 实例(验证/调试)必须显式指 scratch/test 库(DB_NAME=cecelia_scratch),默认连生产 cecelia 库的裸 `node server.js` 一次也不许——2026-07-18 实测 8 秒内 Monitor 循环就对生产任务动手(本次零损伤纯属侥幸)
