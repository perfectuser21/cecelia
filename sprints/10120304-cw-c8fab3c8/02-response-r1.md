---
task_id: c8fab3c8-c85e-4e7e-a610-ce776c4aefe2
step: spec_response
upstream: ["02-review-r1.md#R-1", "02-review-r1.md#R-2", "02-review-r1.md#R-3"]
---
# 规格答辩（第 1 轮）

### R-1
处理: 采纳
说明: Q-1 前提（Q-2~Q-4 沿用「同 Q-1」）改为两个执行地：预览环境可用时优先用；Deploy Preview Environment 红或没有 URL 时，在本机起隔离 Brain 兜底。兜底命令可以直接粘贴执行：`DB_NAME=cecelia_scratch node src/migrate.js` → `DB_NAME=cecelia_scratch PORT=5299 node server.js &` → 先确认 `/api/brain/health` 返回 `.runtime.isolated==true` 再往下做。依据：`runtime-safety.js:9` 看到库名里有 scratch 就判为隔离实例，不跑后台调度，也不调用模型；`server.js:198` 支持用 PORT 换端口。
写入（curl 到 `<BRAIN>`）和核对（psql cecelia_scratch）都打到同一个 scratch 库，符合 INV-f437b0fd。明确禁止用 5221。
补充说明：`smoke-production-guard.mjs` 要求有 Docker 容器和 BRAIN_CONTAINER，它管的是 smoke 脚本，QA 手工跑 curl 不经过它，所以兜底方案靠 runtime-safety 的隔离判定加「禁止用 5221」来保证安全。`## 铁律对照` 已补上 INV-909ce765。

### R-2
处理: 采纳
说明: 分两处改。
1. S-1 不再按固定约束名找，改成按 `made_by` 列查 `decisions` 上全部 CHECK 约束，不管叫什么名字：
   - 单列约束：取值全部求并集，删掉后收敛成一个 `decisions_made_by_check`。
   - 多列约束，或定义无法解析：直接 `RAISE EXCEPTION`，事务回滚，不写 552。不会出现「CI 绿但生产照样拒绝 ai」的情况。
   - S-2 新增两条断言：改名或另有同列约束的形态（第 4 条），多列约束的形态（第 5 条）。
2. 新增 Q-7 生产真库只读验收：
   - 执行地：在 MMV 经现有 pg-tunnel `localhost:15432`（DEFINITION.md:1095）连生产库，`PGOPTIONS='-c default_transaction_read_only=on'`，只发 SELECT，不在 us-vps 上起任何进程（INV-96054a8b）。
   - 时间点：合并前查一次，记为 D0；部署后先确认 schema_version 里有 552，再查一次记为 D1。
   - 期望：D1 只剩一个 `decisions_made_by_check`，取值 ⊇ D0 所有约束的取值 ∪ {ai}。
   - D0 里如果出现多列约束或解析不了的定义，合并前就退回 S-1。
   Q-5 也改成按列查询，并断言只剩一个约束。`## 未覆盖真实链路` 里原先写的「部署后自报」已删掉，改由 Q-7 覆盖。

### R-3
处理: 采纳
说明: S-2 第 6 条写明 bogus 插入要包在 `SAVEPOINT` 里，报错后先 `ROLLBACK TO SAVEPOINT` 再继续断言。新增的第 5 条（多列约束形态下迁移报错）也按同样方式处理。这和 `migration-542-...test.js:60-65` 的写法一致。
