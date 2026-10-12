# 合同：Projects 双向同步与 AI 参与三档

依据：[已批准 PrepPRD](prep-prd.md)，决策 3ea59af0、c3b84640，任务 97024a3b。本合同补齐既有开发的验收对应关系，不改变范围。

GP-Anchor: none(infra)

## 交付行为

1. 全部 projects 行参与推送，不受 30 条或近期状态过滤；摘要未变则不重复写入。
2. 状态正向映射：queued/pending→Not Started；planning/active/in_progress→In Progress；paused/blocked/failed→On Hold；completed→Completed；cancelled/canceled/archived→Discard。未知状态告警并采用 Not Started。
3. 人工状态反向映射：Inbox/Not Started/Planned→planning；In Progress→in_progress；On Hold→paused；Completed→completed；Discard→cancelled。
4. Name、AI Project、Run ID、AI 进展和机器生成正文由 Brain 维护；Status、Priority、Remark、Due Date、AI 参与按三方基线合并。人建项目正文保留。
5. 每轮先拉后推。Notion 与基线不同才回写；双改时人工胜出，被覆盖 Brain 值写入 metadata.notion_overrides，保留最近 20 条。初始化旧页时保留历史人工状态，将旧机器摘要移至 AI 进展。推送回声不算人改。
6. 拉取使用两分钟重叠增量游标；失败不越过未完成页。未 Archive 且 Run ID 为空的人建页进入 projects，写 notion_id/project_db/human_baseline，并回填 brain:<id>；重试不重复创建。
7. ai_tier 仅允许知情、盯着、介入；新旧项目默认知情，POST/PATCH 非法值返回 400。缺失的 AI 参与、AI 进展列自动补建；已有配置不覆盖。
8. 上线后按原批准清单将 9 个在做项目设为介入，其余保持知情。数据执行与真实 Notion 验收另留回执，不由 CI smoke 改生产数据。

## 测试策略

纯函数测试检查状态映射、三方合并、初始化与冲突留痕；同步模块行为测试在 HTTP/数据库 I/O 边界注入夹具，验证重试、分页与属性写入；Express 路由测试验证档位输入。真实 PostgreSQL 测试在随机隔离 schema 执行迁移，检查约束、默认值、幂等与回滚并清理夹具。本地数据库只允许 cecelia_scratch，CI 使用隔离 service 数据库。

## Test Contract

| Workstream | Test File | BEHAVIOR | 验证层 |
|---|---|---|---|
| ws1 | `packages/brain/src/__tests__/project-notion-human.test.js` | 推送回声不改变 active 或写重复审计 | 单元 |
| ws1 | `packages/brain/src/__tests__/project-notion-human.test.js` | 双改时人工状态和备注胜出 | 单元 |
| ws1 | `packages/brain/src/__tests__/project-notion-human.test.js` | 旧页初始化将摘要移出 Remark | 单元 |
| ws1 | `packages/brain/src/__tests__/project-notion-ingest.test.js` | INSERT 后回填失败 | 行为 |
| ws1 | `packages/brain/src/__tests__/project-notion-ingest.test.js` | 第二页查询失败不推进游标 | 行为 |
| ws1 | `packages/brain/src/__tests__/projects-notion-sync.test.js` | 超过30个和较早归档项目也参与推送 | 行为 |
| ws1 | `packages/brain/src/__tests__/projects-notion-sync.test.js` | 人工备注与机器进展分列 | 单元 |
| ws1 | `packages/brain/src/routes/__tests__/task-projects-ai-tier.test.js` | 未指定时默认为知情 | 路由 |
| ws1 | `packages/brain/src/__tests__/integration/migration-554-projects-ai-tier.pg.integration.test.js` | 合法档位持久化 | 真实 PostgreSQL |
| ws1 | `packages/brain/src/__tests__/integration/migration-554-projects-ai-tier.pg.integration.test.js` | 同一 Notion 页不能关联两个项目 | 真实 PostgreSQL |
| ws1 | `packages/brain/scripts/smoke/projects-notion-sync-smoke.sh` | 项目同步与数据库约束全链验证 | CI smoke |

## 生产验收与范围边界

生产验收沿用 PrepPRD：Notion 人建项目十分钟内进入 Brain 并回填 Run ID；Notion 状态与档位回写；Brain 档位推送；全量项目逐项核对状态；清理验收项目；CI 全绿。CI smoke 只验证隔离夹具，不能代替真实 Notion 验收。

不新增盯着提醒、不新增介入自动拆任务派活；不回写人工 Name，不同步 Archive、Area/Goals relation 列。
