# Cecelia Core 决策与记忆系统研究报告

**研究日期**: 2026-02-19  
**研究范围**: `/home/xx/perfect21/cecelia/core`  
**主要版本**: Brain v1.50.6, Schema v038

---

## 目录

1. [决策流程架构](#1-决策流程架构)
2. [三层大脑运作机制](#2-三层大脑运作机制)
3. [记忆与学习系统](#3-记忆与学习系统)
4. [数据库关键表](#4-数据库关键表)
5. [API 接口清单](#5-api-接口清单)
6. [记忆检索机制](#6-记忆检索机制)
7. [决策执行流程](#7-决策执行流程)
8. [核心文件导航](#8-核心文件导航)

---

## 1. 决策流程架构

### 1.1 决策层次（三层大脑）

Cecelia 采用仿人脑的三层分布式决策架构：

```
事件输入
  ↓
L0 脑干（纯代码）- 自动反应 - tick.js, executor.js
  ├─ 简单/常规/规则可处理 → 直接执行
  └─ 复杂/异常/需要判断 → 升级到 L1
     ↓
L1 丘脑（Haiku） - 快速判断 - thalamus.js
  ├─ level=0: 脑干反射
  ├─ level=1: 快速判断（<1s）
  └─ level=2: 复杂决策 → 升级到 L2
     ↓
L2 皮层（Sonnet） - 深度分析 - cortex.js
  └─ RCA / 战略调整 / 经验学习
```

### 1.2 决策触发条件

**L1 丘脑（Haiku）被唤醒的事件类型**：
- TASK_COMPLETED（任务完成 - 可能有隐藏问题）
- TASK_FAILED（任务失败 - 超过重试限制）
- TASK_TIMEOUT（任务超时）
- OKR_BLOCKED（目标阻塞 - 严重）
- DEPARTMENT_REPORT（部门报告 - 严重问题）
- USER_COMMAND（用户命令 - 复杂）
- RESOURCE_LOW（资源不足 - 严重）

**L2 皮层（Sonnet）被唤醒的条件**：
- L1 判断结论为 level=2（深度思考）
- 反复失败模式（failure_count >= 3）
- 系统性故障检测
- 需要战略调整

### 1.3 决策输出标准

所有决策输出统一 JSON 格式：

```json
{
  "level": 0|1|2,
  "actions": [
    {
      "type": "action_type",  // 必须在白名单内
      "params": {...}         // action 特定参数
    }
  ],
  "rationale": "决策理由（人类可读）",
  "confidence": 0.0-1.0,     // 置信度
  "safety": false|true        // 是否需要人工审批
}
```

**三层白名单 Action**：

| Layer | Actions 数量 | 特点 |
|-------|------------|------|
| L0 脑干 | 0（纯代码） | 无 LLM 决策，直接代码执行 |
| L1 丘脑 | 27 个 | 任务操作、OKR 操作、通知、分析、规划等 |
| L2 皮层 | 27 + 3 个 | 增加：adjust_strategy, record_learning, create_rca_report |

**L1 完整白名单**（27 个）：
- 任务类：dispatch_task, create_task, cancel_task, retry_task, reprioritize_task, pause_task, resume_task, mark_task_blocked, quarantine_task
- OKR 类：create_okr, update_okr_progress, assign_to_autumnrice
- 系统类：notify_user, log_event, escalate_to_brain, request_human_review
- 分析类：analyze_failure, predict_progress
- 规划类：create_proposal
- 知识类：create_learning, update_learning, trigger_rca
- 生命周期类：update_task_prd, archive_task, defer_task
- 控制类：no_action, fallback_to_tick

---

## 2. 三层大脑运作机制

### 2.1 L0 脑干（纯代码）

**位置**：`tick.js`, `executor.js`, `planner.js`, `alertness/`, `circuit-breaker.js`, `quarantine.js`

**运作循环**：
- **Tick Loop**: 每 5 秒循环检查，每 5 分钟执行一次正式 `executeTick()`
- **TICK_LOOP_INTERVAL_MS**: 5000ms（配置在环境变量或代码常量）
- **TICK_INTERVAL_MINUTES**: 5 分钟（正式 tick 执行间隔）

**executeTick() 核心步骤**（顺序执行）：

```javascript
async function executeTick() {
  // 0. 评估系统警觉等级 (alertness level)
  //    5 级：IDLE → ALERT → EMERGENCY → CRITICAL → SHUTDOWN
  
  // 1. 处理 L1 丘脑事件（如有新事件）
  //    检查 event_queue → callThalamus() → 如 level=2 升级到皮层
  
  // 2. 决策引擎（对比目标进度 → 生成决策 → 执行）
  //    compareGoalProgress() → generateDecision() → executeDecision()
  
  // 3. 孤儿任务清理
  //    清理引用已删除的 goal_id 或 project_id 的任务
  
  // 4. 获取每日焦点
  //    getDailyFocus() → 选择一个主 Global OKR 作为今日焦点
  
  // 5. 自动超时检测
  //    in_progress 时间 > 60 分钟 → 标记为 failed
  
  // 6. 存活探针（Liveness Probe）
  //    验证标记为 in_progress 的任务进程是否还活着
  //    检查 /proc/<pid> 存在性
  
  // 7. 看门狗（Watchdog）
  //    采样 /proc/stat → CPU 使用率 → 三级响应
  //    Level 1: 日志警告
  //    Level 2: 降低警觉（alertness --）
  //    Level 3: Kill 进程、提升警觉（alertness ++）
  
  // 8. OKR 自动拆解
  //    Global OKR 有 0 个 KR → 创建拆解任务 → 秋米处理
  
  // 9. 规划（KR 轮转评分）
  //    queued 任务数为 0 && 有 KR → planNextTask()
  //    选下一个优先级最高的 KR → 生成任务
  
  // 10. 派发循环（Fill All Slots）
  //    while (active_tasks < AUTO_DISPATCH_MAX) {
  //      dispatchNextTask()
  //    }
}
```

**关键配置**（代码常量）：
- `MAX_SEATS`: 最大并发任务数（自动计算：min(可用内存/500MB, 可用CPU/0.5) ）
- `INTERACTIVE_RESERVE`: 2（预留 2 个座位给用户交互）
- `AUTO_DISPATCH_MAX`: MAX_SEATS - INTERACTIVE_RESERVE
- `MEM_PER_TASK_MB`: 500MB（平均每个任务内存消耗）
- `CPU_PER_TASK`: 0.5 核（平均每个任务 CPU 消耗）
- `STALE_THRESHOLD_HOURS`: 24（任务超过 24h 未完成视为陈旧）
- `DISPATCH_TIMEOUT_MINUTES`: 60（派发后 60min 自动失败）

### 2.2 L1 丘脑（Haiku 快速判断）

**文件**：`/home/xx/perfect21/cecelia/core/brain/src/thalamus.js`

**关键函数**：
- `analyzeEvent(event)` - 主入口，调用 Sonnet 分析
- `callSonnet(prompt)` - HTTP 调用 Claude Sonnet API
- `quickRoute(event)` - 硬编码的快速路由规则（不调用 LLM）
- `parseDecisionFromResponse(response)` - 从 Sonnet 响应中解析 JSON Decision
- `validateDecision(decision)` - 验证 Decision 是否符合格式和白名单

**快速路由规则**（L0 硬编码，不调用 LLM）：

| 事件类型 | 条件 | 直接返回 |
|---------|------|---------|
| HEARTBEAT | 总是 | level=0, no_action |
| TASK_COMPLETED | 无异常 | level=0, dispatch_task |
| TASK_COMPLETED | 有异常 | null → 调用 Sonnet |
| TASK_FAILED | 简单失败 | level=0, retry_task |
| TASK_FAILED | 重试超限 | level=0, cancel_task |
| TASK_FAILED | 复杂原因 | null → 调用 Sonnet |
| TASK_TIMEOUT | 总是 | level=0, log_event + retry_task |
| 其他 | 复杂事件 | null → 调用 Sonnet |

**Sonnet 分析流程**：

```javascript
async function analyzeEvent(event) {
  // Step 1: 搜索相关历史经验
  const learnings = await searchRelevantLearnings({
    task_type: event.task?.task_type,
    failure_class: event.failure_info?.class,
    event_type: event.type
  }, 20);  // 返回最相关的 20 条学习记录
  
  // Step 2: 构建 prompt（注入历史经验）
  let prompt = THALAMUS_PROMPT;
  if (learnings.length > 0) {
    prompt += "## 系统历史经验（参考）\n";
    learnings.forEach((l, i) => {
      prompt += `- [${i+1}] **${l.title}** (相关度: ${l.relevance_score}): ${l.content.slice(0, 200)}\n`;
    });
  }
  prompt += "\n\`\`\`json\n" + JSON.stringify(event, null, 2) + "\n\`\`\`";
  
  // Step 3: 调用 Sonnet API
  const response = await callSonnet(prompt);
  
  // Step 4: 解析响应
  const decision = parseDecisionFromResponse(response);
  
  // Step 5: 验证
  const validation = validateDecision(decision);
  if (!validation.valid) {
    // 记录 LLM 错误并降级
    await recordLLMError('thalamus', ...);
    return createFallbackDecision(event, validation.errors.join('; '));
  }
  
  // Step 6: 返回决策
  if (decision.level === 2) {
    // 升级到皮层
    return await analyzeDeep(event, decision);
  }
  return decision;
}
```

**记录的信息**：
- Token 使用（input/output tokens、成本）
- LLM 错误（分类为 API_ERROR / BAD_OUTPUT / TIMEOUT）
- 路由决策事件（route_type, latency_ms）

### 2.3 L2 皮层（Sonnet 深度分析）

**文件**：`/home/xx/perfect21/cecelia/core/brain/src/cortex.js`

**触发条件**：
- L1 返回 level=2
- 反复失败的任务（failure_count >= 3）
- RCA 请求

**核心功能**：

```javascript
async function analyzeDeep(event, thalamusDecision = null) {
  // Step 1: 构建分析上下文
  const context = {
    event,                     // 原始事件
    thalamus_judgment: thalamusDecision,
    timestamp: new Date().toISOString()
  };
  
  // Step 2: 获取决策历史（最近 24h 的 10 条决策）
  context.recent_decisions = await pool.query(`
    SELECT trigger, input_summary, llm_output_json, status, created_at
    FROM decision_log
    WHERE created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  
  // Step 3: 获取系统状态快照
  context.system_status = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM tasks WHERE status = 'in_progress') as tasks_in_progress,
      (SELECT COUNT(*) FROM tasks WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '24 hours') as recent_failures,
      (SELECT COUNT(*) FROM goals WHERE status = 'in_progress') as active_goals
  `);
  
  // Step 4: 搜索相关的历史 Cortex 分析（相似问题的深度分析）
  //        这是"长期记忆"检索 - 从 cortex_analyses 表查询相似问题
  const historicalAnalyses = await searchRelevantAnalyses({
    task_type: event.failed_task?.task_type,
    failure_class: event.failure_history?.[0]?.failure_classification?.class,
    trigger_event: event.type
  }, 5);
  
  // Step 5: 构建 Cortex Prompt（注入历史分析）
  let prompt = CORTEX_PROMPT;
  if (learnings.length > 0) {
    prompt += "## 系统历史经验（按相关性排序）\n";
    learnings.forEach((l, i) => {
      prompt += `- [${i+1}] **${l.title}** (相关度: ${l.relevance_score}): ${l.content.slice(0, 300)}\n`;
    });
  }
  if (historicalAnalyses.length > 0) {
    prompt += "\n## 类似问题的历史分析\n";
    historicalAnalyses.forEach((a, i) => {
      prompt += `- [${i+1}] 根因: ${a.root_cause}, 置信度: ${a.confidence_score}\n`;
      prompt += `  缓解方案: ${JSON.stringify(a.mitigations).slice(0, 200)}\n`;
    });
  }
  prompt += "\n\`\`\`json\n" + JSON.stringify(context, null, 2) + "\n\`\`\`";
  
  // Step 6: 调用 Opus API
  const response = await callOpus(prompt);
  
  // Step 7: 解析和验证
  const decision = parseCortexDecision(response);
  const validation = validateCortexDecision(decision);
  if (!validation.valid) {
    return createCortexFallback(event, validation.errors.join('; '));
  }
  
  // Step 8: 记录决策到日志
  await logCortexDecision(event, decision);
  
  // Step 9: 处理特殊决策类型
  //        - 如有 learnings → recordLearnings()
  //        - 如有 absorption_policy → storeAbsorptionPolicy()
  //        - 如有 strategy_updates → 标记为待审批
  
  return decision;
}
```

**Cortex 的核心能力**：

1. **根因分析 (RCA)**
   - 文件：`performRCA(failedTask, history[])`
   - 输入：失败任务 + 历史失败记录
   - 输出：{ analysis, contributing_factors, recommended_actions, strategy_adjustments, confidence }
   - 去重机制：`checkShouldCreateRCA()` 检查是否存在相似分析，避免重复

2. **历史分析搜索**
   - 函数：`searchRelevantAnalyses(context, limit=5)`
   - 查询对象：`cortex_analyses` 表
   - 评分机制：
     - 失败分类匹配：+10
     - 任务类型匹配：+8
     - 触发事件匹配：+6
     - 新近度：最近 7 天 +3，最近 30 天 +2，更旧 +1
   - 返回：按相关度分数排序

3. **策略调整建议**
   - 可调整参数白名单：
     - `alertness.emergency_threshold` (0.5-1.0)
     - `alertness.alert_threshold` (0.3-0.8)
     - `retry.max_attempts` (1-5)
     - `retry.base_delay_minutes` (1-30)
     - `resource.max_concurrent` (1-20)
     - `resource.memory_threshold_mb` (500-4000)
   - 所有调整需要人工审批（进入 `pending_actions` 表）

4. **学习记录**
   - 函数：`recordLearnings(learnings[], event)`
   - 存储到：`cecelia_events` 表（event_type='learning'）

5. **吸收策略 (Absorption Policy)**
   - 当识别到可自动处理的重复失败模式时生成
   - Schema：{ action: "requeue"|"skip"|"adjust_params"|"kill", params: {}, expected_outcome, confidence, reasoning }
   - 存储到：`absorption_policies` 表（status=draft）

---

## 3. 记忆与学习系统

### 3.1 记忆层次

Cecelia 的记忆系统分为三个层次：

| 层次 | 介质 | 时间窗口 | 用途 | 表 |
|------|------|---------|------|-----|
| **短期记忆** | working_memory (key-value) | 实时 | 当前状态、上次派发时间、tick 计数 | `working_memory` |
| **中期记忆** | decision_log, cecelia_events | 最近 24h | 决策过程、系统事件、错误记录 | `decision_log`, `cecelia_events` |
| **长期记忆** | learnings, cortex_analyses | 永久 | 经验教训、根因分析、历史模式 | `learnings`, `cortex_analyses` |

### 3.2 Learnings 表（经验记录）

**表结构**：

```sql
CREATE TABLE learnings (
  id UUID PRIMARY KEY,
  title VARCHAR(255),                 -- 学习标题（如 "RCA Learning: Network timeout in XX"）
  category VARCHAR(50),               -- 分类：'failure_pattern', 'optimization', 'strategy_adjustment'
  trigger_event VARCHAR(100),         -- 触发事件：'systemic_failure', 'alertness_emergency', ...
  content TEXT,                       -- 学习内容（RCA 结果、建议等）
  strategy_adjustments JSONB,         -- 推荐的策略调整（数组）
  applied BOOLEAN DEFAULT false,      -- 是否已应用
  applied_at TIMESTAMP,               -- 应用时间
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB                      -- 附加信息（task_id, confidence 等）
);

-- 索引
CREATE INDEX idx_learnings_category ON learnings(category);
CREATE INDEX idx_learnings_trigger_event ON learnings(trigger_event);
CREATE INDEX idx_learnings_created_at ON learnings(created_at);
CREATE INDEX idx_learnings_applied ON learnings(applied);
```

**记录流程**：
```javascript
// 在 cortex.js 中
if (decision.learnings && decision.learnings.length > 0) {
  await recordLearnings(decision.learnings, event);
}

async function recordLearnings(learnings, event) {
  for (const learning of learnings) {
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('learning', 'cortex', $1)
    `, [JSON.stringify({
      learning,
      event_type: event.type,
      recorded_at: new Date().toISOString()
    })]);
  }
}
```

### 3.3 Cortex Analyses 表（根因分析持久化）

**表结构**：

```sql
CREATE TABLE cortex_analyses (
  id UUID PRIMARY KEY,
  
  -- 关联
  task_id UUID REFERENCES tasks(id),
  event_id INTEGER REFERENCES cecelia_events(id),
  trigger_event_type VARCHAR(50),  -- systemic_failure, rca_request, etc.
  
  -- RCA 核心结果
  root_cause TEXT NOT NULL,
  contributing_factors JSONB,      -- [{factor, impact, evidence}]
  mitigations JSONB,                -- [{action, expected_impact, priority}]
  
  -- 失败上下文
  failure_pattern JSONB,            -- {class, task_type, frequency, severity}
  affected_systems JSONB,           -- [system_name, ...]
  
  -- 学习与策略
  learnings JSONB,                  -- 关键洞察数组
  strategy_adjustments JSONB,       -- 推荐的参数调整
  
  -- 元数据
  analysis_depth VARCHAR(20),       -- quick, standard, deep
  confidence_score NUMERIC(3,2),    -- 0.00-1.00
  analyst VARCHAR(20) DEFAULT 'cortex',
  
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

-- 高效查询索引
CREATE INDEX idx_cortex_analyses_task_id ON cortex_analyses(task_id);
CREATE INDEX idx_cortex_analyses_created_at ON cortex_analyses(created_at DESC);
CREATE INDEX idx_cortex_analyses_trigger ON cortex_analyses(trigger_event_type);
CREATE INDEX idx_cortex_analyses_failure_pattern ON cortex_analyses USING GIN (failure_pattern);
```

**存储流程**：
```javascript
// 在 cortex.js 中
async function saveCortexAnalysis(analysis, context = {}) {
  const { task, event, failureInfo } = context;
  
  // 生成相似度 hash（用于去重）
  const similarityHash = generateSimilarityHash({
    task_type: task?.task_type,
    reason: failureInfo?.class,
    root_cause: analysis.analysis || ''
  });
  
  const result = await pool.query(`
    INSERT INTO cortex_analyses (
      task_id, event_id, trigger_event_type,
      root_cause, contributing_factors, mitigations,
      failure_pattern, affected_systems,
      learnings, strategy_adjustments,
      analysis_depth, confidence_score, analyst, metadata, similarity_hash
    ) VALUES ($1, $2, ..., $15)
    RETURNING id
  `, [...values]);
  
  // 异步质量评估（不阻塞主路径）
  evaluateQualityInitial(analysisId).catch(err => {
    console.error('[Cortex] Quality evaluation failed:', err.message);
  });
  
  return analysisId;
}
```

### 3.4 学习检索机制

**函数**：`searchRelevantLearnings(context, limit=10)` (在 `learning.js` 中)

**检索流程**：

```javascript
async function searchRelevantLearnings(context = {}, limit = 10) {
  // Step 1: 获取所有学习记录（最近 100 条）
  const result = await pool.query(`
    SELECT id, title, category, trigger_event, content, 
           strategy_adjustments, applied, created_at, metadata
    FROM learnings
    ORDER BY created_at DESC
    LIMIT 100
  `);
  
  // Step 2: 在内存中评分（可扩展到向量相似度）
  const scoredLearnings = result.rows.map(learning => {
    let score = 0;
    const metadata = learning.metadata || {};
    const content = learning.content || '';
    const contentLower = content.toLowerCase();
    
    // 1. 任务类型精确匹配（权重：10）
    if (context.task_type && metadata.task_type === context.task_type) {
      score += 10;
    }
    
    // 2. 失败分类匹配（权重：8）
    if (context.failure_class && content.includes(context.failure_class)) {
      score += 8;
    }
    
    // 3. 事件类型匹配（权重：6）
    if (context.event_type && learning.trigger_event === context.event_type) {
      score += 6;
    }
    
    // 4. 新近度（权重：1-3）
    const ageInDays = (Date.now() - new Date(learning.created_at).getTime()) 
                    / (1000 * 60 * 60 * 24);
    if (ageInDays <= 7) score += 3;
    else if (ageInDays <= 30) score += 2;
    else score += 1;
    
    // 5. 是否已应用（权重：+2）
    if (learning.applied) score += 2;
    
    return { ...learning, relevance_score: score };
  });
  
  // Step 3: 按相关度排序，取前 N 条
  scoredLearnings.sort((a, b) => b.relevance_score - a.relevance_score);
  return scoredLearnings.slice(0, limit);
}
```

**评分维度**：
- 任务类型精确匹配：+10
- 失败分类匹配：+8
- 事件类型匹配：+6
- 新近度（最近 7 天）：+3
- 新近度（最近 30 天）：+2
- 新近度（更旧）：+1
- 已应用状态：+2

### 3.5 决策日志（Decision Log）

**表结构**：

```sql
CREATE TABLE decision_log (
  id UUID PRIMARY KEY,
  trigger TEXT,                   -- 'thalamus' | 'cortex'
  input_summary TEXT,             -- 决策输入摘要
  llm_output_json JSONB,          -- LLM 完整输出（Decision JSON）
  action_result_json JSONB,       -- 执行结果
  status TEXT,                    -- 'pending' | 'executing' | 'completed' | 'failed'
  created_at TIMESTAMP DEFAULT NOW(),
  ts TIMESTAMP DEFAULT NOW()
);
```

**记录流程**：
```javascript
// 在 cortex.js 中
async function logCortexDecision(event, decision) {
  try {
    await pool.query(`
      INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      'cortex',
      \`Deep analysis for \${event.type}\`,
      decision,
      { analysis: decision.analysis },
      'pending'
    ]);
  } catch (err) {
    console.error('[cortex] Failed to log decision:', err.message);
  }
}
```

---

## 4. 数据库关键表

### 4.1 Core 表（决策相关）

| 表 | 用途 | 关键字段 | 版本 |
|----|------|---------|------|
| **decision_log** | LLM 决策记录 | trigger, llm_output_json, status | 基础 |
| **cecelia_events** | 全局事件日志 | event_type, source, payload | 基础 |
| **working_memory** | 短期记忆 | key, value_json | 基础 |
| **brain_config** | 系统配置 | key, value | 005 |
| **learnings** | 经验记录 | category, trigger_event, content | 012 |
| **cortex_analyses** | RCA 分析 | root_cause, failure_pattern, confidence | 013 |
| **cortex_quality_reports** | 分析质量评估 | analysis_id, score, feedback | 015 |
| **absorption_policies** | 吸收策略 | signature, policy_json, status | 016/025/026 |
| **pending_actions** | 危险操作审批队列 | action_type, params, status | 007 |
| **rca_cache** | RCA 去重缓存 | signature, analysis_id | 024 |

### 4.2 任务流表（与决策联系）

| 表 | 用途 | 关键字段 |
|----|------|---------|
| **tasks** | 任务队列 | status, task_type, priority, payload, prd_content |
| **goals** | OKR 目标 | type(global_okr/area_okr/kr), parent_id, progress |
| **projects** | 项目/Initiative | type(project/initiative), parent_id, repo_path |
| **pr_plans** | PR 工程规划 | project_id, dod, sequence, depends_on |

### 4.3 可观测性表

| 表 | 用途 | 版本 |
|----|------|------|
| **run_events** | 任务执行事件 | 023 |
| **failure_classifications** | 失败分类 | 内嵌于 task payload |
| **execution_logs** | 执行日志 | 文件系统 `/tmp/cecelia-*.log` |

---

## 5. API 接口清单

### 5.1 决策/分析 API

**POST /api/brain/decide**
- 请求：事件 JSON
- 响应：Decision（包含 actions, rationale, confidence）
- 用途：手动触发决策分析
- 模型：自动选择 L1 Haiku 或 L2 Sonnet

**POST /api/brain/rca** (推断)
- 请求：{ failed_task_id, history: [...] }
- 响应：RCA 报告
- 用途：触发根因分析

**GET /api/brain/decision-log**
- 查询参数：trigger, status, created_after
- 响应：决策日志列表
- 用途：查询决策历史

### 5.2 学习/记忆 API

**POST /api/brain/memory/search**
- 请求：{ query: string, topK: number, mode: "summary"|"full" }
- 响应：{ matches: [{id, level, title, similarity, preview}, ...] }
- 用途：搜索相关历史（Summary 层）

**GET /api/brain/memory/detail/:id**
- 请求参数：id (UUID)
- 响应：完整详情
- 用途：查看完整详情（Detail 层）

**POST /api/brain/memory/search-related**
- 请求：{ base_id: string, topK: number, exclude_self: boolean }
- 响应：{ matches: [...] }
- 用途：搜索相关任务（Related 层）

**GET /api/brain/learnings**
- 查询参数：category, applied, created_after, limit
- 响应：学习记录列表
- 用途：查询学习记录

**GET /api/brain/cortex-analyses**
- 查询参数：task_id, created_after, limit
- 响应：Cortex 分析列表
- 用途：查询 RCA 分析

### 5.3 系统状态 API

**GET /api/brain/status/full**
- 响应：完整系统状态快照
- 包含：tick 状态、alertness 等级、quarantine 统计、资源使用

**GET /api/brain/tick**
- 响应：当前 tick 循环状态
- 包含：enabled, running, last_tick, next_tick, loop_interval_ms

**GET /api/brain/alertness**
- 响应：警觉等级、指标、诊断信息

**GET /api/brain/health**
- 响应：健康检查结果
- 包含：database 连接、port 监听

---

## 6. 记忆检索机制

### 6.1 递进式搜索架构（三层）

```
┌─────────────────────────────────────────────────┐
│ Summary 层（快速检索）                          │
│ API: POST /api/brain/memory/search              │
│ 返回：id, level, title, similarity, preview     │
└─────────────────────────────────────────────────┘
                   ↓
        用户点击某条结果
                   ↓
┌─────────────────────────────────────────────────┐
│ Detail 层（完整信息）                           │
│ API: GET /api/brain/memory/detail/:id           │
│ 返回：id, level, title, description, status等   │
└─────────────────────────────────────────────────┘
                   ↓
        用户要求看相关任务
                   ↓
┌─────────────────────────────────────────────────┐
│ Related 层（关联搜索）                          │
│ API: POST /api/brain/memory/search-related      │
│ 返回：相似的其他任务/项目                        │
└─────────────────────────────────────────────────┘
```

### 6.2 相似度算法

**Hybrid Score** = 0.7 × Vector Similarity + 0.3 × Jaccard Similarity

**实现**：`similarity.js` (Phase 0 + Phase 1)

- Phase 0：Jaccard（token 级别的词汇相似度）
- Phase 1：OpenAI Embeddings + pgvector（向量语义相似度）

### 6.3 搜索关键词提取

**实体类型**：
- **Task**: id, title, description, status, metadata, project_id
- **Initiative**: id, title (from projects.name), description, status
- **KR**: id, title, description, status, parent_id

**计算相似度**：
```javascript
// 在 MemoryService 中
search(query, {topK, mode}) {
  const results = await similarity.searchWithVectors(query, {topK});
  
  if (mode === 'summary') {
    return {
      matches: results.matches.map(m => ({
        id: m.id,
        level: m.level,
        title: m.title,
        similarity: m.score,
        preview: generatePreview(m.description)
      }))
    };
  }
  
  return results;  // full mode
}
```

---

## 7. 决策执行流程

### 7.1 Decision Executor 工作流

**文件**：`decision-executor.js`

**执行步骤**：

```javascript
async function executeDecision(decision, context) {
  // Step 1: 验证决策格式和白名单
  const validation = validateDecision(decision);
  if (!validation.valid) {
    throw new Error(`Invalid decision: ${validation.errors.join('; ')}`);
  }
  
  // Step 2: 检查是否有危险操作
  const isDangerous = hasDangerousActions(decision);
  if (isDangerous) {
    // 进入审批队列
    await pool.query(`
      INSERT INTO pending_actions (
        action_type, params, context, decision_id, status
      ) VALUES ($1, $2, $3, $4, 'pending_approval')
    `, ['decision_execution', decision, context, ...]);
    
    console.log('[executor] Dangerous decision queued for approval');
    return { queued_for_approval: true };
  }
  
  // Step 3: 按顺序执行 actions
  const results = [];
  const startTx = await pool.query('BEGIN');
  
  try {
    for (const action of decision.actions) {
      const handler = actionHandlers[action.type];
      if (!handler) {
        throw new Error(\`No handler for action: \${action.type}\`);
      }
      
      const result = await handler(action.params, context);
      results.push({
        action: action.type,
        result,
        executed_at: new Date().toISOString()
      });
    }
    
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
  
  // Step 4: 记录执行结果
  await pool.query(`
    INSERT INTO cecelia_events (event_type, source, payload)
    VALUES ('decision_executed', 'executor', $1)
  `, [JSON.stringify({
    decision: decision,
    execution_results: results,
    timestamp: new Date().toISOString()
  })]);
  
  return { executed: true, results };
}
```

### 7.2 Action Handlers（27 个）

**分类**：

**任务类**（9 个）:
- `dispatch_task` → 调用 `tick.js` 的派发逻辑
- `create_task` → 创建新任务
- `cancel_task` → 标记任务为 cancelled
- `retry_task` → 重试失败任务（status → queued）
- `reprioritize_task` → 修改优先级
- `pause_task` → 暂停任务
- `resume_task` → 恢复暂停的任务
- `mark_task_blocked` → 标记为阻塞（记录原因）
- `quarantine_task` → 隔离任务

**OKR 类**（3 个）:
- `create_okr` → 创建目标
- `update_okr_progress` → 更新进度
- `assign_to_autumnrice` → 指派给秋米拆解

**系统/通知类**（4 个）:
- `notify_user` → 发送通知
- `log_event` → 记录事件
- `escalate_to_brain` → 升级到皮层
- `request_human_review` → 请求人工审批

**分析类**（2 个）:
- `analyze_failure` → 分析失败
- `predict_progress` → 预测进度

**规划类**（1 个）:
- `create_proposal` → 创建计划

**知识类**（3 个）:
- `create_learning` → 创建学习记录
- `update_learning` → 更新学习记录
- `trigger_rca` → 触发 RCA

**生命周期类**（3 个）:
- `update_task_prd` → 更新 PRD
- `archive_task` → 归档任务
- `defer_task` → 延迟任务

**控制类**（2 个）:
- `no_action` → 无操作
- `fallback_to_tick` → 降级到 L0

---

## 8. 核心文件导航

### 8.1 决策流程相关

```
/home/xx/perfect21/cecelia/core/brain/src/

决策入口：
├── thalamus.js (264 KB)
│   ├── analyzeEvent(event) - L1 丘脑主入口
│   ├── callSonnet(prompt) - Sonnet API 调用
│   ├── quickRoute(event) - 硬编码快速路由
│   ├── EVENT_TYPES - 事件类型枚举
│   ├── ACTION_WHITELIST - 27 个 action 白名单
│   └── validateDecision(decision) - Decision 格式验证
│
├── cortex.js (822 KB)
│   ├── analyzeDeep(event) - L2 皮层主入口
│   ├── performRCA(failedTask) - 根因分析
│   ├── saveCortexAnalysis(analysis) - RCA 持久化
│   ├── searchRelevantAnalyses(context) - 历史 RCA 搜索
│   ├── callOpus(prompt) - Opus API 调用
│   ├── storeAbsorptionPolicy(policy) - 吸收策略存储
│   └── CORTEX_ACTION_WHITELIST - L2 额外 action
│
├── decision.js
│   ├── compareGoalProgress() - 对比目标进度
│   ├── generateDecision() - 生成决策
│   └── executeDecision() - 执行决策
│
├── decision-executor.js (600+ KB)
│   ├── executeDecision(decision) - Decision 执行主函数
│   ├── actionHandlers - 27 个 action 处理器
│   └── 事务化执行（BEGIN/COMMIT/ROLLBACK）
│
执行层：
├── executor.js (1.2 MB)
│   ├── triggerCeceliaRun(task) - 派发任务执行
│   ├── checkServerResources() - 资源检查
│   ├── checkExitReason(pid) - 进程退出诊断
│   ├── MAX_SEATS / INTERACTIVE_RESERVE - 并发配置
│   └── 进程管理与资源限制
│
├── tick.js (主调度循环)
│   ├── executeTick() - 5 分钟执行一次的正式 tick
│   ├── dispatchNextTask() - 派发下一个任务
│   ├── planNextTask() - KR 轮转规划
│   ├── TICK_LOOP_INTERVAL_MS / TICK_INTERVAL_MINUTES
│   └── initTickLoop() / startTickLoop()
```

### 8.2 记忆与学习相关

```
├── learning.js (400+ KB)
│   ├── recordLearning(analysis) - 记录学习
│   ├── applyStrategyAdjustments(adjustments) - 应用策略调整
│   ├── searchRelevantLearnings(context) - 学习搜索（评分）
│   ├── ADJUSTABLE_PARAMS - 可调参数白名单
│   └── getRecentLearnings() - 获取最近学习
│
├── services/memory-service.js
│   ├── search(query, {topK, mode}) - Summary 层搜索
│   ├── getDetail(id) - Detail 层
│   ├── searchRelated(baseId) - Related 层
│   └── _generatePreview() / _formatDetail()
│
├── similarity.js (500+ KB)
│   ├── searchSimilar(query, topK, filters) - 相似度搜索
│   ├── calculateScore(query, entity) - 评分算法
│   ├── getAllActiveEntities(filters) - 获取所有实体
│   └── Hybrid: Vector (0.7) + Jaccard (0.3)
│
├── routes/memory.js
│   ├── POST /api/brain/memory/search
│   ├── GET /api/brain/memory/detail/:id
│   └── POST /api/brain/memory/search-related
│
├── embedding-service.js
│   └── OpenAI Embeddings 生成 (Phase 1 of similarity)
│
├── openai-client.js
│   └── generateEmbedding(text) - OpenAI 调用
```

### 8.3 保护系统相关

```
├── alertness/ (警觉系统)
│   ├── index.js
│   │   ├── initAlertness() - 初始化
│   │   ├── evaluateAlertness() - 评估等级
│   │   ├── getCurrentAlertness() - 获取当前等级
│   │   ├── canDispatch() / canPlan() - 权限检查
│   │   └── ALERTNESS_LEVELS (IDLE/ALERT/EMERGENCY/CRITICAL/SHUTDOWN)
│   ├── diagnosis.js - 诊断系统异常
│   ├── escalation.js - 升级流程
│   ├── healing.js - 自愈机制
│   └── metrics.js - 指标采集
│
├── circuit-breaker.js (300+ KB)
│   ├── isAllowed() - 熔断判断（CLOSED/OPEN/HALF_OPEN）
│   ├── recordSuccess() / recordFailure()
│   └── getAllStates() - 获取所有熔断器状态
│
├── quarantine.js (600+ KB)
│   ├── handleTaskFailure(task) - 失败处理
│   ├── quarantineTask(taskId) - 隔离任务
│   ├── checkExpiredQuarantineTasks() - 自动释放
│   └── getQuarantineStats() - 隔离统计
│
├── watchdog.js (500+ KB)
│   ├── monitorsProcesses() - 进程监控
│   ├── CPUWatchdog - CPU 过载检测
│   └── /proc 采样、动态阈值、两段式 kill
```

### 8.4 数据库相关

```
├── migrations/ (38 个 migrations)
│   ├── 000_base_schema.sql - 基础表
│   ├── 012_learnings_table.sql - 经验表
│   ├── 013_cortex_analyses.sql - RCA 分析表
│   ├── 015_cortex_quality_system.sql - 质量评估
│   ├── 024_add_rca_cache_table.sql - RCA 去重
│   └── ...
│
├── db.js - PostgreSQL 连接池
├── db-config.js - 数据库配置
├── task-router.js - 任务路由规则
└── task-updater.js - 任务状态更新
```

### 8.5 事件系统

```
├── event-bus.js
│   ├── emit(eventType, payload) - 发送事件
│   ├── on(eventType, handler) - 监听事件
│   └── 内存事件总线
│
├── events/taskEvents.js
│   ├── publishTaskStarted() - 任务开始事件
│   ├── publishExecutorStatus() - 执行器状态
│   └── WebSocket 广播
│
├── websocket.js
│   └── 实时事件推送（前端订阅）
└── trace.js - 执行链路追踪
```

---

## 总结

### 决策流程三层架构

```
L0 脑干（纯代码）
  ↓ 检查 → 简单? → 直接执行
  ├─ NO
  └─ YES 升级
     ↓
L1 丘脑（Haiku）
  ├─ quickRoute() → 快速路由（不调用 LLM）
  └─ analyzeEvent() → 调用 Sonnet
     ├─ level=0/1 → 返回决策
     └─ level=2 → 升级
        ↓
L2 皮层（Sonnet）
  └─ analyzeDeep() → 调用 Opus
     ├─ RCA 分析
     ├─ 战略调整建议
     ├─ 经验记录
     └─ 返回深度决策
```

### 记忆检索三层架构

```
Summary 层（快速搜索）
  ↓ 用户点击
Detail 层（完整信息）
  ↓ 用户要求看相关
Related 层（关联搜索）
```

### 关键数据流

```
事件 → Thalamus (L1) → 评分 + 搜索学习 → Decision
                          ↓ (level=2)
                       Cortex (L2) → 搜索历史分析 + 注入上下文 → 深度 Decision
                          ↓
                    Decision-Executor → 验证 → 执行 Action → 记录结果
```

### 记忆持久化

```
Thalamus 输出 (L1)
  ↓
decision_log 表（24h 窗口）
  ↓
Cortex 输出 (L2)
  ├─ learnings → 学习记录
  ├─ cortex_analyses → RCA 分析
  └─ absorption_policy → 吸收策略
     ↓
搜索中注入历史（searchRelevantLearnings / searchRelevantAnalyses）
  ↓
改进下一次决策（循环学习）
```

