---
task_id: c8fab3c8-c85e-4e7e-a610-ce776c4aefe2
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 9
可验证: 8
场景覆盖: 8
回归风险: 8
可执行: 9

## 上轮问题
- R-1: 关闭 —— Q-1 前提已补本机兜底：`DB_NAME=cecelia_scratch` 跑 migrate，起 5299 端口隔离 Brain，并先检查 `.runtime.isolated==true`。已核实这套兜底能用：`db-config.js:19` 优先认 DB_NAME，`runtime-safety.js:3,9` 看到库名含 scratch 就判为隔离，`routes/goals.js:105-106` 的 health 接口会返回 `runtime.isolated`，`packages/brain/server.js` 存在。写入和核对打到同一个 scratch 库，并明确禁止用 5221。`## 铁律对照` 已补 INV-909ce765。
- R-2: 关闭 —— S-1 已改为按 made_by 列查 `pg_constraint` 里的全部 CHECK：多个约束取值求并集后收敛成一个；遇到多列约束或无法解析的定义就报错回滚，不会静默放过。S-2 第 4、5 条覆盖了改名/多约束和多列约束两种形态。新增 Q-7：经 pg-tunnel 15432 只读查询生产，合并前查一次得 D0，部署后再查一次得 D1，断言 D1 ⊇ D0 ∪ {ai} 且只剩一个约束，正好补上 I-2 的真库验收。另外已核实：`migrate.js:43-58` 判断是否已跑只看 `schema_version`，所以 Q-5 删掉 552 记录后重跑的路径成立；552 编号目前没被占用（最大是 551）。

### R-4
针对: S-1
严重度: 建议
场景: 假如某个库在迁移之外给 made_by 加过单列的排除式约束，比如 `CHECK (made_by <> 'bot')`，S-1 的正则会把 `'bot'` 当成一个允许值抽出来，然后删掉这条约束、重建成 IN 列表。原本是「只拒 bot」，重建后变成「只允许列表里的值」，取值范围被收窄了，而且没有任何报错。
依据: S-1 只对「抽不出值」的定义报错（第 20 行），没有检查定义是不是 `IN (...)` / `= ANY (ARRAY[...])` 形态。Q-7 的 D0 只拦「多列或无法解析」，这种能抽出值但语义相反的定义拦不住。目前没有证据表明生产上有这种约束，所以只作建议。
说明: 解析前先判断定义是否匹配 `= ANY (ARRAY[` 或 `IN (` 形态，不匹配一律 `RAISE EXCEPTION`。Q-7 的 D0 判据同步改成「非 IN/ANY 形态即退回」。
