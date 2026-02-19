# Cecelia Core 关键代码位置速查表

## 决策层相关

### L1 丘脑（Sonnet 快速判断）
```
/home/xx/perfect21/cecelia/core/brain/src/thalamus.js

关键函数：
- analyzeEvent(event) [line ~359] - L1 主入口
- callSonnet(prompt) [line ~416] - Sonnet API 调用
- quickRoute(event) [line ~490] - 硬编码快速路由（不调用 LLM）
- parseDecisionFromResponse(response) [line ~453] - JSON 解析
- validateDecision(decision) [line ~198] - Decision 格式验证
- createFallbackDecision(event, reason) [line ~469] - 降级决策

关键常量：
- EVENT_TYPES [line ~112] - 事件类型枚举（13 种）
- ACTION_WHITELIST [line ~142] - 27 个 action 白名单
- THALAMUS_PROMPT [line ~320] - L1 系统提示词
```

### L2 皮层（Opus 深度分析）
```
/home/xx/perfect21/cecelia/core/brain/src/cortex.js

关键函数：
- analyzeDeep(event, thalamusDecision) [line ~305] - L2 主入口
- callOpus(prompt) [line ~174] - Opus API 调用
- performRCA(failedTask, history) [line ~679] - 根因分析
- saveCortexAnalysis(analysis, context) [line ~560] - RCA 持久化
- searchRelevantAnalyses(context, limit) [line ~626] - 历史 RCA 搜索
- storeAbsorptionPolicy(policy, context) [line ~481] - 吸收策略存储
- logCortexDecision(event, decision) [line ~437] - 决策日志记录

关键常量：
- CORTEX_PROMPT [line ~34] - L2 系统提示词
- CORTEX_ACTION_WHITELIST [line ~158] - L2 额外 3 个 action
```

### 决策执行
```
/home/xx/perfect21/cecelia/core/brain/src/decision-executor.js

关键函数：
- executeDecision(decision, context) [line ~主函数] - Decision 执行主函数
- actionHandlers - 27 个 action 处理器映射
  ├─ dispatch_task [line ~28]
  ├─ create_task [line ~38]
  ├─ cancel_task [line ~54]
  ├─ retry_task [line ~65]
  ├─ ... 等其他 action handlers
  └─ 事务化执行（BEGIN/COMMIT/ROLLBACK）
```

## 记忆与学习相关

### 学习检索与评分
```
/home/xx/perfect21/cecelia/core/brain/src/learning.js

关键函数：
- recordLearning(analysis) [line ~34] - 记录学习
- applyStrategyAdjustments(adjustments, learningId) [line ~80] - 应用策略调整
- searchRelevantLearnings(context, limit) [line ~173] - 学习搜索（评分机制）

关键常量：
- ADJUSTABLE_PARAMS [line ~16] - 6 个可调参数白名单

评分维度（在 searchRelevantLearnings 中）：
- 任务类型精确匹配：+10
- 失败分类匹配：+8
- 事件类型匹配：+6
- 新近度（最近 7 天）：+3
- 新近度（最近 30 天）：+2
- 新近度（更旧）：+1
- 已应用状态：+2
```

### 内存服务（递进式搜索）
```
/home/xx/perfect21/cecelia/core/brain/src/services/memory-service.js

类：MemoryService
关键方法：
- search(query, options) [line ~26] - Summary 层搜索
- getDetail(id) [line ~54] - Detail 层查询
- searchRelated(baseId, options) [line ~120] - Related 层相关搜索
- _generatePreview(description) [line ~154] - 预览文本生成
- _formatDetail(row) [line ~175] - 详情格式化

三层架构：
1. Summary：id, level, title, similarity, preview
2. Detail：完整信息（description, status, metadata）
3. Related：相似的其他任务/项目
```

### 相似度计算
```
/home/xx/perfect21/cecelia/core/brain/src/similarity.js

类：SimilarityService
关键方法：
- searchSimilar(query, topK, filters) [line ~29] - 相似度搜索
- calculateScore(query, entity) - 评分算法
- getAllActiveEntities(filters) [line ~58] - 获取所有实体

算法：
- Hybrid Score = 0.7 × Vector Similarity + 0.3 × Jaccard Similarity
- Phase 0：Jaccard（词汇相似度）
- Phase 1：OpenAI Embeddings + pgvector（向量语义相似度）
```

## L0 脑干（纯代码调度）

