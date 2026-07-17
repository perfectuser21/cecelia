# 设计：产能判定合并——harness cap 收权 slot-allocator + cap 函数化（beeba317）

日期：2026-07-17 ｜ 状态：已批准（Alex 07-17 拍板，决策 4c7e935c）
上游：docs/handoffs/202607171730-slot-allocator-consolidation.md（v2，SSOT，本 spec 是其工程化展开）

## 问题

dispatcher 的 harness 并发闸数 in_progress 任务数（`MAX_CONCURRENT_HARNESS_INITIATIVES=2`，dispatcher.js:55-102）。任务生命周期一半以上在等 CI/等 merge，容器已退内存归零仍占并发位 → "纸面满"机器空转。且 cap 是猜出来的常数：即使换成数容器，固定 4 在"4 容器各占 300MB、VM 剩 8G"时照样误拒。

## 方案总览

判定唯一入口收归 `slot-allocator.js`，新增 `harnessSlotCheck(machine='local')`；cap 从常数改为三分量取 min 的函数；体征采样离线化（scheduler-jobs 写缓存，判定读缓存）。

## 组件设计

### 1. 新模块 `packages/brain/src/machine-vitals.js`（采样器 + 缓存）

单一职责：采集本机体征写内存缓存，暴露读接口。不做判定。

```js
// 采样（由 scheduler-jobs 每 60s 调用，不在派发热路径）
async function sampleMachineVitals()   // 写模块级缓存 { sampled_at, relay_containers: [names], vm_total_mb, vm_used_mb, host_disk_pct, docker_disk_pct, error }
// 读取（slot-allocator / capacity-budget 调用，纯同步读缓存）
function getMachineVitals()            // 返回缓存 + stale 标记（age > STALE_MS=180s → stale:true）
```

采样命令（execFile，复用 harness-container-cleanup.js 的 dockerCmd 模式，单次采样总超时 10s）：
- 活 relay 容器：`docker ps --format {{.Names}}` → 前缀 `cecelia-relay-` 过滤
- VM 内存：`docker info --format {{.MemTotal}}`（total）+ `docker stats --no-stream --format {{.MemUsage}}` 求和（used）
- 盘：`df -P /`（宿主）+ `df -P ~/OrbStack 数据盘路径`（实现时用 `docker system info` 的 Docker Root Dir 对应宿主挂载，若取不到则并入宿主盘一项并在缓存标注）

任一命令失败 → 缓存写入 `error` 字段，读方按保守处理。

### 2. slot-allocator 新增 `harnessSlotCheck()`

```js
async function harnessSlotCheck({ machine = 'local', candidate } = {})
// 返回 { allow: boolean, reason, containers, inflight, cap: {effective, mem_cap, acct_cap, hard_cap}, vitals, quota, stale }
```

判定顺序（任一拒即短路，全部原因进返回值供日志）：
1. **vitals 可用性**：缓存 error 或 stale（>180s）→ 拒（reason=`vitals_stale`/`vitals_error`）
2. **盘**：host_disk_pct 或 docker_disk_pct > 85 → 拒（`disk_pressure`）
3. **内存健康**：`evaluateMemoryHealth` action=halt（Brain RSS 泄漏，语义不改）→ 拒（`memory_pressure`）
4. **Claude 额度（收编，禁新写）**：调 `checkQuotaGuard()`——`allow=false`（>98%）→ 拒（`quota_critical`）；`priorityFilter` 存在（>90%）且 candidate.priority 不在名单 → 拒（`quota_low_priority`）
5. **动态 cap**：
   - `mem_cap = floor((vm_total_mb - vm_used_mb) / RELAY_TIER_MB)`，RELAY_TIER_MB 取 resource-tier.js 的 normal 档 1024（import 常量，不硬编码数字）
   - `acct_cap = 可用 Claude 账号数 × PER_ACCOUNT_CONCURRENCY(2)`，账号数 = account-usage ACCOUNTS 中未 spending-cap、未 auth-fail 的个数（account-usage 需导出 `getAvailableAccountCount()`）
   - `hard_cap = env HARNESS_HARD_CAP || 8`
   - `effective = max(1, min(mem_cap, acct_cap, hard_cap))`——mem_cap 算出 0 时不压到 0（已有容器在跑说明还活着，且 halt 由第 3 步管）；但 mem_cap ≤ 0 且活容器 ≥ 1 时拒（`no_memory_headroom`）
   - `拟占用 = 活 relay 容器数 + inflight`，inflight = 最近 5min 内进入 in_progress 且 docker ps 里没有对应容器的 harness_initiative/golden_path_proposal 数（SQL：`started_at > NOW()-interval '5 minutes'`，容器名含 initiative 短 id 前缀做匹配）
   - `拟占用 ≥ effective` → 拒（`cap_reached`）
