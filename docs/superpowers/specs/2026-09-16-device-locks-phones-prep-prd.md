# 小改动 PrepPRD：手机设备资源锁——device_locks 纳管安卓手机 + 原子 acquire + 派发接线

Brain task: 104ab89f-5fb1-4a18-b56e-9dd1c7edfa57（P1，change_kind=capability_change，map_scope=G5）
归位：管家线 · G5 算力与基础设施调度（journey dddddddd-f0f0-4000-8000-000000000004），横切件。
gp-anchor: skipped (product-map.json not found, non-zenithjoy-workspace repo)

## 改什么

全部在 `packages/brain/`，单 PR：

### 1. Migration 448：device_locks 扩展 + 手机种子
- 加列 `host TEXT`、`device_type TEXT`（**范围声明：本期仅登记元数据，派发不做主机路由校验**）
- 种子 4 台手机（serial = device_name，2026-09-16 adb 实采）：

| device_name (serial) | host | device_type |
|---|---|---|
| ANGYVB4311010223 | xian-m1 | phone |
| e6c7ef34 | xian-m1 | phone |
| ANGYVB4227006983 | xian-m4 | phone |
| ANGYVB4402004137 | xian-m4 | phone |

- 按规约插 schema_version 行；selfcheck EXPECTED_SCHEMA_VERSION 同步

### 2. acquire 原子化（src/routes/brain-meta.js）
单条原子 UPDATE 取代现有 SELECT-then-UPDATE 竞态（brain-meta.js:1711-1735）：
```sql
UPDATE device_locks SET locked_by=$1, locked_at=NOW(), expires_at=NOW()+($2||' minutes')::interval
WHERE device_name=$3 AND (
  locked_by IS NULL
  OR locked_by = $1                                   -- 同持有者 reacquire = 续期（必须保留，防重启二次派发自死锁）
  OR (                                                 -- 过期抢占：双重判据
    expires_at IS NOT NULL AND expires_at < NOW()
    AND NOT EXISTS (SELECT 1 FROM tasks WHERE id::text = device_locks.locked_by AND status = 'in_progress')
  )
) RETURNING *
```
- 0 行时区分两种结果：设备行不存在 → 404 unknown_device（fail fast）；被占 → acquired:false + 持有者信息
- `expires_at IS NULL AND locked_by 非空` 视为占用（永久锁），仅双重判据可解
- ttl_minutes clamp 到 [1, 240]，非法值用默认 30
- **时钟死规矩：expires_at 只用 DB 侧 NOW() 写、只与 NOW() 比，禁收执行体自报时间戳**

### 3. register 端点（幂等）
`POST /api/brain/device-locks/register` body {device_name, host, device_type}：
`INSERT ... ON CONFLICT (device_name) DO UPDATE SET host=EXCLUDED.host, device_type=EXCLUDED.device_type`（不碰锁字段）。手机换宿主直接重注册。

### 4. 派发接线（两处，共用一个 helper）
新模块 `src/device-lock-helpers.js`：`acquireDeviceLock(taskId, serial, ttl)` / `releaseDeviceLocksHeldBy(taskId)` / `sweepStaleDeviceLocks()`。

**接线点 a — dispatcher.js**：在**原子 claim 成功之后、triggerCeceliaRun 之前**（不放 selectNextDispatchableTask 内——那里到真派发之间还有 8+ 条拒绝路径，锁必泄漏）。task.payload.device_serial 存在时 acquire（locked_by=task.id）：
- 被占 → 释放 claim + revert queued + 计入 skipIds continue（复用现成 HOL skip 形状）
- unknown_device → 任务直接 failed + error_message 告警（防静默饿死在 queued）
- claim 后任何后续拒绝/回滚路径 → revert 时同步 releaseDeviceLocksHeldBy(task.id)

**接线点 b — worker-pool-dispatch.js**：CAS claim 之后同样接 acquire（旁路不接线 = 锁形同虚设）；抢不到 → revert 留给下轮。

