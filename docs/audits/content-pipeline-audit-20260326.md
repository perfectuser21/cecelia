# Content Pipeline 全链路审计报告

**审计日期**: 2026-03-26
**审计范围**: ZenithJoy 内容 pipeline 全链路（采集 → 生产 → 发布 → 回流）
**审计方式**: 代码静态审查 + 数据库实际查询

---

## 一、Pipeline 架构总览

```
【数据采集层】
  8个平台 scraper（n8n 调度）
  → social_media_raw DB（content_master/content_snapshots）
  → cecelia DB（zenithjoy.publish_logs 关联 work_id）

【内容生产层】
  Brain tick → orchestrateContentPipelines()
  → content-research（NotebookLM）
  → content-generate（/content-creator skill）
  → content-review（/content-creator skill）
  → content-export（生成卡片 + manifest.json）

【发布层】
  content-export 完成 → 创建 8个 content_publish 任务
  → executor 路由到各平台 publisher skill
  → 写入 cecelia DB（publish_results 表）

【回流层】
  scraper 采集到 platform_post_id
  → 查 zenithjoy.publish_logs（platform_post_id 索引）
  → 更新 metrics 字段关联 work_id
```

---

## 二、各节点状态一览

| 层 | 节点 | 状态 | 备注 |
|----|------|------|------|
| 采集 | 抖音 scraper | ⚠️ P0 | DB 连接 `social_media_raw` 不存在 |
| 采集 | 快手 scraper | ⚠️ P0 | DB 连接 `social_media_raw` 不存在 |
| 采集 | 头条 scraper | ⚠️ P0 | DB 连接 `social_media_raw` 不存在 |
| 采集 | 微博 scraper | ⚠️ P0 | DB 连接 `social_media_raw` 不存在 |
| 采集 | 小红书 scraper | ⚠️ P0 | DB 连接 `social_media_raw` 不存在 |
| 采集 | 微信 scraper | ⚠️ P0 | DB 连接 `social_media_raw` 不存在 |
| 采集 | 视频号 scraper | ⚠️ P0 | DB 连接 `social_media_raw` 不存在 |
| 采集 | 知乎 scraper | ❌ | 无 DB 实现，仅输出 JSON |
| 生产 | content-pipeline tick | ✅ | tick.js 已集成 orchestrateContentPipelines |
| 生产 | content-research | ✅ | NotebookLM executor 实现完整 |
| 生产 | content-generate | ✅ | content-creator skill 路由正确 |
| 生产 | content-review | ✅ | 含重试逻辑（MAX_REVIEW_RETRY=3） |
| 生产 | content-export | ⚠️ P1 | 产出 manifest.json 但未写入 zenithjoy.works |
| 发布 | 抖音 publisher | ✅ | 图文/视频/文章三种类型全实现 |
| 发布 | 快手 publisher | ✅ | CDP Cookie + HTTP API 方案 |
| 发布 | 头条 publisher | ✅ | 微头条/文章/视频 全实现 |
| 发布 | 微博 publisher | ✅ | Playwright CDP 方案 |
| 发布 | 小红书 publisher | ✅ | 图文/视频/文章 实现 |
| 发布 | 微信 publisher | ✅ | 官方 API 方案 |
| 发布 | 视频号 publisher | ✅ | 图文/视频 实现 |
| 发布 | 知乎 publisher | ✅ | 文章/想法 实现 |
| 回流 | work_id 关联-抖音 | ✅ | aweme_id → publish_logs |
| 回流 | work_id 关联-微博 | ✅ | weiboId → publish_logs |
| 回流 | work_id 关联-快手 | ✅ | workId → publish_logs（最早实现） |
| 回流 | work_id 关联-头条 | ❌ P1 | 无 platform_post_id 提取 |
| 回流 | work_id 关联-微信 | ❌ P1 | 无 platform_post_id 提取 |
| 回流 | work_id 关联-小红书 | ❌ P1 | 无 platform_post_id 提取 |
| 回流 | work_id 关联-视频号 | ❌ P1 | 无 platform_post_id 提取 |
| 回流 | work_id 关联-知乎 | ❌ | 无 DB 实现 |

---

## 三、P0 问题（阻断性）

### P0-1: `social_media_raw` 数据库不存在

