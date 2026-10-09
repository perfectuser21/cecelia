# 手机设备资源锁设计（device_locks 纳管安卓手机 + 原子 acquire + 派发接线）

日期：2026-09-16 · Brain task 104ab89f · 归位：管家线 G5 横切件 · GP-Anchor: none(infra)

## 问题

Brain 无手机级资源互斥：多个 RPA 任务（发布/点赞/采集）并发派发会互抢同一台安卓手机——adb/UIA 双流同机互抢前台，最坏情况把内容发错到真实平台。`device_locks` 表（migration 065）建成后零调用方，种子里没有任何手机，且现有 acquire API 是先 SELECT 再 UPDATE，本身有并发竞态。

## 方案（对抗收敛后）

被否掉的备选：①acquire 放 `selectNextDispatchableTask` 候选循环内——该点到真派发之间有 8+ 条拒绝/回滚路径（pre-flight fail、duplicate skip、slot deny、claim 竞争失败等），每条都让锁泄漏到 TTL，否。②释放逐终态回写点接线——executor.js 47 处终态直写 + psql 直设病史，枚举必漏，否。③执行侧心跳续期——需改造远端执行体，重，否。

### 组件

**1. Migration 448**：`device_locks` 加列 `host TEXT`、`device_type TEXT`（本期仅登记元数据，不做主机路由校验）；种子 4 台手机（2026-09-16 adb 实采）：

| device_name (serial) | host | device_type |
|---|---|---|
| ANGYVB4311010223 | xian-m1 | phone |
| e6c7ef34 | xian-m1 | phone |
| ANGYVB4227006983 | xian-m4 | phone |
| ANGYVB4402004137 | xian-m4 | phone |

schema_version 插行。selfcheck EXPECTED_SCHEMA_VERSION **不 bump**（豁免记录：selfcheck.js:28 是地板语义 `DB >= expected`，431-447 共 17 个 migration 均未 bump 属既定惯例；bump 反而要求生产先跑 448 才能过自检，平添部署顺序耦合）。

**2. `src/device-lock-helpers.js`**（新模块，三个函数，全部单条原子 SQL）：

- `acquireDeviceLock(taskId, serial, ttlMinutes)` — 原子 UPDATE：
  ```sql
  UPDATE device_locks SET locked_by=$1, locked_at=NOW(), expires_at=NOW()+($2||' minutes')::interval
  WHERE device_name=$3 AND (
    locked_by IS NULL
    OR locked_by = $1                -- 同持有者 reacquire=续期（重启二次派发防自死锁，必须保留）
    OR (expires_at IS NOT NULL AND expires_at < NOW()
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id::text = device_locks.locked_by
                        AND t.status = 'in_progress'))   -- 过期抢占双重判据
  ) RETURNING *
  ```
  0 行时二次 SELECT 区分：行不存在 → `{result:'unknown_device'}`（fail fast）；被占 → `{result:'locked', holder}`。
  `expires_at IS NULL AND locked_by 非空` = 永久锁视为占用，仅双重判据可解。ttl clamp [1,240]，默认 30。
  **时钟死规矩：expires_at 只用 DB 侧 NOW() 写、只与 NOW() 比，禁收执行体自报时间戳。**
- `releaseDeviceLocksHeldBy(taskId)` — `UPDATE ... SET NULL WHERE locked_by=$1`。
- `sweepStaleDeviceLocks()` — 对账式释放（正确性保证，不依赖回写点接线）：
  ```sql
  UPDATE device_locks SET locked_by=NULL, locked_at=NULL, expires_at=NULL
  WHERE locked_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id::text = device_locks.locked_by
                    AND t.status IN ('queued','in_progress'))
  ```
  按"持有任务非活跃"判而非枚举终态——天然覆盖 completed/failed/cancelled/quarantined/blocked/dep_failed/archived/psql 直设/task 已删。

**3. 派发接线（两处）**：

- **dispatcher.js**：原子 claim 成功之后、triggerCeceliaRun 之前，`task.payload.device_serial` 存在时 acquire（locked_by=task.id）。`locked` → 释放 claim + revert queued + skipIds continue（复用现成 HOL skip 形状）；`unknown_device` → 任务 failed + error_message（防静默饿死 queued，drain 泄漏病史同型）。claim 后任何既有拒绝/回滚路径在 revert 处同步 `releaseDeviceLocksHeldBy`。
- **worker-pool-dispatch.js**：CAS claim 之后同样 acquire；抢不到 → revert 留下轮。旁路不接线 = 锁形同虚设。

**4. tick 接线**：`sweepStaleDeviceLocks` 挂 tick 周期 job；`task-updater.js updateTaskStatus` 终态分支挂即时 release（低延迟优化，sweeper 兜正确性）。

**5. API（brain-meta.js）**：acquire 端点改走 helper（对外行为：原子化 + unknown 404）；新增 `POST /device-locks/register`，幂等 `ON CONFLICT (device_name) DO UPDATE SET host, device_type`（不碰锁字段，手机换宿主重注册即可）。

### 数据流

带 `payload.device_serial` 的任务：queued → dispatcher claim → acquire 锁 → 派发执行 → 终态 → updateTaskStatus 即时 release（漏了则 sweeper 下个 tick 收尾；再漏则 TTL+双重判据兜底）。抢不到锁：revert queued → 下轮 tick 重试，不阻塞其他候选。

### 错误处理（混沌审查 10 场景结论）

- 执行超 TTL：双重判据保证持有任务 in_progress 期间锁不被抢（关键改进，否则复现要防的双机撞车）
- Brain 重启：锁全在 Postgres，无内存态，安全
- 执行体崩死：watchdog 判 failed → sweeper/终态释放；requeue 场景走同持有者 reacquire
- 手机离线：任务失败即释放，浪费一个周期，可接受（acquire 前查 adb 心跳＝后续优化）
- 明确不解（另立）：同任务双开（根因 zombie-reaper 判活）、人肉 ssh 带外操作（advisory lock 不可强制，靠可观测+SOP）、多设备死锁（单 serial 无场景，注释留"将来按 device_name 排序获取"）

## 测试策略

- **Integration（真库，`__tests__/integration/*.pg.integration.test.js` 形状，cecelia_scratch）**：并发 acquire 恰一个赢（mock pool 测不出行级原子性，必须真库，TDD failing test 先行）；sweeper 释放非活跃持有者；过期+持有任务 in_progress 不可抢 / 已死可抢。
- **Unit（vitest，mock pool 断言 SQL 形状）**：同持有者续期、非持有者 release 409、unknown_device 分类、ttl clamp、dispatcher 接线的 locked/unknown_device 两分支、revert 路径带 release。
- **E2E**：不适用（无 UI/外部平台面；派发行为由 integration 覆盖）。
- **Trivial**：register 幂等 upsert。

## 对抗摘要

Challenger（8 findings）与混沌（3 critical / 4 ttl-acceptable / 3 out-of-scope）两路独立审查，P0/P1 全部消化：acquire 移层（→claim 后）、释放改对账式 sweeper、过期抢占双重判据、unknown fail fast、worker-pool 旁路接线、真库并发测试、migration 规约/register 幂等/永久锁/ttl clamp/host 列范围声明。收敛判据满足（无未消化 P0/P1）。
