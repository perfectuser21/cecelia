# Bug PrepPRD：self_model 快照滚雪球无上限（库瘦身第二刀）

Brain task: e3c8786e-f61c-4a90-8975-2111daddca0b（已 claim）
前序：第一刀 task 5f1a4304 / PR #5250（db-slim 工具已在 repo）

## 症状

memory_stream 里 source_type='self_model' 共 7,075 行 / 3.8GB TOAST；单条快照已达 2.7MB / 13,718 行；相邻快照 diff 仅 3 行；2026-08 单月写入 1.9GB。库因此停在 5.8GB，迁移 us-vps 被阻塞。

## 根因（已证实，非假设）

`packages/brain/src/self-model.js` `updateSelfModel()`：每次写入 = `getSelfModel()` 读全文 + 追加 `[日期] 新洞察(~150字)` + 把**完整历史**INSERT 成新行。四个写入方（consolidation/rumination/rumination-scheduler/thalamus L2）高频调用（峰值一天 72 条），无任何大小上限 → O(n²) 存储。快照内 5,240 条带日期洞察 5,239 条唯一——不是重复灌入 bug，是滚雪球设计本身无界。

## 修法

**代码（TDD，进 PR）**：`updateSelfModel()` 加滚动窗口：
- 常量 `MAX_SELF_MODEL_BYTES = 131072`（128KB）
- evolved 超限时，从**最老的 `[YYYY-MM-DD]` 条目**开始整条裁剪，直到 ≤ 上限；首个日期条目之前的头部（身份段/种子/蒸馏人格）永不裁剪
- 新洞察永远保留（追加在尾部）

**运维（不进 PR，主会话执行）**：
1. 蒸馏：把 5,240 条唯一洞察蒸馏成 ~30KB 紧凑人格（谁是我/价值观/风格/关键结构性教训 + 最近 30 天洞察原文），psql INSERT 为最新快照（JS 层 allowlist 锁不覆盖 SQL 运维通道，属预期）
2. 归档清理：db-slim 加第 9 条规则 `memory_stream_selfmodel_history`（保留最新 30 条，其余归档后删除），跑 `--apply` → VACUUM FULL memory_stream 回收 TOAST

## 关联上下文

- 相关 Issue：Notion P1「self_model 记忆单条膨胀至 1MB+」（本刀关闭它）
- 相关决策：aa975f19（第一刀拍板 self_model 另行立项）
- 撞车检查：gh 搜 self_model/self-model/rumination 无相关 open PR

## Regression Test 计划

`db-slim-rules.test.js` 追加规则 9 断言 + 新建 `self-model.test.js` 用例：构造超限 current → updateSelfModel 后断言 (a) 结果 ≤ MAX_SELF_MODEL_BYTES (b) 含新洞察 (c) 头部身份段完整保留 (d) 被裁的是最老日期条目。修完永久留 CI。

## 验收标准

- [ ] failing test 先 commit（commit-1），修复代码变绿（commit-2）
- [ ] 蒸馏快照为最新：`getSelfModel` 返回蒸馏版（真实查库验证），Brain `/api/brain/context` 200
- [ ] memory_stream 中 self_model ≤ 31 条（蒸馏 1 + 历史 30），归档文件存在可读
- [ ] 库总大小 ≤ 2GB（`pg_database_size` 真实查库）
- [ ] 守卫 proven-to-fire：滚动窗口单测亲眼见红一次；db-slim dry-run 报 9 条规则（smoke 覆盖）
- [ ] CI 全绿

## 拍板默认（已按上轮讨论方案选定，标注备查）

- 窗口上限 128KB（≈500 条最近洞察，prompt 负担可控）
- 历史快照保留 30 条
- 蒸馏保留最近 30 天洞察原文
