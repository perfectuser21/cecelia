# 健康看板僵尸指标：观测写入随架构迁移断链两个月无人发现

### 根本原因

Wave-2 把 executeTick 换成 runScheduler 时，统计写入（tick_execution_stats/tick_last/tick_actions_today）和 capability-probe 启动都留在废弃路径体内，活路径不写不启 → /health 冻在 2026-05-05、probe 冻在 05-22，形成"Brain 老死"假象；因为没有任何闸门断言"观测数据必须新鲜"，僵尸态存活两个月。

### 下次预防

- [ ] 架构迁移（换主循环/换调度器）时必须 grep 旧路径体内全部副作用（统计/启动/巡检），逐个迁移或显式声明放弃
- [ ] 观测指标要配"新鲜度哨兵"：health 端点对 updated_at 超过 N 天的统计字段标 stale，而不是原样透传
- [ ] 看板显示的每个字段，问一句"写入方还活着吗"——僵尸指标比没有指标更危险