### 心跳循环
```
/home/xx/perfect21/cecelia/core/brain/src/tick.js

关键函数：
- executeTick() [line ~正式 tick 执行] - 5 分钟执行一次
- dispatchNextTask() [line ~派发下一个任务] - 派发循环
- planNextTask(krIds) [line ~KR 轮转规划] - 规划下一个任务

关键配置：
- TICK_LOOP_INTERVAL_MS = 5000ms（环境变量或代码常量）
- TICK_INTERVAL_MINUTES = 5（正式 tick 间隔）
- MAX_SEATS = 自动计算（min(可用内存/500MB, 可用CPU/0.5)）
- INTERACTIVE_RESERVE = 2
- AUTO_DISPATCH_MAX = MAX_SEATS - INTERACTIVE_RESERVE
- STALE_THRESHOLD_HOURS = 24
- DISPATCH_TIMEOUT_MINUTES = 60

executeTick() 顺序（10 步）：
1. 警觉等级评估 → alertness level
2. L1 丘脑事件处理（如有事件）
3. 决策引擎
4. 孤儿任务清理
5. 获取每日焦点
6. 自动超时检测
7. 存活探针
8. 看门狗（CPU 采样）
9. OKR 自动拆解
10. 派发循环
```

### 执行器与资源管理
```
/home/xx/perfect21/cecelia/core/brain/src/executor.js

关键函数：
- triggerCeceliaRun(task) [line ~派发任务] - 派发任务执行
- checkServerResources() [line ~180] - 资源检查
- checkExitReason(pid, taskId) [line ~84] - 进程退出诊断
- resolveRepoPath(projectId) [line ~150] - repo_path 解析

关键常量：
- CPU_CORES = os.cpus().length
- TOTAL_MEM_MB = Math.round(os.totalmem() / 1024 / 1024)
- MEM_PER_TASK_MB = 500
- CPU_PER_TASK = 0.5
- INTERACTIVE_RESERVE = 2
- USABLE_MEM_MB = TOTAL_MEM_MB * 0.8
- USABLE_CPU = CPU_CORES * 0.8
- MAX_SEATS = Math.max(Math.floor(Math.min(...)), 2)
- SWAP_USED_MAX_PCT = 70
```

## 保护系统

### 警觉系统
```
/home/xx/perfect21/cecelia/core/brain/src/alertness/

文件：
- index.js - 主模块
  ├─ initAlertness() - 初始化
  ├─ evaluateAlertness() - 评估等级
  ├─ getCurrentAlertness() - 获取当前等级
  ├─ canDispatch() / canPlan() - 权限检查
  └─ ALERTNESS_LEVELS (IDLE/ALERT/EMERGENCY/CRITICAL/SHUTDOWN)

- diagnosis.js - 系统诊断
- escalation.js - 升级流程
- healing.js - 自愈机制
- metrics.js - 指标采集

5 级警觉：
1. IDLE - 空闲
2. ALERT - 警告
3. EMERGENCY - 紧急
4. CRITICAL - 严重
5. SHUTDOWN - 关闭
```

### 熔断器
```
/home/xx/perfect21/cecelia/core/brain/src/circuit-breaker.js

关键函数：
- isAllowed() - 熔断判断
- recordSuccess() / recordFailure()
- getAllStates() - 获取所有熔断器状态

三态：
1. CLOSED - 正常
2. OPEN - 熔断
3. HALF_OPEN - 恢复中
```

### 隔离区
```
/home/xx/perfect21/cecelia/core/brain/src/quarantine.js

关键函数：
- handleTaskFailure(task) [line ~失败处理] - 失败处理流程
- quarantineTask(taskId, reason, context) - 隔离任务
- checkExpiredQuarantineTasks() - 自动释放过期隔离
- getQuarantineStats() - 隔离统计
```

### 看门狗
```
/home/xx/perfect21/cecelia/core/brain/src/watchdog.js

关键函数：
- monitorsProcesses() - 进程监控
- CPUWatchdog - CPU 过载检测

机制：
- /proc/stat 采样
- 动态阈值计算
- 两段式 kill（SIGTERM → SIGKILL）
```

## 数据库表

