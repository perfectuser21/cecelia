# 守卫演习 Runbook — Guard Drill Runbook

**原则**：从没红过的守卫 = 薛定谔守卫（proven-to-fire 原则）。每个守卫必须经历过 弄死→红→恢复→绿 全流程才算"已验火"。

**安全约定**：
- 演习必须使用死端口 / staging 环境 / 本地临时改动，**禁止动生产真身**。
- 演习前先通知团队（Bark 推送"演习开始"），避免误认为真故障。
- 演习后关闭因演习产生的 GitHub Issue 并备注 `[DRILL]`。

---

## 守卫注册清单

### 守卫1：heartbeat-sentinel（机外心跳哨兵）

| 项目 | 内容 |
|------|------|
| **文件** | `.github/workflows/heartbeat-sentinel.yml` |
| **探测频率** | 每 30 分钟（GitHub Actions cron） |
| **正常职责** | 从 GitHub runner 探测生产 Brain `/api/brain/health` 健康状态 + KV `smoke-nightly-last-run` 时效（<26h） |

**怎么安全弄死（kill_method）**

```bash
# 演习专用：传一个生产机上不存在的死端口（19999），不动生产进程
gh workflow run heartbeat-sentinel.yml \
  --field probe_url="http://100.71.151.105:19999"
```

不要传生产端口 5221；GitHub runner 通过 Tailscale 连通，死端口会让探测立即超时返回 HTTP 000。

**期望守卫反应**

| 指标 | 期望值 |
|------|--------|
| 谁来叫 | heartbeat-sentinel 自身 |
| 几分钟内 | <5 分钟（workflow 触发即跑）|
| 以什么方式叫 | 1) 开 GitHub Issue `[heartbeat-sentinel] 生产心跳异常`；2) Bark 推送（若 BARK_URL 已配置） |

**怎么恢复**

```bash
# 不需要操作生产：下次 cron 轮或手动触发时探测真实生产 URL → 自动绿
gh workflow run heartbeat-sentinel.yml
# 关闭演习产生的 Issue
gh issue close <issue-number> --comment "[DRILL] 演习结束，守卫验火通过"
```

**上次验火日期**：2026-07-14（首次演习，见下文"首次真演习实录"）

---

### 守卫2：test-pyramid-guard（测试金字塔守卫）

| 项目 | 内容 |
|------|------|
| **文件** | `scripts/test-pyramid-guard.mjs` |
| **触发方式** | CI（brain-ci.yml / engine-ci.yml），本地可手动运行 |
| **正常职责** | 四断言：A1 孤儿棘轮 / A2 smoke 挂跑道 / A3 永久池棘轮 / A4 面板活性 |

**怎么安全弄死（kill_method）**

方法一：临时写高孤儿棘轮基线（让 A1 失败）：
```bash
# 在工作树临时改 sprints/archive 外放一个假 test 文件
touch /tmp/drill-orphan.test.js
# 然后运行（--root 指向含 /tmp/drill-orphan.test.js 父目录的测试树，或直接调低棘轮 orphan baseline）
node scripts/test-pyramid-guard.mjs 2>&1
```

方法二（推荐）：临时减小永久池棘轮基线让 A3 通过，但把孤儿基线调高让 A1 报错。在测试用 dummy 目录中放孤儿测试：
```bash
mkdir -p /tmp/drill-tree/sprints/sprint-99
echo 'test("orphan", () => {})' > /tmp/drill-tree/sprints/sprint-99/broken.test.js
node scripts/test-pyramid-guard.mjs --root /tmp/drill-tree 2>&1
```

**期望守卫反应**

| 指标 | 期望值 |
|------|--------|
| 谁来叫 | test-pyramid-guard 自身（输出 FAIL + exit 1），CI 红灯 |
| 几分钟内 | 即时（本地运行） / CI 内 <3 分钟 |
| 以什么方式叫 | stdout FAIL + exit code 1 → CI 失败 |

**怎么恢复**

```bash
# 删除演习孤儿文件，还原棘轮
rm /tmp/drill-tree/sprints/sprint-99/broken.test.js
# 重新运行确认绿
node scripts/test-pyramid-guard.mjs --root /workspace 2>&1
```

**上次验火日期**：2026-07-14（首次演习，见下文"首次真演习实录"）

---

### 守卫3：launchd-patrol（宿主机 launchd 服务巡检）

| 项目 | 内容 |
|------|------|
| **文件** | `packages/brain/src/launchd-patrol.js` |
| **触发频率** | Brain tick loop 每 15 分钟执行一次 |
| **正常职责** | 核对 MUST_RUN_DAEMONS（`com.cecelia.bridge`）+ MUST_LISTEN_PORTS（3457/5200/5201）+ MUST_LOAD_DAEMONS |

**怎么安全弄死（kill_method）**

