## Brain {VERSION} — 照相层保鲜预算盖不住刷新周期，coding 派发每周期都有死窗

- 保鲜预算 `PHOTO_STALE_THRESHOLD` 与 `rescan-if-changed.sh` 的触发阈值碰巧同为 600s，语义
  变成「刚过期才去刷新」；而一轮全扫要 324s（0921 实测 cecelia：api 08:40:04 / graph 08:45:24）、
  cron 粒度 300s、上一轮没跑完时本轮被锁挡掉（日志实测 age=600/899/1200s）。于是旧快照过期
  在数学上必然早于新快照落库，派发闸每个刷新周期都有一段稳定死窗，落进去的 coding 任务一律
  抛 `map_stale`（实测复现：任务 a70d7743 08:51 派发、快照 08:40:04，差 11 分钟即死）。
  预算改为 1800s，并把触发阈值 / 扫描耗时 / cron 粒度三个数各自显式命名。
- 放宽安全性依据：正确性由 `assertMapImpactContract` 的 `map.source_revision === base_sha`
  精确保证，账龄只是活性心跳；真停摆由 `promise-map-nightly` 的 24h 哨兵押尾。
- 新增机械守卫 `registry-freshness-budget.test.js`：预算必须严格大于「触发+扫描+cron 粒度」，
  且 JS 记的触发阈值必须等于 shell 脚本里 grep 出的真实默认值（只改一边就红）。
- `promise-map-nightly` 新增断言 `fact_snapshot_dispatch_gate`：同一批 headers 改用派发闸
  口径判年龄。此前 A5 用 24h 口径、派发闸用 10min 口径，差 48 倍——快照按派发口径已陈旧、
  coding 全挂时 A5 照样报绿，这正是该缺陷烂 11 天无人发现的原因（issue e180b05c 曾据此
  误判为「扫描链全挂」）。
