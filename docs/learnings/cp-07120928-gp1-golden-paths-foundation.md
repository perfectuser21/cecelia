# Learning: GP1/T1 golden_paths 底座——新表+状态机+保质期 delta job

## 背景

GP loop 立项（decisions cb6be3f6/b416bfb3）第 1/7 棒：为「AI 自提 Golden Path」建蓝图级实体
golden_paths（10 态生命周期状态机），与既有 golden_path（任务级累积 FR 台账）刻意分表——语义/粒度/
生命周期不同，强行复用会把两套状态机搅在一行。

## 根本原因

（本条为新功能立础，非 bug 修复；记录设计层面为何"看似重复建表"是正确选择）
既有 golden_path 表是任务级 FR 台账且九要素 T2 在活跃写入；"能复用不新建"原则不适用于语义错配的
实体。命名上单数/复数一字之差极易踩混——所以 migration、route、测试三处都写了区分注释，索引用
`idx_golden_paths_` 复数前缀避免与 `idx_golden_path_*` 撞名。

## 关键实现点

- PATCH 状态机照 tasks.js `allowedTransitions` + 409 INVALID_TRANSITION 仓库范式
- **compare-and-swap 守卫**：PATCH 的 SELECT 与 UPDATE 之间，行状态可能被 gp-shelf-life job
  （每 10min 原子翻转 status）改掉；UPDATE WHERE 加 `AND status = $N` 守旧态，空结果 409
  CONCURRENT_MODIFICATION——凡"先读后写的状态机端点"与"定时 job 直改同一状态列"共存，必须带此守卫
- gp-shelf-life 照 receipt-collector 模式：模块级 lastRunAt 自 gate + env 覆盖 + __resetForTest +
  fail-open + 禁 import notifier（防环）
- 新增 scheduler job 必须同步 scheduler-jobs.test.js 的 job 计数与名单断言（12→13）
- migration 推进 schema 地板时三处联动：selfcheck.js EXPECTED_SCHEMA_VERSION + selfcheck.test.js
  地板断言 + DEFINITION.md schema_version 行

### 下次预防

- [ ] 状态机端点与定时 job 共写同一状态列时，code review 必查 compare-and-swap 守卫
- [ ] 新增 migration 时一次性改齐三处 schema version（selfcheck.js / selfcheck.test.js / DEFINITION.md），别等 DevGate 报
- [ ] 与既有表名仅单复数之差的新表，migration/route/测试三处都要写区分注释
