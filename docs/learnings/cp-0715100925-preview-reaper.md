# preview 泄漏致宿主盘满——单发 webhook 无对账（2026-07-15）

## 根本原因

预览环境清理只有一条腿：PR close 事件 → GHA 单发 webhook → Brain 执行 stop。Brain 不可达窗口（Tailscale 抖动、宕机、部署重启）事件即永久丢失，且 workflow 把 curl 失败吞成 exit 0 还评论"已清理"——泄漏既不报警也无人对账。堆到 23G worktree + 19 孤儿 DB 时宿主盘 100%，OrbStack VM 写盘 StorageFull 自杀，生产全灭。

## 下次预防

- [ ] 任何"事件触发式清理"必须配"周期对账式回收"双腿（事件腿快、对账腿兜底）——preview-reaper.sh 即模板
- [ ] webhook 调用失败禁止吞成功：step 必红 + 评论如实，否则泄漏无信号
- [ ] 会删数据的回收器三铁律：目标名白名单正则、状态未知 fail-safe 不动、上线前 --dry-run 与人工核对
