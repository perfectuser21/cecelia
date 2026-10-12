# PrepPRD：Projects 双向同步 + AI 参与三档

决策：3ea59af0（真相源=Brain，Notion=工作台，三档）、c3b84640（本版范围）。任务 97024a3b。
GP-Anchor: none(infra)（本仓库无 product-map，N/A）

## 本次做
1. 推送全量：`pushProjectRoots` 去掉 `WHERE … LIMIT 30`，全部 projects 行参与，digest 不变跳过。
2. 状态映射补全（Brain→Notion）：queued/pending→Not Started；planning/active/in_progress→In Progress；paused/blocked/failed→On Hold；completed→Completed；cancelled/canceled/archived→Discard。未知值不再兜底 In Progress，改兜底 Not Started 并打 warn。
3. 反向映射（Notion→Brain，仅人改时用）：Inbox/Not Started/Planned→planning；In Progress→in_progress；On Hold→paused；Completed→completed；Discard→cancelled。
4. 列分工：
   - 机器列（只 Brain 写）：Name、AI Project、Run ID、**AI 进展**（新 rich_text 列，承接原 Remark 的进度摘要）、正文。
   - 人工列（三方基线合并，人赢）：Status↔projects.status、Priority↔custom_props.priority、Remark↔custom_props.remark、Due Date↔end_date、**AI 参与**↔ai_tier。
5. 三方基线：`notion_props.human_baseline` 存上次同步值。每轮先拉后推：
   - 拉：Notion 值 ≠ 基线 → 人改了 → 写 Brain、基线=Notion 值；若当时 Brain 值也 ≠ 基线（双改冲突）→ 人赢，旧 Brain 值记进 `metadata.notion_overrides`（保留最近 20 条：{field, brain_value, notion_value, at}）。
   - 推：Brain 值 ≠ 基线 → Brain 改了（API/AI）→ PATCH 该列、基线=Brain 值。
   - **基线初始化**（已关联 Notion 页但无 human_baseline 的存量行，只做一次）：status 基线=按第 2 条把 Brain 现值换算成 Notion 值；priority/due/ai_tier 基线=Brain 现值（多为空）；remark 基线=Notion 现值（存量 Remark 是机器旧摘要），随后推送把 Remark 清空、摘要改写进「AI 进展」。这样存量页里人以前改过的 Status（如 coding 合同对抗改成 Completed）被正确识别为人改并拉回，机器推过的值不会被误判。
   - 拉增量：Notion 查询 `last_edited_time >= 游标-2min`，游标存 `ops_notion_ingest_cursor`（db_key='projects'）。自己推送引起的编辑因等于基线自动无操作。
6. Notion 人建项目入库：未勾 Archive 且 Run ID 为空的页 → INSERT projects（name=标题，status/priority/remark/end_date/ai_tier 取页面值，ai_tier 空=知情，metadata.source='notion'，notion_props 写 notion_id/project_db/human_baseline）→ 回填 Run ID=`brain:<id>`。幂等：先按 notion_props.notion_id 查已有行。
7. AI 参与：迁移 554 加 `projects.ai_tier TEXT NOT NULL DEFAULT '知情' CHECK (ai_tier IN ('知情','盯着','介入'))`；PATCH /projects/:id 支持 ai_tier（非法值 400）。Notion 缺列时自动补建「AI 参与」(select 三选项) 与「AI 进展」(rich_text)，只补缺不改人调过的配置。
8. 上线后数据：9 个在做项目 PATCH ai_tier=介入，其余保持知情。

## 不做
- 盯着提醒推送（将来并入按人日报；停滞阈值=7 天，记在决策里）
- 介入自动拆任务派活（另立任务）
- Name 人改回写、Archive 勾选同步、Area/Goals 等 relation 列

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 人改了哪一列 | last_edited_time / 三方基线 | 三方基线（游标只做增量筛选） | 推送本身也改 last_edited_time，单靠时间会把自己的推送当人改 | 轻：误判=多写一次同值 |
| 新页是否人建 | Run ID 为空 / AI Project 未勾 | Run ID 为空且未归档 | Brain 推送必写 Run ID | 轻：重复入库靠 notion_id 幂等兜住 |

## 验收（Final E2E，生产）
- [ ] Notion 新建测试项目 → ≤10 分钟 Brain `GET /projects` 查到该行（metadata.source=notion），Notion 页 Run ID=brain:<id>
- [ ] Notion 把该项目 Status 改 Discard → Brain status=cancelled；AI 参与改 盯着 → Brain ai_tier=盯着
- [ ] Brain PATCH 某项目 ai_tier=介入 → Notion「AI 参与」显示 介入
- [ ] 全部 projects 有 Notion 页，状态按映射逐个一致（脚本比对零不一致）
- [ ] 测试项目清理（Brain 删行 + Notion 归档 Discard）
- [ ] CI 全绿
