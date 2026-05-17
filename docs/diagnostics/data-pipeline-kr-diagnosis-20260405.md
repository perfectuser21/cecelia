# 诊断报告：数据闭环 KR 0% 进度卡点分析

**生成时间**: 2026-04-05 21:34 CST  
**KR**: 数据闭环 — 全平台数据采集+每周自动周报+分析驱动下轮选题  
**KR ID**: `ff1635d6-ad02-4223-a6a9-f6c044e39c72`  
**调查触发**: SelfDrive 自动任务 `359b7147-b30f-4261-bfd1-9bd0e6536e73`

---

## 根因

### 根因1：OKR 拆解断链（主因，优先级 P0）

数据闭环 KR 下共有 5 个 projects，全部进度为 0%：

| 项目 | 状态 | Scopes | Initiatives | Tasks |
|------|------|--------|-------------|-------|
| 数据采集完整化 | active | 3 | **0** | **0** |
| 智能周报引擎 | planning | 3 | **0** | **0** |
| 选题决策闭环 | planning | 3 | **0** | **0** |
| 内容效果数据采集系统 | planning | 0 | 0 | 0 |
| 爆款分析+KR完成度仪表盘 | planning | 0 | 0 | 0 |

**卡点位置**：拆解停在 Scope 层，没有向下推进到 Initiative 和 Task 层。没有 Task 就没有执行单元，KR 进度永远是 0%。

数据采集完整化的 3 个 scopes（全部 planning）：
- `互动指标采集（评论/转发/收藏/分享全8平台）`
- `数据质量保障（去重/空值/异常告警/补采）`
- `采集可靠性（失败自动重试+缺采补录+健康监控）`

智能周报引擎的 3 个 scopes（全部 planning）：
- `7天数据汇总（全指标自动聚合+历史对比）`
- `深度分析报告生成（趋势/爆款归因/平台ROI）`
- `多渠道分发（飞书升级版+Dashboard周报页）`

### 根因2：平台数据采集模块未落地（P1）

`executor.js` 中已有路由规则：
```js
'platform_scraper': '/media-scraping', // 平台数据采集 → CN Mac mini
```

但实际状态：
- 数据库中 **0 个** `platform_scraper` 类型的任务记录
- 没有 `social_media_posts` 等平台数据存储表（仅有 `platform_credentials` 和 `platform_docs`）
- `/media-scraping` skill 文件存在，但没有被 Brain Tick 触发过

**结论**：平台数据采集的 Brain Tick 调度逻辑缺失，`platform_scraper` 任务从未被自动创建。

### 根因3：周报引擎依赖表刚刚修复（P1）

`weekly-report-generator.js` 查询的表包括 `pipeline_publish_stats`。该表在 2026-04-05 的 PR #1913 才完成修复（之前表缺失）。在此之前，周报生成器即便被触发也会因表不存在而报错。

---

## 具体问题回答

### (1) Project #4 数据采集完整化中是否有失败的任务？

**否，没有失败任务。** 该项目下没有任何任务（0 tasks）。项目虽然是 `active` 状态，但 3 个 scopes 均为 `planning`，没有 initiatives，没有 tasks。问题不是"任务失败"，而是"从未创建过任务"。

### (2) Project #3 智能周报引擎为何仍 planning？

**两层原因**：
1. 项目本身 `planning` 状态，没有被激活（需要人工/自动触发 activate）
2. 拆解未完成：3个 scopes 均为 planning，没有 initiatives/tasks

此外，周报引擎的前置依赖（平台数据采集）也未就绪，即使先激活周报引擎也因没有数据可汇总而无意义。

### (3) 是否需要调整任务拆分或补充缺失的环节？

**是**，需要补充以下三个环节：

---

## 修复建议

### 行动1：激活 数据采集完整化 scopes，用 /decomp 拆解 initiatives（立即）

对 `互动指标采集` scope 优先拆解，产出可执行的 initiative 和 dev 任务。这是整个数据闭环的数据源头。

目标：让 `数据采集完整化` 项目至少有 1 个 initiative → 1 个 task 进入 in_progress。

### 行动2：Brain Tick 增加 platform_scraper 任务调度（中期）

在 Brain 的某个 tick 模块（参考 `pipeline-patrol` 设计）中增加：
- 定期检查各平台是否有待采集数据
- 自动创建 `platform_scraper` 类型任务，路由到 CN Mac mini 的 `/media-scraping` skill

目前 executor.js 路由已就位，缺的是触发器。

### 行动3：确认 pipeline_publish_stats 表就绪后激活智能周报引擎（后置）

PR #1913 已修复 `pipeline_publish_stats` 表缺失问题。下次周一 09:00 (北京时间) 之前验证：
```bash
psql -U cecelia -d cecelia -c "\d pipeline_publish_stats"
```
确认表存在后，将 `智能周报引擎` 项目状态从 `planning` → `active`，并用 /decomp 拆解 initiatives。

---

## 优先级排序

1. **P0** (今天): 对 `数据采集完整化` 的互动指标采集 scope 进行 /decomp 拆解 → 产出可执行任务
2. **P1** (本周): 补充 Brain Tick 中 platform_scraper 调度逻辑（无数据源则周报无意义）
3. **P2** (下周): 激活 `智能周报引擎` + 拆解其 initiatives

---

*本报告由 SelfDrive 自动生成，任务 ID: 359b7147-b30f-4261-bfd1-9bd0e6536e73*
