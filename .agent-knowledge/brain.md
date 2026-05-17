# Brain 模块详情

> 从 `packages/brain/src/` 提取的关键信息（更新于 2026-03-28）。
> 详细说明书：http://38.23.47.81:9998/knowledge/brain/

---

## 基本信息

| 项目 | 值 |
|------|----|
| 端口 | 5221 |
| 入口 | `packages/brain/src/routes.js`（路由汇聚）|
| Tick 间隔 | 每 5s 检查，每 2min 执行一次 tick |
| 数据库 | PostgreSQL，库名 `cecelia` |
| 源文件数 | ~171 个 .js 文件 |

---

## 三层大脑

| 层 | 文件 | 模型 | 职责 |
|----|------|------|------|
| L0 脑干 | `tick.js`, `planner.js`, `executor.js` | 纯代码 | 调度、派发、保护 |
| L1 丘脑 | `thalamus.js` | MiniMax M2.1 | 事件路由、快速判断 |
| L2 皮层 | `cortex.js` | Opus | 深度分析、RCA、战略调整 |

---

## 自驱系统（2026-03 新增）

Cecelia 的"自我感知 → 自我行动"闭环，由四个模块协作：

| 模块 | 文件 | 职责 |
|------|------|------|
| 能力探针 | `capability-probe.js` | 每小时验证所有关键链路是否通（类比感知手脚能不能动） |
| 能力扫描 | `capability-scanner.js` | 扫描系统能力使用情况（哪些能力被用了/闲置了） |
| 自驱引擎 | `self-drive.js` | 分析探针报告，自主创建修复/优化任务（4h 周期，最多 3 个任务/次） |
| 多巴胺回路 | `dopamine.js` | 记录奖赏信号，强化成功 pattern，影响自驱任务倾向 |

闭环流程：
```
Probe（链路通不通）+ Scanner（能力用没用）
  ↓
Self-Drive（分析 → 优先级排序 → 创建任务）
  ↓
Tick Loop（派发 → /dev 执行 → CI 验证）
  ↓
下次 Probe/Scan 验证效果
```

---

## 调度与保护系统

| 机制 | 文件 | 触发条件 |
|------|------|---------|
| 熔断器 | `circuit-breaker.js` | 连续失败超阈值，暂停派发 |
| 隔离区 | `quarantine.js` | 任务反复失败，移入隔离 |
| 看门狗 | `watchdog.js` | RSS/CPU 超限，告警 |
| 警觉系统 | `alertness/` | 0(平静)→4(紧急)，4级警觉 |
| Area 调度 | `area-scheduler.js` | YARN Fair Scheduler 模型：min/max/weight 三参数，按业务线公平分配 slot |
| Pipeline 巡航 | `pipeline-patrol.js` | 扫描所有 .dev-mode 文件，检测卡住的 /dev 会话，自动创建 pipeline_rescue 任务 |
| 免疫系统 | `immune-system.js` | 失败签名分析、自动修复路径 |
| KR3 进度报告 | `kr3-progress-scheduler.js` | UTC 06:00 每日触发，查询 KR3 微信小程序进度 + dev 任务统计，输出结构化日志 |

---

## 记忆系统

| 类型 | 存储 | 说明 |
|------|------|------|
| 语义记忆 | PostgreSQL + pgvector | tasks/learnings 向量搜索 |
| 事件记忆 | `cecelia_events` 表 | 时间线事件 |
| 自我模型 | `memory_stream` 表 | 自我叙事，随反刍演化 |
| 工作记忆 | `working_memory` 表 | 当前 tick 的临时状态 |

---

## 关键 API 端点

```
GET  /api/brain/health              健康检查
GET  /api/brain/status              系统状态摘要
GET  /api/brain/status/full         完整系统状态（含 working_memory）
GET  /api/brain/alertness           警觉等级（0-4）
POST /api/brain/tick                手动触发 tick
GET  /api/brain/tasks               查询任务（?status=queued/in_progress 等）
POST /api/brain/tasks               创建任务
PATCH /api/brain/tasks/:id          更新任务状态/结果
GET  /api/brain/tasks/:id/logs      任务日志
GET  /api/brain/quarantine          隔离区任务
GET  /api/brain/watchdog            实时 RSS/CPU
POST /api/brain/execution-callback  任务完成回调（CI/PR 回写）
GET  /api/brain/focus               今日焦点
POST /api/brain/intent/parse        意图识别
GET  /api/brain/decisions           有效决策（SSOT）
GET  /api/brain/briefing            每日简报
GET  /api/brain/context             全景摘要（OKR+PR+任务+决策）
POST /api/brain/memory/search       语义搜索知识库
GET  /api/brain/dev-records         最近 PR 记录
GET  /api/brain/policies            免疫系统策略
GET  /api/brain/immune/dashboard    免疫系统仪表盘
GET  /api/brain/kr-project-map     KR-Project 依赖图（krs + orphaned_projects + tier 分层）
GET  /api/brain/topics              查询内容选题候选库（topic_selection_log，支持 ?date= 过滤）
```

---

## 任务评分公式（planner.js）

