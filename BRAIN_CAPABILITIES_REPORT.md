# Cecelia Core Brain - 完整能力报告

**生成时间**: 2026-02-07
**Brain 版本**: 1.22.1
**Schema 版本**: 016
**测试通过率**: 860/860 (100%)

---

## 📊 系统概览

### 核心定位
Cecelia Brain = **自主运行的任务调度与决策系统**
- 24/7 自主运行（不需要人工介入）
- 从失败中学习并调整策略
- 自我保护和资源管理
- 三层决策架构（脑干→丘脑→皮层）

### 架构图
```
用户意图
    ↓
┌─────────────────────────────────────────────┐
│  L2 皮层 (Cortex) — Opus LLM               │
│  深度分析、RCA、策略调整                    │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│  L1 丘脑 (Thalamus) — Sonnet LLM           │
│  事件路由、快速判断                         │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│  L0 脑干 (Brainstem) — 纯代码              │
│  tick.js, executor.js, planner.js, ...      │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│  PostgreSQL — 唯一真相源                    │
│  cecelia 数据库, schema v016                │
│  20 张核心表                                │
└─────────────────────────────────────────────┘
```

---

## 🧠 三层大脑架构

### L0 脑干 (Brainstem) — 纯代码

**职责**: 确定性执行，状态推进，资源管理

| 模块 | 文件 | 核心能力 |
|------|------|----------|
| **主循环** | tick.js | • 5秒循环间隔，5分钟执行一次<br>• KR 轮转评分选任务<br>• 自动超时处理（60分钟+）<br>• 孤儿任务清理<br>• 日常焦点管理 |
| **执行器** | executor.js | • 动态并发控制（1-12席位）<br>• 压力自适应限流（4档）<br>• 进程生成和管理<br>• 指数退避重试<br>• 失败分类和隔离 |
| **规划器** | planner.js | • KR 自动拆解任务<br>• PRD 生成<br>• 依赖识别 |
| **看门狗** | watchdog.js | • /proc 实时采样<br>• 动态 RSS/CPU 阈值<br>• 三级响应（警告/杀进程/危机）<br>• 两阶段杀进程（SIGTERM→SIGKILL） |
| **警觉系统** | alertness.js | • 4级保护（Normal/Alert/Emergency/Coma）<br>• 信号聚合（8种信号）<br>• 指数衰减恢复<br>• Token bucket 限流 |
| **熔断器** | circuit-breaker.js | • 三态隔离（CLOSED/OPEN/HALF_OPEN）<br>• 按服务追踪<br>• 3次失败自动熔断<br>• 30分钟自动半开 |
| **隔离区** | quarantine.js | • 失败模式分类（6种）<br>• 3次失败自动隔离<br>• 可疑输入检测（80+正则）<br>• 手动释放需 RCA |

### L1 丘脑 (Thalamus) — Sonnet LLM

**职责**: 快速路由，初步判断

| 能力 | 说明 |
|------|------|
| **事件路由** | 识别事件类型，分配处理路径 |
| **快速判断** | <1秒响应，置信度评分 |
| **异常检测** | 识别系统性故障模式 |
| **决策生成** | 生成带置信度的决策建议 |
| **危险过滤** | 识别并拦截危险操作 |

### L2 皮层 (Cortex) — Opus LLM

**职责**: 深度分析，战略调整

| 模块 | 能力 |
|------|------|
| **RCA 分析** | • 根本原因分析<br>• 系统性失败识别<br>• 策略调整建议 |
| **质量评估** | • 分析质量评分<br>• 相似度检测（防重复）<br>• 有效性追踪 |
| **学习系统** | • 从失败中学习<br>• 策略有效性评估<br>• 相关经验检索 |
| **提案系统** | • 策略调整提案<br>• 审批/拒绝工作流<br>• 回滚机制 |

---

## 🛡️ 保护系统

### 1. 警觉系统（Alertness）— 4级自适应保护

