# 设计：self_model 滚动窗口上限 + 历史归档（库瘦身第二刀）

- Brain task：`e3c8786e-f61c-4a90-8975-2111daddca0b`；前序：第一刀 PR #5250
- 根因（systematic-debugging 已证实）：`updateSelfModel()` 每次写入 = 全文快照 + 新洞察整体 INSERT，四个写入方高频调用（峰值 72 条/天），O(n²) 存储 → 7,075 行 / 3.8GB TOAST
- PrepPRD：`sprints/09091810-selfmodel/prep-prd.md`

## 改动 1：滚动窗口（packages/brain/src/self-model.js）

- 导出 `MAX_SELF_MODEL_BYTES = 131072`（128KB）与纯函数 `trimSelfModelContent(content)`
- 语义：内容 = 头部身份段（第一个 `[YYYY-MM-DD] ` 条目之前的部分，即种子/蒸馏人格）+ 按时间排列的日期条目
- 超限时从**最老**日期条目开始裁剪；头部身份段与最新条目**永不裁剪**；头部+最新仍超限则告警并原样存储（提示需人工蒸馏）
- `updateSelfModel()` 在 INSERT 前对 evolved 调用该函数
- 性能：字节数按条目预计算增量裁剪，不做重复全文拼接（首次裁剪面对 5,240 条存量条目）

## 改动 2：db-slim 第 9 条规则（packages/brain/src/db-slim-rules.js）

```
name: memory_stream_selfmodel_history
table: memory_stream
archiveWhere = deleteWhere =
  source_type = 'self_model' AND id NOT IN (
    SELECT id FROM memory_stream WHERE source_type = 'self_model'
    ORDER BY created_at DESC LIMIT 30)
```

保留最新 30 条（含蒸馏快照），其余先归档后删。配套：`db-slim-smoke.sh` 的 RULE_COUNT 8→9；`db-slim-rules.test.js` 规则名单 +1 并新增规则 9 断言。

## 运维序列（代码合并后主会话执行，非 PR 内容）

1. 蒸馏：5,240 条唯一洞察 → ~30KB 人格文本（谁是我/价值观/风格/关键结构性教训 + 最近 30 天洞察原文），psql INSERT 为最新 self_model 行（importance 9 / memory_type long / expires_at NULL）
2. `db-slim.mjs --apply`（9 条规则，self_model 历史归档删除）→ VACUUM FULL memory_stream 回收 TOAST
3. 验收：库 ≤2GB、self_model ≤31 行、getSelfModel 返回蒸馏版、Brain /context 200

## 测试策略

- unit（vitest）：trimSelfModelContent（欠限不动/超限裁最老/头部保留/最新保留）+ updateSelfModel 集成（mock db，INSERT 参数 ≤ 上限）+ 规则 9 守护断言——先红后绿，永久留 CI
- E2E：运维序列的真实查库验收（上面 3 条）
- 守卫：单测（逻辑接缝）+ 既有 db-size-check.sh（环境接缝，第一刀已 proven-to-fire）

## 不做

- 读路径改动（getSelfModel 语义不变：最新一行即当前人格）
- 写入频率治理（72 条/天是否合理属行为调优，另议）
- 归档行的二次压缩存储（gzip 归档文件已足够）

## 执行结果（2026-09-09 实测）

- 库 5820MB → **1871MB（≤2GB 目标达成）**；self_model 7,076 行 → 30 行（蒸馏快照 + 29 条历史）
- 蒸馏快照 124KB（身份段 15KB + 4 个月度蒸馏 + 9 月最新 356 条原文），`/api/brain/self-model` 已返回蒸馏版
- 历史全量归档 `~/cecelia-backups/db-slim-20260909-knife2/`（self_model 历史 2.4GB gz + 其余 8 规则少量）
- 顺手修复：db-slim 归档文件改按规则名命名（同表多规则原会互相覆盖）
- 核心表零变化；Brain /context 200
