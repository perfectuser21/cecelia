## Brain {VERSION} — 排程台账补齐第四来源：us-vps 宿主 crontab

- `ops_schedule_entries` 此前只有 gha/github(20) + openclaw/mmv(41) + launchd/local(1)，
  宿主 crontab 的 22 条（19 开 3 停：Notion 派单轮询、opc-* 五个 Notion 同步、
  磁盘/网关守卫、库备份、磁盘采样）**完全不在台账**，Notion 上零留痕——看不见的活
  没法被团队调度。
- 新增 `parseCrontab` + 腿4 `crontab@us-vps`（经 `buildHostCmd` 逃出容器读宿主 root 表）。
  真表实证：22 条全部正确分类、标签唯一。
- 三类行分清：活的 / **被注释掉的活**（`#[retired-0921] 45 20 * * * ...` 标 disabled，
  沿用 openclaw 腿的原则「看不见的禁用等于悄悄少干活」）/ 纯说明注释（跳过）。
  判据是"剥掉 `#` 和 `[标记]` 之后仍是合法排期开头"，而不是看有没有 `#`。
- label 带上排期：同一脚本常配多条不同排期（`opc-kr-current.py` 三条、
  `opc-okr-sync.py` 四条、`opc-daily-page.py` 四条），只用 basename 会因
  `(source, host_alias, label)` 唯一键互相覆盖，22 条只剩 13 条。
- `next_run_utc` 一律 null：算 cron 下次运行要完整实现 cron 语义（列表/步长/
  星期与日期的或关系/DST），算错比不算更坏。同 `parseGhaCron` 的口径——禁假精确。
- 0 条解析结果直接抛错（0=可疑禁当真空），与 launchd/openclaw 两腿同口径：
  一次取数失败不该把整份台账标成 inactive。
- 配 `crontab-ledger-smoke.sh` 并登记进棘轮闸 allowlist：验取数命令没写死落点、
  三类行分清、结果真落真 PG 并逐字段读回、同脚本多排期各占一行不互相覆盖。