| 级别 | 触发条件 | 系统行为 | 限流效果 |
|------|----------|----------|----------|
| **L0 Normal** | 系统压力 < 0.5 | 100% 正常运行 | 12席位 |
| **L1 Alert** | 压力 0.5-0.7 | 减少派发，增加监控 | 8席位 |
| **L2 Emergency** | 压力 0.7-0.9 | 最小运营，停止新任务 | 4席位 |
| **L3 Coma** | 压力 ≥ 0.9 | 仅心跳，等待恢复 | 0席位（停止） |

**8种信号源**：
- 熔断器打开次数
- 隔离区任务数量
- 看门狗杀进程次数
- LLM 调用失败率
- 数据库连接状态
- 任务超时率
- 资源使用率
- 错误日志频率

**恢复机制**: 指数衰减（信号半衰期 30分钟）

### 2. 熔断器（Circuit Breaker）

**三态状态机**:
```
CLOSED (正常)
  ↓ 3次连续失败
OPEN (隔离30分钟)
  ↓ 30分钟超时
HALF_OPEN (试探)
  ↓ 成功 → CLOSED
  ↓ 失败 → OPEN
```

**按服务隔离**: cecelia-run, external-api, database 等独立追踪

### 3. 看门狗（Watchdog）

**监控指标**:
- RSS 内存使用
- CPU 持续占用
- 进程启动时长

**动态阈值**:
- 杀进程阈值：min(35% 总内存, 2400MB)
- 警告阈值：75% of 杀进程阈值
- 60秒启动宽限期

**三级响应**:
1. **警告**: 记录日志，发送告警
2. **杀进程**: SIGTERM(5s) → SIGKILL → 重入队列
3. **危机**: 2次被杀 → 隔离为 resource_hog

### 4. 隔离区（Quarantine）

**自动隔离条件**:
- 3次失败
- 2次被看门狗杀死
- 检测到可疑输入

**失败分类（6种）**:
1. **BILLING_CAP** - API 配额耗尽
2. **RATE_LIMIT** - 频率限制
3. **NETWORK** - 网络问题
4. **AUTH** - 认证失败
5. **RESOURCE** - 资源不足
6. **TASK_ERROR** - 任务级错误

**TTL 自动释放**:
- RATE_LIMIT: 30分钟
- NETWORK: 30分钟
- RESOURCE: 1小时
- REPEATED_FAILURE: 24小时
- MANUAL: 永不自动释放

---

## 🔄 任务生命周期

```
1. 创建 (Create)
   ↓
2. 路由 (Route) — task-router.js
   - US: dev/review/qa/audit
   - HK: talk/research/data
   ↓
3. 规划 (Plan) — planner.js
   - KR 轮转评分
   - 生成 PRD
   ↓
4. 派发 (Dispatch) — tick.js
   - 检查并发限制
   - 检查熔断器
   - Token bucket 限流
   ↓
5. 执行 (Execute) — executor.js
   - 生成命令
   - 创建进程
   - 监控输出
   ↓
6. 监控 (Monitor) — watchdog.js
   - RSS/CPU 采样
   - 超时检测
   - 健康检查
   ↓
7. 结果处理
   ├─ 成功 → 记录熔断器成功
   ├─ 失败 → 分类 → 重试/隔离
   └─ 超时 → 杀进程 → 重入队列
   ↓
8. 学习 (Learn) — learning.js + cortex.js
   - 记录失败经验
   - RCA 分析
   - 策略调整建议
```

---

## 🎯 资源管理

### 动态并发控制

**计算公式**:
```
effectiveSlots = min(
  usable_memory / 500MB,
  usable_cpu / 0.5 core
)

maxSlots = min(effectiveSlots, 12)
```

**8核16GB服务器**:
- 内存席位: 16000MB / 500MB = 32
- CPU 席位: 8 / 0.5 = 16
- 最终: min(32, 16, 12) = 12 席位