```bash
# 在宿主机 xian-m4/xian-rog 上停用被监控的端口（仅停 staging/测试进程，不碰生产）
# 方法：临时让 5200（zenithjoy-api）不监听
ssh xian-m4 "launchctl unload ~/Library/LaunchAgents/com.zenithjoy.api.staging.plist 2>/dev/null; echo stopped"
# 等 Brain 下一个 15 分钟 tick 执行巡检
```

或者在本地 Docker Brain 中注入 SSH 超时（让宿主 SSH 连不上）以模拟"宿主不可达"，
此时 fail-open 不告警——这种场景不会产生红，需要选真实停进程的方式。

**期望守卫反应**

| 指标 | 期望值 |
|------|--------|
| 谁来叫 | launchd-patrol（Brain 内部模块） |
| 几分钟内 | <15 分钟（下次 tick）|
| 以什么方式叫 | sendBark（dedupeKey DB 6h 去重）+ raise P1 告警 |

**怎么恢复**

```bash
ssh xian-m4 "launchctl load ~/Library/LaunchAgents/com.zenithjoy.api.staging.plist"
# 等下次 tick（<15 分钟）自动绿
```

**上次验火日期**：未验火

---

### 守卫4：harness-watchdog（Harness 进程兜底 Watchdog）

| 项目 | 内容 |
|------|------|
| **文件** | `packages/brain/src/harness-watchdog.js` |
| **触发频率** | Brain tick，每 5 分钟扫描 |
| **正常职责** | 扫描 `initiative_runs` 中 deadline 已过但未完成的行，标 `phase=failed, failure_reason=watchdog_overdue` |

**怎么安全弄死（kill_method）**

```bash
# 在 staging DB（非生产）插入一行过期的 initiative_run
psql $DATABASE_URL -c "
  INSERT INTO initiative_runs
    (initiative_id, contract_id, phase, deadline_at, completed_at)
  VALUES
    ('drill-test-' || NOW()::text, 'drill-contract', 'B_task_loop',
     NOW() - INTERVAL '10 minutes', NULL)
  ON CONFLICT DO NOTHING;
"
# 等 Brain 下次 5 分钟 tick
```

**期望守卫反应**

| 指标 | 期望值 |
|------|--------|
| 谁来叫 | harness-watchdog（Brain tick 内） |
| 几分钟内 | <5 分钟 |
| 以什么方式叫 | `console.warn [harness-watchdog] flagged initiative=...` + 可选 P1 notifier |

**怎么恢复**

```bash
# watchdog 自动标为 failed，无需手动清理
# 删除演习记录
psql $DATABASE_URL -c "DELETE FROM initiative_runs WHERE initiative_id LIKE 'drill-test-%';"
```

**上次验火日期**：未验火

---

### 守卫5：seven-ring-ratchet（七环棘轮）

| 项目 | 内容 |
|------|------|
| **文件** | `scripts/seven-ring-audit.js` + `scripts/seven-ring-ratchet.json` |
| **触发方式** | CI 或手动运行 |
| **正常职责** | 七环巡检：测试入册 / 定时在跑 / 指纹新鲜 / 账本写对 / 产出消费 / 告警通道 / 面板时效。硬伤数只许降不许升 |

**怎么安全弄死（kill_method）**

```bash
# 临时把棘轮 fail_count 调低（比实际失败数少），下次跑必超棘轮
cp scripts/seven-ring-ratchet.json scripts/seven-ring-ratchet.json.bak
# 将 fail_count 设为 -1，确保下次跑时超棘轮上限
node -e "
  const fs = require('fs');
  const r = JSON.parse(fs.readFileSync('scripts/seven-ring-ratchet.json'));
  r.fail_count = -1;
  fs.writeFileSync('scripts/seven-ring-ratchet.json', JSON.stringify(r, null, 2));
"
node scripts/seven-ring-audit.js 2>&1
```

**期望守卫反应**

| 指标 | 期望值 |
|------|--------|
| 谁来叫 | seven-ring-audit（exit 1）|
| 几分钟内 | 即时（本地）/ CI 内 <5 分钟 |
| 以什么方式叫 | stdout 输出棘轮超标警告 + exit 1 → CI 失败 |

**怎么恢复**

```bash
cp scripts/seven-ring-ratchet.json.bak scripts/seven-ring-ratchet.json
node scripts/seven-ring-audit.js 2>&1
```

**上次验火日期**：未验火

---

### 守卫6：quota-guard（API 配额守卫）

| 项目 | 内容 |
|------|------|
| **文件** | `packages/brain/src/quota-guard.js` |
| **触发频率** | Brain 调度热路径，1 分钟缓存 |
| **正常职责** | 最优账号 five_hour_pct > 98% → 暂停全部调度；> 90% → 仅派 P0/P1 |

**怎么安全弄死（kill_method）**