### 5. 释放 = 对账式 sweeper（不做逐点接线）
executor.js 47 处终态直写 + psql 直设病史 → 枚举回写点必漏。改为 tick 挂对账 job，每 tick 一条 SQL：
```sql
UPDATE device_locks SET locked_by=NULL, locked_at=NULL, expires_at=NULL
WHERE locked_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tasks WHERE id::text = device_locks.locked_by
                  AND status IN ('queued','in_progress'))
```
按"持有任务非活跃"判而非枚举终态——天然覆盖 completed/failed/cancelled/quarantined/blocked/dep_failed/archived/psql 直设/task 被删。中心函数（task-updater.js updateTaskStatus）挂即时 release 作为低延迟优化，sweeper 是正确性保证。

## 为什么改
Brain 无手机级互斥：多个 RPA 任务（发布/点赞/采集）并发派发会互抢同一台手机（adb/UIA 双流互抢焦点，可能发错内容到真实平台）。device_locks 表 2026-04 建成后零调用方，acquire 本身还有竞态。

## 关联上下文
- Journey：管家 · G5 算力与基础设施调度（横切件，护安卓发布 line01 四条路 + 未来 RPA 路）
- 历史决策匹配：无冲突；GitHub 无撞车 PR
- 病史引用：drain 泄漏静默滞留（场景10 同型）、brain-restart-resets-inprogress（场景4，同持有者 reacquire 分支消化）、zombie-reaper 误杀双开（根因在判活，本 PR 不解，见「不包含」）

## 影响范围
- dispatcher 派发热路径加一次条件 DB 调用（仅 payload.device_serial 存在时）
- 现有 acquire/release API 行为变化：acquire 语义增强（原子+双重判据），release 不变（非持有者仍 409）
- 无 device_serial 的任务零影响

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 设备是否可抢占（锁过期时） | ①仅看 expires_at ②执行侧心跳续期 ③expires_at+持有任务状态双重判据 | ③ | 无需执行侧改造，同库原子可判；长任务 in_progress 期间锁永不被抢 | 误判→双 RPA 同机操作，可能发错内容到真实平台（最严重后果） |
| 持有任务是否已死（sweeper 释放） | ①枚举终态 ②status NOT IN (queued,in_progress) | ② | 覆盖 quarantined/blocked/dep_failed/psql 直设等所有非活跃态 | 误判→设备白锁最多一个 TTL 周期（30min），可自愈 |
| serial 是否有效 | ①upsert 自动建行 ②行不存在即 failed 告警 | ② | upsert 会给拼错的 serial 造假行拿假锁 | 误判→任务错误 failed，人工可见可重发（fail fast 优于静默饿死） |

## 不包含（另立任务/记录在案）
- 同任务双开（requeue 后旧执行体未死）：根因在 zombie-reaper/watchdog 判活，另立
- 人肉 ssh 带外操作手机：advisory lock 不可强制，靠设备清单可观测 + SOP；有头 acquire SOP 后续增强
- 多设备死锁：当前单 serial 无场景，代码注释留"将来按 device_name 排序获取"
- host 列参与路由校验（本期仅登记）
- acquire 前查设备 adb 心跳（离线手机拿锁浪费一个周期，可接受）

## 验收标准
- [ ] failing test 先 commit（TDD：并发 acquire 恰一个赢——**真库集成测试** `*.pg.integration.test.js` 形状跑 cecelia_scratch，mock pool 测不出行级原子性）
- [ ] 单测：同持有者续期 / 非持有者 release 409 / 过期+持有任务已死可抢 / 过期+持有任务 in_progress 不可抢 / unknown_device 404 / ttl clamp
- [ ] 集成：带 device_serial 任务派发抢锁失败留 queued 下轮重试；unknown serial → failed；sweeper 释放非活跃持有者的锁
- [ ] DevGate 三件套过（facts-check / check-version-sync / dod-mapping）
- [ ] 版本 bump 走 changes/ 碎片（{VERSION} 占位，禁碰五件套）
- [ ] CI 全绿，merge 后回写 Brain task 104ab89f
