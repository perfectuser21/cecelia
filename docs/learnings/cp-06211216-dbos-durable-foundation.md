# Learning: DBOS durable 底座第一步（flag 门控 + daily-report durable）

分支：cp-0621121623-dbos-durable-foundation
日期：2026-06-21

## 背景
把 DBOS 作为 brain durable 底座引入（第一步最小安全增量）：flag 门控（默认关=行为零变化），
把 daily-report 包成崩溃可恢复的 durable workflow。DBOS 系统表落 cecelia 库的 `dbos` schema，
不碰 public 业务表。

## 根本原因
brain 运行时态碎裂、重启即丢（4 路诊断证）。daily-report 这类多步 + 外部副作用（发飞书）的
后台任务，崩在中途会丢进度或重复发副作用。需要 durable execution（断点续 + 副作用 exactly-once）。

## 关键发现（踩坑 → 修正）
1. **DBOS register-before-launch 硬约束（实测踩到）**：`DBOS.registerStep` / `registerWorkflow`
   必须在 `DBOS.launch()` **之前**完成，否则报 `DBOS code is being registered after DBOS.launch()`。
   → 初版按 caller 传 deps 在运行时 `buildDurableDailyReport()` 内注册 step，崩。
   → 修正：module load 时一次性注册 step/workflow（顶层），运行时依赖（pool/sendFeishu/trace）
     经 `configureDurableDeps()` 在 launch 前注入模块级 holder；日期等可序列化参数作为 workflow 入参。
   这是测试先写（Red）才暴露出来的真实约束，不是凭空猜的。
2. **setConfig 字段名**（4.x，已核类型定义）：`systemDatabaseUrl` + `systemDatabaseSchemaName:'dbos'`
   + `systemDatabasePool`(custom pg.Pool) + `systemDatabasePoolSize`。**没有 `databaseUrl`、没有
   `systemDatabaseSchema`**。必须显式给 `systemDatabaseUrl` 指向 cecelia 库本身，否则 DBOS 默认去连
   `cecelia_brain_dbos_sys` 独立库。spike 里的 `databaseUrl as any` 是错的（运行时被静默忽略）。
3. **接线必 try/catch degrade**：`DBOS.launch()` 失败抛 `DBOSInitializationError`，不包 try/catch
   则开 flag 时 brain 起不来。抽出 `bootDurable()`（flag 门控 + try/catch + 返回 boolean）便于单测，
   server.js 只调一行。
4. **崩溃恢复测试形态**：用子进程 spawn（MODE=start 崩溃 / MODE=recover 重启），断言
   step_trace 计数证已完成 step 不重跑（generateReport=1）+ feishu_sends 计数=1 证 exactly-once。
   真 Postgres 测试用 `describe.skipIf(process.env.TEST_PG!=='1')` 守卫，CI 无 DB 时跳过、本地验真。

## 下次预防
- [ ] 引入任何"注册式"框架（DBOS / 装饰器路由等）先查清"注册必须早于启动"这类生命周期约束，
      设计成 module-load 注册 + 运行时注入依赖，别在请求/调用时才注册。
- [ ] DBOS 配置字段直接读 `node_modules/@dbos-inc/dbos-sdk/dist/src/*.d.ts`，不信 spike/博客的 `as any`。
- [ ] 依赖真 Postgres 的崩溃恢复测试一律 `skipIf` 守卫，保证 CI 绿、本地能验真。
- [ ] 新引入 durable workflow 的 step 复用既有纯函数（仅加 export），不重写逻辑，回归锚为既有单测。

## Code review 二轮修复（flag-ON 路径，2026-06-21）
首轮崩溃测试在 launch 前 import 了 durable 模块，**遮蔽了生产真实顺序**——code review 抓出 5 个 flag-ON 缺陷：
- **C1（Critical）注册晚于 launch**：生产 boot 走 server.js→bootDurable→DBOS.launch()，但 durable 模块
  （顶层注册）只在 tick 时被 router 的 lazy `import()` 触发=launch 之后→`DBOSConflictingRegistrationError`
  被 fire-and-forget `.catch` 吞，日报静默永不跑。**修**：dbos-runtime.js 顶部静态 `import {configureDurableDeps}`
  →注册随 boot import 链在 launch 前发生；initDurable 内 launch 前注入 pool。**加生产-ordering 测试**
  （先 launch 再驱动 route，子进程忠实复现生产入口顺序，不在 launch 前 import durable）锁死，防回归。
- **C2（Critical）丢触发窗口+去重**：durable 版没复用 `isInReportTriggerWindow`+`hasTodayReport`→flag 开
  每 tick(~5min)发一次飞书。**修**：守卫移进 `durableDailyReport`，返回 `{generated,date,skipped_window,skipped_dup}`。
- **I1 process.exit 烤进 shipped step**：改 `_deps.beforeSave` 注入 seam（`NODE_ENV!=='production'` 守卫），
  崩溃从测试注入，shipped step body 干净。
- **I2 `_launched` 与 DBOS 内部 desync**：改用 `DBOS.isInitialized()` 作真值源。
- **I3 launch 失败泄漏 sysPool**：launch reject 时 `sysPool.end()` 再抛错。

教训（钉死）：**测试若用了比生产更宽松的加载顺序，会遮蔽 ordering bug**。涉及"注册必须早于启动"的框架，
测试必须用子进程 + 生产入口忠实复现 boot 顺序（launch 后才驱动），而非在 setup 里提前 import。
