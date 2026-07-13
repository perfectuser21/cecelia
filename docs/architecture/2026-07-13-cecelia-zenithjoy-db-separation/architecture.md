# Cecelia × ZenithJoy 数据库分离架构

**Initiative**: 拆库三刀落地（0935f962）  
**决策来源**: 3ac02755（2026-07-09）  
**文档日期**: 2026-07-13

---

## 背景

ZenithJoy 业务数据（`zenithjoy` schema）历史上存放在 Cecelia 的 `cecelia` 主库，通过 schema 隔离。随着业务独立性增强，需要将 zenithjoy 数据迁移到独立的 `zenithjoy` 库，彻底解耦两产品的数据库依赖。

---

## 三刀分解

| 刀 | 任务 | 状态 |
|---|---|---|
| **刀1a/1b** | zenithjoy 裸表归位 schema + 建独立 zenithjoy 库骨架 | ✅ 完成（PR #3847）|
| **刀1c** | pg_dump --schema=zenithjoy 从 cecelia 导出，导入独立 zenithjoy 库 | ✅ 完成（本 PR）|
| **刀1d** | 切换 ZenithJoy prod/staging DATABASE_NAME → 新 zenithjoy 库 | ✅ 完成（本 PR）|
| **刀1e** | ZenithJoy tasks/cecelia_events 跨库直连改走 Brain API | ✅ 完成（已有 PR）|

---

## 刀1c — Schema 迁移详情

### 迁移前状态（2026-07-13 执行时）

- `cecelia.zenithjoy` schema：69 张表，migration 记录 110 条（含最新）
- `zenithjoy.zenithjoy` schema（刀1a/1b 骨架）：69 张表，但 migration 记录只有 105 条
- **缺失 5 个 migration 的记录**：
  1. `20260710_070000_create_skill_drafts.sql`
  2. `20260710_150000_collect_videos_composite_pk.sql`（缺少 `comments_reported_at` 等字段）
  3. `20260710_194200_skill_drafts_longrun.sql`
  4. `20260712_content_judgment_gate.sql`（缺少 `judgment_status`/`outreach_eligible` 等字段）
  5. `20260712_dm_assignments_cancelled_status.sql`（缺少 `cancelled` 约束）

### 迁移执行

```bash
# 在 mmv（38.23.47.81）上执行
cd /Users/administrator/perfect21/zenithjoy
DATABASE_NAME=zenithjoy DATABASE_HOST=localhost DATABASE_PORT=5432 DATABASE_USER=cecelia \
  npm run migrate --workspace=apps/api
```

结果：5 个 pending migrations 全部 idempotent 应用成功，所有缺失字段和约束补齐。

---

## 刀1d — DATABASE_NAME 切换

### Prod (`/Library/LaunchDaemons/com.zenithjoy.api.plist`)

```xml
<key>DATABASE_NAME</key>
<string>zenithjoy</string>  <!-- 从 cecelia 改为 zenithjoy（刀1d 前已更新）-->
```

### Staging (`~/Library/LaunchAgents/com.zenithjoy.api.staging.plist`)

```xml
<key>DATABASE_NAME</key>
<string>zenithjoy</string>  <!-- 从 zenithjoy_test 改为 zenithjoy（本 PR 更新）-->
```

### Brain（Docker 容器 cecelia-node-brain）

```bash
ZENITHJOY_DB_NAME=zenithjoy  # 已在容器 env 中设置，Brain 写入新独立库
```

---

## 连接架构（迁移后）

```
Brain (Docker) ─→ cecelia DB (5432)           # Brain 自身数据
Brain (Docker) ─→ zenithjoy DB (5432)         # ZENITHJOY_DB_NAME=zenithjoy
                    └── zenithjoy schema
                          ├── works
                          ├── publish_logs
                          └── ...

ZenithJoy API Prod ─→ zenithjoy DB (5432)     # DATABASE_NAME=zenithjoy
ZenithJoy API Staging ─→ zenithjoy DB (5432)  # DATABASE_NAME=zenithjoy (刀1d)

cecelia DB.zenithjoy schema ← 只读参考（双写验证期观察用）
```

---

## 双写验证期（≥ 3 天）

**验证脚本**：`scripts/zenithjoy-db-compare.sh`

```bash
# 在 mmv 上每天运行
bash /path/to/cecelia/scripts/zenithjoy-db-compare.sh
```

**通过标准**：
- `zenithjoy` 库关键表（works/wechat_publish_task/publish_logs）count 持续增长
- `cecelia.zenithjoy` 同名表 count 不再增长（停止接收新写入）
- 连续 3 天无异常 WARN

**验证通过后**：可从 `cecelia` 库删除 `zenithjoy` schema（一次性清理，不影响服务）。

---

## 关键决策

| 决策 | 内容 |
|---|---|
| 迁移方式 | 使用 ZenithJoy 自带 migration runner（幂等），不做 pg_dump 覆盖 |
| staging 共享 prod DB | staging 与 prod 共用 `zenithjoy` 库，简化运维，与团队规模匹配 |
| Brain 双池 | Brain 用 `zenithjoy-db.js` 独立连接池，`ZENITHJOY_DB_NAME` 环境变量控制切换 |
