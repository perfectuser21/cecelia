# 设计：引入 DBOS durable 底座（第一步 · flag 门控 + daily-report）

**日期**: 2026-06-21
**任务**: c64b5a00-942f-421e-99c4-a0d31585d090
**分支**: cp-0621121623-dbos-durable-foundation
**背景**: 4 路诊断（docs/architecture/2026-06-21-brain-unified-runtime-state-analysis.md）证 brain 运行时态碎裂、重启即丢；三轮实测验证 DBOS 用现有 Postgres 能 durable 恢复（exit137 后从断点续、不重跑、副作用 exactly-once，已在真 daily-report + 真 cecelia 库跑通）。

## 1. 目标与非目标

**目标**：把 DBOS 作为 brain durable 底座引入，**第一步只做最小安全增量**——flag 门控 + 把 daily-report 包成 durable workflow。默认关 = 行为零变化。

**非目标（各自后续 PR）**：接进 brain 启动真开 flag（灰度）；迁移其它任务；统一 dispatch；Nomad 第 1 层。

## 2. 架构（三个小单元 + 两处接线）

### 2.1 `packages/brain/src/durable/dbos-runtime.js`（DBOS 生命周期）
- `isDurableEnabled()` → `process.env.DBOS_DURABLE_ENABLED === 'true'`（默认 false）
- `initDurable()` → 仅当 enabled：用**确切正确的 DBOS 4.x 字段**（已核类型定义，spike 的 `databaseUrl`/`as any` 是错的，运行时被静默忽略）：
  ```js
  const sysPool = new Pool({ connectionString: <cecelia 库 URL>, max: 5 });
  DBOS.setConfig({
    name: 'cecelia-brain',
    systemDatabaseUrl: <cecelia 库 URL>,   // 指向 cecelia 库本身（不是默认的 cecelia_brain_dbos_sys 独立库）
    systemDatabaseSchemaName: 'dbos',       // 表落 cecelia 库的 dbos schema（隔离真实，全查询 schema-qualified）
    systemDatabasePool: sysPool,            // 传 custom pool → DBOS 跳过 CREATE DATABASE，用已有连接（最小权限）
    systemDatabasePoolSize: 5,
  });
  await DBOS.launch();
  ```
- `shutdownDurable()` → 已 launch 则 `DBOS.shutdown()`
- **隔离形态**：DBOS 系统表落 **cecelia 库的 `dbos` schema**（靠 `systemDatabaseUrl`→cecelia + `systemDatabaseSchemaName:'dbos'` + custom pool 三件套），与 `public` 里的 149 张业务表零冲突（DBOS 全部 DML schema-qualified）。回退 = `DROP SCHEMA dbos CASCADE`。
- ⚠️ **字段名铁律**（Research Subagent 核实）：没有 `databaseUrl`、没有 `systemDatabaseSchema`；必须显式给 `systemDatabaseUrl`，否则 DBOS 默认去连 `cecelia_brain_dbos_sys` 独立库（非同库 schema）。

### 2.2 `packages/brain/src/durable/daily-report-durable.js`（durable 版日报）
- 把 daily-report 各步包成 `DBOS.registerStep`：fetchContentOutput / fetchPublishStats / fetchEngagement / fetchFailureCount / generateReport / saveReport / sendFeishu
- 组合成 `DBOS.registerWorkflow(durableDailyReport)`
- **复用不重写**：重构 `daily-report-generator.js` 导出其内部 step 函数，durable 版与原版共用同一批 step 逻辑（零重复）

### 2.3 接线（两处，都 flag 门控）
- `server.js` boot 序列（app.listen 之前）：`if (isDurableEnabled()) await initDurable()`
- `tick-runner.js:1633`：`generateDailyReport(pool)` → flag 开时走 `durableDailyReport`，flag 关时调原函数（一字不改）

## 3. 数据流
```
tick → flag关: generateDailyReport(pool)         [现状，不变]
       flag开: durableDailyReport()  → DBOS workflow
                 step1..4 查真库 → step5 生成 → step6 存库 → step7 飞书
                 崩溃任意点 → 重启 DBOS.launch() 自动 recover → 从断点续
```

## 4. 错误处理 / 安全
- **flag 关（默认）**：initDurable no-op、daily-report 走原路径 → **CI 回归必须全绿、行为零变化**
- DBOS launch 失败：记错误日志，**不阻断 brain 启动**（degrade 到非 durable，daily-report 仍可跑原路径）。
  - **接线铁律**（钉进 plan）：`server.js` 那行必须 `try { if (isDurableEnabled()) await initDurable(); } catch (e) { logError(e); /* 继续启动，degrade */ }`。`initDurable` 失败会 throw `DBOSInitializationError`，不包 try/catch 则开 flag 时 brain 启动失败。
- DBOS schema 隔离，业务表零改动；可 `DROP SCHEMA dbos CASCADE` 完全回退

## 5. 测试
- **回归（flag 关）**：现有 daily-report 单测全绿，行为不变
- **durable（flag 开）**：单测模拟 workflow 崩溃（step5 后 throw/exit）→ 触发 DBOS recover → 断言：① step1-4 不重跑（trace 计数）② sendFeishu 恰好一次（side-effect 计数）。固化自已验证 spike。
- 测试用独立测试库 + dbos schema，不碰生产

## 6. 验收标准
- [ ] flag 关时 CI 全绿、daily-report 行为零变化（回归不破）
- [ ] flag 开时单测证明：崩溃 recover 后 step 不重跑 + 飞书 exactly-once
- [ ] DBOS 系统表在独立 dbos schema，149 业务表零改动
- [ ] `@dbos-inc/dbos-sdk` 入 package.json，版本同步规则遵守
- [ ] CI 全绿