**现象**：所有 8 个 scraper 脚本配置 `database: 'social_media_raw'`，但该数据库未创建。
**影响**：所有平台数据采集在建立 DB 连接时失败。
**证据**：
```bash
# 执行 psql -U cecelia -l 确认，数据库列表中无 social_media_raw
# 实际存在: cecelia, postgres, template0, template1
```
**表结构**：各 scraper 期望：
- `content_master`（快手/头条/微博/小红书/视频号）
- `douyin.daily_snapshots`（抖音，需 douyin schema）
- `wechat.daily_snapshots`（微信，需 wechat schema）

**修复建议**：创建 `social_media_raw` 数据库并初始化各平台 schema。

---

## 四、P1 问题（断链）

### P1-1: content-export 未写入 `zenithjoy.works`

**现象**：`executeExport()` 生成 manifest.json 并返回 `{ status: 'ready_for_publish' }`，但不向 `zenithjoy.works` 表写入记录。
**影响**：发布后无法通过 works 查询内容全貌；publish_logs 无法关联 work_id。
**位置**：`packages/brain/src/content-pipeline-executors.js` L360-415
**修复建议**：在 executeExport 末尾，INSERT INTO zenithjoy.works（title, content_type, status='ready', nas_path=manifest_path）

### P1-2: 5个平台 scraper 无 platform_post_id 提取

**现象**：头条/微信/小红书/视频号 scraper 只存 title+timestamp，无法与 publish_logs 关联。
**影响**：这 5 个平台的发布作品无法回流数据（阅读量/点赞等）。
**修复建议**：各平台独立评估 API 路径（需先分析各平台返回的 JSON 结构）

### P1-3: 两套发布记录系统未打通

**现象**：
- `cecelia.publish_results`：publisher skill 执行后写入（work_id, url, success）
- `zenithjoy.publish_logs`：works 发布后写入（platform_post_id, metrics）

两个表没有外键关联，同一次发布的记录无法互查。
**修复建议**：在 publisher skill 完成后，将 result 同步写入 zenithjoy.publish_logs 的 metadata 字段

---

## 五、P2 优化项

### P2-1: 知乎 scraper 无 DB 写入能力

知乎 scraper（scraper-zhihu-v8-api.js）仅输出 JSON 文件，不写入任何 DB。需先确定是写 social_media_raw 还是直接写 content_master。

### P2-2: content_publish 任务 vs content_publish_jobs 表混用

- Brain tasks 表：task_type='content_publish'（由 orchestrator 创建）
- cecelia DB：content_publish_jobs 表（由 /api/brain/publish-jobs 路由管理）

两套记录代表同一事物，存在数据冗余。建议 content_publish_jobs 作为 tasks 的一个 view 或废弃。

---

## 六、整体连通性评分

| 维度 | 状态 | 评分 |
|------|------|------|
| 数据采集 | ❌ DB 不存在 | 0/10 |
| 内容生产 | ✅ 逻辑完整 | 8/10 |
| 内容发布 | ✅ 8个平台已实现 | 9/10 |
| 数据回流 | ⚠️ 3/8平台 | 3/10 |
| **总体** | **采集层完全断链** | **5/10** |

---

## 七、建议修复优先级

| 优先级 | 任务 | 预估工作量 |
|--------|------|-----------|
| P0 | 创建 social_media_raw DB + 各平台 schema 迁移 | 1 PR |
| P1 | content-export 写入 zenithjoy.works | 0.5 PR |
| P1 | 头条/微信/小红书/视频号 platform_post_id 提取 | 2 PR（各平台独立） |
| P1 | publish_results ↔ publish_logs 打通 | 0.5 PR |
| P2 | 知乎 scraper DB 写入 | 0.5 PR |
| P2 | content_publish_jobs 与 tasks 去重 | 1 PR |

---

## 八、审计方法

本次审计通过以下方式获取信息：
- 代码静态阅读：`packages/brain/src/content-pipeline-*.js`、`services/creator/scripts/publishers/`、`workflows/platform-data/workflows/scraper/scripts/`
- 数据库实际查询：`PGPASSWORD=... psql -U cecelia -l` 确认数据库存在性，`\dt zenithjoy.*` 确认表结构
- n8n workflow 文件：`zenithjoy/workflows/n8n/media/`
- Learning 文档参考：`docs/learnings/cp-03260755-scraper-work-id-assoc.md`