6. 放行（`allow:true`）

resume 豁免不在本函数内做——保留在 dispatcher 的 `shouldApplyHarnessCap`（候选筛选层），语义不变。

### 3. dispatcher 改造

- `shouldApplyHarnessCap(candidate)` 保留（类型过滤 + resume 豁免）
- 命中后改调 `await harnessSlotCheck({ candidate })` 替代任务数计数；拒发时 `recordDispatchResult(pool, false, res.reason)`，日志打 `slot_check` 全维一行：
  `slot_check containers=X inflight=Y cap=Z(mem=A acct=B hard=C) vitals=ok|disk|stale quota=ok|low verdict=deny:<reason>|allow`
- 旧任务数判定降级 TASK_CAP=12 纯兜底（防 docker 层全瞎时无限叠加）：任务数 ≥ 12 → 拒（`task_cap_backstop`）
- `MAX_CONCURRENT_HARNESS_INITIATIVES` / `harnessConcurrencyExceeded` 删除（含 env 文档），dispatcher 不留第二套判定

### 4. scheduler-jobs 接线

JOBS 数组加一行：`{ name: 'machine-vitals', needsPool: false, handler: sampleMachineVitals }`（60s 循环即采样周期，无需自建 gate）。stale >15min 升级：sampleMachineVitals 内部检测上次成功采样距今 >15min 时 console.error + 写 working_memory 哨兵键 `machine_vitals_stale_alert`（P1 告警接现有哨兵巡检，不新建告警通道）。

### 5. capacity-budget API

GET /capacity-budget 响应加 `machine_vitals` 段 = `getMachineVitals()` 原样透出（含 stale 标记），指挥舱直接吃。

## 明确不做（范围外）

- 三轴选择系（多账号 provider 池/多机分桶实现）→ 刀2 任务 600295fe
- tokenExhausted / codex 闸 / backpressure / 2026-04-18 内存 pivot 语义 → 全部不动
- relay 容器内存档位调整 → 不动

## 测试策略（E2E/integration/unit 分档）

**Unit（vitest，禁 mock 判定函数与数据源之间的边——mock 只允许打在 execFile/pool.query 系统边界上）：**
1. 【failing 主线 A 收权】8 个 in_progress harness + 缓存显示活容器 2 + 体征好 + 额度足 → 旧版拒（红）→ 新版放行（绿）
2. 【failing 主线 B 函数化】缓存显示活容器 4、vm 余量 6G（mem_cap=6）、账号 2（acct_cap=4）→ 拟占用 4 ≥ min(6,4,8)=4 仍拒（acct_cap 卡住，正确）；账号 3 时（acct_cap=6）→ 放行——"有内存+有账号则不被常数卡"
3. mem_cap 压缩：vm 余量 1.5G → mem_cap=1，活容器 1 → 拒
4. 盘 >85% → 拒；memory_pressure(halt) → 拒
5. docker 采样 error → 拒；缓存 stale(>180s) → 拒且 reason=vitals_stale
6. quota >98% → 拒；>90% + P2 候选 → 拒、P0 候选 → 过
7. inflight 超发窗口：活容器 1 + 3min 前 started 无容器的 harness 1 → 拟占用 2
8. TASK_CAP=12 兜底：任务数 12 → 拒（即使容器 0）
9. resume 豁免回归：resume_from_checkpoint=true 不进 harnessSlotCheck（dispatcher 层测）
10. slot-allocator 既有测试全过

**Integration：** scheduler-jobs 单发 `runSchedulerJobsOnce` 含 machine-vitals job → 缓存被填充；capacity-budget 路由返回 machine_vitals 段。

**容器内实弹（交付验收，非 CI）：** 部署后生产日志出现 `slot_check` 全维行；`curl /api/brain/capacity-budget | jq .machine_vitals` 非空。

## 守卫（哨兵死规矩）

- 逻辑接缝：上述 regression tests 永久进 CI
- 环境接缝（docker CLI 在 brain 容器内可用性）：machine-vitals 采样失败本身就是运行时自检（error 进缓存 → 判定拒 + stale 告警哨兵）——proven-to-fire：部署验证时手动改坏 docker socket 权限看它报 stale（实弹步骤写进 PR 验证记录）

## 版本

brain minor bump（行为变更：派发判定换轨）。