```
任务总分 = 阶段分 + 状态分 + 优先级分 + 学习惩罚 + 内容加分

阶段分：  dev 阶段 = +100（最高优先）
状态分：  queued = +10，in_progress = 0
优先级：  P0 = +30，P1 = +20，P2 = +10
学习惩罚：7天内同类型失败 ≥2次 = -20
内容加分：已知拆解方案的 dev 任务 = +5
```

---

## 内容飞轮数据回收（2026-03-31 新增）

| 文件 | 职责 |
|------|------|
| `post-publish-data-collector.js` | 发布后数据回收模块。每 tick 扫描完成 4h 以上的 content_publish 任务，通过 Brain 任务队列派发 platform_scraper 任务（fire-and-forget），结果写入 pipeline_publish_stats 表 |

API：`GET /api/brain/pipelines/:id/stats` — 返回该 pipeline 各平台数据汇总（views/likes/comments/shares）

数据表：`pipeline_publish_stats`（migration 207） — 字段：pipeline_id / publish_task_id / platform / views / likes / comments / shares / scraped_at

---

## 集成测试模块（2026-03-28 新增）

| 文件 | 职责 |
|------|------|
| `__tests__/integration/brain-endpoint-contracts.test.js` | Brain API 端点契约测试（mock DB，supertest），覆盖 GET/POST/PATCH /tasks，无需真实 DB 或 Brain 服务 |
| `__tests__/integration/critical-routes.integration.test.js` | Brain 关键路由集成测试（真实 PostgreSQL），覆盖 GET /health、GET /tasks、GET /context、GET /okr/current，验证真实 SQL 行为 |
| `__tests__/content-pipeline-error-message.test.js` | content-pipeline 错误可观测性测试：验证 orchestrator 6 个失败路径均正确写入 `tasks.error_message` 字段（mock DB pool，无需真实服务） |

测试模式：
- mock 模式：`vi.mock('../../db.js')` + supertest + makeApp() 工厂函数，可在 CI ubuntu-latest 离线运行
- 集成模式：`new pg.Pool(DB_DEFAULTS)` 真实连接 + supertest，需要真实 PostgreSQL（CI brain-unit job 提供）

---

## 内容飞轮调度模块（2026-03-30 新增）

| 文件 | 职责 |
|------|------|
| `src/daily-report-generator.js` | 每日内容日报生成器：UTC 01:00（北京时间 09:00）触发，查询昨日 content-pipeline 完成数、各平台发布统计、数据回收、异常告警，写入 working_memory + 通过 notifier.js 推送飞书。幂等机制：working_memory key=daily_report_triggered_{DATE}。 |

---

## 内容流水线 LLM 调用模块（2026-03-31 新增）

| 文件 | 职责 |
|------|------|
| `src/__tests__/content-pipeline-llm.test.js` | content-pipeline executor Claude 调用测试：验证 executeCopywriting/executeCopyReview/executeGenerate/executeImageReview 四个阶段的 callLLM 调用逻辑，覆盖 previous_feedback 注入、rule_scores 返回格式、LLM 失败降级（mock callLLM，无需真实 LLM 服务）。 |

---

## content-type-registry notebook_id 补充逻辑（2026-03-31 新增）

| 文件 | 职责 |
|------|------|
| `src/__tests__/content-type-registry-notebook-id.test.js` | content-type-registry notebook_id 补充逻辑单元测试：验证 DB config 无 notebook_id 时从 YAML 补充、DB 有 notebook_id 时使用 DB 值、空字符串时补充等 5 个场景（mock DB pool + fs，无需真实 DB）。 |

---

## 内容生成 v1 — Research LLM Fallback（2026-04-06 新增）

| 文件 | 职责 |
|------|------|
| `src/__tests__/content-pipeline-research-fallback.test.ts` | executeResearch LLM 降级路径测试：验证无 notebook_id 时调用 LLM 完成研究（不返回 success:false）、orchestrator DEFAULT_CONTENT_TYPE 常量存在、daily-stats 路由存在（mock callLLM + fs，无需真实服务）。 |

---

## Gate 5 A1 — Honeycomb 接入 + Brain OpenTelemetry SDK（2026-04-27 新增）

| 文件 | 职责 |
|------|------|
| `src/otel.js` | OpenTelemetry SDK 初始化模块。导出 `initOtel()`：检测 `HONEYCOMB_API_KEY`，有 key 时启动 NodeSDK + OTLP exporter 发往 Honeycomb（serviceName: cecelia-brain），无 key 时静默返回 null，不报错、不阻塞启动。导出 `_resetOtel()` 供测试重置实例。 |
| `scripts/smoke/gate5-a1-otel-smoke.sh` | Gate 5 A1 真环境 smoke 验证脚本（CI real-env-smoke 跑）：检查 otel.js 语法、initOtel 导出、server.js 顶部接入、3 个 OTel 依赖声明、graceful skip 逻辑（7 项验证）。 |
| `src/__tests__/otel.test.js` | A1 单元测试（3 个）：验证无 HONEYCOMB_API_KEY 时 initOtel() 不抛错、返回 null；有 key 时（mock SDK）返回 SDK 实例。 |

