# 小改动 PrepPRD：拆库刀1——zenithjoy schema 剥离 cecelia 库（两 PR 向后兼容 + 切换文档）

## 改什么

**PR-A（cecelia repo）Brain 解耦（方案一：独立 pool，用户已拍）**
1. 新增 `packages/brain/src/zenithjoy-db.js`：懒初始化独立 Pool——env `ZENITHJOY_DATABASE_NAME` 已设→连独立库（host/port/user/password 各带 `ZENITHJOY_DATABASE_*` 覆盖，默认回落 Brain 现有 DB 配置的同名项）；env 未设→返回 Brain 现有 pool（**行为不变，向后兼容**）。
2. `packages/brain/src/routes/execution.js:556-637`：三处 `zenithjoy.works`/`zenithjoy.publish_logs` SQL 改用该 pool。
3. `packages/brain/scripts/backfill-publish-logs.js`：连接目标参数化（同一 env）。
4. `packages/brain/migrations/277`：不动历史文件，但在 `zenithjoy-db.js` 注释里声明 zenithjoy.publish_logs 表定义以 ZJ 侧 migrations 为准（Brain 277 是历史双写残留）。
5. bump brain 版本（惯例）+ 新增 smoke（lint-feature-has-smoke 若触发）。

**PR-B（zenithjoy repo）deploy 链生产库名参数化**
1. `deploy-lib.sh:872-873`：`ZJ_PROD_DB` 默认值 `cecelia` → `zenithjoy`；同函数内配套注释说明切换语义。
2. `rollback-prod.yml:69`：`ZJ_PROD_DB=cecelia` → `zenithjoy`。
3. `scripts/sync-scraper-to-works.sh` / `scripts/publish-by-content-id.sh`：`PGDATABASE` 硬编码 cecelia → env 可覆盖、默认 `zenithjoy`。
4. `apps/api/src/db/connection.ts:9` 默认库名**本刀不动**（本地 dev 剥离属刀2）；CI 十几处 `DATABASE_NAME=cecelia`（一次性容器内库名）**本刀不动**。

**切换 runbook（文档，随 PR-B 入库 docs/runbooks/db-split-cutover.md）**：建库→pg_dump -n zenithjoy | restore→停写窗口→生产 plist/env 加 `DATABASE_NAME=zenithjoy` + Brain 容器加 `ZENITHJOY_DATABASE_NAME=zenithjoy`→重启验证（/health+发布回执冒烟+n8n 目标库改）→旧 schema `ALTER SCHEMA zenithjoy RENAME TO zenithjoy_frozen_20260710` 观察一周→删。

## 为什么改
环境隔离决策（0710）：cecelia 库同时装着 Cecelia 生产 + ZJ 生产（schema 合租），爆炸半径覆盖两产品；且为刀3（ZJ 迁 HK）铺路——迁独立库比现场剥 schema 干净一个量级。调研坐实：68 表 9.8MB、零跨 schema FK、migrations 自足；唯一 P0 耦合 = Brain execution.js 跨 schema 写发布回执（迁库后静默丢数据）。

## 关联上下文
- 决策：0710 环境隔离终局（08:48）+ 方案一（Brain 独立 pool）用户已拍
- Brain task：2b557dca-69b0-40ef-a3c5-da71ed14c920
- staging 已用独立库 zenithjoy_test（现成范本，不动）

## 影响范围
两 PR 均向后兼容：env/默认值不切换则行为不变。真正切换发生在 runbook 执行时（用户在场）。风险点：Brain 独立 pool 的懒初始化不能在 env 未设时创建多余连接；rollback-prod 改默认值后若在切换前触发回滚会指向还不存在的 zenithjoy 库——runbook 里前置"先建库再合 PR-B"?（修正：建库动作提到 PR-B 合并前执行，库先建好空着无害）。

## 验收标准
- [ ] PR-A：commit-1 失败测试（env 设/未设两分支的 pool 选择 + execution.js 使用新 pool）→ commit-2 实现绿；lint 0；bump 版本
- [ ] PR-B：deploy-lib 单测（如有）+ bash -n + workflow YAML 校验；runbook 文档随 PR 入库
- [ ] 两 PR CI 全绿 merged；生产未切换（行为不变实证：merge 后发布回执照常写 cecelia 库）
- [ ] `zenithjoy` 空库已预建（切换前置）
- [ ] 切换 runbook 完整可执行，留用户 promote