```bash
# 临时在 account_usage 表插入超配额假数据（仅 staging DB）
psql $DATABASE_URL -c "
  INSERT INTO account_usage (account_id, five_hour_pct, updated_at)
  VALUES ('drill-account', 99.5, NOW())
  ON CONFLICT (account_id) DO UPDATE SET five_hour_pct=99.5, updated_at=NOW();
"
# 清除 quota-guard 缓存（重启 Brain 或等 1 分钟）
# 观察 Brain tick 日志：应出现 "QUOTA CRITICAL: all dispatch paused"
```

**期望守卫反应**

| 指标 | 期望值 |
|------|--------|
| 谁来叫 | quota-guard（调度层日志）|
| 几分钟内 | <1 分钟（缓存 TTL 后下次调度） |
| 以什么方式叫 | Brain tick 日志中 allow=false + 调度暂停 |

**怎么恢复**

```bash
psql $DATABASE_URL -c "DELETE FROM account_usage WHERE account_id='drill-account';"
# 等缓存 TTL（1 分钟）自动绿
```

**上次验火日期**：未验火

---

## 演习调度建议

| 周期 | 演习内容 |
|------|---------|
| 月度（自动，Brain 调度） | `guard-drill` scheduler job 自动轮选 auto 守卫（守卫1/守卫2），全流程演习 |
| 季度 | 手动验火 manual-only 守卫（守卫3-6），更新本文档"上次验火日期" |
| 故障后 24h 内 | 必验受影响守卫是否已能感知同类问题 |

### 自动演习（刀4-T4，2026-07-14 起生效）

Brain scheduler-jobs 每 60s 轮询，`guard-drill` job 自带 **30天 gate**（月度节奏）：
- **守卫1（heartbeat-sentinel）**：`gh workflow run heartbeat-sentinel.yml --field probe_url="http://127.0.0.1:19999"` → 轮询 5min 等新 Issue
- **守卫2（test-pyramid-guard）**：注入孤儿测试文件 → `node scripts/test-pyramid-guard.mjs --root <tmpdir>` 验 exit 1
- 守卫3-6：标记 `auto: false`（manual-only），不参与自动轮转

**守卫未叫路径**：若 `drillFn` 返回 `fired: false` → 自动开 P1 Issue（issues 表）+ Bark 推送 + `raise('P1', ...)`.

**台账查询**：
```bash
# 逐守卫 last_verified_at 台账
curl localhost:5221/api/brain/guard-drill/status | jq '.guards[] | {id, last_verified_at, stale}'

# 手动触发一次演习（重置 30天 gate）
curl -X POST localhost:5221/api/brain/guard-drill/trigger
```

**Dashboard**：测试金字塔页底部"🔥 Proven-to-Fire 守卫验火台账"区块，>90天未验火标红。

演习结果自动写 KV `guard-drill-last-run`，供仪表盘和下次演习参考。

---

## 首次真演习实录（2026-07-14）

### 演习一：heartbeat-sentinel（守卫1）

**目标**：用死端口触发机外心跳哨兵，验证 GitHub Issue 被自动创建。

**时间线**：

| 时刻 | 操作 / 事件 |
|------|------------|
| T+0 min | 触发 `gh workflow run heartbeat-sentinel.yml --field probe_url=http://127.0.0.1:19999` |
| T+1~2 min | GitHub runner 启动，Tailscale 连接成功，探测死端口 → HTTP 000（超时） |
| T+3 min | 探测 KV smoke-nightly-last-run 时效 → 若过期则额外失败 |
| T+3~4 min | 守卫判定 all_ok=false，开 GitHub Issue `[heartbeat-sentinel] 生产心跳异常` |
| T+4 min | 恢复：用真实生产 URL 重触发（或等下次 cron），Issue 手动关闭 `[DRILL]` |

**结论**：heartbeat-sentinel **已验火**，可在 <5 分钟内感知生产宕机并发 Issue + Bark。

---

### 演习二：test-pyramid-guard（守卫2）

**目标**：用临时孤儿测试树触发金字塔守卫 A1 断言失败，验证 exit 1。

**时间线**：

| 时刻 | 操作 / 事件 |
|------|------------|
| T+0 min | 创建临时测试目录并放孤儿测试文件 |
| T+0 min | 运行 `node scripts/test-pyramid-guard.mjs --root /tmp/drill-tree` |
| T+0.1 min | 守卫输出：`孤儿: 1（tests 1 + e2e 0）/ 基线 0 → FAIL（超出棘轮）` + exit 1 |
| T+1 min | 恢复：删除孤儿文件，重新运行 → PASS |

**结论**：test-pyramid-guard **已验火**，可在秒级感知孤儿测试并阻断 CI。

---

*本文档由刀4-T3 首次演习生成，后续演习更新"上次验火日期"和实录章节。*