### 压力自适应限流（4档）

| 系统压力 | 可用席位 | 说明 |
|----------|----------|------|
| < 0.5 | 12 | 正常运行 |
| 0.5-0.7 | 8 | 中等压力，减少派发 |
| 0.7-0.9 | 4 | 高压力，最小运营 |
| 0.9-1.0 | 1 | 危机模式，极少派发 |
| ≥ 1.0 | 0 | 停止派发，仅心跳 |

### Token Bucket 限流

**3种桶**:
- `dispatch`: 10 tokens/min（派发限流）
- `l1_calls`: 20 tokens/min（丘脑调用限流）
- `l2_calls`: 5 tokens/min（皮层调用限流）

**自动补充**: 每分钟按 refillRate 补充

---

## 🧪 学习与智能

### 失败学习循环

```
任务失败
  ↓
classifyFailure() — 6种分类
  ↓
计算 retry_strategy
  ├─ BILLING_CAP → 等待 reset_time
  ├─ RATE_LIMIT → 指数退避
  ├─ NETWORK → 短退避（30s）
  └─ 其他 → 按分类处理
  ↓
重入队列（使用 retry_strategy.next_run_at）
  ↓
如果3次失败 → 隔离区
  ↓
Cortex RCA 分析（系统性失败）
  ↓
生成策略调整建议
  ↓
写入 brain_config 表
  ↓
config-loader 读取配置
  ↓
应用到系统行为
  ↓
策略有效性评估
  - 计算改进率（baseline vs post）
  - >5% 改进 → 标记有效
  - 记录到 strategy_effectiveness 表
```

### Cortex 质量系统

**4维质量评分**:
1. **完整性** (Completeness): 根本原因、因素、策略是否完整
2. **有效性** (Effectiveness): 用户评分（1-5星）- 重现惩罚
3. **及时性** (Timeliness): 分析生成速度
4. **独特性** (Uniqueness): 与现有分析的相似度

**相似度检测**:
- 使用 similarity_hash (task_type + reason + root_cause)
- >80% 相似 → 建议复用，不创建新分析
- <80% 相似 → 创建新分析

**用户反馈循环**:
```
RCA 分析生成
  ↓
用户评分（1-5星）
  ↓
effectiveness = (rating × 8) - reoccurrence_penalty
  - 5星 = 40分
  - 重现1次 = -5分
  - 重现2次 = -10分
  - 重现3+次 = -20分
  ↓
更新 quality_score 和 quality_dimensions
```

---

## 📡 API 端点（80+个）

### 核心状态与控制
- `GET /api/brain/status` - 当前系统状态
- `GET /api/brain/status/full` - 完整状态快照
- `GET /api/brain/health` - 健康检查
- `POST /api/brain/tick` - 手动触发 tick

### Tick 管理
- `GET /api/brain/tick/status` - Tick 循环状态
- `POST /api/brain/tick/enable` - 启用
- `POST /api/brain/tick/disable` - 禁用
- `POST /api/brain/tick/drain` - 优雅关闭
- `GET /api/brain/tick/drain-status` - 排空进度

### 警觉系统
- `GET /api/brain/alertness` - 当前警觉级别
- `POST /api/brain/alertness/evaluate` - 重新评估
- `POST /api/brain/alertness/override` - 手动覆盖

### 熔断器
- `GET /api/brain/circuit-breaker` - 所有服务状态
- `POST /api/brain/circuit-breaker/:service/reset` - 重置特定服务

### 隔离区
- `GET /api/brain/quarantine` - 隔离任务列表
- `GET /api/brain/quarantine/stats` - 统计信息
- `POST /api/brain/quarantine/:taskId/release` - 释放任务
- `POST /api/brain/quarantine/release-all` - 批量释放

