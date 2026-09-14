# Handoff：Notion 排单 OpenClaw 分流改 relation 数据驱动（PR #5324/#5326）

**verdict: PASS**（1.292.1 已上产，E2E 验证通过）

## 完成
- 主理人纠正落地：撤掉硬编码「执行方」select + OPENCLAW_EXECUTORS 代码枚举，Tasks 库改 relation「Workflow」「Agent」直指运行舱四表的真实 Notion 行（workflows_db/graph_db）
- migration 444：ops_workflows/ops_agents 加 `dispatch` jsonb 人工列（采集不覆盖）；已种子：AwrSocialLeadgenV4.dispatch.webhook_url、affine-yuesheng→yueshengyun-daily.json、jinoshengyuan-social-media→jinoshengyuan-daily.json
- pull 反查 notion_id（归一去杠）→ dispatch 取入口/模板 → run_id `notion-<pageid32>-<ts>` POST n8n；缺配置写 ⚠ 回执（不含幂等标记，配好自动重派）
- smoke 反向守卫：OPENCLAW_EXECUTORS 回潮即红（notion-openclaw-dispatch-smoke.sh + notion-workflow-relation-smoke.sh）
- 顺手修 #5322 引入的 syncOpenClawRuns 列名 bug（finished_at→stopped_at，终态同步腿此前从未生效；回归用例断言 SQL 列名）
- Notion Tasks 库 schema 已 PATCH：加 Workflow/Agent relation、删「执行方」；E2E：自检行走通 relation 反查+⚠ 回执，已收尾 Cancelled

## 没完成
- 悦升/金诺以外的 workflow 行 dispatch 未配置（按需在 ops 表补 webhook_url/template 即可，无需改码）
- 真派发（真跑获客画布）未在本次触发——链路验证止步于配置校验层，主理人首次真排单即为真枪验收

## 下一步
- 主理人在 Notion Tasks 建行：Status=Delegated + Workflow 选「Social Leadgen V4 Commander Canvas」+ Agent 选 affine-yuesheng（悦升）或 jinoshengyuan-social-media（金诺）→ 5 分钟内自动派发
- 遗留大刀不变：map 扫描器迁 us-vps（解锁 Notion 编码任务 c90a6ce4 等 blocked 行）

## 数据源
- packages/brain/src/notion-push-sync.js（pull/dispatch/syncOpenClawRuns）
- packages/brain/migrations/444_ops_dispatch_manual.sql；ops_workflows/ops_agents.dispatch（us-vps cecelia 库）
- Notion Tasks 库 d5bc40c2-ba63-82ef-965a-8153b7ad81a0；ops 四库 id 在 working_memory.ops_notion_dbs

## 产物
- PR #5324（relation 数据驱动）、#5326（列名修复）、#5325/#5327（bump）；生产 1.292.1
