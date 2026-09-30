# 设计：修复 tasks 时间列偏 8 小时

## 背景
Brain 任务 `19684870-4b47-49eb-9287-5ed2d1a181aa`。生产库 `timestamp without time zone` 列
（`started_at`/`created_at` 等）存的是 UTC 裸数字，但 node-pg 的 `postgres-date` 解析器按
**进程时区**（容器 `TZ=Asia/Shanghai`）解释这些无时区数字，导致读出来的 JS Date 比真实时刻
早 8 小时。实测：任务刚启动 4 秒，API 报告的 `started_at` 却显示为 8 小时前。

`tick-helpers.js::autoFailTimedOutTasks`、`executor.js` 的存活探测宽限期都基于
`Date.now() - new Date(started_at)` 做超时判断，直接受害——这就是历史事故
87c9a08b（任务刚启动即被判超时）的确切根因。

`due_at` 字段看起来是"准的"，但只是巧合：`notion-push-sync.js:538` 写入时故意把北京墙钟
数字（而非真实 UTC）塞进 `due_at`，读取时同一个解析 bug 又把它转正——两个错误互相抵消，
不是真修好，一旦修了读取 bug，这里会变成新的错误源。

另外顺手挖到 2 处独立、方向搞反的时区转换 bug（`project-compare.js:140`、
`routes/ops.js:403`），与本 bug 同源但触发条件不同，一并修。

## 根因（已用生产库实测验证）
- 容器 `TZ=Asia/Shanghai`（`docker exec cecelia-node-brain env` 实测）。
- DB 会话时区 `Etc/UTC`（`SHOW timezone`）；`NOW()` 写入的裸数字就是真实 UTC 时刻。
- `node_modules/postgres-date/index.js`：Postgres 对 `timestamp without time zone`
  输出的文本从不带时区后缀，解析器判断不到偏移量时落进
  `new Date(year, month, day, hour, minute, second, ms)` 分支——这个多参数构造函数用
  **进程本地时区**解释这些数字，把"UTC裸数字"错当"上海时间"，多减了一次 8 小时偏移。
- 全仓库 `grep -rn "setTypeParser"` 为空，目前没有任何代码在 `pg.types` 层修过这个。
- 写入路径没问题：`pg` 序列化 JS Date 到 SQL 时会显式带时区偏移后缀，Postgres 按此正确
  换算存值——纯粹是**读取路径**的 bug。

## 修法（对应决策 26e553fb）

1. **`packages/brain/src/db.js`**：加一行全局 `pg.types.setTypeParser(1114, ...)`，把
   OID 1114（`timestamp without time zone`）按 UTC 解析（`new Date(val + 'Z')` 风格）。
   精确锁定"怎么解析这一种类型"，不碰容器 `TZ` 环境变量（30+ 处显式传
   `timeZone:'Asia/Shanghai'` 的展示格式化代码不受影响；改容器 TZ 影响面更大且未能
   100% 排查有没有隐式依赖进程 TZ 的展示代码，风险更高）。

2. **`packages/brain/src/notion-push-sync.js:538`**：撤掉 `AT TIME ZONE 'Asia/Shanghai'`
   写入补偿，`due_at` 直接存真实 UTC 时刻——这样才能和 `recurring.js:111`
   （`AT TIME ZONE 'UTC'`，本来就正确）、`decision-executor.js:507`
   （`deferDate.toISOString()`，本来就正确）三处写入路径统一语义。已排查
   `due_at` 全量消费点（`openclaw-agent-executor.js`/`lib/qiumi-device-busy.js`/
   `routes/status.js` 等），确认只有这一处写入语义不一致。

3. **`packages/brain/src/lib/qiumi-device-busy.js:29`**：撤掉 `DUE_AT_SELECT_SQL`
   读取补偿，改直接 `SELECT due_at`（全局 parser 修好后已经不需要这层 SQL 补偿）。
   已确认调用点 `openclaw-agent-executor.js:388` 的查询显式 `WHERE task_type='qiumi_task'`
   限定范围，不会牵连 `recurring_tasks` 来源、本来就写对了的 `due_at` 行。

4. **`packages/brain/src/project-compare.js:140`**：`completed_at`（`timestamp without
   time zone`）在 `AT TIME ZONE 'Asia/Shanghai'` 之前漏了一步 `::timestamptz`，补上。

5. **`packages/brain/src/routes/ops.js:403`**：`learnings.created_at` 同样漏了
   `::timestamptz`，补上。

## 测试策略
- **`db.js` 级别的核心回归测试**（新增 pg 集成测试）：写入一个已知 UTC 时刻到
  `timestamp without time zone` 列，走真实连接池读出，断言 JS Date 与写入值一致
  （不偏移 8 小时）——这是对 postgres-date 解析 bug 本身最直接的复现/回归测试，
  修复前必须先跑红。
- **`tick-helpers.test.js`**：现有测试直接传入已构造好的 JS Date 对象（不经过真实 pg
  解析），本身不受这个 bug 影响，不用改，但作为"受益方"跑一遍确认无回归。
- **`qiumi-device-busy-wait.pg.integration.test.js`**：现在的写法是模拟旧的
  "写北京墙钟、读时转换"补偿逻辑，需要改成直接写/读真实 UTC 语义（去掉
  `DUE_AT_SELECT_SQL` 引用，改用 `due_at`）。
- **`project-compare.js`/`routes/ops.js`**：补一个跨越"北京时间 0 点～8 点"这个边界
  的用例（这正是方向反了会出错的窗口——UTC 当天 16:00~24:00 对应北京第二天 0:00~8:00）。

## 验收标准
- [ ] 新增 pg 集成测试先 commit（复现 8 小时偏移），确认失败
- [ ] `db.js` 加 setTypeParser 后该测试变绿
- [ ] `due_at` 写入/读取三处改法统一后，`qiumi-device-busy-wait.pg.integration.test.js`
      改写后全绿
- [ ] `project-compare.js`/`routes/ops.js` 的边界用例通过
- [ ] DevGate 三项 + Brain 包全量测试无新增回归
- [ ] CI 全绿，PR 合并，生产验证一次新派任务的 `started_at` 与真实时间一致