### Cortex & Learning
- `GET /api/brain/cortex/analyses` - RCA 分析列表
- `POST /api/brain/cortex/feedback` - 提交反馈
- `POST /api/brain/cortex/evaluate-quality` - 质量评估
- `POST /api/brain/cortex/check-similarity` - 相似度检测
- `POST /api/brain/learning/evaluate-strategy` - 策略有效性评估

### Feature 管理
- `GET /api/brain/features` - 所有 Feature
- `POST /api/brain/features` - 创建 Feature
- `PUT /api/brain/features/:id` - 更新 Feature
- `GET /api/brain/feature-tick/status` - Feature Tick 状态

### 决策与操作
- `GET /api/brain/decisions` - 决策历史
- `GET /api/brain/pending-actions` - 待审批操作
- `POST /api/brain/pending-actions/:id/approve` - 批准
- `POST /api/brain/pending-actions/:id/reject` - 拒绝
- `POST /api/brain/action/create-task` - 创建任务
- `POST /api/brain/action/create-goal` - 创建目标

**完整列表**: 80+ 端点涵盖所有系统功能

---

## 💾 数据库 Schema（v016）

### 核心表（20张）

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| **goals** | OKR 存储 | id, title, type, status, parent_id, progress |
| **projects** | 仓库+Feature | id, name, repo_path, parent_id |
| **features** | Feature 状态机 | id, project_id, name, status |
| **tasks** | 任务 | id, project_id, goal_id, task_type, status, payload |
| **agent_runs** | 执行历史 | id, task_id, run_id, status, output |
| **execution_logs** | 进程日志 | id, task_id, level, message, timestamp |
| **execution_checkpoints** | 进度快照 | id, task_id, checkpoint_key, data |
| **circuit_breaker_state** | 熔断器状态 | service_name, state, failure_count |
| **alertness_state** | 警觉状态 | current_level, signals, last_evaluated_at |
| **decisions** | 决策历史 | id, event_type, decision_json, executed_at |
| **pending_actions** | 待审批队列 | id, action_type, params, status |
| **brain_config** | 动态配置 | key, value, updated_at |
| **schema_version** | 迁移追踪 | version, description, applied_at |
| **cortex_analyses** | RCA 记录 | id, task_id, root_cause, strategy_adjustments, quality_score, user_feedback, reoccurrence_count |
| **learnings** | 失败学习 | id, category, context, strategy_adjustments |
| **strategy_adoptions** | 策略采用 | id, strategy_key, old_value, new_value, adopted_at |
| **strategy_effectiveness** | 策略有效性 | id, adoption_id, baseline_success_rate, post_adjustment_success_rate, is_effective |
| **proposals** | 策略提案 | id, proposal_type, params, status |
| **event_log** | 审计追踪 | id, event_type, data, timestamp |
| **published_items** | 发布系统 | id, content, status |

### 迁移历史（16个）
- 000_base_schema.sql → 016_immune_system_connections.sql
- 最新: Migration 016 添加策略有效性追踪和质量反馈

---

## ✅ 测试覆盖

**总测试**: 860/860 通过 (100%)
**测试文件**: 56个

### 关键测试覆盖

| 系统 | 测试文件 | 测试数 |
|------|----------|--------|
| **Tick Loop** | tick.test.js | 9 |
| **Executor** | executor.test.js | 15+ |
| **Alertness** | alertness.test.js | 12 |
| **Circuit Breaker** | circuit-breaker.test.js | 8 |
| **Quarantine** | quarantine.test.js | 20+ |
| **Watchdog** | watchdog.test.js | 10 |
| **Cortex** | cortex.test.js | 15+ |
| **Learning** | learning.test.js | 12 |
| **Config Loader** | config-loader.test.js | 13 |
| **Quality** | cortex-quality.test.js | 20+ |
| **Migrations** | migration-*.test.js | 100+ |

---

## 📈 性能指标

### 系统容量
- **最大并发**: 12 任务（动态调整）
- **Tick 间隔**: 5秒循环，5分钟执行
- **Feature Tick**: 30秒间隔
- **任务超时**: 60分钟自动失败
- **熔断器恢复**: 30分钟