### 决策相关表
```
数据库：cecelia
地址：localhost:5432

表：
1. decision_log
   - id (UUID)
   - trigger (text: 'thalamus' | 'cortex')
   - input_summary (text)
   - llm_output_json (JSONB)
   - action_result_json (JSONB)
   - status (text)
   - created_at (timestamp)

2. learnings (migration 012)
   - id (UUID)
   - title (varchar)
   - category (varchar: failure_pattern/optimization/strategy_adjustment)
   - trigger_event (varchar)
   - content (text)
   - strategy_adjustments (JSONB)
   - applied (boolean)
   - applied_at (timestamp)
   - created_at (timestamp)
   - metadata (JSONB)
   
   索引：
   - idx_learnings_category
   - idx_learnings_trigger_event
   - idx_learnings_created_at
   - idx_learnings_applied

3. cortex_analyses (migration 013)
   - id (UUID)
   - task_id (UUID)
   - event_id (integer)
   - trigger_event_type (varchar)
   - root_cause (text)
   - contributing_factors (JSONB)
   - mitigations (JSONB)
   - failure_pattern (JSONB)
   - affected_systems (JSONB)
   - learnings (JSONB)
   - strategy_adjustments (JSONB)
   - analysis_depth (varchar)
   - confidence_score (numeric)
   - analyst (varchar)
   - created_at (timestamp)
   - metadata (JSONB)
   - similarity_hash (text)
   
   索引：
   - idx_cortex_analyses_task_id
   - idx_cortex_analyses_created_at
   - idx_cortex_analyses_trigger
   - idx_cortex_analyses_failure_pattern (GIN)

4. working_memory (基础)
   - key (text)
   - value_json (JSONB)
   - updated_at (timestamp)

5. cecelia_events (基础)
   - id (serial)
   - event_type (text)
   - source (text)
   - payload (JSONB)
   - created_at (timestamp)
   
   索引：idx_cecelia_events_type_time

6. pending_actions (migration 007)
   - 危险操作审批队列
   - status: pending_approval / approved / rejected

7. absorption_policies (migration 016/025/026)
   - 吸收策略表
   - status: draft / approved / active / archived
```

## API 接口

### 决策/分析 API
```
POST /api/brain/decide
- 手动触发决策分析
- 请求：{ event: {...} }
- 响应：Decision JSON

GET /api/brain/decision-log
- 查询决策历史
- 参数：trigger, status, created_after
```

### 学习/记忆 API
```
POST /api/brain/memory/search
- 搜索相关历史（Summary 层）
- 请求：{ query, topK, mode }
- 响应：{ matches: [{id, level, title, similarity, preview}] }

GET /api/brain/memory/detail/:id
- 查看完整详情（Detail 层）
- 响应：完整对象信息

POST /api/brain/memory/search-related
- 搜索相关任务（Related 层）
- 请求：{ base_id, topK, exclude_self }
- 响应：{ matches: [...] }

GET /api/brain/learnings
- 查询学习记录
- 参数：category, applied, created_after, limit

GET /api/brain/cortex-analyses
- 查询 RCA 分析
- 参数：task_id, created_after, limit
```

### 系统状态 API
```
GET /api/brain/status/full
- 完整系统状态快照
- 包含：tick 状态、alertness、quarantine、资源

GET /api/brain/tick
- Tick 循环状态
- 包含：enabled, running, last_tick, next_tick

GET /api/brain/alertness
- 警觉等级与指标

GET /api/brain/health
- 健康检查
```

## 迁移脚本

```
/home/xx/perfect21/cecelia/core/brain/migrations/

决策/记忆相关：
- 012_learnings_table.sql - 经验记录表
- 013_cortex_analyses.sql - RCA 分析表
- 015_cortex_quality_system.sql - 分析质量评估
- 024_add_rca_cache_table.sql - RCA 去重缓存
- 025_immune_system_v1.sql - 免疫系统（吸收策略）
- 026_extend_policy_evaluation_modes.sql - 策略扩展
- 028_add_embeddings.sql - 向量嵌入表
```

## 关键代码片段速索

### 评分算法（learning.js）
- 行 188-223：学习检索评分机制

### RCA 去重（cortex.js）
- 行 689-697：checkShouldCreateRCA() 去重逻辑

### 相似度搜索（similarity.js）
- 行 29-46：混合相似度计算

### 历史分析搜索（cortex.js）
- 行 626-673：searchRelevantAnalyses 评分机制

### Decision 验证（thalamus.js）
- 行 198-240：validateDecision 格式验证

### 决策执行（decision-executor.js）
- action handlers 事务化执行

### Prompt 注入（thalamus.js / cortex.js）
- thalamus.js 行 362-374：历史经验注入
- cortex.js 行 343-378：历史分析注入