server.js 接入点：文件最顶部（import dotenv/config 之前）：
```js
import { initOtel } from './src/otel.js';
await initOtel();
```

---

## Gate 5 B1+B2 — 凭据健康巡检 + 每日真业务 E2E smoke（2026-04-27 新增）

| 文件 | 职责 |
|------|------|
| `src/credentials-health-scheduler.js` | B1 凭据健康巡检调度器：每天北京时间 03:00（UTC 19:00）触发，巡检 NotebookLM/Claude OAuth(account1-3)/Codex(team1-5)/发布器 cookies。三级告警：已过期/missing→P0，7天内→P0告警+P1任务，30天内→P1告警+P2任务。内存去重（24h/每凭据/每级别），DB幂等sentinel（task_type=credentials_health）。 |
| `src/cron/daily-real-business-smoke.js` | B2 每日真业务 E2E smoke：每天北京时间 04:00（UTC 20:00）触发，创建 content-pipeline 任务（solo-company-case），后台轮询 30min，验收 export 完成 + 图片 ≥ 9，失败/超时→P0飞书告警+创建Brain dev任务。30天后自动 archive smoke 记录。 |
| `scripts/cecelia-bridge.js` | +新增 `/notebook/auth-check` 端点：通过宿主机 notebooklm CLI 真调 API 验证 cookie 有效性，供 credentials-health-scheduler.js 的 checkNotebookLmAuth() 调用。 |
| `scripts/cron/credentials-health-check.sh` | B1 Shell 脚本版本：可独立运行的宿主机凭据巡检，输出 JSON 到 stdout，含 NotebookLM CLI 调用、Claude credentials.json 解析、Codex wham/usage API 验证、发布器 Playwright state 文件检查。 |
| `scripts/scan-code-dedup.mjs` | KR coding dedup Phase 1 扫描引擎：滑动窗口 hash（8行/30 token 阈值）扫描 Brain src 重复代码块。`--json` JSON输出，`--baseline` 保存基线到 dedup-baseline.json。基线（2026-05-14）：365文件，重复率 1.3%，122个重复块。 |
| `scripts/dedup-baseline.json` | KR coding dedup 基线数据（2026-05-14）：duplication_pct=1.3%，duplicate_blocks=122，目标降至 <1.0%。Phase 2 重构参考：top offenders 为 callback-processor.js、routes/execution.js、decomposition-checker.js。 |
| `scripts/smoke/gate5-b1-b2-smoke.sh` | Gate 5 B1+B2 真环境 smoke 验证脚本（CI real-env-smoke 跑）：检查文件存在 + 语法正确 + tick-runner 接入 + bridge 端点 + 时间窗口逻辑正确（6 项验证）。 |
| `src/__tests__/credentials-health-scheduler.test.js` | B1 单元测试（25 个）：覆盖 isInCredentialsHealthWindow 窗口判断、checkClaudeCredentials 状态分级（ok/warning/critical/expired/missing/unknown/error）、checkNotebookLmAuth/checkCodexAuth、runCredentialsHealthCheck 主流程（窗口外/去重/各凭据失效→告警+任务）。 |
| `src/cron/__tests__/daily-real-business-smoke.test.js` | B2 单元测试（31 个）：覆盖 isInSmokeWindow、hasTodaySmoke、createSmokeTask(ON CONFLICT)、findFailedStage、assertSmokeOutput、handleSmokeFailure、archiveOldSmokePipelines、runDailySmoke（触发/跳过/失败）、waitAndAssertSmoke（完成/failed/超时）。 |

tick-runner.js 接入点：
- 10.17h（UTC 20:00）：`Promise.resolve().then(() => runDailySmoke(pool))`
- 10.21（UTC 19:00）：`Promise.resolve().then(() => runCredentialsHealthCheck(pool))`

---

## 深度说明书

- 规划器：http://38.23.47.81:9998/knowledge/brain/planner.html
- 打分机制：http://38.23.47.81:9998/knowledge/brain/planner-scoring.html
- 完整 Brain 模块图：http://38.23.47.81:9998/knowledge/brain/

---

## Capture Digestion 路由模块（2026-03-31 新增）

| 文件 | 职责 |
|------|------|
| `src/routes/capture-atoms.js` | Capture Atoms API 路由：GET /api/brain/capture-atoms（查询 pending_review atoms，支持 status/limit 参数）、PATCH /api/brain/capture-atoms/:id（confirm/dismiss 操作；confirm 调用 routeAtomToTarget 写入目标表 notes/tasks/decisions/events/knowledge/content_topics）。 |

## 社媒热点路由模块（2026-03-31 新增）

| 文件 | 职责 |
|------|------|
| `src/routes/social-trending.js` | 社媒热点 API 路由：GET /api/brain/social/trending（查询 TimescaleDB v_all_platforms 视图，支持 platform/limit/days 参数过滤）。使用独立 pg.Pool 连接 TimescaleDB（TIMESCALE_HOST/DB/USER/PASSWORD 环境变量）；TimescaleDB 不可达时降级返回空数组，不影响 Brain 其他功能。挂载路径：/social/trending。 |