### 资源限制
- **进程内存阈值**: min(35% 总内存, 2400MB)
- **警告阈值**: 75% of 杀进程阈值
- **启动宽限期**: 60秒
- **重试间隔**: 指数退避（2^n × 60s，最大30分钟）

### LLM 调用
- **L1 丘脑**: Sonnet, <1秒响应
- **L2 皮层**: Opus, 5-30秒分析
- **Token 限流**:
  - dispatch: 10/min
  - L1: 20/min
  - L2: 5/min

---

## 🎯 系统能力总结

### ✅ 完全实现的功能

1. **自主运行** - 24/7 无人值守运行
2. **智能派发** - KR 轮转评分，自动选择下一个任务
3. **资源管理** - 动态并发控制，压力自适应
4. **故障保护** - 4级警觉，熔断器，看门狗，隔离区
5. **失败学习** - RCA 分析，策略调整，有效性评估
6. **质量评估** - 4维评分，相似度检测，用户反馈
7. **智能重试** - 按失败类型自定义重试策略
8. **动态配置** - 策略调整可被系统读取和应用
9. **Feature 管理** - 多任务 Feature 状态机
10. **审计追踪** - 完整的事件日志和决策记录

### 🎉 免疫系统完整闭环

```
失败 → 分类 → 重试策略 → 隔离（3次）
  ↓
RCA 分析（Cortex）
  ↓
策略调整建议
  ↓
写入 brain_config
  ↓
config-loader 读取 ✅
  ↓
应用到系统 ✅
  ↓
有效性评估 ✅
  ↓
质量反馈 ✅
```

**所有连接已完成！** 系统可以真正从失败中学习并自我改进。

---

## 📝 开发规范

### 版本控制
- **Brain 版本**: `brain/package.json` (当前 1.22.1)
- **版本追踪**: `.brain-versions` (SSOT)
- **Schema 版本**: Migration 文件编号 (当前 016)
- **EXPECTED_SCHEMA_VERSION**: `brain/src/selfcheck.js` (016)

### 文档规范
- **架构定义**: `DEFINITION.md` (主文档)
- **开发经验**: `LEARNINGS.md` (1015 lines, 持续更新)
- **能力清单**: `BRAIN_CAPABILITIES_REPORT.md` (本文档)
- **API 文档**: 嵌入在 routes.js 代码注释中

### 测试规范
- **必须**: 所有新功能都要有测试
- **覆盖**: Migration, 业务逻辑, API 端点
- **隔离**: beforeEach 清理数据，避免污染
- **目标**: 保持 100% 通过率

### CI/CD 规范
- **CI 检查**: Facts Consistency, Version Check, Brain Tests, Semantic Brain
- **Required Checks**: Brain (Node.js), Semantic Brain (Python), Version Check
- **Branch Protection**: main + develop 都需要 PR + CI 通过
- **enforce_admins**: true（管理员也要走 PR）

---

## 🚀 部署状态

**当前状态**: 完全健康，可立即部署

- ✅ 所有测试通过 (860/860)
- ✅ 所有连接完整
- ✅ 文档更新同步
- ✅ 无遗留垃圾文件
- ✅ 无矛盾信息
- ✅ Schema 版本正确 (v016)
- ✅ 版本号同步 (1.22.1)

**部署方式**:
```bash
# 构建镜像
bash scripts/brain-build.sh

# 部署（自动：migrate → selfcheck → test → start）
bash scripts/brain-deploy.sh
```

**健康检查**:
```bash
# API 健康检查
curl http://localhost:5221/api/brain/health

# 完整状态
curl http://localhost:5221/api/brain/status/full
```

---

**报告结束** - Cecelia Brain 1.22.1 完整能力清单
**免疫系统**: 100% 功能完整 ✅
**系统状态**: 可立即部署 🚀
